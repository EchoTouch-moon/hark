# 记忆 / 观点 / 检索 Core 对接

状态：Core存储已verified-local；本分支Native/Tauri/UI读和用户动作已接（get/list opinion、反馈、撤销、检索、原消息证据），Native20/UI27及构建通过。独立观点在页面真实显示，pending_revision不伪成已修订判断。本切片已接Pi提议/recall工具，普通对话可返回Core真实写入收据；opening仅recall不写入。Core69/Native21/Host16+2/UI29及构建通过，尚未部署至运行窗口，不是真实模型或完整产品验收。部署状态见主线STATUS与memory-native-ui.md。

受信调用方是进程内 Native / Host。不要把 `memory_propose_change` 或 `opinion_propose_change` 加进 `FRONTEND_COMMANDS`、Tauri command 或 capability。WebView 不能传 `recorded`、`success`、来源 ID 或完成状态。

## 为什么要新表

`conversation_events` 是对话原文。修订不能覆盖它，聊天正文也不是长期记忆权威。`source_refs` 只保存已读文件的路径、哈希和摘录，不能再当决定或观点表。v3 没有 memory/opinion 领域表。观点如果再写进 `workspace_memories`，就会有第二套权威。

v4 只新增本切片要用的表，不改 `0001_init.sql` / `0002_opening_run.sql` / `0003_conversation_run.sql`：

- `workspace_memories` + `memory_revisions`：identity / decision / experience
- `opinions` + `opinion_revisions`：结构化观点
- `opinion_feedback`：用户反馈原文
- `memory_write_receipts`：本切片 operationId 幂等收据，不是队列或权限平台
- `memory_search_docs` + FTS5 `memory_search_fts`：投影，不是可独立修改的权威

`SCHEMA_VERSION` 现在是 4。旧库打开时从 v1–v3 升级，不丢对话和来源。

## 受信上下文

模型正文不能填这些字段。Host / Native 构造 `MemoryCallContext`：

```text
workspaceId
operationId          # 1..=128，非控制字符，不像密钥。同一 workspace 重放返回原收据
currentUserMessageId # 已落库且属于该 workspace；可省略
caller               # user | host | agentRun { runId }
```

`agentRun` 的run必须属于该workspace、处于running且当前服务/目录快照仍匹配；校验在Core写事务内复用普通run合同。Host按run+SDK toolCallId生成稳定operationId，Native绑定currentUserMessageId，不从模型参数取。本地用户反馈和已有记录阅读不查模型授权，也不新造 Gate。文件来源是否可用仍走原来的目录撤权 / 暂停；写记忆不会打开任意文件。

## memory_propose_change

```text
Core::memory_propose_change(ctx, MemoryChangeProposal) -> Result<MemoryReceipt>
```

`MemoryChangeProposal` 只有 `operation / kind / content / sourceRefs / targetId / expectedRevision`。`kind` 只能是 `identity | decision | experience`。`operation` 是 `ADD | REVISE | DISPUTE | NOOP | RETRACT`。

来源必须是同一 workspace 的 `source_refs.id` 或 `conversation_events.id`。不存在是 `source_ref_not_found`。跨空间是 `cross_workspace_ref`。文件摘录只看已保存的 excerpt；目录暂停 / 撤销返回 `root_paused` / `root_revoked`，不会为了核验去读文件。

决定：

- 必须有同 workspace 的 `user_message` 原话支持正文。文件摘录或当前消息 ID 不能单独为外部事实背书。
- `REVISE` / `DISPUTE` 还必须绑定当前用户消息，不能只用旧消息改决定。
- 正文比原话更强（彻底切换、已迁移、全局偏好等）或对不上时，返回 `needs_clarification`，`recorded=false`，不写决定。`retainedQuote` 是留下来的原话，不是已记录的决定。
- 决定不能只靠子串或词覆盖当成肯定结论。否定、疑问、条件里的片段（「不采用 Bun」「是否采用 Bun？先别决定。」「如果测试通过，再采用 Bun。」）摘成「采用 Bun」时，返回 `needs_clarification`，`recorded=false`。疑问句和「先别决定」整段照抄也不是已决定。
- 完整原话可以记下，否定和试用限定语必须留在正文里。例如「我决定不采用Bun，继续Node」仍是否定决定；「先试 Bun，Node 保底」仍是试用保底，不能写成「已彻底切换 Bun」，也不能只摘「先试 Bun」。只丢掉「我们决定」「改为」这类中性前缀、其余原话还在时，可以记。
- 身份引用和观点重叠仍用原来的词覆盖。那不是已核实事实，也不能借此把摘出来的肯定句写成决定。

