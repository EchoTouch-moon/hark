# NIGHT QUEUE — 主 Agent 按 DAG 逐项执行

## 一晚时间有限时的硬优先级
1. M0-T01 → T02 → [T03,T04,T05] → M0-GATE。
2. M1-T01 → [T02,T03,T04] → [T05,T06,T07,T08] → T09 → M1-GATE。
3. M2-T01/T02/T03 → M2-GATE（**仅 M1 通过且无风险**）。
4. M3/M4 不执行；细节已有合同供未来计划。

## 每项的验收要翻 `tasks/manifest.json`
不能只按本列表凭经验实现，必须读取 `depends_on`, `deliverables`, `acceptance_tests` 和 `implementation_notes`。状态通过 `handoff/STATUS.md` 记录，任务文件也可加 `progress.json`，但不得改动原 manifest 的合同意图。

## 失败分支
- M0/T02 Schema 和 DB 依赖问题 → 核心 Gate BLOCKED，不可冲进 UI 声称完成。
- 后端正常但浏览器 E2E 环境缺工具 → API 自动测试 + build + 手动页面截图/说明，标 `M1-GATE PARTIAL`，不假称绿色。
- Hermes 未连接 → Mock Adapter 走完全流程，M1 仍可为 GREEN（以 Mock 合同为前提）。
- 外部账号/写操作需求 → 记录 blocked/approval-needed，独立完成可安全任务。

## 提交检查点
本地 commit 建议：`chore(m0): bootstrap`、`feat(m0): contracts-policy`、`feat(m1): event-card-run`、`feat(m1): ui-shell`、`test(m1): e2e-and-gate`。不需要为了凑 commit 信息拆掉原子事务，不要自动推 remote。
