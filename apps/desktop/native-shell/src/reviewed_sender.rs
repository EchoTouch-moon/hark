//! Experimental, feature-gated TLS transport. It is not wired to the desktop.
//! DNS/TLS connection itself is an external effect: the trusted caller must
//! first obtain the user's persisted approval and current authorization. The
//! Core send lock must then recheck both before calling `begin` synchronously.
//! A begun request cannot be unsent; any error after start is ambiguous and
//! must not trigger an automatic retry. Response reads happen outside that lock.

use std::collections::HashSet;
use std::fmt;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use rustls::{ClientConfig, ClientConnection, StreamOwned};

use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use sha2::{Digest, Sha256};

pub const STEPFUN_ENDPOINT: &str = "https://api.stepfun.com/step_plan/v1/messages?beta=true";
pub const STEPFUN_MODEL: &str = "step-3.7-flash";
pub const MAX_REQUEST_BYTES: usize = 512 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
pub const MAX_OUTPUT_TOKENS: u64 = 4096;
const HTTP_HOST: &str = "api.stepfun.com";
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_LINE_BYTES: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(250);
static RESOLVERS: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone, Default)]
pub struct CancelHandle {
    inner: Arc<CancelState>,
}

#[derive(Default)]
struct CancelState {
    cancelled: AtomicBool,
    // Serializes cancellation with each synchronous write and flush.
    start: Mutex<()>,
}

impl CancelHandle {
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        // Wait for a concurrent socket write or flush to finish. Once this
        // returns no subsequent request bytes can be written by this handle.
        let _guard = self.inner.start.lock().unwrap_or_else(|e| e.into_inner());
    }
    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::SeqCst)
    }
    fn check(&self, deadline: Instant) -> io::Result<()> {
        if self.is_cancelled() {
            // `Read::read_exact` retries `Interrupted` forever, so cancellation
            // must use a terminal error kind rather than EINTR semantics.
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "cancelled",
            ));
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "deadline exceeded"));
        }
        Ok(())
    }
}

/// A certificate-verified connection. Establish only after persisted approval.
/// It contains no body or credential and has not sent an HTTP request.
pub struct PreparedConnection {
    tls: StreamOwned<ClientConnection, TcpStream>,
    cancel: CancelHandle,
}

/// DNS is bounded in count and waiting time; detached resolver workers never
/// receive a credential, request body or socket and cannot send later.
fn resolve_stepfun(cancel: &CancelHandle, deadline: Instant) -> io::Result<Vec<SocketAddr>> {
    cancel.check(deadline)?;
    if RESOLVERS
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| {
            (n < 4).then_some(n + 1)
        })
        .is_err()
    {
        return Err(io::Error::other("DNS capacity exhausted"));
    }
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = (HTTP_HOST, 443).to_socket_addrs().map(|a| {
            a.take(32)
                .filter(|address| publicly_routable(address.ip()))
                .collect()
        });
        RESOLVERS.fetch_sub(1, Ordering::SeqCst);
        let _ = tx.send(result);
    });
    loop {
        cancel.check(deadline)?;
        match rx.recv_timeout(
            deadline
                .saturating_duration_since(Instant::now())
                .min(POLL_INTERVAL),
        ) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(io::Error::other("DNS unavailable"))
            }
        }
    }
}

// Do not allow DNS rebinding to turn the fixed provider name into a local or
// reserved-network connection. The certificate is verified independently.
fn publicly_routable(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a >= 224
                || ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && (c == 0 || c == 2))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return publicly_routable(IpAddr::V4(v4));
            }
            let segments = ip.segments();
            (segments[0] & 0xe000) == 0x2000 && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