身份只接受用户原话或文件摘录的包含引用，标签是「不是观察事实」。经验必须有明确确认用语（如「记住这点」）并且正文被该原话支持；单次观察不会升成方法或全局偏好。没有全局记忆写入口。

收据 `outcome`：

| outcome | recorded | 含义 |
|---|---|---|
| `committed` | true | 这次写入了 revision。才可以显示已记下 |
| `noop` | false | 没有有效变化，或相同正文已经是当前记录 |
| `needs_clarification` | false | 核验不了。不能称已记录 |
| `conflict` | false | `expectedRevision` 不是当前 head。不覆盖。重试必须用新 operationId |
| `reverted` | false | 只来自撤销路径 |

硬错误（错 workspace、伪造来源、缺字段）是 `Err`，不写收据。同一 `operationId` 再次调用忽略新正文，返回第一次的收据，并刷新 `stillCurrent`。`stillCurrent=false` 表示后来又有修订，不能把重放收据当成当前决定。

`MemoryReceipt` 对 UI `MemoryReceiptData` 的映射：`operationId / workspaceId / decisionTitle / decisionSummary / committedAt / revision / reverted / sourceMessageId`。只有 `recorded` 或 `reverted` 时才映射。`needs_clarification` 不能显示「已记下」。

读接口：`get_memory(workspaceId, memoryId)`、`list_workspace_memories(workspaceId)`、`memory_receipt_by_operation(workspaceId, operationId)`。列表最多 100 条当前 head。历史在 `history` 里，`historical=true` 的旧修订不是当前决定。

## opinion_propose_change

```text
Core::opinion_propose_change(ctx, OpinionChangeProposal) -> Result<OpinionReceipt>
```

必填 `summary / evidenceRefs / counterArguments / uncertainties`。`summary` 非空。`evidenceRefs` 至少一个真实同 workspace 来源。反论和不确定项可以是空数组，但不能缺字段，单项不能是空串。

观点不写入 `workspace_memories`。推断可以保存为观点，但收据和检索标签都写明不是已核实事实。如果证据只有当前用户消息，摘要必须被该原话支持，否则 `needs_clarification`。其他证据至少要有实质词重叠；完全对不上也不保存。

`OpinionView` 对齐 UI，并多三个字段：`judgmentGenerated`、`replayed`、`stillCurrent`。`rationale` 固定说明没有另生成理由。`suggestedNextStep` 目前是空，不会把用户评论伪装成下一步。

## submit_opinion_feedback

```text
Core::submit_opinion_feedback(OpinionFeedbackInput) -> Result<OpinionView>
```

入参就是 UI `{ requestId, workspaceId, opinionId, expectedRevision, action, userComment }`，再加受信 `caller`。`requestId` 是幂等键。动作：`helpful | rebut | shelve | revise`。

- 反馈追加修订，不改写旧修订正文，评论留在 `opinion_feedback`。
- `helpful`：状态仍是 active，不是新判断。
- `rebut`：状态 `disputed`。用户原话以「用户反驳：」追加到反论。不改决定，也不把它写成事实。
- `shelve`：状态 `shelved`。搁置不是否定事实，不改 `workspace_memories`。
- `revise`：只有评论、没有新的结构化摘要时，状态是 `pending_revision`，摘要不变，`judgmentGenerated=false`。不能称已生成新判断。真正的新判断走 `opinion_propose_change` 的 `REVISE`。

