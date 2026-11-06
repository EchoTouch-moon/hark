-- Hark R1 schema v4: workspace memory, structured opinions, feedback, FTS projection.
-- Does not rewrite 0001_init.sql, 0002_opening_run.sql, or 0003_conversation_run.sql.
-- conversation_events and source_refs stay the evidence authority. These tables are
-- not a second copy of chat text, and opinions are not stored again as memories.
-- memory_search_docs / memory_search_fts are projections, not a writable authority.

CREATE TABLE workspace_memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('identity', 'decision', 'experience')),
  head_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_workspace_memories_ws ON workspace_memories (workspace_id, kind);

CREATE TABLE memory_revisions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES workspace_memories(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'ADD', 'REVISE', 'DISPUTE', 'NOOP', 'RETRACT', 'RESTORE'
  )),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed', 'retracted')),
  content TEXT NOT NULL,
  support TEXT NOT NULL CHECK (support IN ('user_quote', 'file_excerpt')),
  note TEXT NOT NULL DEFAULT '',
  supersedes_revision_id TEXT,
  operation_id TEXT NOT NULL,
  caller TEXT NOT NULL,
  historical INTEGER NOT NULL CHECK (historical IN (0, 1)),
  source_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (memory_id, revision)
);

CREATE INDEX idx_memory_revisions_ws ON memory_revisions (workspace_id, memory_id);
CREATE INDEX idx_memory_revisions_op ON memory_revisions (workspace_id, operation_id);

CREATE TABLE opinions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  head_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_opinions_ws ON opinions (workspace_id);

CREATE TABLE opinion_revisions (
  id TEXT PRIMARY KEY,
  opinion_id TEXT NOT NULL REFERENCES opinions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'ADD', 'REVISE', 'DISPUTE', 'NOOP', 'RETRACT', 'RESTORE', 'FEEDBACK'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'active', 'shelved', 'disputed', 'superseded', 'stale', 'pending_revision', 'retracted'
  )),
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  counter_json TEXT NOT NULL,
  uncertainty_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  supersedes_revision_id TEXT,
  operation_id TEXT NOT NULL,
  caller TEXT NOT NULL,
  historical INTEGER NOT NULL CHECK (historical IN (0, 1)),
  judgment_generated INTEGER NOT NULL CHECK (judgment_generated IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (opinion_id, revision)
);

CREATE INDEX idx_opinion_revisions_ws ON opinion_revisions (workspace_id, opinion_id);
CREATE INDEX idx_opinion_revisions_op ON opinion_revisions (workspace_id, operation_id);

-- Original feedback text. A later revision must not be the only copy of the comment.
CREATE TABLE opinion_feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  opinion_id TEXT NOT NULL REFERENCES opinions(id),
  revision_id TEXT NOT NULL REFERENCES opinion_revisions(id),
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('helpful', 'rebut', 'shelve', 'revise')),
  user_comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, request_id)
);

CREATE INDEX idx_opinion_feedback_opinion ON opinion_feedback (opinion_id, created_at);

-- Idempotency receipt for this slice only. Not an agent, queue, or permission platform.
CREATE TABLE memory_write_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  operation_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('memory', 'opinion', 'feedback', 'revert')),
  outcome TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, operation_id, domain)
);

CREATE TABLE memory_search_docs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  body TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  status_label TEXT NOT NULL,
  historical INTEGER NOT NULL CHECK (historical IN (0, 1)),
  source_ref_id TEXT,
  opinion_id TEXT,
  conversation_id TEXT,
  target_id TEXT,
  trust INTEGER NOT NULL
);

CREATE INDEX idx_memory_search_docs_ws ON memory_search_docs (workspace_id, kind, historical);

-- Trigram cannot match 1–2 character terms. Those queries use bounded LIKE in Rust.
CREATE VIRTUAL TABLE memory_search_fts USING fts5(
  body,
  content='memory_search_docs',
  content_rowid='rowid',
  tokenize='trigram'
);
