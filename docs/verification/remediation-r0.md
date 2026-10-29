# R0 正确性门禁 · 2026-10-29

PASS（本地合成故障注入）；不代表 R1/R2 已验收。

- H02：遗留 queued/running 显式 failed/INTERRUPTED，不自动重试计费；真实 SIGKILL 写进程后重开数据库恢复，再分析成功。
- H03：controller 按 Run ID 绑定，A完成后取消A不影响B；同项目在途/全局并发分别拦截。
- H04：不存在/跨项目/epoch不符/冻结/历史或不可用证据 Insight 拒绝；指定目标优先放入8条洞察上下文，包含理由和引用。
- H05：analysis v2 删除日志先落盘，取消在途任务并等待，依次清 Observer/Insight/Analysis+feedback；跨库失败保留日志，下次启动补偿，非跨库原子。暂停监控仍用 enabled=false，不清历史。
- H06：stdout 1MiB/stderr128KiB、超时/取消/TERM忽略后KILL、close后结算，POSIX进程组；全局默认1并发、真实Provider每日20次持久化请求预算（请求数上限，不是货币限额）。Windows只回收直接子进程。
- H07：fd最多8KiB读取，路径/inode/变更复核；100MiB文档和替换故障覆盖。FileExcerpt.sha256为捕获前缀hash，不是全文hash；bytes/truncated表示原始大小和截断。
- H09：saxes严格XML，禁止DTD/实体、限制16MiB/64层/200000节点；不完整、注释假标签、统计矛盾、状态冲突不能PASS。
- H10：配置0.0.0.0等非loopback时启动拒绝；无远程身份系统。

证据：handoff/EVIDENCE/r0-tests.txt（40文件338测试）、r0-typecheck.txt（全仓通过）、r0-lint.txt（改动文件通过）；r0-analysis.txt、r0-files-junit.txt、r0-pi-process.txt对应故障细节。工作者早期类型检查因并行编辑短暂失败，整合后的最终类型检查通过。

没有真实模型调用、没有真实项目写入。文件系统复核并非对恶意宿主的OS隔离；扩展仍属受信任本地代码。记录这些边界而不扩大安全承诺。
