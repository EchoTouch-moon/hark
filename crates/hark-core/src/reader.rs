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

use std::cell::{Cell, RefCell};
use std::ffi::{CStr, CString};
use std::io::Read;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::Arc;

use crate::error::{CoreError, ErrorCode, Result};
use crate::policy::{blocked_component, private_key_bytes, split_relative};
use crate::CancelFlag;

thread_local! {
    static READDIR_STEPS: Cell<u64> = const { Cell::new(0) };
    static OPEN_ATTEMPTS: Cell<u64> = const { Cell::new(0) };
    static BEFORE_OPEN: RefCell<Option<Arc<dyn Fn(&str) + Send + Sync>>> = RefCell::new(None);
    static AFTER_WORKSPACE_VERIFY: RefCell<Option<Arc<dyn Fn(&str) + Send + Sync>>> =
        RefCell::new(None);
}

/// Test hook: counts `readdir` returns on this thread. Not a product metric.
pub fn reset_reader_work_counters() {
    READDIR_STEPS.with(|n| n.set(0));
    OPEN_ATTEMPTS.with(|n| n.set(0));
}

pub fn reader_readdir_steps() -> u64 {
    READDIR_STEPS.with(|n| n.get())
}

pub fn reader_open_attempts() -> u64 {
    OPEN_ATTEMPTS.with(|n| n.get())
}

/// Runs after the pre-open type check and before `openat`, so a test can swap in a FIFO.
/// Production callers leave this unset. Thread-local, so parallel tests do not share it.
pub fn set_reader_before_open_hook(hook: Option<Arc<dyn Fn(&str) + Send + Sync>>) {
    BEFORE_OPEN.with(|slot| *slot.borrow_mut() = hook);
}

/// Test hook: runs after a workspace directory inode is checked and before the
/// file open that must use that same descriptor. Inert unless a test sets it.
/// Not a product capability.
pub fn set_reader_after_workspace_verify_hook(hook: Option<Arc<dyn Fn(&str) + Send + Sync>>) {
    AFTER_WORKSPACE_VERIFY.with(|slot| *slot.borrow_mut() = hook);
}

fn note_readdir() {
    READDIR_STEPS.with(|n| n.set(n.get().saturating_add(1)));
}

fn note_open_attempt() {
    OPEN_ATTEMPTS.with(|n| n.set(n.get().saturating_add(1)));
}

fn run_before_open_hook(name: &str) {
    let hook = BEFORE_OPEN.with(|slot| slot.borrow().clone());
    if let Some(hook) = hook {
        hook(name);
    }
}

fn run_after_workspace_verify_hook(file_rel: &str) {
    let hook = AFTER_WORKSPACE_VERIFY.with(|slot| slot.borrow().clone());
    if let Some(hook) = hook {
        hook(file_rel);
    }
}

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

#[derive(Debug)]
pub(crate) struct InspectedDir {
    pub children: Vec<ChildInspect>,
    pub hit_entry_limit: bool,
    pub cancelled: bool,
}

