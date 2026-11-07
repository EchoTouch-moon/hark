# 主页极简整理 — 实际验证

## 改动
- 顶栏由5个按钮减为2个：项目切换与⋯。项目概览、历史与记忆、项目/应用设置、添加项目、隐藏/退出放入菜单。
- 初读进度、记忆折页及火光说明移入项目概览；本地扫描、来源依据、记忆收据与独立观点默认折叠，仍可展开操作。
- 输入区保留草稿、发送/停止和必要的模型配置入口；保留权限检查、IME防误发送、真正错误与合成预览标识。空状态只保留只读说明和选择文件夹主操作。
- 仅React UI，复用既有Bridge；无新依赖、迁移或后台重启，不读Key、不发模型请求。

## 已运行
- `npm run typecheck:ui`、`npm run test:ui`：29/29、`npm run build:ui` 全部成功；完整输出见 `home-minimal-validation.txt`。
- 独立临时Chrome profile、实际Vite页面、合成IPC夹具（不是Core数据）；1420的修改前页面与1421的隔离工作树使用同一份合成资料。
- 浏览器实际观测见 `home-minimal-browser.json`：顶栏5→2、本地卡默认收起且可展开；概览打开、Escape关闭与焦点返回；历史/项目设置/应用设置菜单入口打开；390px页面无横向溢出；深色主题切换；空状态选择按钮可见；未捕获JS异常。
- 截图：`home-before-synthetic.png`、`home-after-synthetic.png`、`home-after-dark-synthetic.png`、`home-mobile-synthetic.png`、`home-menu-synthetic.png`、`home-overview-synthetic.png`、`home-empty-synthetic.png`。

## 范围与待确认
截图均为明确标记的合成界面资料，不是实际项目观察或真实模型回复。Chrome页面交互不替代Tauri WebView、系统文件夹选择器、隐藏/退出或真实模型验收；本段未自动点击或截取运行中用户窗口。真正Native API和授权合同未修改。

## 主线部署
源码 `9e0c7bb` 已合入主线，主线再次通过UI类型、29测试与build。既有Vite记录四个修改模块的HMR更新，1420及Header模块HTTP200；Native PID27872在更新前后相同，未重启。已关闭临时1421预览，不影响主服务。输出与HMR记录见 `home-main-deployment.txt`。实际Native窗口观感仍由用户查看确认。

仓库未配置外部架构画布目标；仅同步仓库内架构状态，不扫描个人笔记。
