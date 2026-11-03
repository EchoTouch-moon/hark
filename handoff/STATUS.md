# 当前状态（2026-11-03）

- M0 近期工作见 `tasks/DEVELOPMENT-PROGRESS.md`。已实现合同、摘要、观察权限判断、状态机和 SQLite 迁移的首批基础，验证见 `handoff/EVIDENCE/m0-foundation-check-2026-11-03.txt`。M0-REBUILD-01/02 和 M0 Gate 均未完成；真实目录和执行通道未接入。
- 文档优先的重建版本：已整理，入口为 `README.md` 和 `tasks/REBUILD-PLAN.md`。
- 产品目标与既有 MVP 产品合同、验收和安全文件已保留；原先位于其他分支的产品定位、开发计划和 DeepSeek 研究资料已复制为历史参考。
- 旧前后端、实现测试和构建文件已从此版本移除；本轮新增基础模块、构建及测试配置，尚无可运行完整产品。CI 定义已更新，远端执行未验证。
- 旧证据保留在 `handoff/EVIDENCE/`，仅证明其原记录所述历史，不能作为重建版本的通过证据。
- GitHub：重建版本已经 PR #55 与必需检查合入 `master`；旧 PR 已关闭，已按本次授权清理旧分支。`bot/hearth-g0-contract` 因现有规则禁止删除而保留。具体数量以 GitHub 实时状态为准。
- 原工作区未提交变更未触碰；GitHub 默认分支是否包含此版本，以 PR 实际合并状态为准。
