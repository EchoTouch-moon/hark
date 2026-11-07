# 桌面开发启动入口 — 实际交付

用户明确选择双击启动当前开发版，而不是独立打包。已在用户授权的桌面创建Hark.app，未覆盖已有同名入口。

## 实现
- AppleScript模板调用主线仓库的Python标准库脚本；桌面包使用炉心ICNS，LSUIElement隐藏临时启动器Dock项，本地ad-hoc签名并校验成功，不使用私钥证书或关闭系统保护。
- 脚本检查本机1420是否为Hark页面；需要时用已安装Node直接启动Vite。锁定启动流程，已有Native则只激活，否则启动本地开发二进制。
- 不调用模型、不读取Key、不自动启用workspace授权；日志位于Git忽略的data/desktop-launcher，目录700/文件600，拒绝日志末端符号链接。

## 实际验证
- `python3 scripts/test-launch-desktop-dev.py`：6项通过，含已有进程不重复启动、停止时只启动一次、缺少二进制提示和错误端口不复用。
- `cargo build --manifest-path apps/desktop/Cargo.toml -p hark-desktop` 实际成功，包含已选定的炉心图标资源。
- 创建前，先前PID27872已不存在；没有停止一个在用进程。通过桌面入口实际启动Native97055，AppKit激活成功。
- 再次执行启动器后PID仍为97055，未多开；本地页面HTTP200。桌面包签名校验及图标资源一致性通过。输出见desktop-launcher-validation.txt。

## 能力边界
这是依赖现有仓库/Node/开发资源的启动入口，不是独立安装包。真实测试复用了既有Vite，服务完全停止后的自动拉起未做实际冷启动；窗口若已隐藏到托盘，可从托盘选“显示窗口”。未读取实际项目画面/内容或做真实模型请求。完全退出后新启动仍需用户填写会话Key，重复打开不会主动清除Key。

仓库未配置外部架构画布目标；仅更新仓库架构状态，不扫描个人笔记。
