# G0 证据

基线：PR #6 `4d08d465239f4157bf920eb82903bc2a7726d553`、PR #5 `fe5464e4e2cb4cfb0b6cb8dffbc4db16bf664b23`。本次只做离线、合成数据的局部测试及只读源码/远端 CI 审查。

`baseline-tests.txt` 为命令 `pnpm exec vitest run packages/project-observer/src/observer.p0.test.ts packages/project-insight/src/coordinator.test.ts packages/project-insight/src/observer-read-port.test.ts packages/project-analysis/src/engine/privacy.test.ts packages/project-analysis/src/engine/remediation.test.ts packages/project-analysis/src/providers/pi.test.ts tests/unit/project-ember.test.ts` 的实际输出。该命令里 `observer-read-port.test.ts` 并不存在，被 Vitest 忽略；实际为日志列出的 6 个文件、46 个测试，不能报告为 7 个文件或端到端成功。测试使用合成数据和 Pi 测试用进程，未调用真实模型。

远端 PR #6 CI: https://github.com/EchoTouch-moon/hark/actions/runs/40998662240 （438 测试通过；浏览器 11 通过、11 失败、3 未运行；作业失败）。PR #5: https://github.com/EchoTouch-moon/hark/actions/runs/40994397259 （浏览器同为 11/11/3；作业失败）。远端 CI 测试的是 GitHub 合并结果而非本地新提交；不可据此声称 G0 或新 MVP 的真实端到端已通过。
