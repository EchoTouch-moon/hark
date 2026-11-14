//! Bounded, in-memory review queue. This is not a persisted approval or a send
//! permit. A trusted caller constructs each snapshot from the final request.
//! This module is deliberately not connected to the desktop or transport.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hark_core::{RunId, WorkspaceId};
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

const MAX_REVIEWS: usize = 16;
const MAX_QUEUE_BYTES: usize = 4 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 512 * 1024;
const MAX_SOURCES: usize = 128;
const MAX_LIMITS: usize = 32;
const MAX_REVIEW_LIFETIME: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLimit {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSource {
    pub source_id: String,
    pub path: String,
    pub version: String,
    pub byte_len: u64,
    pub truncated: bool,
}

/// Constructed by trusted Native code, never deserialized from the UI. The
/// body must be the final serialized request; do not supply credentials or
/// request headers. This type intentionally does not implement Debug.
pub struct ReviewRequest {
    pub workspace_id: WorkspaceId,
    pub run_id: RunId,
    pub recipient: String,
    pub model: String,
    pub limits: Vec<ReviewLimit>,
    pub sources: Vec<ReviewSource>,
    pub body: String,
}

/// Immutable once inserted; UI receives a serialized view, never a mutable
/// reference to the stored request. Not Debug so request text is not logged.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSnapshot {
    review_id: String,
    workspace_id: WorkspaceId,
    run_id: RunId,
    recipient: String,
    model: String,
    limits: Vec<ReviewLimit>,
    sources: Vec<ReviewSource>,
    body: String,
}

impl ReviewSnapshot {
    pub fn review_id(&self) -> &str {
        &self.review_id
    }
    pub fn workspace_id(&self) -> &WorkspaceId {
        &self.workspace_id
    }
    pub fn run_id(&self) -> &RunId {
        &self.run_id
    }
    pub fn recipient(&self) -> &str {
        &self.recipient
    }
    pub fn model(&self) -> &str {
        &self.model
    }
    pub fn limits(&self) -> &[ReviewLimit] {
        &self.limits
    }
    pub fn sources(&self) -> &[ReviewSource] {
        &self.sources
    }
    pub fn body(&self) -> &str {
        &self.body
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReviewDecision {
    Approve,
    Reject,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReviewQueueError {
    #[error("review not available")]
    NotAvailable,
    #[error("review is not pending")]
    NotPending,
    #[error("review is not approved")]
    NotApproved,
    #[error("review queue is full")]
    Full,
    #[error("invalid review request")]
    Invalid,
    #[error("review queue lock poisoned")]
    Poisoned,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Pending,
    Approved,
}

struct Entry {
    snapshot: Arc<ReviewSnapshot>,
    expires: Instant,
    bytes: usize,
    state: State,
}

/// Each method takes the lock briefly; waiting for a human does not block the
/// worker or prevent cancellation. Expired entries are removed on access.
#[derive(Default)]
pub struct PendingReviewQueue {
    entries: Mutex<HashMap<String, Entry>>,
}

impl PendingReviewQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// The caller must verify endpoint, source provenance and contents before
    /// insertion; this queue performs only shape and resource-limit checks.
    pub fn insert(
        &self,
        request: ReviewRequest,
        ttl: Duration,
    ) -> Result<String, ReviewQueueError> {
        let bytes = request_size(&request)?;
        if ttl.is_zero() || ttl > MAX_REVIEW_LIFETIME {
            return Err(ReviewQueueError::Invalid);
        }
        let expires = Instant::now()
            .checked_add(ttl)
            .ok_or(ReviewQueueError::Invalid)?;
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ReviewQueueError::Poisoned)?;
        purge_expired(&mut entries);
        if entries.len() >= MAX_REVIEWS
            || entries
                .values()
                .map(|entry| entry.bytes)
                .sum::<usize>()
                .saturating_add(bytes)
                > MAX_QUEUE_BYTES
        {
            return Err(ReviewQueueError::Full);
        }
        let id = format!("review_{}", Uuid::new_v4().simple());
        let snapshot = Arc::new(ReviewSnapshot {
            review_id: id.clone(),
            workspace_id: request.workspace_id,
            run_id: request.run_id,
            recipient: request.recipient,
            model: request.model,
            limits: request.limits,
            sources: request.sources,
            body: request.body,
        });
        entries.insert(
            id.clone(),
            Entry {
                snapshot,
                expires,
                bytes,
                state: State::Pending,
            },
        );
        Ok(id)
    }

    /// Returns the full exact snapshot only for a matching, pending review.
    pub fn get(
        &self,
        id: &str,
        workspace: &WorkspaceId,
        run: &RunId,
    ) -> Result<Arc<ReviewSnapshot>, ReviewQueueError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ReviewQueueError::Poisoned)?;
        purge_expired(&mut entries);
        let entry = matching(&entries, id, workspace, run)?;
        if entry.state != State::Pending {
            return Err(ReviewQueueError::NotPending);
        }
        Ok(Arc::clone(&entry.snapshot))
    }

    /// Only the opaque ID and expected identity are accepted from the caller;
    /// UI-provided replacement contents can never update the queued request.
    pub fn decide(
        &self,
        id: &str,
        workspace: &WorkspaceId,
        run: &RunId,
        decision: ReviewDecision,
    ) -> Result<(), ReviewQueueError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ReviewQueueError::Poisoned)?;
        purge_expired(&mut entries);
        if matching(&entries, id, workspace, run)?.state != State::Pending {
            return Err(ReviewQueueError::NotPending);
        }
        match decision {
            ReviewDecision::Approve => {
                entries
                    .get_mut(id)
                    .ok_or(ReviewQueueError::NotAvailable)?
                    .state = State::Approved
            }
            ReviewDecision::Reject => {
                entries.remove(id);
            }
        }
        Ok(())
    }

    /// Transfers a locally approved snapshot exactly once. The returned item is
    /// NOT a persisted approval and NOT permission to send: caller must still
    /// perform durable approval and a final authorized send-boundary check.
    pub fn take_approved(
        &self,
        id: &str,
        workspace: &WorkspaceId,
        run: &RunId,
    ) -> Result<Arc<ReviewSnapshot>, ReviewQueueError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ReviewQueueError::Poisoned)?;
        purge_expired(&mut entries);
        if matching(&entries, id, workspace, run)?.state != State::Approved {
            return Err(ReviewQueueError::NotApproved);
        }
        let entry = entries.remove(id).ok_or(ReviewQueueError::NotAvailable)?;
        Ok(entry.snapshot)
    }

    /// Removes pending and approved-but-not-taken entries for this run.
    pub fn cancel_run(
        &self,
        workspace: &WorkspaceId,
        run: &RunId,
    ) -> Result<usize, ReviewQueueError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| ReviewQueueError::Poisoned)?;
        purge_expired(&mut entries);
        let before = entries.len();
        entries.retain(|_, entry| {
            entry.snapshot.workspace_id != *workspace || entry.snapshot.run_id != *run
        });
        Ok(before - entries.len())
    }
}

