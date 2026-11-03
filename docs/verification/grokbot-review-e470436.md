# 历史安全审查摘要：e470436

2026-11-01 审查固定的 `bot/hearth-g0-contract@e470436d52f618de606b50b260c8734f11fb7a9c`。本文件保留有复现价值的发现；它描述的是该历史版本，**不是对当前 G0 的全面安全结论**。当前整合基线与验证状态见 [G0 精简交接](../../handoff/G0-CURRENT-HANDOFF.md)。

## 合成测试观察

1. **撤销观察未覆盖旧路径**：将 observe 设为 false 后，新视图拒绝访问，但旧的项目扫描调用仍成功并实际调用扫描方法。关联历史源码：[permissions.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/permissions.ts) 与 [observer.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/routes/observer.ts)。这条发现需要在当前版本上另行验证，不能因历史结果推断修复或未修复。
2. **扫描时间被误当作进展**：同一 Git HEAD 再次扫描后，历史叙事仍产生“推进”并显示 bright。关联历史源码：[chronicle.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/chronicle.ts) 与 [flame.ts](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/server/src/http/hearth/flame.ts)。这条发现也需要在当前版本另行验证。
3. **旧动作可伪造成功**：历史 real 模式接受客户端给出的任意 action，并持久化成功消息。后续 [PR #29](https://github.com/EchoTouch-moon/hark/pull/29) 的限定范围修复已合入 G0，旧执行与审批入口关闭；不能把这等同于完整 G1-A 通过。

4. **视图刷新存在交互缺口**：历史版本的正常态“重新扫描”按钮没有接线，视图没有按项目范围刷新；这是源码审查结果，未另做动态复现，当前 G0 仍需另行核实。相关历史源码见 [ChatPage.tsx](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/web/src/pages/ChatPage.tsx) 与 [hearthViewModel.tsx](https://github.com/EchoTouch-moon/hark/blob/e470436d52f618de606b50b260c8734f11fb7a9c/apps/web/src/features/hearthViewModel.tsx)。

历史复现材料见 [证据目录](../../handoff/EVIDENCE/grokbot-review-2026-11-01/README.md)：3 个附加复现与原测试共 17 项通过，表示旧问题被观察到；原版全量 464 项和浏览器 25 项通过也不代表安全验收。Windows、真实 Provider 和真实项目未在该次审查中验证。

保留已有基础并按当前合同逐项核查，避免将历史审查版本整版当作新的生产基线。原先 B0–B4 与双平台分工是历史提案，不作为现行执行排期。