impl PreparedConnection {
    /// The caller must already have obtained durable user approval. This API
    /// cannot enforce that authorization and must remain in trusted Native.
    pub fn connect_after_approval(cancel: CancelHandle) -> io::Result<Self> {
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let addresses = resolve_stepfun(&cancel, deadline)?;
        for address in addresses {
            cancel.check(deadline)?;
            let wait = deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(1));
            if let Ok(socket) = TcpStream::connect_timeout(&address, wait) {
                let config = production_tls_config()
                    .map_err(|_| io::Error::other("TLS configuration unavailable"))?;
                return Self::handshake(socket, config, HTTP_HOST, cancel, deadline);
            }
        }
        Err(io::Error::other("connection unavailable"))
    }

    fn handshake(
        socket: TcpStream,
        config: Arc<ClientConfig>,
        host: &'static str,
        cancel: CancelHandle,
        deadline: Instant,
    ) -> io::Result<Self> {
        socket.set_read_timeout(Some(POLL_INTERVAL))?;
        socket.set_write_timeout(Some(POLL_INTERVAL))?;
        let name = rustls::pki_types::ServerName::try_from(host)
            .map_err(|_| io::Error::other("invalid TLS server name"))?;
        let conn = ClientConnection::new(config, name)
            .map_err(|_| io::Error::other("TLS configuration unavailable"))?;
        let mut tls = StreamOwned::new(conn, socket);
        while tls.conn.is_handshaking() {
            cancel.check(deadline)?;
            match tls.conn.complete_io(&mut tls.sock) {
                Ok(_) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => return Err(io::Error::other("TLS verification or handshake failed")),
            }
        }
        cancel.check(deadline)?;
        Ok(Self { tls, cancel })
    }

    /// Call synchronously inside Core's consumed-approval, revalidated writer
    /// lock. This method returns only once request bytes have been flushed or
    /// the socket has failed/closed; it does not queue later work. Any error
    /// after the first write is uncertain and the approval remains consumed.
    pub fn begin(
        mut self,
        body: &str,
        credential: &str,
        approved_sha256: &str,
    ) -> io::Result<StartedResponse> {
        let request = ReviewedRequest::validate(body, credential, approved_sha256)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "reviewed request refused"))?;
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        // Guard every synchronous write and flush, including the first byte.
        guarded_write(&mut self.tls, &self.cancel, deadline, b"P")?;
        guarded_flush(&mut self.tls, &self.cancel, deadline)?;
        guarded_write(&mut self.tls, &self.cancel, deadline, b"OST /step_plan/v1/messages?beta=true HTTP/1.1\r\nHost: api.stepfun.com\r\nContent-Type: application/json\r\nAccept: text/event-stream\r\nAccept-Encoding: identity\r\nAnthropic-Version: 2023-06-01\r\nX-Api-Key: ")?;
        guarded_write(&mut self.tls, &self.cancel, deadline, credential.as_bytes())?;
        guarded_write(
            &mut self.tls,
            &self.cancel,
            deadline,
            b"\r\nConnection: close\r\nContent-Length: ",
        )?;
        guarded_write(
            &mut self.tls,
            &self.cancel,
            deadline,
            request.body().len().to_string().as_bytes(),
        )?;
        guarded_write(&mut self.tls, &self.cancel, deadline, b"\r\n\r\n")?;
        guarded_write(
            &mut self.tls,
            &self.cancel,
            deadline,
            request.body().as_bytes(),
        )?;
        guarded_flush(&mut self.tls, &self.cancel, deadline)?;
        Ok(StartedResponse {
            reader: BufReader::new(BoundedTls {
                tls: self.tls,
                cancel: self.cancel,
                deadline,
            }),
        })
    }
}

fn guarded_write(
    tls: &mut StreamOwned<ClientConnection, TcpStream>,
    cancel: &CancelHandle,
    deadline: Instant,
    mut bytes: &[u8],
) -> io::Result<()> {
    while !bytes.is_empty() {
        match guarded_send_operation(cancel, deadline, || tls.write(bytes)) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "TLS write stopped",
                ))
            }
            Ok(n) => bytes = &bytes[n..],
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                cancel.check(deadline)?
            }
            Err(_) => {
                cancel.check(deadline)?;
                return Err(io::Error::other("TLS write failed"));
            }
        }
    }
    Ok(())
}

fn guarded_flush(
    tls: &mut StreamOwned<ClientConnection, TcpStream>,
    cancel: &CancelHandle,
    deadline: Instant,
) -> io::Result<()> {
    loop {
        match guarded_send_operation(cancel, deadline, || tls.flush()) {
            Ok(()) => return Ok(()),
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                cancel.check(deadline)?
            }
            Err(_) => {
                cancel.check(deadline)?;
                return Err(io::Error::other("TLS flush failed"));
            }
        }
    }
}

/// The lock spans one actual synchronous TLS I/O call. Socket timeouts bound
/// the time cancellation waits for an in-flight operation. Never queue a later
/// asynchronous write from this closure.
fn guarded_send_operation<T>(
    cancel: &CancelHandle,
    deadline: Instant,
    operation: impl FnOnce() -> io::Result<T>,
) -> io::Result<T> {
    let _guard = cancel
        .inner
        .start
        .lock()
        .map_err(|_| io::Error::other("cancellation lock poisoned"))?;
    cancel.check(deadline)?;
    operation()
}

struct BoundedTls {
    tls: StreamOwned<ClientConnection, TcpStream>,
    cancel: CancelHandle,
    deadline: Instant,
}
impl Read for BoundedTls {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            self.cancel.check(self.deadline)?;
            match self.tls.read(buf) {
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => return Err(io::Error::other("TLS response failed")),
                result => return result,
            }
        }
    }
}

/// Once returned, read response status/body outside the Core lock.
pub struct StartedResponse {
    reader: BufReader<BoundedTls>,
}

/// A decoded response body. Each `read` yields up to the caller's buffer size;
/// SSE bytes are preserved exactly and HTTP chunk framing is removed.
pub struct ResponseBody {
    reader: BufReader<BoundedTls>,
    mode: BodyMode,
    delivered: usize,
    line_bytes: usize,
}

enum BodyMode {
    Chunked {
        remaining: u64,
        need_ending: bool,
        finished: bool,
    },
    Length(u64),
    UntilClose,
}