fn matching<'a>(
    entries: &'a HashMap<String, Entry>,
    id: &str,
    workspace: &WorkspaceId,
    run: &RunId,
) -> Result<&'a Entry, ReviewQueueError> {
    let entry = entries.get(id).ok_or(ReviewQueueError::NotAvailable)?;
    if entry.snapshot.workspace_id != *workspace || entry.snapshot.run_id != *run {
        return Err(ReviewQueueError::NotAvailable);
    }
    Ok(entry)
}

fn purge_expired(entries: &mut HashMap<String, Entry>) {
    let now = Instant::now();
    entries.retain(|_, entry| entry.expires > now);
}

fn request_size(request: &ReviewRequest) -> Result<usize, ReviewQueueError> {
    if request.body.is_empty()
        || request.body.len() > MAX_BODY_BYTES
        || request.recipient.is_empty()
        || request.recipient.len() > 2048
        || request.model.is_empty()
        || request.model.len() > 256
        || request.limits.len() > MAX_LIMITS
        || request.sources.len() > MAX_SOURCES
    {
        return Err(ReviewQueueError::Invalid);
    }
    let mut size = request
        .body
        .len()
        .saturating_add(request.recipient.len())
        .saturating_add(request.model.len());
    for item in &request.limits {
        if item.label.is_empty() || item.label.len() > 256 || item.value.len() > 1024 {
            return Err(ReviewQueueError::Invalid);
        }
        size = size
            .saturating_add(item.label.len())
            .saturating_add(item.value.len());
    }
    for item in &request.sources {
        if item.source_id.is_empty()
            || item.source_id.len() > 128
            || item.path.is_empty()
            || item.path.len() > 1024
            || item.version.is_empty()
            || item.version.len() > 256
        {
            return Err(ReviewQueueError::Invalid);
        }
        size = size
            .saturating_add(item.source_id.len())
            .saturating_add(item.path.len())
            .saturating_add(item.version.len());
    }
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::thread;

    fn ids() -> (WorkspaceId, RunId) {
        (
            WorkspaceId::parse("ws_00000000000000000000000000000001").unwrap(),
            RunId::parse("run_00000000000000000000000000000001").unwrap(),
        )
    }

    fn request(workspace: &WorkspaceId, run: &RunId) -> ReviewRequest {
        ReviewRequest {
            workspace_id: workspace.clone(),
            run_id: run.clone(),
            recipient: "https://example.invalid/messages".into(),
            model: "synthetic".into(),
            limits: vec![ReviewLimit {
                label: "输出".into(),
                value: "200".into(),
            }],
            sources: vec![ReviewSource {
                source_id: "src_synthetic".into(),
                path: "README.md".into(),
                version: "synthetic-v1".into(),
                byte_len: 10,
                truncated: true,
            }],
            body: "{ \"message\": \"示例\\n原文\" }".into(),
        }
    }

    #[test]
    fn exact_snapshot_cannot_be_replaced_and_is_taken_once() {
        let (workspace, run) = ids();
        let queue = PendingReviewQueue::new();
        let original = request(&workspace, &run);
        let original_body = original.body.clone();
        let id = queue.insert(original, Duration::from_secs(30)).unwrap();
        let snapshot = queue.get(&id, &workspace, &run).unwrap();
        assert_eq!(snapshot.body, original_body);
        assert_eq!(snapshot.sources[0].path, "README.md");
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotApproved)
        ));
        queue
            .decide(&id, &workspace, &run, ReviewDecision::Approve)
            .unwrap();
        assert!(matches!(
            queue.decide(&id, &workspace, &run, ReviewDecision::Approve),
            Err(ReviewQueueError::NotPending)
        ));
        assert_eq!(
            queue.take_approved(&id, &workspace, &run).unwrap().body,
            original_body
        );
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));
    }

    #[test]
    fn rejecting_cancelling_expiring_and_wrong_identity_never_release_approval() {
        let (workspace, run) = ids();
        let other_workspace = WorkspaceId::parse("ws_00000000000000000000000000000002").unwrap();
        let other_run = RunId::parse("run_00000000000000000000000000000002").unwrap();
        let queue = PendingReviewQueue::new();
        let id = queue
            .insert(request(&workspace, &run), Duration::from_secs(30))
            .unwrap();
        assert!(matches!(
            queue.get(&id, &other_workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));
        assert!(matches!(
            queue.decide(&id, &workspace, &other_run, ReviewDecision::Approve),
            Err(ReviewQueueError::NotAvailable)
        ));
        queue
            .decide(&id, &workspace, &run, ReviewDecision::Reject)
            .unwrap();
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));

        let id = queue
            .insert(request(&workspace, &run), Duration::from_secs(30))
            .unwrap();
        queue
            .decide(&id, &workspace, &run, ReviewDecision::Approve)
            .unwrap();
        assert_eq!(queue.cancel_run(&workspace, &run).unwrap(), 1);
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));

        let id = queue
            .insert(request(&workspace, &run), Duration::from_millis(15))
            .unwrap();
        thread::sleep(Duration::from_millis(30));
        assert!(matches!(
            queue.decide(&id, &workspace, &run, ReviewDecision::Approve),
            Err(ReviewQueueError::NotAvailable)
        ));
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));
    }

    #[test]
    fn concurrent_duplicate_decisions_admit_only_one() {
        let (workspace, run) = ids();
        let queue = Arc::new(PendingReviewQueue::new());
        let id = queue
            .insert(request(&workspace, &run), Duration::from_secs(30))
            .unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (queue, id, workspace, run, barrier) = (
                Arc::clone(&queue),
                id.clone(),
                workspace.clone(),
                run.clone(),
                Arc::clone(&barrier),
            );
            workers.push(thread::spawn(move || {
                barrier.wait();
                queue
                    .decide(&id, &workspace, &run, ReviewDecision::Approve)
                    .is_ok()
            }));
        }
        barrier.wait();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(|won| *won)
                .count(),
            1
        );
        assert!(queue.take_approved(&id, &workspace, &run).is_ok());
        assert!(matches!(
            queue.take_approved(&id, &workspace, &run),
            Err(ReviewQueueError::NotAvailable)
        ));
    }

    #[test]
    fn caps_entries_size_and_lifetime_and_reclaims_expired_capacity() {
        let (workspace, run) = ids();
        let queue = PendingReviewQueue::new();
        assert!(matches!(
            queue.insert(request(&workspace, &run), Duration::ZERO),
            Err(ReviewQueueError::Invalid)
        ));
        assert!(matches!(
            queue.insert(
                request(&workspace, &run),
                MAX_REVIEW_LIFETIME + Duration::from_secs(1)
            ),
            Err(ReviewQueueError::Invalid)
        ));
        let mut oversized = request(&workspace, &run);
        oversized.body = "x".repeat(MAX_BODY_BYTES + 1);
        assert!(matches!(
            queue.insert(oversized, Duration::from_secs(1)),
            Err(ReviewQueueError::Invalid)
        ));
        for _ in 0..MAX_REVIEWS {
            queue
                .insert(request(&workspace, &run), Duration::from_millis(50))
                .unwrap();
        }
        assert!(matches!(
            queue.insert(request(&workspace, &run), Duration::from_secs(1)),
            Err(ReviewQueueError::Full)
        ));
        thread::sleep(Duration::from_millis(75));
        assert!(queue
            .insert(request(&workspace, &run), Duration::from_secs(1))
            .is_ok());
    }
}
