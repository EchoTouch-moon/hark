# F1 开场收据修复证据：审查 #3

本文件记录隔离分支 `dev/r1-opening-receipt` 提交 `c69ade2` 当时的证据。合入当前 Core 后的联合结果见 `f1-core-integrated.md`。不要把下面“#1/#5 未修”读成集成后的状态。Host 未启动。不是父会话复审通过，也不是产品 PASS。

范围只含首次开场可信收据。写本文件时，#1 中间 symlink 重叠绕过、#5 撤权复查与 Workspace fd 绑定仍未在该隔离分支修。

自建合成临时目录。没有真实私人目录、密钥、模型或搜索调用。

## 失败负例（修复前）

`set -o pipefail`

`CARGO_TARGET_DIR` 指向本 worktree 的 `target/`。

`cargo test --manifest-path crates/hark-core/Cargo.toml --offline --test opening_receipt -- --test-threads=1 cancelled_wrong_model_empty_sources_are_not_presented`

退出码 **101**。stepfun/expected-model 授权并 `cancel_onboarding` 后，同 provider、不同 model、空 source 的 `success: true` 被接受，写入 `agent_opening_message` 且 `folded_local_card=true`。

## 修复后命令

均使用 `set -o pipefail`，target 仍是本 worktree，不共享其他 lane。

| 命令 | 退出码 |
|---|---|
| `cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8` | 0 |
| `cargo check --manifest-path crates/hark-core/Cargo.toml --offline --tests` | 0 |

结果：3 单元 + 20 既有磁盘 + 7 新开场磁盘 + 3 IPC，全部 ok。`0001_init.sql`、`reader.rs`、`grant.rs`、`scan.rs` 无 diff。

新磁盘负例覆盖：取消后迟到收据、重启后取消仍拒绝、错误 Provider/Model、伪 run、跨 workspace run/source、模型授权暂停/撤权、目录暂停/恢复不复活旧 run、目录撤权、配置切换及切回、失败不折叠且不置 `model_analyzed`、空证据、两种首消息重放不覆盖、显式 retry 新 run、未发放 run 的 success 不完成、初读开关不 wildcard。合法且仍匹配快照的 run 在重启后可以提交，这是恢复，不是绕过。

## 实现要点

- 不改已提交 v1。v2 只给 `onboarding_runs` 增加 run 与授权快照列。原因见 `handoff/DECISIONS.md`。
- `mark_analyzing` 发放并持久化 `active_run_id`，快照 provider、model、grant 与 root 的 `updated_at`。
- `commit_agent_opening` 新增必填 `run_id`。调用方 `success` 不是完成状态。
- 初读开关只写 `initial_read_requested`。启用模型必须同时有明确 provider 与 model。
- 成功开场至少引用一条本 workspace source，且目录授权仍 active。失败不折叠本地卡。

## 未验证

- 父会话复审、真实 StepFun、UI、Sidecar、Windows 编译。
- 正文是否假称构建或外网研究：只拒绝空 source，不解析正文。
- 来源是否仍是当前文件字节：不重走读取路径。可用性等于本 workspace 归属加当前目录授权。
- #1/#5 未修。
