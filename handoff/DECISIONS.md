# Hark R1 决策

- 用户明确批准隔离新建 `dev/r1-desktop`，PRD v0.5.1 替代旧 M0/M1 产品/实施合同，保留安全红线；PRD 原 DRAFT 状态不擅改。
- 原工作区有未提交修改，不覆盖、不 stash、不代为提交；新 worktree 从本机 origin/master 7fa37df 建立，未 fetch，不声称远端最新。
- 前端主体暂缓；Grok 4.7 分 Core → Host → integration 三个独占串行 seam 实现，主会话负责规划与代码/证据审查，不额外消耗 OpenAI 规划子 agent。
- 只为当前纵切增加必要表/依赖，不做旧库迁移、兼容层、Node native addon、全套空基础设施或 Mock 产品验收。
