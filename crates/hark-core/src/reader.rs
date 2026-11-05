//! Safe directory reader.
//!
//! Opens the authorized directory with `O_NOFOLLOW` on the final component, then
//! walks only with `openat` + `O_NOFOLLOW`. It does not resolve a path string and
//! then open that resolved string. File bytes are read from the already-checked descriptor.
//!
//! Hard-link policy: a regular file with `nlink != 1` is refused. Directory link
//! counts are not used (they include `.` / `..`).
//! Alias policy: Finder aliases (`kIsAlias`) are refused. Alias resolution APIs
//! are never called. Windows has no safe implementation and fails closed.

use std::ffi::{CStr, CString};
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use crate::error::{CoreError, ErrorCode, Result};
use crate::policy::{blocked_component, private_key_bytes, split_relative};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DirIdentity {
    pub dev: String,
    pub ino: String,
}

#[derive(Debug)]
pub(crate) struct ReadBytes {
    pub bytes: Vec<u8>,
    pub truncated: bool,
    #[allow(dead_code)]
    pub file_len: u64,
}

#[derive(Debug)]
pub(crate) enum ChildInspect {
    Dir {
        name: String,
    },
    File {
        name: String,
        #[allow(dead_code)]
        len: u64,
    },
    Rejected {
        name: String,
        reason: ErrorCode,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Relation {
    Disjoint,
    Overlap,
}

pub(crate) fn reader_capability() -> &'static str {
    if cfg!(windows) {
        "fail_closed"
    } else if cfg!(target_os = "macos") {
        "unix_openat_nofollow_finder_alias"
    } else if cfg!(unix) {
        "unix_openat_nofollow"
    } else {
        "fail_closed"
    }
}

pub(crate) fn identify_directory(path: &Path) -> Result<DirIdentity> {
    ensure_supported()?;
    require_absolute_clean(path)?;
    let fd = open_root(path)?;
    let st = fstat(&fd)?;
    ensure_dir(&st)?;
    Ok(identity_of(&st))
}

pub(crate) fn relation(path_a: &Path, path_b: &Path) -> Result<Relation> {
    let id_a = identify_directory(path_a)?;
    let id_b = identify_directory(path_b)?;
    if id_a == id_b {
        return Ok(Relation::Overlap);
    }
    if nested(path_a, &id_a, path_b, &id_b)? || nested(path_b, &id_b, path_a, &id_a)? {
        return Ok(Relation::Overlap);
    }
    Ok(Relation::Disjoint)
}

pub(crate) fn inspect_directory(
    root: &Path,
    expected: &DirIdentity,
    rel_dir: &str,
) -> Result<Vec<ChildInspect>> {
    ensure_supported()?;
    let root_fd = reopen_root(root, expected)?;
    let dev = root_dev(&root_fd)?;
    let dir_fd = walk_dir(&root_fd, &dev, split_relative(rel_dir)?)?;
    let names = list_names(&dir_fd)?;
    let mut out = Vec::with_capacity(names.len());
    for listed in names {
        let ListedName::Utf8(name) = listed else {
            out.push(ChildInspect::Rejected {
                name: "non-utf8".to_string(),
                reason: ErrorCode::InvalidPath,
            });
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        if let Some(code) = blocked_component(&name) {
            out.push(ChildInspect::Rejected { name, reason: code });
            continue;
        }
        out.push(inspect_one(&dir_fd, &name, dev.clone())?);
    }
    out.sort_by(|a, b| child_name(a).cmp(child_name(b)));
    Ok(out)
}

pub(crate) fn identify_relative(
    root: &Path,
    expected: &DirIdentity,
    rel: &str,
) -> Result<DirIdentity> {
    ensure_supported()?;
    let root_fd = reopen_root(root, expected)?;
    let dev = root_dev(&root_fd)?;
    let fd = walk_dir(&root_fd, &dev, split_relative(rel)?)?;
    let st = fstat(&fd)?;
    ensure_dir(&st)?;
    reject_alias(fd.as_raw_fd())?;
    Ok(identity_of(&st))
}

pub(crate) fn read_file(
    root: &Path,
    expected: &DirIdentity,
    rel_file: &str,
    max_bytes: u64,
) -> Result<ReadBytes> {
    ensure_supported()?;
    let parts = split_relative(rel_file)?;
    if parts.is_empty() {
        return Err(CoreError::new(
            ErrorCode::InvalidPath,
            "refusing to read a directory as a file",
        ));
    }
    for part in &parts {
        if let Some(code) = blocked_component(part) {
            return Err(CoreError::new(code, format!("refusing component {part}")));
        }
    }
    let root_fd = reopen_root(root, expected)?;
    let root_dev = root_dev(&root_fd)?;
    let (parent, file_name) = parts.split_at(parts.len() - 1);
    let parent_fd = walk_dir(&root_fd, &root_dev, parent.to_vec())?;
    let file_fd = open_child(&parent_fd, &file_name[0], false)?;
    let st = fstat(&file_fd)?;
    classify_file(&st, &root_dev, &file_name[0])?;
    reject_alias(file_fd.as_raw_fd())?;
    let file_len = if st.st_size < 0 { 0 } else { st.st_size as u64 };
    let to_read = max_bytes.min(file_len) as usize;
    let mut file = std::fs::File::from(file_fd);
    let mut bytes = vec![0_u8; to_read];
    let mut filled = 0;
    while filled < to_read {
        match file.read(&mut bytes[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) => {
                return Err(CoreError::new(ErrorCode::Io, err.to_string()));
            }
        }
    }
    bytes.truncate(filled);
    if private_key_bytes(&bytes) {
        return Err(CoreError::new(
            ErrorCode::SensitivePath,
            "refusing private-key material",
        ));
    }
    Ok(ReadBytes {
        bytes,
        truncated: file_len > max_bytes,
        file_len,
    })
}

fn nested(
    parent: &Path,
    parent_id: &DirIdentity,
    child: &Path,
    child_id: &DirIdentity,
) -> Result<bool> {
    let parent_parts = path_components(parent)?;
    let child_parts = path_components(child)?;
    if child_parts.len() <= parent_parts.len() {
        return Ok(false);
    }
    let prefix_ok = parent_parts
        .iter()
        .zip(child_parts.iter())
        .all(|(a, b)| a.eq_ignore_ascii_case(b));
    if !prefix_ok {
        return Ok(false);
    }
    let suffix = child_parts[parent_parts.len()..].to_vec();
    let root_fd = reopen_root(parent, parent_id)?;
    let dev = root_dev(&root_fd)?;
    match walk_dir(&root_fd, &dev, suffix) {
        Ok(fd) => {
            let st = fstat(&fd)?;
            Ok(identity_of(&st).ino == child_id.ino && identity_of(&st).dev == child_id.dev)
        }
        Err(err) if err.code == ErrorCode::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

fn ensure_supported() -> Result<()> {
    #[cfg(not(unix))]
    {
        return Err(CoreError::new(
            ErrorCode::ReaderUnsupportedPlatform,
            "safe reader is not implemented on this platform; failing closed",
        ));
    }
    #[cfg(unix)]
    {
        Ok(())
    }
}

fn require_absolute_clean(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(CoreError::new(
            ErrorCode::InvalidPath,
            "authorized path must be absolute",
        ));
    }
    for c in path.components() {
        match c {
            std::path::Component::ParentDir | std::path::Component::CurDir => {
                return Err(CoreError::new(
                    ErrorCode::PathEscape,
                    "authorized path must not contain . or ..",
                ));
            }
            std::path::Component::Normal(name) => {
                if name.as_bytes().contains(&0) {
                    return Err(CoreError::new(ErrorCode::InvalidPath, "NUL in path"));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn reopen_root(path: &Path, expected: &DirIdentity) -> Result<OwnedFd> {
    require_absolute_clean(path)?;
    let fd = open_root(path)?;
    let st = fstat(&fd)?;
    ensure_dir(&st)?;
    let got = identity_of(&st);
    if &got != expected {
        return Err(CoreError::new(
            ErrorCode::GrantIdentityMismatch,
            "path no longer points at the authorized directory inode",
        ));
    }
    Ok(fd)
}

fn open_root(path: &Path) -> Result<OwnedFd> {
    let c = cstring_from_path(path)?;
    let mut st: libc::stat = unsafe { std::mem::zeroed() };
    let lrc = unsafe { libc::lstat(c.as_ptr(), &mut st) };
    if lrc != 0 {
        return Err(map_open_errno(last_errno(), "root"));
    }
    if is_lnk(&st) {
        return Err(CoreError::new(
            ErrorCode::SymlinkRejected,
            "root is a symlink",
        ));
    }
    let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let fd = unsafe { libc::open(c.as_ptr(), flags) };
    if fd < 0 {
        return Err(map_open_errno(last_errno(), "root"));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn walk_dir(root: &OwnedFd, root_dev: &str, parts: Vec<String>) -> Result<OwnedFd> {
    let mut current = dup_fd(root)?;
    for part in parts {
        if let Some(code) = blocked_component(&part) {
            return Err(CoreError::new(code, format!("refusing component {part}")));
        }
        let next = open_child(&current, &part, true)?;
        let st = fstat(&next)?;
        ensure_dir(&st)?;
        if identity_of(&st).dev != root_dev {
            return Err(CoreError::new(
                ErrorCode::CrossDeviceRejected,
                format!("refusing cross-device component {part}"),
            ));
        }
        reject_alias(next.as_raw_fd())?;
        current = next;
    }
    Ok(current)
}

fn inspect_one(parent: &OwnedFd, name: &str, root_dev: String) -> Result<ChildInspect> {
    match open_child(parent, name, false) {
        Err(err) if err.code == ErrorCode::SymlinkRejected => {
            return Ok(ChildInspect::Rejected {
                name: name.to_string(),
                reason: ErrorCode::SymlinkRejected,
            });
        }
        Err(err) => return Err(err),
        Ok(fd) => {
            let st = match fstat(&fd) {
                Ok(st) => st,
                Err(err) => return Err(err),
            };
            if is_dir(&st) {
                if identity_of(&st).dev != root_dev {
                    return Ok(ChildInspect::Rejected {
                        name: name.to_string(),
                        reason: ErrorCode::CrossDeviceRejected,
                    });
                }
                if let Err(err) = reject_alias(fd.as_raw_fd()) {
                    return Ok(ChildInspect::Rejected {
                        name: name.to_string(),
                        reason: err.code,
                    });
                }
                return Ok(ChildInspect::Dir {
                    name: name.to_string(),
                });
            }
            if let Err(err) = classify_file(&st, &root_dev, name) {
                return Ok(ChildInspect::Rejected {
                    name: name.to_string(),
                    reason: err.code,
                });
            }
            if let Err(err) = reject_alias(fd.as_raw_fd()) {
                return Ok(ChildInspect::Rejected {
                    name: name.to_string(),
                    reason: err.code,
                });
            }
            Ok(ChildInspect::File {
                name: name.to_string(),
                len: if st.st_size < 0 { 0 } else { st.st_size as u64 },
            })
        }
    }
}

fn classify_file(st: &libc::stat, root_dev: &str, name: &str) -> Result<()> {
    if is_lnk(st) {
        return Err(CoreError::new(ErrorCode::SymlinkRejected, name.to_string()));
    }
    if !is_reg(st) {
        return Err(CoreError::new(
            ErrorCode::SpecialFileRejected,
            name.to_string(),
        ));
    }
    if identity_of(st).dev != root_dev {
        return Err(CoreError::new(
            ErrorCode::CrossDeviceRejected,
            name.to_string(),
        ));
    }
    if st.st_nlink != 1 {
        return Err(CoreError::new(
            ErrorCode::HardlinkRejected,
            format!("{name} has link count {}", st.st_nlink),
        ));
    }
    Ok(())
}

fn open_child(parent: &OwnedFd, name: &str, dir: bool) -> Result<OwnedFd> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(CoreError::new(
            ErrorCode::PathEscape,
            "illegal path component",
        ));
    }
    let c = CString::new(name)
        .map_err(|_| CoreError::new(ErrorCode::InvalidPath, "NUL in component"))?;
    let mut lst: libc::stat = unsafe { std::mem::zeroed() };
    let lrc = unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            c.as_ptr(),
            &mut lst,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if lrc != 0 {
        return Err(map_open_errno(last_errno(), name));
    }
    if is_lnk(&lst) {
        return Err(CoreError::new(
            ErrorCode::SymlinkRejected,
            format!("refusing symlink component {name}"),
        ));
    }
    let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    if dir {
        flags |= libc::O_DIRECTORY;
    }
    let fd = unsafe { libc::openat(parent.as_raw_fd(), c.as_ptr(), flags) };
    if fd < 0 {
        return Err(map_open_errno(last_errno(), name));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

enum ListedName {
    Utf8(String),
    NonUtf8,
}

fn list_names(dir: &OwnedFd) -> Result<Vec<ListedName>> {
    let dup = dup_fd(dir)?;
    let raw = dup.as_raw_fd();
    std::mem::forget(dup);
    let ptr = unsafe { libc::fdopendir(raw) };
    if ptr.is_null() {
        unsafe { libc::close(raw) };
        return Err(CoreError::new(ErrorCode::Io, "fdopendir failed"));
    }
    let stream = DirStream(ptr);
    let mut names = Vec::new();
    loop {
        clear_errno();
        let ent = unsafe { libc::readdir(stream.0) };
        if ent.is_null() {
            let err = last_errno();
            if err != 0 {
                return Err(CoreError::new(
                    ErrorCode::Io,
                    format!("readdir errno {err}"),
                ));
            }
            break;
        }
        let name = unsafe { CStr::from_ptr((*ent).d_name.as_ptr()) };
        match String::from_utf8(name.to_bytes().to_vec()) {
            Ok(text) => names.push(ListedName::Utf8(text)),
            Err(_) => names.push(ListedName::NonUtf8),
        }
    }
    Ok(names)
}

struct DirStream(*mut libc::DIR);
impl Drop for DirStream {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { libc::closedir(self.0) };
            self.0 = std::ptr::null_mut();
        }
    }
}

fn fstat(fd: &OwnedFd) -> Result<libc::stat> {
    let mut st: libc::stat = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::fstat(fd.as_raw_fd(), &mut st) };
    if rc != 0 {
        return Err(CoreError::new(
            ErrorCode::Io,
            format!("fstat errno {}", last_errno()),
        ));
    }
    Ok(st)
}

fn identity_of(st: &libc::stat) -> DirIdentity {
    DirIdentity {
        dev: st.st_dev.to_string(),
        ino: st.st_ino.to_string(),
    }
}

fn root_dev(fd: &OwnedFd) -> Result<String> {
    Ok(identity_of(&fstat(fd)?).dev)
}

fn ensure_dir(st: &libc::stat) -> Result<()> {
    if is_lnk(st) {
        return Err(CoreError::new(
            ErrorCode::SymlinkRejected,
            "directory is a symlink",
        ));
    }
    if !is_dir(st) {
        return Err(CoreError::new(ErrorCode::NotADirectory, "not a directory"));
    }
    Ok(())
}

fn is_dir(st: &libc::stat) -> bool {
    (st.st_mode & libc::S_IFMT) == libc::S_IFDIR
}

fn is_reg(st: &libc::stat) -> bool {
    (st.st_mode & libc::S_IFMT) == libc::S_IFREG
}

fn is_lnk(st: &libc::stat) -> bool {
    (st.st_mode & libc::S_IFMT) == libc::S_IFLNK
}

fn reject_alias(fd: std::os::fd::RawFd) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let mut buf = [0_u8; 32];
        let rc = unsafe {
            libc::fgetxattr(
                fd,
                b"com.apple.FinderInfo\0".as_ptr() as *const libc::c_char,
                buf.as_mut_ptr() as *mut libc::c_void,
                buf.len(),
                0,
                0,
            )
        };
        if rc < 0 {
            let err = last_errno();
            if err == libc::ENOATTR {
                return Ok(());
            }
            return Err(CoreError::new(
                ErrorCode::AliasCheckFailed,
                format!("finder alias check failed errno {err}"),
            ));
        }
        if rc < 10 {
            return Err(CoreError::new(
                ErrorCode::AliasCheckFailed,
                "finder info too short",
            ));
        }
        let flags = u16::from_be_bytes([buf[8], buf[9]]);
        const K_IS_ALIAS: u16 = 0x8000;
        if flags & K_IS_ALIAS != 0 {
            return Err(CoreError::new(
                ErrorCode::AliasRejected,
                "finder alias bit set",
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = fd;
        Ok(())
    }
}

fn dup_fd(fd: &OwnedFd) -> Result<OwnedFd> {
    let raw = unsafe { libc::dup(fd.as_raw_fd()) };
    if raw < 0 {
        return Err(CoreError::new(ErrorCode::Io, "dup failed"));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(raw) })
}

fn cstring_from_path(path: &Path) -> Result<CString> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| CoreError::new(ErrorCode::InvalidPath, "NUL in filesystem path"))
}

fn map_open_errno(err: i32, name: &str) -> CoreError {
    if err == libc::ELOOP || err == libc::EMLINK {
        CoreError::new(
            ErrorCode::SymlinkRejected,
            format!("refusing symlink component {name}"),
        )
    } else if err == libc::EACCES || err == libc::EPERM {
        CoreError::new(ErrorCode::AccessDenied, name.to_string())
    } else if err == libc::ENOENT {
        CoreError::new(ErrorCode::NotFound, name.to_string())
    } else if err == libc::ENOTDIR {
        CoreError::new(ErrorCode::NotADirectory, name.to_string())
    } else {
        CoreError::new(ErrorCode::Io, format!("open {name} errno {err}"))
    }
}

fn last_errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

fn clear_errno() {
    #[cfg(target_os = "macos")]
    unsafe {
        *libc::__error() = 0;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    unsafe {
        *libc::__errno_location() = 0;
    }
}

fn path_components(path: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for c in path.components() {
        match c {
            std::path::Component::Normal(name) => {
                let text = name.to_str().ok_or_else(|| {
                    CoreError::new(ErrorCode::InvalidPath, "non-utf8 path component")
                })?;
                out.push(text.to_string());
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {}
            std::path::Component::ParentDir | std::path::Component::CurDir => {
                return Err(CoreError::new(
                    ErrorCode::PathEscape,
                    "path contains . or ..",
                ));
            }
        }
    }
    Ok(out)
}

fn child_name(child: &ChildInspect) -> &str {
    match child {
        ChildInspect::Dir { name }
        | ChildInspect::File { name, .. }
        | ChildInspect::Rejected { name, .. } => name,
    }
}
