# Hearth · 续页

一个独立、可点击的项目对话应用原型。主页可直接聊天，一条项目线索作为Agent的开场；资料按需查看。现有正式应用没有被替换。

在仓库根目录运行：

```sh
python3 -m http.server 4341 --bind 127.0.0.1 --directory prototypes/07-continuation
```

打开 http://127.0.0.1:4341 。退出服务按 Ctrl+C。

- `/#setup`：从目录授权开始，模拟添加目录；不接触真实文件。
- `/#discover`：直接对话的主页，可输入、切换讨论范围、沿线索聊一个项目、查看依据或暂缓。
- `/#projects`：三个合成项目的清晰索引。
- `/#project/fragments/overview`：项目概况、研究线索、用户选择。
- `/#conversation`：全局盘点；`/#conversation/fragments`：围绕一个项目接着聊。
- `/#settings`：忙闲与明暗演示、权限说明。

草稿、示例对话、暂缓和示例目录仅保存在此原型的浏览器本地存储 `continuation-prototype.v1`，刷新后可恢复。所有回复为本机预设；无扫描、模型、外部检索、真实通知、归档搬迁或删除。清除此键可重置演示。

字体自托管并附许可。按钮/输入框/档案都是实际HTML元素，无图片替代界面。

验证（先启动服务，使用仓库既有开发依赖）：

```sh
node prototypes/07-continuation/verify.mjs
```

最新交互/布局证据在handoff/EVIDENCE/conversation-home-2026-10-30/。设计规则见 DESIGN.md；方向取舍见 DIRECTION.md。正式能力接入必须继续遵守根项目的数据、权限和安全合同。
