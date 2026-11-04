# 一次真实 StepFun 调用（2026-11-04）

用户确认外发，项目别名 `glm-words`。本机目录不写入仓库。这次调用没有经过 Hark 页面，因此没有预览 ID、确认记录或 `runId`，不能单独当作产品闭环通过。

- Provider / 模型：`stepfun-plan` / `step-5-preview`
- 扩展：已安装的 `@d3ara1n/pi-provider-stepfun` 入口，只加载这一份
- 进程：Pi 1.4.0，`--no-tools --no-skills --no-mcp --no-context-files --no-session`
- 工作目录：临时空目录，不是该项目文件夹
- 凭证：只向子进程传入 `STEP_PLAN_API_KEY`，未写入本文件
- 送出的资料：README 与 pyproject 中的产品说明、收词、复习、技术栈、AI 边界。未读取 `.env`、`words.db` 或源码正文
- 结果：模型返回一段中文说明，并列出四项不确定。引用的编号都在本次送出的五条资料里。没有写回项目事实，也没有第二次请求

原始回答保存在当次终端输出，不包含凭证。
