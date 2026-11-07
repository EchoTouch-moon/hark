# Hark 应用图标 — 炉心

用户已选定设计01，来源为 `design/app-icon-concepts/01-ember.svg` 与其1024 PNG。

- `icon.svg`：矢量母版。
- `icon.png`：1024×1024 RGBA母版，透明外边距。
- `32x32.png`、`128x128.png`、`128x128@2x.png`（256）、`256x256.png`、`512x512.png`：PNG资源。
- `icon.icns`：macOS资源，由系统iconutil从16/32/128/256/512的1x/2x iconset生成。
- `icon.ico`：Windows容器，含16/24/32/48/64/128/256七档。
- `tray.svg` / `tray.png`：黑色透明背景单色火苗，32 PNG编译嵌入macOS模板托盘，由系统适配深浅色；其他平台托盘使用32彩色应用图标。

Tauri的bundle.icon已指向这些资源，但bundle.active仍为false，不启用打包。默认灰块及程序生成的绿色托盘方块已在源码中替换。未重启运行中的桌面；下次构建启动加载新资源，实际Dock/托盘与Windows效果尚未验证。

再导出：保留原始SVG；母版PNG由本机Chrome独立临时profile栅格化。已有Pillow 11.3.0用于RGBA LANCZOS缩放与ICO保存，系统 `/usr/bin/iconutil` 用于ICNS生成，不是应用运行依赖。图标资源变化后需要重建Native；不要为换图标直接重启用户窗口，重启前仍须征得用户同意并提醒本次运行Key会清除。
