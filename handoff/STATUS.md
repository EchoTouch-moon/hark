# 当前状态（2026-11-03）

- M0 合成用户决定 v4 迁移已实现；修订或撤回后引用旧决定的观点不可用，历史保留；fixture 项目删除中时观察与观点也停止使用。78 项本地测试及类型检查/构建见 `handoff/EVIDENCE/m0d-fixture-decisions-check-2026-11-03.txt`；真实用户决定与正式生命周期未实现。
- M0-C 的合成观点版本、不可执行方案、修订原因与反馈已实现并局部复核；64 项本地测试与类型检查/构建见 `handoff/EVIDENCE/m0c-fixture-opinion-check-2026-11-03.txt`，边界见 `docs/architecture/M0-C-FIXTURE-OPINION-MEMORY.md`。未实现真实来源、身份认证、研究或产品闭环。
- M0-B 合成来源及不可变观察的 v2 迁移、授权重检、epoch 和幂等基础已完成局部验证；见 `docs/architecture/M0-B-FIXTURE-CHRONICLE.md` 和 `handoff/EVIDENCE/m0b-fixture-chronicle-check-2026-11-03.txt`。真实来源及观点持久化未完成。
- M0-A 首版结构合同已落地：项目、类型化来源、观点版本、计划、反馈和版本对，见 `docs/architecture/M0-A-PROJECT-KNOWLEDGE-CONTRACT.md`；36 项本地测试及构建、类型检查、文档检查见 `handoff/EVIDENCE/m0a-project-contract-check-2026-11-03.txt`。可信来源核验、持久化和 Gate 均未完成。
- 官方原型已隔离克隆并按固定提交进行源码对照；本轮新增合成路径预检和中断恢复，26 项本地测试通过，见 `handoff/EVIDENCE/m0-path-recovery-check-2026-11-03.txt`。预检不能抵御检查后替换，真实目录读取、执行与外发仍未接通。
- M0 近期工作见 `tasks/DEVELOPMENT-PROGRESS.md`。已实现合同、摘要、观察权限判断、状态机和 SQLite 迁移的首批基础，验证见 `handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt`。M0-REBUILD-01/02 和 M0 Gate 均未完成；真实目录和执行通道未接入。
- 文档优先的重建版本：已整理，入口为 `README.md` 和 `tasks/REBUILD-PLAN.md`。
- 产品目标与既有 MVP 产品合同、验收和安全文件已保留；原先位于其他分支的产品定位、开发计划和 DeepSeek 研究资料已复制为历史参考。
- 旧前后端、实现测试和构建文件已从此版本移除；本轮新增基础模块、构建及测试配置，尚无可运行完整产品。CI 定义已更新，远端执行未验证。
- 旧证据保留在 `handoff/EVIDENCE/`，仅证明其原记录所述历史，不能作为重建版本的通过证据。
- GitHub：重建版本已经 PR #55 与必需检查合入 `master`；旧 PR 已关闭，已按本次授权清理旧分支。`bot/hearth-g0-contract` 因现有规则禁止删除而保留。具体数量以 GitHub 实时状态为准。
- 原工作区未提交变更未触碰；GitHub 默认分支是否包含此版本，以 PR 实际合并状态为准。
