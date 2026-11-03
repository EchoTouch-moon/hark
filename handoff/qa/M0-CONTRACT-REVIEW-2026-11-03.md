# M0 重建合同与合成验收设计复核

审查基线：`c3b1528`，2026-11-03。本次为独立只读文档复核，范围为 `tasks/manifest.json` 的 M0-REBUILD-01/02 定义任务及其合同和验收映射；不代表产品能力或完整 Gate 验收。

- M0-REBUILD-01：**DONE（合同复核与保守裁决）**。`docs/architecture/M0-CONTRACT-REVIEW.md`、`M0-CONTRACT-FIELD-MAP.md`、`M0-EXECUTION-AND-E2E-MAPPING.md` 覆盖授权目录、多项目与非 Git、研究外发、暂停撤权、执行审批、旧字段及 M0/M1/M2 与安全 P0 Gate 映射；未实现能力仍按失败关闭记录。
- M0-REBUILD-02：**DONE（合成场景及失败验收设计）**。`tasks/M0-SYNTHETIC-ACCEPTANCE.md` 定义 A/B、来源、观点、反馈、修订、越权、缺源、撤权及恢复，并区分 fixture 证据与 NOT RUN。实际发现器、Git/非 Git 识别和产品纵切是后续实现，不在此定义任务中冒称完成。

此复核只完成文档定义任务。M0 Gate 仍 **NOT PASSED**：动作具体政策、可信身份/来源和适用安全测试等仍需按合同完成并复审。安全 P0 Gate 未通过，真实 connector 不可启用；M1 尚未开始。E2E-01～12 和 S01～S12 不因本文标记已运行。
