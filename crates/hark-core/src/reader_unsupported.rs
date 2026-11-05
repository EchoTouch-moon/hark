//! Fail-closed reader for platforms without an implemented safe open path.

use std::path::Path;

use crate::error::{CoreError, ErrorCode, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DirIdentity {
    pub dev: String,
    pub ino: String,
}

#[derive(Debug)]
pub(crate) struct ReadBytes {
    pub bytes: Vec<u8>,
    pub truncated: bool,
    pub file_len: u64,
}

#[derive(Debug)]
pub(crate) enum ChildInspect {
    Dir { name: String },
    File { name: String, len: u64 },
    Rejected { name: String, reason: ErrorCode },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Relation {
    Disjoint,
    Overlap,
}

pub(crate) fn reader_capability() -> &'static str {
    "fail_closed"
}

pub(crate) fn identify_directory(_path: &Path) -> Result<DirIdentity> {
    unsupported()
}

pub(crate) fn relation(_path_a: &Path, _path_b: &Path) -> Result<Relation> {
    unsupported()
}

pub struct InspectedDir {
    pub children: Vec<ChildInspect>,
    pub hit_entry_limit: bool,
    pub cancelled: bool,
}

pub fn reset_reader_work_counters() {}

pub fn reader_readdir_steps() -> u64 {
    0
}

pub fn reader_open_attempts() -> u64 {
    0
}

pub fn set_reader_before_open_hook(_hook: Option<std::sync::Arc<dyn Fn(&str) + Send + Sync>>) {}

pub(crate) fn inspect_directory(
    _root: &Path,
    _expected: &DirIdentity,
    _rel_dir: &str,
    _max_entries: u32,
    _cancel: &crate::CancelFlag,
) -> Result<InspectedDir> {
    unsupported()
}

pub(crate) fn identify_relative(
    _root: &Path,
    _expected: &DirIdentity,
    _rel: &str,
) -> Result<DirIdentity> {
    unsupported()
}

pub(crate) fn read_file(
    _root: &Path,
    _expected: &DirIdentity,
    _rel_file: &str,
    _max_bytes: u64,
) -> Result<ReadBytes> {
    unsupported()
}

fn unsupported<T>() -> Result<T> {
    Err(CoreError::new(
        ErrorCode::ReaderUnsupportedPlatform,
        "safe reader is not implemented on this platform; failing closed",
    ))
}
