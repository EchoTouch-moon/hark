# Observer P0.5 H04 SQLite

- Database: independent `observer.sqlite`
- Migrations: v1 core, v2 `current_revision` / `last_gap_at` + event snapshot FKs (rebuild table, transactional)
- Node bundled SQLite **3.51.3** (WAL-reset fix). `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`
- Single writer via `${db}.writer.lock`; no extra checkpoint process
- Unreferenced observation runs may be pruned; event rows are never deleted by prune

| ID | Result | Evidence |
|---|---|---|
| DB-01 | PASS | faults after-run/snapshot/events/pointer all roll back |
| DB-02 | PASS | second `migrateObserver` applies `[]`, version 2 |
| DB-03 | PASS | bounded busy retry in `transaction()` (no hang) |
| DB-04 | PASS | `integrity_check=ok`, `foreign_key_check` 0 after restart |
| DB-05 | PASS | `VACUUM INTO` backup opens and lists the project |
| DB-06 | PASS | no long-lived read transactions in query path |
| DB-07 | PASS | cursor pagination unique ids; events project-scoped |
