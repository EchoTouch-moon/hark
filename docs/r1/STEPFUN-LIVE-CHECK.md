# StepFun 有界验收（待用户亲自实跑）

这不是 Rust Core 联合真实 StepFun 的整产品闭环，也不是桌面体验、安装包或记忆验收。脚本只复用当前生产 `HostRuntime`、Pi SDK provider adapter 和 `workspace.read_file` / `workspace.overview` 白名单。授权响应与 README 都是本次进程自建的合成材料。没有读取真实项目。

离线测试拦截 fetch，不能当成真实模型通过。`claimsProductAcceptance` 恒为 false。

## 目标与未证明项

- 模型固定 `step-3.7-flash`。不授权其他模型、后台调用或隐式 Provider 切换。
- 唯一网络目标：`https://api.stepfun.com/v1/chat/completions`。
- 本仓生产代码与本地文档不能证明该路径、流式方言、工具名 `workspace.read_file` 或计费可用。状态：**待实测**。本任务没有做网络探针，也没有切换 base URL。
- 生产 adapter 对这个 base URL 不会自行写入输出上限。发出前的 fetch guard 把 `max_tokens` 和 `max_completion_tokens` 都强制为 512。本任务没有消耗请求去探测 StepFun 是否同时接受这两个字段，也没有根据猜测改成单一字段或切换端点。状态仍是**待实测**。若协议拒绝，脚本停下，不重试，不改端点。
- 预算：最多 3 次网络发送。失败、超时和非 200 都计入，且之后不再发送。不自动 retry，不跟随 redirect，不刷新模型目录，不搜索。

## 三次请求怎么控制

生产 Host/Pi 循环负责工具往返。脚本不自写 LLM 工具循环。第 4 次网络尝试在发出前被 guard 拒绝。

| 发送 | guard 对 body 的强制 | 含义 |
|---|---|---|
| 1 | `tool_choice: none` | 流式 text。这是预算锁，不是模型自发不调工具 |
| 2 | `tool_choice` 指定 `workspace.read_file` | **强制 tool 选择测试**，不是自发工具调用 |
| 3 | `tool_choice: none` | 工具后的最终回复，禁止再调工具以免超预算 |

`firstText` 与 `tool` 分列。任一项失败都不能写成通过。若 text 阶段已经用掉过多额度，tool 阶段标 `incomplete` 并停止。401 / 403 / 429、断网、redirect、协议失败都停止，不打印响应体、headers 或 Key。

## 用户亲自运行

只在打算消耗最多 3 次真实请求时运行。不要由 agent、CI 或管道代跑。

```bash
bash scripts/stepfun-live-check.sh
```

可选摘要路径必须是本仓相对路径，且位于 `handoff/EVIDENCE/r1/`：

```bash
bash scripts/stepfun-live-check.sh --summary handoff/EVIDENCE/r1/stepfun-live-check-summary.json
```

Wrapper 先用 `env -i` 启动 `bash --noprofile --norc`。这次 `env` 的参数只有 `PATH`、`TMPDIR`、`LANG`、`HOME`、`TERM`、清洁 shell 标记和脚本路径，不含 Key。隐藏 `read -s` 和 `export` 发生在这个清洁 shell 里面，并且在读 Key 之前已经 `set +x`。Node 继承该 shell 的环境，不从参数接收 Key。已存在的 `HARK_STEPFUN_API_KEY` 会先被丢掉，不会回退到 keychain、`.env`、`auth.json` 或其他环境变量。`umask 077` 和 `trap` 仍在；退出时 unset。Key 不进入参数、配置文件、JSONL 或日志。Node 读到后立即从环境删除，再注入生产内存 credential / provider slot。SDK 的 appData、cwd、sessionDir 使用本次临时目录，结束删除。

摘要必须是 `handoff/EVIDENCE/r1/` 下还不存在的扁平 `.json`。父目录若是符号链接，或目标已存在（普通文件或符号链接），在任何模型调用前拒绝。创建使用 `O_NOFOLLOW|O_EXCL`，不跟随最终组件。已存在的摘要不会被覆盖；换一个新文件名再跑。

这不是抵御同权限本机攻击者的 OS sandbox。它防止相对摘要路径经最终符号链接写出仓库。同用户仍可能调试本进程，或在检查父目录之后替换父级链接。

若请求已经发出后脚本异常退出，摘要保留 guard 的发送数、attempt 和 HTTP status，不会把已经发生的请求显示成 0。

摘要只含 model、请求数、token cap、HTTP 状态、stream/tool verdict 和合成输入标记。不含 Key、完整 headers、request body 或完整模型回复。

## 离线测试

```bash
npm run test:stepfun-live-check
```

证明：第 4 次拒绝、body cap/model/URL、redirect 与 retry 关闭、缺 Key 拒绝、输出与 JSONL 无合成 Key、受控 PTY 探针截取 env/bash/node 启动参数且不含合成 Key、符号链接摘要在 fetch 前拒绝且外部 canary 不变、401/403/429 不追加调用、已发送后异常仍保留请求计数、工具链步数受控。这些全部使用合成 Key 和拦截 fetch，不调用真实模型。

## 仍须用户亲自实跑

- 该 URL 是否接受 `step-3.7-flash` 与同时出现的两个 token cap 字段。本任务没有为此花请求。
- 流式 text 是否真的返回。
- 强制 `workspace.read_file` 后，生产循环能否拿到合成 README 并给出最终回复。
- 真实计费与错误码是否与 guard 的停止行为一致。
