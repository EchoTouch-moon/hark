# 重建交接（2026-11-03）

最新：增加 v3 合成观点草稿、版本原因、方案和反馈存储；本地 64 项测试、类型检查及构建通过，证据见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`。仅支持合成观察证据；正式身份、生命周期、真实来源和 M0 Gate 未完成。

最新：v2 迁移与合成 Chronicle 已建立来源/项目绑定、授权重检、重置 epoch、不可变和幂等基础；19 项局部测试及类型检查见 `handoff/EVIDENCE/m0b-fixture-chronicle-check-2026-11-03.txt`。真实项目未观察，M0 Gate 仍未通过。

最新：按 Mac 分支审查新增项目理解合同首版和跨项目结构负例，详见 `docs/architecture/M0-A-PROJECT-KNOWLEDGE-CONTRACT.md`；36 项本机测试、类型检查与构建见 `handoff/EVIDENCE/m0a-project-contract-check-2026-11-03.txt`。未实现真实来源核验或观点持久化，M0 Gate 未通过。

最新：官方 DeepSeek 原型的参考记录见 `docs/architecture/DEEPSEEK-PROTOTYPE-2026-11-03.md`。新增路径预检和中断恢复；真实读取的竞态安全边界、Windows 验证和安全 Gate 仍未完成。验证见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。一次测试收集意外及缓解见 `handoff/BLOCKERS.md`。

本轮增加本地进度看板、合同/摘要、观察权限、状态转换和数据库迁移的基础实现。`handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt` 记录测试、类型检查、构建和文档检查；架构图见 `docs/architecture/hearth-foundation-v2.html`。当前未通过 M0 Gate；后续任务和未完成项见进度看板。

上一轮新增 M0 子任务与合成验收草案 `tasks/M0-FOUNDATION-2026-11-03.md`；首轮合同冲突已记录，尚未完成逐字段复核或 Gate 验证。上一轮文档检查见 `handoff/EVIDENCE/m0-plan-doc-check-2026-11-03.txt`；历史证据不能证明新实现。

请从 `README.md` 和 `tasks/REBUILD-PLAN.md` 开始。旧前后端和相关构建、测试已从重建版本移除；安全合同、计划、参考资料与历史证据保留。未实现、运行或验收新的产品。

原工作区的未提交改动保持原样。用户已授权将本次重建推送到 GitHub，并处理相关 PR 和分支；`master` 和 G0 的分支保护继续生效。当前清理详情应以 GitHub 实际 PR、分支与提交为准。
