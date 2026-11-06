//! Provisional engineering limits. Not a product close of PRD O-13.

/// Current business schema. v1 SQL is unchanged. v2 adds opening-run columns.
/// v3 widens conversation event kinds and adds ordinary conversation runs.
/// v4 adds workspace memory, structured opinions, feedback, and an FTS projection.
pub const SCHEMA_VERSION: i64 = 4;

pub const MAX_FRAME_BYTES: usize = 1_048_576;
pub const MAX_STREAM_QUEUE: usize = 64;
pub const MAX_CONTROL_QUEUE: usize = 64;
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const MAX_TIMEOUT_MS: u64 = 120_000;

pub const DEFAULT_MAX_ENTRIES: u32 = 2_000;
pub const DEFAULT_MAX_DEPTH: u32 = 6;
pub const DEFAULT_MAX_FILE_BYTES: u64 = 256 * 1024;
pub const DEFAULT_MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024;

pub const ABSOLUTE_MAX_ENTRIES: u32 = 20_000;
pub const ABSOLUTE_MAX_DEPTH: u32 = 32;
pub const ABSOLUTE_MAX_FILE_BYTES: u64 = 1_048_576;
pub const ABSOLUTE_MAX_TOTAL_BYTES: u64 = 8 * 1_048_576;

pub const MAX_EVENT_BODY_CHARS: usize = 16_000;
pub const MAX_USER_MESSAGE_CHARS: usize = 32_000;
pub const MAX_EXCERPT_CHARS: usize = 280;
pub const MAX_MEMORY_TEXT_CHARS: usize = 4_000;
pub const MAX_OPINION_ITEM_CHARS: usize = 500;
pub const MAX_OPINION_LIST_ITEMS: usize = 16;
pub const MAX_SEARCH_TERMS: usize = 8;
pub const MAX_SEARCH_PAGE: usize = 20;
pub const MAX_SEARCH_CANDIDATES: usize = 80;
pub const MAX_SEARCH_OFFSET: usize = 200;
pub const MAX_MEMORY_LIST: usize = 100;
pub const MAX_IGNORED_RECORDS: usize = 200;
pub const MAX_RELATIVE_PATH_CHARS: usize = 4_096;
pub const ONBOARDING_GENERATION: i64 = 1;