impl StartedResponse {
    /// Reject redirects, ambiguous framing and non-SSE responses. The server's
    /// error text and headers are never included in the returned error.
    pub fn into_body(mut self) -> io::Result<ResponseBody> {
        let mut raw = Vec::new();
        while !raw.ends_with(b"\r\n\r\n") {
            if raw.len() >= MAX_HEADER_BYTES {
                return Err(invalid_response());
            }
            let mut byte = [0];
            self.reader.read_exact(&mut byte)?;
            raw.push(byte[0]);
        }
        let mut headers = [httparse::EMPTY_HEADER; 64];
        let mut parsed = httparse::Response::new(&mut headers);
        if !matches!(parsed.parse(&raw), Ok(httparse::Status::Complete(_)))
            || parsed.code != Some(200)
        {
            return Err(invalid_response());
        }
        let mut content_length: Option<u64> = None;
        let mut chunked = false;
        let mut content_type = false;
        let mut seen_transfer = false;
        for header in parsed.headers.iter() {
            if header.name.eq_ignore_ascii_case("content-length") {
                if content_length.is_some() {
                    return Err(invalid_response());
                }
                let length = std::str::from_utf8(header.value)
                    .ok()
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .ok_or_else(invalid_response)?;
                if length > MAX_RESPONSE_BYTES as u64 {
                    return Err(invalid_response());
                }
                content_length = Some(length);
            } else if header.name.eq_ignore_ascii_case("transfer-encoding") {
                if seen_transfer {
                    return Err(invalid_response());
                }
                seen_transfer = true;
                let value = std::str::from_utf8(header.value).map_err(|_| invalid_response())?;
                if !value.trim().eq_ignore_ascii_case("chunked") {
                    return Err(invalid_response());
                }
                chunked = true;
            } else if header.name.eq_ignore_ascii_case("content-encoding") {
                let value = std::str::from_utf8(header.value).map_err(|_| invalid_response())?;
                if !value.trim().eq_ignore_ascii_case("identity") {
                    return Err(invalid_response());
                }
            } else if header.name.eq_ignore_ascii_case("content-type") {
                if content_type {
                    return Err(invalid_response());
                }
                let value = std::str::from_utf8(header.value).map_err(|_| invalid_response())?;
                if !value
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case("text/event-stream")
                {
                    return Err(invalid_response());
                }
                content_type = true;
            }
        }
        if !content_type || (chunked && content_length.is_some()) {
            return Err(invalid_response());
        }
        let mode = if chunked {
            BodyMode::Chunked {
                remaining: 0,
                need_ending: false,
                finished: false,
            }
        } else if let Some(length) = content_length {
            BodyMode::Length(length)
        } else {
            BodyMode::UntilClose
        };
        Ok(ResponseBody {
            reader: self.reader,
            mode,
            delivered: 0,
            line_bytes: 0,
        })
    }
}

fn invalid_response() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid model response")
}

fn account_sse_line(bytes: &[u8], length: &mut usize) -> io::Result<()> {
    for byte in bytes {
        if *byte == b'\n' {
            *length = 0;
        } else {
            *length += 1;
            if *length > MAX_LINE_BYTES {
                return Err(invalid_response());
            }
        }
    }
    Ok(())
}

fn bounded_http_line(reader: &mut impl BufRead, max: usize) -> io::Result<Vec<u8>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated model response",
            ));
        }
        let count = available
            .iter()
            .position(|b| *b == b'\n')
            .map_or(available.len(), |i| i + 1);
        if line.len().saturating_add(count) > max {
            return Err(invalid_response());
        }
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if line.last() == Some(&b'\n') {
            if !line.ends_with(b"\r\n") {
                return Err(invalid_response());
            }
            line.truncate(line.len() - 2);
            return Ok(line);
        }
    }
}

impl Read for ResponseBody {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            match &mut self.mode {
                BodyMode::Chunked {
                    remaining,
                    need_ending,
                    finished,
                } => {
                    if *finished {
                        return Ok(0);
                    }
                    if *remaining == 0 {
                        if *need_ending {
                            let mut ending = [0; 2];
                            self.reader.read_exact(&mut ending)?;
                            if &ending != b"\r\n" {
                                return Err(invalid_response());
                            }
                            *need_ending = false;
                        }
                        let line = bounded_http_line(&mut self.reader, MAX_LINE_BYTES)?;
                        let size = line
                            .split(|b| *b == b';')
                            .next()
                            .ok_or_else(invalid_response)?;
                        if size.is_empty()
                            || size.len() > 16
                            || !size.iter().all(u8::is_ascii_hexdigit)
                        {
                            return Err(invalid_response());
                        }
                        let size = u64::from_str_radix(
                            std::str::from_utf8(size).map_err(|_| invalid_response())?,
                            16,
                        )
                        .map_err(|_| invalid_response())?;
                        if size > (MAX_RESPONSE_BYTES - self.delivered) as u64 {
                            return Err(invalid_response());
                        }
                        if size == 0 {
                            let mut trailer_bytes = 0;
                            loop {
                                let trailer =
                                    bounded_http_line(&mut self.reader, MAX_HEADER_BYTES)?;
                                trailer_bytes += trailer.len() + 2;
                                if trailer_bytes > MAX_HEADER_BYTES {
                                    return Err(invalid_response());
                                }
                                if trailer.is_empty() {
                                    break;
                                }
                                if !trailer.contains(&b':') {
                                    return Err(invalid_response());
                                }
                            }
                            *finished = true;
                            return Ok(0);
                        }
                        *remaining = size;
                    }
                    let allowed = (*remaining).min(output.len() as u64) as usize;
                    let count = self.reader.read(&mut output[..allowed])?;
                    if count == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "truncated model response",
                        ));
                    }
                    *remaining -= count as u64;
                    *need_ending = *remaining == 0;
                    self.delivered += count;
                    account_sse_line(&output[..count], &mut self.line_bytes)?;
                    return Ok(count);
                }
                BodyMode::Length(remaining) => {
                    if *remaining == 0 {
                        return Ok(0);
                    }
                    let allowed = (*remaining).min(output.len() as u64) as usize;
                    let count = self.reader.read(&mut output[..allowed])?;
                    if count == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::UnexpectedEof,
                            "truncated model response",
                        ));
                    }
                    *remaining -= count as u64;
                    self.delivered += count;
                    account_sse_line(&output[..count], &mut self.line_bytes)?;
                    return Ok(count);
                }
                BodyMode::UntilClose => {
                    if self.delivered == MAX_RESPONSE_BYTES {
                        let mut extra = [0];
                        return match self.reader.read(&mut extra)? {
                            0 => Ok(0),
                            _ => Err(invalid_response()),
                        };
                    }
                    let allowed = output.len().min(MAX_RESPONSE_BYTES - self.delivered);
                    let count = self.reader.read(&mut output[..allowed])?;
                    self.delivered += count;
                    account_sse_line(&output[..count], &mut self.line_bytes)?;
                    return Ok(count);
                }
            }
        }
    }
}

