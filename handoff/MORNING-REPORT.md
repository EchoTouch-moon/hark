# Hark R1 执行交接

F1 Core 仍未产品放行。开场 run seam 已串行合入当前读侧 Core，父会话审查原文仍在 `f1-parent-review.md`。

- 分支 `dev/r1-desktop`，未推送。开场候选 `c69ade2` 已 cherry-pick，不合并该 base 上的过期 Reader。
- 审查 #1–#5 在本机联合回归后标 resolved-local。AT-05、Windows、真实模型、UI、整 R1 未通过。
- 证据：`handoff/EVIDENCE/r1/f1-core-integrated.md`。

## 本段串行合入（尚未接 Rust stdio）

- Host `dev/r1-host-runtime`：`2b9ac8c`、`40dae61`。保留单活跃 run、缺正文不回贴旧 pack、stdin/stdout 关闭、新 Session handoff、显式 stepfun 槽不再按名字硬拒。
- Native `dev/r1-native-shell`：`ca0efb3`、`8ca7617`。同 key 重叠扫描/读取拒绝第二次，结束只删除自己的取消标志。
- 文档冲突按函数/段落保留主线 F1 与两边修复，没有整文件 ours/theirs，没有覆盖 parent-review 或 AGENTS。
- 没有推送。真实 Rust↔Host 桥接、窗口点击、安装包、Windows、StepFun 仍未验。
