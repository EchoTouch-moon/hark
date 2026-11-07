# App Icon 三款提案

初始按用户选择先看三款，再由用户选定01炉心。提案阶段未替换应用资源；选定后完成下述资源接线，全程没有重启应用。

交付目录：`design/app-icon-concepts/`。
- 01-ember：炉心，赤陶与奶油火焰。
- 02-dialogue：火语，象牙底与深色对话框。
- 03-hearth：炉门H，炭黑与石灰白H字结构。
- 每款SVG为原创矢量路径，PNG为实际Chrome本地渲染导出，1024×1024 RGBA；三款透明边界均为(80,80)至(944,944)，角点alpha=0。
- `index.html` 为无脚本、无外部资源请求的独立比较页；15张SVG图片加载成功，1440视口scrollWidth=1440，无横向溢出。`preview.png` 为实际1440×1060页面截图，含56/32/24px和深色背景对照。
- 本机Python XML解析三份SVG成功；Pillow Image.verify三份PNG和对照图成功，检查全部图标尺寸、RGBA及角点透明断言通过。

## 选定后资源接线
- 用户选定01。Native资源：icon.svg、PNG32/128/256/512/1024、icon.icns、icon.ico，以及同源黑色透明单色tray.svg/tray.png。
- ICO七档16/24/32/48/64/128/256已逐档解码；ICNS由系统iconutil生成，Pillow加载成功，包含512@2x。所有PNG为RGBA且角点透明。
- macOS托盘改用编译嵌入PNG与icon_as_template；其他平台使用彩色32图标，不再生成绿色纯色方块。Tauri bundle.icon接线，bundle.active仍false，无新依赖或业务接口。
- 实际运行 `cargo check --manifest-path apps/desktop/Cargo.toml -p hark-desktop` 及 `cargo fmt --manifest-path apps/desktop/Cargo.toml --all -- --check` 通过；构建检查使用现有target缓存，未执行桌面二进制。最终校验输出见 `icon-assets-validation.txt`。

资源与macOS编译检查不等于真实Dock/托盘、Windows或安装包验收。当前窗口未重启，图标尚未在运行进程切换；下次需用户批准重建启动后确认。没有发模型请求或读取Key。外部架构目标未配置，未扫描个人笔记。