/// Prepares the fixed Mozilla root store and HTTP/1.1 ALPN without connecting.
/// This does not apply OS trust changes or perform certificate revocation checks.
pub fn production_tls_config() -> Result<std::sync::Arc<rustls::ClientConfig>, ReviewedSenderError>
{
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let mut config = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| ReviewedSenderError::InvalidRequest)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(std::sync::Arc::new(config))
}

/// This error contains no request, URL, credential, or provider response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ReviewedSenderError {
    #[error("invalid reviewed request")]
    InvalidRequest,
    #[error("request no longer matches reviewed content")]
    BodyMismatch,
    #[error("invalid provider credential")]
    InvalidCredential,
}

/// Immutable borrowed data. Intentionally no Debug, Clone or Serialize; do not
/// put it in a log or frontend DTO. This value is not a persisted approval.
pub struct ReviewedRequest<'a> {
    body: &'a str,
}

impl<'a> ReviewedRequest<'a> {
    /// `approved_sha256` must come from the trusted, persisted approval binding,
    /// not from the frontend or the model. The returned body is unchanged.
    /// The actual Native credential must be passed immediately before a future
    /// send; this structure neither stores nor binds a credential for later use.
    pub fn validate(
        body: &'a str,
        credential: &str,
        approved_sha256: &str,
    ) -> Result<Self, ReviewedSenderError> {
        if credential.is_empty()
            || credential.len() > 4096
            || credential.bytes().any(|b| b < 0x20 || b == 0x7f)
        {
            return Err(ReviewedSenderError::InvalidCredential);
        }
        if body.is_empty() || body.len() > MAX_REQUEST_BYTES {
            return Err(ReviewedSenderError::InvalidRequest);
        }
        if approved_sha256.len() != 64
            || !approved_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || format!("{:x}", Sha256::digest(body.as_bytes())) != approved_sha256
        {
            return Err(ReviewedSenderError::BodyMismatch);
        }
        let mut deserializer = serde_json::Deserializer::from_str(body);
        let contains_credential = CheckJson { credential }
            .deserialize(&mut deserializer)
            .map_err(|_| ReviewedSenderError::InvalidRequest)?;
        deserializer
            .end()
            .map_err(|_| ReviewedSenderError::InvalidRequest)?;
        if contains_credential {
            return Err(ReviewedSenderError::InvalidRequest);
        }
        let value: serde_json::Value =
            serde_json::from_str(body).map_err(|_| ReviewedSenderError::InvalidRequest)?;
        let object = value
            .as_object()
            .ok_or(ReviewedSenderError::InvalidRequest)?;
        if object.get("model").and_then(|v| v.as_str()) != Some(STEPFUN_MODEL)
            || object.get("stream").and_then(|v| v.as_bool()) != Some(true)
            || !matches!(
                object.get("max_tokens").and_then(|v| v.as_u64()),
                Some(1..=MAX_OUTPUT_TOKENS)
            )
        {
            return Err(ReviewedSenderError::InvalidRequest);
        }
        Ok(Self { body })
    }

    pub fn endpoint(&self) -> &'static str {
        STEPFUN_ENDPOINT
    }
    pub fn model(&self) -> &'static str {
        STEPFUN_MODEL
    }
    pub fn body(&self) -> &'a str {
        self.body
    }
}

// Scan decoded JSON strings, including keys, without losing duplicates. Reject
// duplicate object members so model/limits have the same meaning at both ends.
struct CheckJson<'a> {
    credential: &'a str,
}
impl<'de> DeserializeSeed<'de> for CheckJson<'_> {
    type Value = bool;
    fn deserialize<D: de::Deserializer<'de>>(self, deserializer: D) -> Result<bool, D::Error> {
        deserializer.deserialize_any(CheckVisitor {
            credential: self.credential,
        })
    }
}

