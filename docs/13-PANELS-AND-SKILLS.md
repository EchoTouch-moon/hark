# 13｜M3/M4 未来产品详细合同（不可抢跑）

## M3 Browser Handoff
- 目标：固定 mock 网站上的 3 条长任务场景，按 `Observe → Plan → Execute → Readback → Verify` 运行，并能查看屏幕截图/trace。
- 输入：`BrowserTaskSpec{allowedOrigins,maxSteps,maxTimeMs,downloadRoot,actionSpec}`；禁止任意网址、任意本地文件、执行 shell。
- 步骤：read-only browser 采集→生成候选操作→在风险操作前暂停并显示具体动作→批准→执行→来源 readback→落 Evidence。
- 任务：M3-T01 Playwright adapter；M3-T02 localhost mock site；M3-T03 执行 step trace；M3-T04 系统暂停/恢复/取消；M3-T05 20-workflow regression；M3-T06 Tauri wrapper/security。
- Gate：没有外部真实账户写入；未知状态无自动重放；step 证据 100%；跨站跳转 deny；真实浏览器不加载用户个人 Chrome profile。

## M4 Dynamic Panels
- 用户表达“帮我生成一个展示最近实验的 Panel”，模型只能生成 JSON `PanelSpec`（详见 `docs/04-CONTRACTS.md`），后端审查→预览→用户确认保存。
- 白名单类型：Metric/List/Timeline/Activity/Status，布局可排序但不可直接传 JS/HTML 执行；数据源永远经授权 Query Service。
- 组件要求：source/time/latest refreshed、empty/loading/error、强类型 props、可撤销修改、所有按钮绑定注册 ActionSpec。
- 测试：脚本注入、CSS URL、任意 local file path、匿名 source、跨项目查询、超预算频率刷新。

## M4 Specialty Learning
- 只有至少两次有**成功且可验证**的高度相似任务轨迹才能提出 candidate（阈值实验可调），模型输出 `SpecialtyDraft`：trigger / parameters / expected sources / allowlisted tools / steps / verifier / failure policy / regression cases / source-trace IDs。
- 需要人类 review/approve 后才允许写入专用版本化 Skills 目录；不得自动修改 `~/.hermes/skills`。
- 不保存密码/验证码/token/cookie；不可从误操作或失败轨迹生成稳定 Skill。
- 允许 future adapters：Pi/Codex/Claude，按隔离 contract 复用。

## 研究拓展
与 Context Runtime 对照：有无 Working Set/Provenance 裁剪时，候选准确率、上下文泄漏率、输入 token、耗时、用户所需点击量；与传统聊天 Agent 比较真正“主动行动”节省的用户劳动。