pub(crate) fn inspect_directory(
    root: &Path,
    expected: &DirIdentity,
    rel_dir: &str,
    max_entries: u32,
    cancel: &CancelFlag,
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<InspectedDir> {
    ensure_supported()?;
    grant_check()?;
    let root_fd = reopen_root(root, expected)?;
    let dev = root_dev(&root_fd)?;
    let dir_fd = walk_dir(&root_fd, &dev, split_relative(rel_dir)?, grant_check)?;
    let mut children = Vec::new();
    let mut classified = 0_u32;
    let mut hit_entry_limit = false;
    let mut cancelled = cancel.is_cancelled();
    if cancelled || max_entries == 0 {
        return Ok(InspectedDir {
            children,
            hit_entry_limit: max_entries == 0,
            cancelled,
        });
    }
    let dup = dup_fd(&dir_fd)?;
    let raw = dup.as_raw_fd();
    std::mem::forget(dup);
    let ptr = unsafe { libc::fdopendir(raw) };
    if ptr.is_null() {
        unsafe { libc::close(raw) };
        return Err(CoreError::new(ErrorCode::Io, "fdopendir failed"));
    }
    let stream = DirStream(ptr);
    loop {
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        if classified >= max_entries {
            hit_entry_limit = true;
            break;
        }
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
        note_readdir();
        let name = unsafe { CStr::from_ptr((*ent).d_name.as_ptr()) };
        let listed = match String::from_utf8(name.to_bytes().to_vec()) {
            Ok(text) => ListedName::Utf8(text),
            Err(_) => ListedName::NonUtf8,
        };
        let ListedName::Utf8(name) = listed else {
            classified += 1;
            children.push(ChildInspect::Rejected {
                name: "non-utf8".to_string(),
                reason: ErrorCode::InvalidPath,
            });
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        cancel.tick();
        if cancel.is_cancelled() {
            cancelled = true;
            break;
        }
        classified += 1;
        if let Some(code) = blocked_component(&name) {
            children.push(ChildInspect::Rejected { name, reason: code });
            continue;
        }
        children.push(inspect_one(&dir_fd, &name, dev.clone(), grant_check)?);
    }
    children.sort_by(|a, b| child_name(a).cmp(child_name(b)));
    Ok(InspectedDir {
        children,
        hit_entry_limit,
        cancelled,
    })
}

pub(crate) fn identify_relative(
    root: &Path,
    expected: &DirIdentity,
    rel: &str,
) -> Result<DirIdentity> {
    ensure_supported()?;
    let root_fd = reopen_root(root, expected)?;
    let dev = root_dev(&root_fd)?;
    let fd = walk_dir(&root_fd, &dev, split_relative(rel)?, &allow_grant)?;
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
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<ReadBytes> {
    grant_check()?;
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
    let parent_fd = walk_dir(&root_fd, &root_dev, parent.to_vec(), grant_check)?;
    let file_fd = open_child(&parent_fd, &file_name[0], false, grant_check)?;
    let st = fstat(&file_fd)?;
    classify_file(&st, &root_dev, &file_name[0])?;
    reject_alias(file_fd.as_raw_fd())?;
    grant_check()?;
    read_fd(file_fd, st.st_size, max_bytes)
}

fn allow_grant() -> Result<()> {
    Ok(())
}

const MAX_ANCESTORS: usize = 128;

fn open_parent(dir: &OwnedFd) -> Result<OwnedFd> {
    let name = CString::new("..").expect("dotdot");
    let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(map_open_errno(last_errno(), ".."));
    }
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

/// Strict physical parents of `start`, rootward. Stops when `..` is the same inode.
/// Does not use the caller path string, so intermediate symlinks such as `/var`
/// do not hide nesting and are not themselves rejected.
fn strict_ancestors(start: &OwnedFd) -> Result<Vec<DirIdentity>> {
    let mut out = Vec::new();
    let mut current = dup_fd(start)?;
    for _ in 0..MAX_ANCESTORS {
        let parent = open_parent(&current)?;
        let parent_id = identity_of(&fstat(&parent)?);
        let current_id = identity_of(&fstat(&current)?);
        if parent_id == current_id {
            return Ok(out);
        }
        out.push(parent_id);
        current = parent;
    }
    Err(CoreError::new(
        ErrorCode::Io,
        "ancestor walk exceeded cap; cannot prove directory is disjoint",
    ))
}

fn physically_nested(id: &DirIdentity, ancestors: &[DirIdentity], other: &DirIdentity) -> bool {
    id == other || ancestors.iter().any(|ancestor| ancestor == other)
}

fn open_scope(
    path: &Path,
    root_expected: &DirIdentity,
    rel: &str,
    dir_expected: &DirIdentity,
) -> Result<(OwnedFd, DirIdentity)> {
    let root_fd = reopen_root(path, root_expected)?;
    let dev = root_dev(&root_fd)?;
    let fd = walk_dir(&root_fd, &dev, split_relative(rel)?, &allow_grant)?;
    let st = fstat(&fd)?;
    ensure_dir(&st)?;
    reject_alias(fd.as_raw_fd())?;
    let got = identity_of(&st);
    if &got != dir_expected {
        return Err(CoreError::new(
            ErrorCode::GrantIdentityMismatch,
            "stored directory inode does not match the opened scope",
        ));
    }
    Ok((fd, got))
}

/// True when either opened scope is the other or a physical descendant.
/// A path that cannot be reopened at its stored inode is an error, not disjoint.
pub(crate) fn scopes_overlap(
    path_a: &Path,
    root_a: &DirIdentity,
    rel_a: &str,
    dir_a: &DirIdentity,
    path_b: &Path,
    root_b: &DirIdentity,
    rel_b: &str,
    dir_b: &DirIdentity,
) -> Result<bool> {
    if dir_a == dir_b {
        return Ok(true);
    }
    let (fd_a, id_a) = open_scope(path_a, root_a, rel_a, dir_a)?;
    let (fd_b, id_b) = open_scope(path_b, root_b, rel_b, dir_b)?;
    let anc_a = strict_ancestors(&fd_a)?;
    let anc_b = strict_ancestors(&fd_b)?;
    Ok(physically_nested(&id_a, &anc_a, &id_b) || physically_nested(&id_b, &anc_b, &id_a))
}

/// Read `file_rel` from the workspace descriptor that was just identity-checked.
/// Does not walk `workspace_rel` again from the root.
pub(crate) fn read_within_workspace(
    root: &Path,
    root_expected: &DirIdentity,
    workspace_rel: &str,
    workspace_expected: &DirIdentity,
    file_rel: &str,
    max_bytes: u64,
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<ReadBytes> {
    ensure_supported()?;
    grant_check()?;
    let parts = split_relative(file_rel)?;
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
    let root_fd = reopen_root(root, root_expected)?;
    let root_dev = root_dev(&root_fd)?;
    let ws_fd = walk_dir(
        &root_fd,
        &root_dev,
        split_relative(workspace_rel)?,
        grant_check,
    )?;
    let ws_st = fstat(&ws_fd)?;
    ensure_dir(&ws_st)?;
    if identity_of(&ws_st) != *workspace_expected {
        return Err(CoreError::new(
            ErrorCode::GrantIdentityMismatch,
            "workspace directory inode changed",
        ));
    }
    reject_alias(ws_fd.as_raw_fd())?;
    run_after_workspace_verify_hook(file_rel);
    grant_check()?;
    let (parent, file_name) = parts.split_at(parts.len() - 1);
    let parent_fd = walk_dir(&ws_fd, &root_dev, parent.to_vec(), grant_check)?;
    let file_fd = open_child(&parent_fd, &file_name[0], false, grant_check)?;
    let st = fstat(&file_fd)?;
    classify_file(&st, &root_dev, &file_name[0])?;
    reject_alias(file_fd.as_raw_fd())?;
    grant_check()?;
    read_fd(file_fd, st.st_size, max_bytes)
}

fn read_fd(file_fd: OwnedFd, size: i64, max_bytes: u64) -> Result<ReadBytes> {
    let file_len = if size < 0 { 0 } else { size as u64 };
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

fn walk_dir(
    root: &OwnedFd,
    root_dev: &str,
    parts: Vec<String>,
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<OwnedFd> {
    let mut current = dup_fd(root)?;
    for part in parts {
        if let Some(code) = blocked_component(&part) {
            return Err(CoreError::new(code, format!("refusing component {part}")));
        }
        let next = open_child(&current, &part, true, grant_check)?;
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

fn inspect_one(
    parent: &OwnedFd,
    name: &str,
    root_dev: String,
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<ChildInspect> {
    match open_child(parent, name, false, grant_check) {
        Err(err)
            if matches!(
                err.code,
                ErrorCode::SymlinkRejected
                    | ErrorCode::SpecialFileRejected
                    | ErrorCode::HardlinkRejected
                    | ErrorCode::NotADirectory
            ) =>
        {
            return Ok(ChildInspect::Rejected {
                name: name.to_string(),
                reason: err.code,
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

fn open_child(
    parent: &OwnedFd,
    name: &str,
    dir: bool,
    grant_check: &dyn Fn() -> Result<()>,
) -> Result<OwnedFd> {
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
    if is_special(&lst) {
        return Err(CoreError::new(
            ErrorCode::SpecialFileRejected,
            format!("refusing special file {name} before open"),
        ));
    }
    if dir && !is_dir(&lst) {
        return Err(CoreError::new(
            ErrorCode::NotADirectory,
            format!("refusing non-directory {name}"),
        ));
    }
    run_before_open_hook(name);
    grant_check()?;
    note_open_attempt();
    let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
    if dir || is_dir(&lst) {
        flags |= libc::O_DIRECTORY;
    }
    let fd = unsafe { libc::openat(parent.as_raw_fd(), c.as_ptr(), flags) };
    if fd < 0 {
        let err = last_errno();
        if err == libc::EAGAIN || err == libc::ENXIO || err == libc::ENODEV {
            return Err(CoreError::new(
                ErrorCode::SpecialFileRejected,
                format!("non-blocking open refused {name}"),
            ));
        }
        return Err(map_open_errno(err, name));
    }
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    let opened = fstat(&fd)?;
    if is_lnk(&opened) || is_special(&opened) || (dir && !is_dir(&opened)) {
        return Err(CoreError::new(
            ErrorCode::SpecialFileRejected,
            format!("opened object for {name} failed type recheck"),
        ));
    }
    if !dir && !is_dir(&opened) && !is_reg(&opened) {
        return Err(CoreError::new(
            ErrorCode::SpecialFileRejected,
            format!("opened object for {name} is not a regular file"),
        ));
    }
    Ok(fd)
}

enum ListedName {
    Utf8(String),
    NonUtf8,
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

fn is_special(st: &libc::stat) -> bool {
    let mode = st.st_mode & libc::S_IFMT;
    mode == libc::S_IFIFO
        || mode == libc::S_IFSOCK
        || mode == libc::S_IFCHR
        || mode == libc::S_IFBLK
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

fn child_name(child: &ChildInspect) -> &str {
    match child {
        ChildInspect::Dir { name }
        | ChildInspect::File { name, .. }
        | ChildInspect::Rejected { name, .. } => name,
    }
}