`expectedRevision` 不符返回 `Err(conflict_revision)`，不写。UI 可映射为 `CONFLICT_REVISION`。

`pending_revision` 不在现有 UI `OpinionStatus` 里。Native 不要把它收成 `active` 后假装摘要已更新。可以扩展 UI 类型，或用 `userFeedbackNote` 和 history note 显示「待修订」，同时保留这个状态。

## revert_memory_operation

```text
Core::revert_memory_operation(workspaceId, operationId) -> Result<MemoryReceipt>
```

按 workspace + operationId 找到已提交的 memory / opinion / feedback 写入，再追加一条 `RETRACT` 或 `RESTORE`。不删除旧行，不改对话原文。已经不是该写入留下的 head 时返回 `Err(conflict_revision)`，不覆盖新版本。没提交过的 operation 不能撤销，也不会把 `reverted` 设成 true。同一 operationId 再撤一次返回第一次的撤销收据。

## search_workspace_memory

```text
Core::search_workspace_memory(MemorySearchInput) -> Result<MemorySearchPage>
```

入参 `{ workspaceId, query, kinds?, cursor? }`。`cursor` 是 `p:<offset>`，offset 最大 200。页大小 20。全部参数化，并且带 workspace 条件。

覆盖：对话原文（`conversation_milestone`）、identity / decision / experience、结构化观点、已保存文件摘录（`local_fact`）、当前与历史修订。旧修订的 `statusLabel` 含「历史修订，不是当前决定」，不能当成最新决定。目录已撤销时，文件摘录清空 snippet，标签为不可用，不当当前事实。

词项按空白和标点切开，保留 `C++`、`Next.js`、`foo/bar`。少于 3 个 Unicode 字符的词，包括 1～2 字中文，用有界 `LIKE ... ESCAPE '\'`，不是 FTS 排序。更长的词用 FTS5 trigram。`matchMode` 为 `fts5 | like_fallback | mixed | empty`。`likeFallbackTerms` 非空时不能说这是 FTS 排序。排序是命中词项数、当前优先于历史、类型，不是 bm25。AND 没有共同命中时才 OR 召回，`usedOrFallback=true`，不等于事实充分。空查询或无命中返回空列表，不编造。

UI `MemorySearchPage` 没有 `matchMode / note`。Native 映射 `items` 时要带上 `statusLabel`，不要丢掉「这不是 FTS 排序」的说明。`kinds` 省略时才包含 identity / experience。只传 UI 四种 kind 时，这两种不会出现。

目录撤权后的文件摘录、以及候选扫描上限（每词 80、列表 100、重复检测 200）都是限额，不是完整语料证明。

## Native 可以接的薄命令

这些读和用户动作可以由 Native 包一层，仍然不要让 WebView 填收据字段：

- `get_opinion`
- `list_workspace_opinions`
- `submit_opinion_feedback`（caller 固定 `user`）
- `revert_memory_operation`
- `search_workspace_memory`
- `get_memory` / `list_workspace_memories`

`memory_propose_change` / `opinion_propose_change` 留在 Host 工具路径。Host 绑定 workspace、operationId、当前用户消息和 caller。模型工具参数只有 operation、kind、content、sourceRefs、target、expectedRevision，或观点的四个结构字段。

## 还没做

- Native/UI读与用户动作已接；Pi三个认知工具及持久收据投影已在本分支接通。只读 `list_memory_receipts({workspaceId})` 返回最近100条提交/撤销收据，UI artifact不是新的对话原文。
- 没有真实模型调用。opening写入尚不支持，不用Host caller绕过普通run验证。
- CTX-01的自动L0/L1投影、Observer失效、全局记忆、memory_get_evidence、向量检索和中文分词依赖仍没做；本切片通过按需recall读既有记录。
- 决定核验只认原话引用和少量中性前缀，不是语义蕴含器，也不是新的模型校验。对不上、被摘掉限定语、或无法确定是明确决定时，留在待澄清。
- 本机 `cargo test` 与 Native `cargo check` 只证明 Core 类型和本地 SQLite 行为。不是桌面点击，也不是整产品完成。
