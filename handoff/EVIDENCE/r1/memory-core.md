# 记忆 Core 证据

状态：`implemented-local`。不是 Native/Host/UI 接线，不是真实模型，不是安装包。

工作区：`/Users/v/new-idea/hark-r1-memory-core`，分支 `dev/r1-memory-core`，起点 `8d5bb44`。没有改主线源码、原用户前端或正在运行的窗口。编译复用了主线 target 目录，只写构建缓存。

## 为什么不能用旧表

- 对话原文在 `conversation_events`。修订覆盖它就会丢掉用户原话。
- `source_refs` 只有文件路径、哈希和摘录。它不能表示决定版本，也不能表示观点的反论和不确定项。
- v3 没有 memory/opinion 表。把观点再塞进通用记忆会形成第二套权威。
- 检索需要 FTS5 投影。投影不能当可独立修改的权威。

所以 v4 新增 `workspace_memories`、`memory_revisions`、`opinions`、`opinion_revisions`、`opinion_feedback`、`memory_write_receipts`、`memory_search_docs` 和 `memory_search_fts`。没有通用 operation、agent、queue 或权限平台。旧 migration 文件没改。

## 语义边界

- 决定必须被同 workspace 用户原话支持。对不上就 `needs_clarification`，`recorded=false`。不写「已决定」。
- 决定不把子串或词覆盖当成肯定结论。从「不采用 Bun」「是否采用 Bun？先别决定。」「如果测试通过，再采用 Bun。」摘出「采用 Bun」不会落成决定。`retainedQuote` 仍是原话，不是已记录决定。
- 完整原话可以保留限定语：「我决定不采用Bun，继续Node」仍是否定；「先试 Bun，Node 保底」仍是试用保底，不会存成「已彻底切换 Bun」或只剩「先试 Bun」。只去掉「我们决定」「改为」这类中性前缀时，其余原话仍可记。
- 身份引用和观点重叠仍允许词覆盖。那条路径不是决定，标签也不是已核实事实。
- 当前消息 ID 不能为文件里的外部事实背书。文件只使用已保存摘录，不为此打开文件。撤权后文件来源不可用。
- 经验不会从单次观察升成方法或全局偏好。没有全局记忆表。
- 观点独立保存。反馈保留原文并追加修订。搁置不是否定事实。只有评论的 revise 标 `pending_revision`，不生成新判断。
- 撤销追加修订。之后已有变更则 `conflict_revision`，不覆盖。不删除历史，不改对话原文。
- 同一 operationId 重放返回原收据。冲突后的重试需要新 operationId。
- 检索：3 个及以上 Unicode 字符走 FTS5 trigram；更短的词，包括 1～2 字中文，走有界参数化 LIKE。LIKE 不是 FTS 排序。排序不是 bm25。旧修订标历史。空结果不编造。
- 本地反馈和已有记录阅读不需要模型批准，没有新 Gate。

## 限额

- 正文最多 4000 字。观点列表项最多 16 条、每条 500 字。
- 检索最多 8 个词项、每词 80 个候选、每页 20 条、cursor offset 最大 200。
- 记忆 / 观点列表最多 100。相同正文去重只看最多 200 条当前记录。
- 这些上限不是完整语料证明。

## 本机命令

合成 temp 库和临时目录。没有模型请求，没有密钥，没有私人目录，没有 sudo / Docker / push。

初版记忆切片曾是 67 passed / 0 failed。决定支持修复后重跑：

```text
CARGO_TARGET_DIR=/Users/v/new-idea/hark-r1-desktop/crates/hark-core/target
cargo fmt --manifest-path crates/hark-core/Cargo.toml
cargo check --manifest-path crates/hark-core/Cargo.toml --offline
cargo test --manifest-path crates/hark-core/Cargo.toml --offline -- --test-threads=8
```

结果：`cargo check` 通过。`cargo test` 69 passed / 0 failed。

- lib 10，含 v1 升级到 v4、未知索引仍拒绝 v3 重建，以及决定引用不再把摘出的肯定句当成支持
- conversation_run 6，含非空 v2 升级后原文仍在
- f1_disk 32，含当前表清单
- ipc_contract 3
- opening_receipt 10
- memory_core 8：保存→修订→反馈→撤销/冲突→重开；同 operation 重放；跨 workspace 与不存在来源拒绝；中文短词 LIKE 与英文/混合查询；历史标记；v3 非空聊天和来源升级后可检索，新写入同步进 FTS；无模型授权也可记本地反馈；三个摘出「采用 Bun」的反例经 `memory_propose_change` 返回 `needs_clarification` 且 `recorded=false`，完整肯定、完整否定和试用保底原话可以记下

```text
CARGO_TARGET_DIR=/Users/v/new-idea/hark-r1-desktop/apps/desktop/target
cargo check --manifest-path apps/desktop/Cargo.toml -p hark-native-shell --offline
```

结果：`hark-native-shell` check 通过。只说明共享类型没有编译破坏。Native 还没有调用新方法。这次决定支持修复没有改 Native/Host/UI，没有重跑这条 check。

## 未验证

- UI / Native adapter / Host tool 未接。
- 没有真实模型、桌面点击、安装包或 Windows 证据。
- CTX-01、Observer 失效、全局记忆、向量检索未做。
- 决定不再把同词但被否定、疑问或条件包住的片段记成肯定决定。这仍不是语义蕴含器：身份/观点的词覆盖还在；英文中性前缀不在封闭帧列表里时会待澄清；整段条件句若原话完整提交，正文会保留「如果」，不会升级成无条件采用。
