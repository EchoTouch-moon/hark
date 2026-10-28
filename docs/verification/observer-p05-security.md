# Observer P0.5 H03 Security

Git spawn uses argv allowlist, `--no-optional-locks`, empty hooksPath, `GIT_CONFIG_NOSYSTEM`, disabled fsmonitor/pager/attributesFile, bounded stdout/stderr (16 MiB).

Reports open the file then compare inode to `realpath` of the path so a symlink swap after the lexical check is rejected.

| ID | Result | Evidence |
|---|---|---|
| SE-01 | PASS | `../` and absolute report paths throw |
| SE-02 | PASS | symlink to outside file → `SYMLINK_ESCAPE` |
| SE-03 | PASS | duplicate realpath rejected; detached worktree is a second project |
| SE-04 | PASS | `core.fsmonitor=touch PWNED-FSM` not executed |
| SE-05 | PASS | `--help` and quote filenames counted, no injection |
| SE-06 | PASS | DOCTYPE/ENTITY rejected |
| SE-07 | PASS | HTTP 401 without session, 403 without CSRF |
| SE-08 | PASS | HEAD / porcelain / index size unchanged after scan |
