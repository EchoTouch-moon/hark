//! One managed Node sidecar. Unix uses a process group. Windows stays off
//! until a Job Object exists. EOF alone is not a Windows safety claim.

use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::error::ShellError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StopReport {
    pub pid: u32,
    pub pgid: u32,
    pub group_alive: bool,
    pub exited: bool,
    pub forced_kill: bool,
    /// Rust worker joined. Process-only reports leave this false.
    pub worker_stopped: bool,
}

pub struct SpawnedSidecar {
    pub pid: u32,
    pub pgid: u32,
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
    // Kept so the stderr reader Arc outlives this process handle.
    #[allow(dead_code)]
    stderr_tail: Arc<Mutex<String>>,
    stderr_thread: Option<JoinHandle<()>>,
    stopped: bool,
    last: StopReport,
}

impl SpawnedSidecar {
    pub fn spawn(
        node_path: &Path,
        args: &[String],
        working_dir: &Path,
        fake_home: &Path,
        secret: &str,
        stderr_tail: Arc<Mutex<String>>,
    ) -> Result<(Self, std::process::ChildStdout), ShellError> {
        #[cfg(not(unix))]
        {
            let _ = (node_path, args, working_dir, fake_home, secret, stderr_tail);
            return Err(ShellError::new(
                "sidecar_disabled_windows",
                "Windows Job Object is not implemented. Sidecar stays off. EOF is not a safe process-tree stop.",
            ));
        }
        #[cfg(unix)]
        {
            let mut cmd = Command::new(node_path);
            cmd.args(args)
                .current_dir(working_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env_remove("OPENAI_API_KEY")
                .env_remove("STEPFUN_API_KEY")
                .env_remove("GOOGLE_APPLICATION_CREDENTIALS")
                .env_remove("AWS_ACCESS_KEY_ID")
                .env_remove("AWS_SECRET_ACCESS_KEY")
                .env_remove("PI_API_KEY")
                .env("HOME", fake_home);
            // New process group so stop can signal the tree, not this test process.
            #[allow(unused_unsafe)]
            unsafe {
                cmd.pre_exec(|| {
                    if libc::setpgid(0, 0) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
            let mut child = cmd
                .spawn()
                .map_err(|err| ShellError::new("sidecar_spawn", err.to_string()))?;
            let pid = child.id();
            let pgid = unsafe { libc::getpgid(pid as i32) };
            if pgid < 0 || pgid as u32 != pid {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ShellError::new(
                    "sidecar_spawn",
                    "child is not its own process-group leader",
                ));
            }
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| ShellError::new("sidecar_spawn", "stdin missing"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| ShellError::new("sidecar_spawn", "stdout missing"))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| ShellError::new("sidecar_spawn", "stderr missing"))?;
            let tail = Arc::clone(&stderr_tail);
            let secret = secret.to_string();
            let stderr_thread = thread::spawn(move || {
                let mut reader = stderr;
                let mut buf = [0_u8; 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]);
                            let scrubbed = scrub(&text, &secret);
                            if let Ok(mut slot) = tail.lock() {
                                slot.push_str(&scrubbed);
                                if slot.len() > 8_192 {
                                    let drain = slot.len() - 8_192;
                                    slot.drain(..drain);
                                }
                            }
                        }
                    }
                }
            });
            Ok((
                Self {
                    pid,
                    pgid: pgid as u32,
                    child: Some(child),
                    stdin: Some(stdin),
                    stderr_tail,
                    stderr_thread: Some(stderr_thread),
                    stopped: false,
                    last: StopReport {
                        pid,
                        pgid: pgid as u32,
                        group_alive: true,
                        exited: false,
                        forced_kill: false,
                        worker_stopped: false,
                    },
                },
                stdout,
            ))
        }
    }

    pub fn write_frame(&mut self, bytes: &[u8]) -> Result<(), ShellError> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| ShellError::new("sidecar_closed", "stdin already closed"))?;
        stdin
            .write_all(bytes)
            .and_then(|_| stdin.flush())
            .map_err(|err| ShellError::new("sidecar_stdin", err.to_string()))
    }

    pub fn close_stdin(&mut self) {
        self.stdin.take();
    }

    pub fn stop(&mut self) -> StopReport {
        if self.stopped {
            return self.last.clone();
        }
        self.stdin.take();
        let mut forced = false;
        signal_group(self.pgid, libc_term());
        let mut exited = wait_child(self.child.as_mut(), 1_500);
        if !exited {
            forced = true;
            signal_group(self.pgid, libc_kill());
            exited = wait_child(self.child.as_mut(), 1_500);
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.try_wait();
        }
        self.child.take();
        // Do not join the stderr reader forever. Dropping the child closes the pipe
        // when the process is actually dead; a live child must not stall stop().
        if let Some(thread) = self.stderr_thread.take() {
            let _ = thread;
        }
        let alive = group_alive(self.pgid);
        if alive {
            signal_group(self.pgid, libc_kill());
            thread::sleep(Duration::from_millis(50));
        }
        self.stopped = true;
        self.last = StopReport {
            pid: self.pid,
            pgid: self.pgid,
            group_alive: group_alive(self.pgid),
            exited: exited || !group_alive(self.pgid),
            forced_kill: forced,
            worker_stopped: false,
        };
        self.last.clone()
    }
}

impl Drop for SpawnedSidecar {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn scrub(text: &str, secret: &str) -> String {
    let mut out = if secret.len() >= 6 {
        text.replace(secret, "[redacted]")
    } else {
        text.to_string()
    };
    for needle in ["apiKey", "Bearer ", "sk-"] {
        if out
            .to_ascii_lowercase()
            .contains(&needle.to_ascii_lowercase())
        {
            out = out
                .lines()
                .map(|line| {
                    if line
                        .to_ascii_lowercase()
                        .contains(&needle.to_ascii_lowercase())
                    {
                        "[redacted-line]"
                    } else {
                        line
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
        }
    }
    out
}

fn wait_child(child: Option<&mut Child>, ms: u64) -> bool {
    let Some(child) = child else {
        return true;
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if start.elapsed() >= Duration::from_millis(ms) => return false,
            Err(_) => return true,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
        }
    }
}

#[cfg(unix)]
fn signal_group(pgid: u32, sig: i32) {
    if pgid == 0 {
        return;
    }
    unsafe {
        libc::kill(-(pgid as i32), sig);
    }
}

#[cfg(not(unix))]
fn signal_group(_pgid: u32, _sig: i32) {}

#[cfg(unix)]
fn group_alive(pgid: u32) -> bool {
    if pgid == 0 {
        return false;
    }
    let rc = unsafe { libc::kill(-(pgid as i32), 0) };
    rc == 0
}

#[cfg(not(unix))]
fn group_alive(_pgid: u32) -> bool {
    false
}

fn libc_term() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGTERM
    }
    #[cfg(not(unix))]
    {
        15
    }
}

fn libc_kill() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGKILL
    }
    #[cfg(not(unix))]
    {
        9
    }
}

pub(crate) fn process_group_alive(pgid: u32) -> bool {
    group_alive(pgid)
}

pub(crate) fn reap_pid(pid: u32) {
    #[cfg(unix)]
    if pid != 0 {
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(400) {
            let mut status = 0;
            let rc = unsafe { libc::waitpid(pid as i32, &mut status, libc::WNOHANG) };
            if rc == pid as i32 || rc < 0 {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}
