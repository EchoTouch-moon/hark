# App Icon 三款提案

用户选择先看三款再定稿；本段没有替换 `apps/desktop/src-tauri/icons/icon.png` 或重启应用。

交付目录：`design/app-icon-concepts/`。
- 01-ember：炉心，赤陶与奶油火焰。
- 02-dialogue：火语，象牙底与深色对话框。
- 03-hearth：炉门H，炭黑与石灰白H字结构。
- 每款SVG为原创矢量路径，PNG为实际Chrome本地渲染导出，1024×1024 RGBA；三款透明边界均为(80,80)至(944,944)，角点alpha=0。
- `index.html` 为无脚本、无外部资源请求的独立比较页；15张SVG图片加载成功，1440视口scrollWidth=1440，无横向溢出。`preview.png` 为实际1440×1060页面截图，含56/32/24px和深色背景对照。
- 本机Python XML解析三份SVG成功；Pillow Image.verify三份PNG和对照图成功，检查全部图标尺寸、RGBA及角点透明断言通过。

仅设计资产检查，不是实际macOS Dock、Windows、icns/ico或安装包验收。等待用户选择后再制作正式平台资源；没有发模型请求或读取Key。外部架构目标未配置，未扫描个人笔记。