struct CheckVisitor<'a> {
    credential: &'a str,
}
impl<'de> Visitor<'de> for CheckVisitor<'_> {
    type Value = bool;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("valid JSON")
    }
    fn visit_bool<E: de::Error>(self, _: bool) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_i64<E: de::Error>(self, _: i64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_u64<E: de::Error>(self, _: u64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_f64<E: de::Error>(self, _: f64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_unit<E: de::Error>(self) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<bool, E> {
        Ok(value.contains(self.credential))
    }
    fn visit_string<E: de::Error>(self, value: String) -> Result<bool, E> {
        self.visit_str(&value)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<bool, A::Error> {
        let mut found = false;
        while let Some(value) = seq.next_element_seed(CheckJson {
            credential: self.credential,
        })? {
            found |= value;
        }
        Ok(found)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<bool, A::Error> {
        let mut keys = HashSet::new();
        let mut found = false;
        while let Some(key) = map.next_key::<String>()? {
            if !keys.insert(key.clone()) {
                return Err(de::Error::custom("duplicate JSON member"));
            }
            found |= key.contains(self.credential);
            found |= map.next_value_seed(CheckJson {
                credential: self.credential,
            })?;
        }
        Ok(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{mpsc, Arc};
    use std::thread;

    use rustls::pki_types::{PrivatePkcs8KeyDer, ServerName};
    use rustls::{
        ClientConfig, ClientConnection, RootCertStore, ServerConfig, ServerConnection, StreamOwned,
    };

    fn fingerprint(body: &str) -> String {
        format!("{:x}", Sha256::digest(body.as_bytes()))
    }
    fn prepare<'a>(
        body: &'a str,
        key: &'a str,
    ) -> Result<ReviewedRequest<'a>, ReviewedSenderError> {
        ReviewedRequest::validate(body, key, &fingerprint(body))
    }
    const BODY: &str = "{ \"model\": \"step-3.7-flash\", \"max_tokens\": 1024, \"stream\": true, \"messages\": [{\"text\":\"示例\\n原文\"}] }";

    #[cfg(feature = "reviewed-integration")]
    fn synthetic_approval_fixture() -> (
        tempfile::TempDir,
        hark_core::Core,
        hark_core::OutboundBinding,
    ) {
        use crate::review_queue::{
            PendingReviewQueue, ReviewDecision, ReviewLimit, ReviewRequest, ReviewSource,
        };
        use hark_core::{
            CancelFlag, ConfirmImport, ConversationRunStart, Core, ImportMode, OutboundBinding,
            OutboundSource, ScanBudget, ServiceGrantUpdate, ServiceKind, ServiceStatus,
        };
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("fixture-project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("README.md"), "synthetic source").unwrap();
        let core = Core::open(&temp.path().join("fixture.sqlite")).unwrap();
        let root = core.authorize_directory(&project).unwrap();
        let budget = ScanBudget::default();
        let scan = core
            .run_initial_scan(&root.id, &budget, &CancelFlag::new())
            .unwrap();
        let ws = core
            .confirm_import(&ConfirmImport {
                root_id: root.id.clone(),
                scan_id: scan.id,
                mode: ImportMode::SingleProject,
                enable_model_initial_read: false,
            })
            .unwrap()
            .workspaces
            .remove(0);
        core.set_service_grant(&ServiceGrantUpdate {
            workspace_id: ws.id.clone(),
            service: ServiceKind::Model,
            status: ServiceStatus::Enabled,
            provider: Some("stepfun".into()),
            model: Some(STEPFUN_MODEL.into()),
        })
        .unwrap();
        let source = core
            .read_workspace_file(&ws.id, "README.md", &budget)
            .unwrap()
            .source;
        let run = core
            .start_conversation_run(&ConversationRunStart {
                request_id: format!("req_{}", uuid::Uuid::new_v4().simple()),
                workspace_id: ws.id.clone(),
                conversation_id: ws.conversation_id,
                user_message_id: None,
                user_text: Some("synthetic prompt".into()),
            })
            .unwrap()
            .run;
        let queue = PendingReviewQueue::new();
        let review_id = queue
            .insert(
                ReviewRequest {
                    workspace_id: ws.id.clone(),
                    run_id: run.id.clone(),
                    recipient: STEPFUN_ENDPOINT.into(),
                    model: STEPFUN_MODEL.into(),
                    limits: vec![ReviewLimit {
                        label: "max_tokens".into(),
                        value: "1024".into(),
                    }],
                    sources: vec![ReviewSource {
                        source_id: source.id.as_str().into(),
                        path: source.relative_path.clone(),
                        version: source.content_sha256.clone(),
                        byte_len: source.byte_len,
                        truncated: source.truncated,
                    }],
                    body: BODY.into(),
                },
                Duration::from_secs(30),
            )
            .unwrap();
        assert!(queue.take_approved(&review_id, &ws.id, &run.id).is_err());
        let displayed = queue.get(&review_id, &ws.id, &run.id).unwrap();
        assert_eq!(displayed.body(), BODY);
        queue
            .decide(&review_id, &ws.id, &run.id, ReviewDecision::Approve)
            .unwrap();
        let snapshot = queue.take_approved(&review_id, &ws.id, &run.id).unwrap();
        let limit_bytes = serde_json::to_vec(snapshot.limits()).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let binding = OutboundBinding {
            workspace_id: snapshot.workspace_id().clone(),
            run_id: snapshot.run_id().clone(),
            root_id: root.id,
            endpoint: snapshot.recipient().into(),
            provider: "stepfun".into(),
            model: snapshot.model().into(),
            body_sha256: fingerprint(snapshot.body()),
            limits_sha256: format!("{:x}", Sha256::digest(limit_bytes)),
            sources: vec![OutboundSource {
                source_id: source.id,
                content_sha256: source.content_sha256,
                byte_len: source.byte_len,
                truncated: source.truncated,
            }],
            expires_at_ms: now + 30_000,
        };
        (temp, core, binding)
    }

    #[cfg(feature = "reviewed-integration")]
    #[test]
    fn approved_fixture_persists_then_sends_once_at_core_boundary() {
        use hark_core::{CoreError, ErrorCode};
        let (_temp, core, binding) = synthetic_approval_fixture();
        let approval = core.approve_outbound(&binding).unwrap();
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 10\r\n\r\ndata: ok\n\n".to_vec();
        let (connection, worker, _) = local_response(response, Duration::ZERO);
        let started = core
            .consume_and_begin_outbound(&approval, &binding, || {
                connection
                    .begin(BODY, "synthetic-key", &binding.body_sha256)
                    .map_err(|_| {
                        CoreError::new(ErrorCode::ModelNotAuthorized, "synthetic send failed")
                    })
            })
            .unwrap();
        let mut body = Vec::new();
        started.into_body().unwrap().read_to_end(&mut body).unwrap();
        assert_eq!(body, b"data: ok\n\n");
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());
        assert!(core
            .consume_and_begin_outbound(&approval, &binding, || Ok(()))
            .is_err());
    }

    #[cfg(feature = "reviewed-integration")]
    #[test]
    fn changed_fixture_source_refuses_tls_begin_and_never_reuses_approval() {
        use hark_core::{CoreError, ErrorCode};
        let (temp, core, binding) = synthetic_approval_fixture();
        let approval = core.approve_outbound(&binding).unwrap();
        let (connection, worker, _) = local_response(Vec::new(), Duration::ZERO);
        std::fs::write(
            temp.path().join("fixture-project/README.md"),
            "changed synthetic source",
        )
        .unwrap();
        assert!(core
            .consume_and_begin_outbound(&approval, &binding, || {
                connection
                    .begin(BODY, "synthetic-key", &binding.body_sha256)
                    .map_err(|_| {
                        CoreError::new(ErrorCode::ModelNotAuthorized, "synthetic send failed")
                    })
            })
            .is_err());
        assert!(worker.join().unwrap().is_empty());
        assert!(core
            .consume_and_begin_outbound(&approval, &binding, || Ok(()))
            .is_err());
    }

    #[test]
    fn preserves_exact_body_and_has_fixed_destination() {
        let request = prepare(BODY, "synthetic-credential").unwrap();
        assert_eq!(request.body().as_bytes(), BODY.as_bytes());
        assert_eq!(request.endpoint(), STEPFUN_ENDPOINT);
        assert_eq!(request.model(), STEPFUN_MODEL);
        assert_eq!(MAX_RESPONSE_BYTES, 4 * 1024 * 1024);
        assert_eq!(CONNECT_TIMEOUT, Duration::from_secs(10));
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(60));
        assert_eq!(
            production_tls_config().unwrap().alpn_protocols,
            vec![b"http/1.1".to_vec()]
        );
    }

    #[test]
    fn rejects_changed_bytes_endpoint_independent_model_and_limits() {
        assert!(matches!(
            ReviewedRequest::validate(BODY, "synthetic-key", &fingerprint("different")),
            Err(ReviewedSenderError::BodyMismatch)
        ));
        for body in [
            "{\"model\":\"other\",\"max_tokens\":10,\"stream\":true}",
            "{\"model\":\"step-3.7-flash\",\"max_tokens\":4097,\"stream\":true}",
            "{\"model\":\"step-3.7-flash\",\"max_tokens\":10,\"stream\":false}",
            "{\"model\":\"step-3.7-flash\",\"model\":\"other\",\"max_tokens\":10,\"stream\":true}",
        ] {
            assert!(matches!(
                prepare(body, "synthetic-key"),
                Err(ReviewedSenderError::InvalidRequest)
            ));
        }
    }

    #[test]
    fn rejects_secrets_even_when_escaped_or_placed_in_a_duplicate_key() {
        let raw = "{\"model\":\"step-3.7-flash\",\"max_tokens\":10,\"stream\":true,\"content\":\"se\\u0063ret\"}";
        assert!(matches!(
            prepare(raw, "secret"),
            Err(ReviewedSenderError::InvalidRequest)
        ));
        let duplicate = "{\"model\":\"step-3.7-flash\",\"max_tokens\":10,\"stream\":true,\"content\":\"secret\",\"content\":\"safe\"}";
        assert!(matches!(
            prepare(duplicate, "secret"),
            Err(ReviewedSenderError::InvalidRequest)
        ));
        assert!(matches!(
            prepare(BODY, "bad\nkey"),
            Err(ReviewedSenderError::InvalidCredential)
        ));
        assert!(matches!(
            prepare(BODY, ""),
            Err(ReviewedSenderError::InvalidCredential)
        ));
    }

    #[test]
    fn dns_rebinding_addresses_are_rejected_without_resolving_or_connecting() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.1.1",
            "100.64.1.1",
            "192.0.2.1",
            "198.18.0.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
        ] {
            assert!(!publicly_routable(value.parse().unwrap()), "{value}");
        }
        assert!(publicly_routable("8.8.8.8".parse().unwrap()));
        assert!(publicly_routable("2606:4700:4700::1111".parse().unwrap()));
    }

    // Test-only synchronous writer. It is intentionally not a production
    // sender: it has no DNS, cancellation, redirect handling or HTTP parser.
    fn write_synthetic_request(
        socket: TcpStream,
        config: Arc<ClientConfig>,
        server_name: &'static str,
        body: &str,
        credential: &str,
    ) -> std::io::Result<StreamOwned<ClientConnection, TcpStream>> {
        let request = prepare(body, credential).map_err(|_| std::io::ErrorKind::InvalidInput)?;
        socket.set_read_timeout(Some(Duration::from_secs(3)))?;
        socket.set_write_timeout(Some(Duration::from_secs(3)))?;
        let name =
            ServerName::try_from(server_name).map_err(|_| std::io::ErrorKind::InvalidInput)?;
        let connection = ClientConnection::new(config, name).map_err(std::io::Error::other)?;
        let mut tls = StreamOwned::new(connection, socket);
        // No credential/body in a format string, debug value, or log. The
        // target path and host cannot be chosen from request contents.
        tls.write_all(b"POST /step_plan/v1/messages?beta=true HTTP/1.1\r\nHost: api.stepfun.com\r\nContent-Type: application/json\r\nAccept: text/event-stream\r\nAnthropic-Version: 2023-06-01\r\nX-Api-Key: ")?;
        tls.write_all(credential.as_bytes())?;
        tls.write_all(b"\r\nConnection: close\r\nContent-Length: ")?;
        tls.write_all(request.body().len().to_string().as_bytes())?;
        tls.write_all(b"\r\n\r\n")?;
        tls.write_all(request.body().as_bytes())?;
        tls.flush()?;
        Ok(tls)
    }

    fn synthetic_configs() -> (Arc<ServerConfig>, Arc<ClientConfig>) {
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let server =
            ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_no_client_auth()
                .with_single_cert(
                    vec![cert.der().clone()],
                    PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
                )
                .unwrap();
        let mut roots = RootCertStore::empty();
        roots.add(cert.der().clone()).unwrap();
        let client =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()
                .unwrap()
                .with_root_certificates(roots)
                .with_no_client_auth();
        (Arc::new(server), Arc::new(client))
    }

    fn local_response(
        response: Vec<u8>,
        pause: Duration,
    ) -> (
        PreparedConnection,
        thread::JoinHandle<Vec<u8>>,
        CancelHandle,
    ) {
        let (server, client) = synthetic_configs();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut tls = StreamOwned::new(ServerConnection::new(server).unwrap(), socket);
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") && headers.len() < 8192 {
                let mut byte = [0];
                if tls.read_exact(&mut byte).is_err() {
                    return Vec::new();
                }
                headers.push(byte[0]);
            }
            let mut body = vec![0; BODY.len()];
            if tls.read_exact(&mut body).is_err() {
                return Vec::new();
            }
            thread::sleep(pause);
            let _ = tls.write_all(&response);
            tls.conn.send_close_notify();
            let _ = tls.flush();
            body
        });
        let cancel = CancelHandle::default();
        let connection = PreparedConnection::handshake(
            TcpStream::connect(address).unwrap(),
            client,
            "localhost",
            cancel.clone(),
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap();
        (connection, worker, cancel)
    }

    #[test]
    fn real_experimental_path_decodes_fragmented_chunked_sse_without_changing_body() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n5\r\ndata:\r\n9\r\n example\n\r\n1\r\n\n\r\n0\r\n\r\n".to_vec();
        let (connection, worker, _) = local_response(response, Duration::ZERO);
        let mut response = connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .unwrap()
            .into_body()
            .unwrap();
        let mut got = Vec::new();
        let mut buf = [0; 3];
        loop {
            let n = response.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            got.extend_from_slice(&buf[..n]);
        }
        assert_eq!(got, b"data: example\n\n");
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());
    }

    #[test]
    fn rejects_redirects_ambiguous_framing_and_oversized_body() {
        for response in [
            b"HTTP/1.1 302 Found\r\nContent-Type: text/event-stream\r\nContent-Length: 0\r\n\r\n".to_vec(),
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n".to_vec(),
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n", MAX_RESPONSE_BYTES + 1).into_bytes(),
        ] {
            let (connection, worker, _) = local_response(response, Duration::ZERO);
            let started = connection.begin(BODY, "synthetic-key", &fingerprint(BODY)).unwrap();
            assert!(started.into_body().is_err());
            assert_eq!(worker.join().unwrap(), BODY.as_bytes());
        }
    }

    #[test]
    fn chunked_limits_and_sse_line_limit_fail_closed() {
        let over_chunk = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n", MAX_RESPONSE_BYTES + 1).into_bytes();
        let (connection, worker, _) = local_response(over_chunk, Duration::ZERO);
        let mut body = connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .unwrap()
            .into_body()
            .unwrap();
        assert!(body.read(&mut [0; 64]).is_err());
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());

        let mut long_line = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n",
            MAX_LINE_BYTES + 1
        )
        .into_bytes();
        long_line.extend(std::iter::repeat_n(b'x', MAX_LINE_BYTES + 1));
        let (connection, worker, _) = local_response(long_line, Duration::ZERO);
        let mut body = connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .unwrap()
            .into_body()
            .unwrap();
        assert!(body.read_to_end(&mut Vec::new()).is_err());
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());
    }

    #[test]
    fn cancelling_before_begin_never_sends_application_bytes() {
        let (connection, worker, cancel) = local_response(Vec::new(), Duration::ZERO);
        cancel.cancel();
        assert!(connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .is_err());
        assert!(worker.join().unwrap().is_empty());
    }

    #[test]
    fn cancellation_waits_for_an_inflight_write_and_prevents_the_next_write() {
        let cancel = CancelHandle::default();
        let writer_cancel = cancel.clone();
        let cancel_clone = cancel.clone();
        let deadline = Instant::now() + Duration::from_secs(3);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (cancelled_tx, cancelled_rx) = mpsc::channel();
        let writer = thread::spawn(move || {
            guarded_send_operation(&writer_cancel, deadline, || {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                Ok(())
            })
            .unwrap();
            // The next operation cannot start once cancellation is requested.
            guarded_send_operation(&writer_cancel, deadline, || Ok(()))
        });
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let canceller = thread::spawn(move || {
            cancel_clone.cancel();
            cancelled_tx.send(()).unwrap();
        });
        let wait = Instant::now() + Duration::from_secs(2);
        while !cancel.is_cancelled() && Instant::now() < wait {
            thread::yield_now();
        }
        assert!(cancel.is_cancelled());
        assert!(matches!(
            cancelled_rx.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_tx.send(()).unwrap();
        assert_eq!(
            writer.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::ConnectionAborted
        );
        canceller.join().unwrap();
        cancelled_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    }

    #[test]
    fn cancellation_and_deadline_interrupt_waiting_for_response() {
        let (connection, worker, cancel) = local_response(Vec::new(), Duration::from_millis(700));
        let started = connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .unwrap();
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            cancel.cancel();
        });
        assert_eq!(
            started.into_body().err().unwrap().kind(),
            io::ErrorKind::ConnectionAborted
        );
        cancel_thread.join().unwrap();
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());

        let (connection, worker, _) = local_response(Vec::new(), Duration::from_millis(700));
        let mut started = connection
            .begin(BODY, "synthetic-key", &fingerprint(BODY))
            .unwrap();
        started.reader.get_mut().deadline = Instant::now() + Duration::from_millis(30);
        assert_eq!(
            started.into_body().err().unwrap().kind(),
            io::ErrorKind::TimedOut
        );
        assert_eq!(worker.join().unwrap(), BODY.as_bytes());
    }

    #[test]
    fn synthetic_tls_server_receives_the_exact_reviewed_body() {
        let (server, client) = synthetic_configs();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (done_tx, done_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut tls = StreamOwned::new(ServerConnection::new(server).unwrap(), socket);
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") && headers.len() < 8192 {
                let mut byte = [0_u8];
                tls.read_exact(&mut byte).unwrap();
                headers.push(byte[0]);
            }
            let mut body = vec![0; BODY.len()];
            tls.read_exact(&mut body).unwrap();
            done_tx.send((headers, body)).unwrap();
            // Raw chunked response demonstrates bytes can be read; decoding,
            // limits, cancellation and error handling are not implemented.
            tls.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n6\r\ndata\n\n\r\n0\r\n\r\n").unwrap();
            tls.conn.send_close_notify();
            tls.flush().unwrap();
        });
        let socket = TcpStream::connect(address).unwrap();
        let mut tls =
            write_synthetic_request(socket, client, "localhost", BODY, "synthetic-key").unwrap();
        let (headers, body) = done_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(headers.starts_with(
            b"POST /step_plan/v1/messages?beta=true HTTP/1.1\r\nHost: api.stepfun.com\r\n"
        ));
        assert!(headers
            .windows(b"X-Api-Key: synthetic-key\r\n".len())
            .any(|w| w == b"X-Api-Key: synthetic-key\r\n"));
        assert_eq!(body, BODY.as_bytes());
        let mut response = Vec::new();
        tls.read_to_end(&mut response).unwrap();
        assert!(response
            .windows(b"Transfer-Encoding: chunked".len())
            .any(|w| w == b"Transfer-Encoding: chunked"));
        worker.join().unwrap();
    }

    #[test]
    fn wrong_certificate_hostname_fails_before_request_is_delivered() {
        let (server, client) = synthetic_configs();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut tls = StreamOwned::new(ServerConnection::new(server).unwrap(), socket);
            let mut first = [0_u8];
            assert!(tls.read(&mut first).is_err());
        });
        let socket = TcpStream::connect(address).unwrap();
        assert!(
            write_synthetic_request(socket, client, "wrong.example", BODY, "synthetic-key")
                .is_err()
        );
        worker.join().unwrap();
    }
}
