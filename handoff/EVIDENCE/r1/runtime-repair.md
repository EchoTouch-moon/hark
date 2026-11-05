# Pi 后台启动阻塞修复证据 · 2026-11-05

## 故障与实际状态
- Workflow `106be9d1-a67f-4109-9341-c0c23c4a0a4e` failed，`r1.core` 启动前失败；Host/integration 未执行，无可恢复 child session。
- 失败后已验证 R1 分支 clean，HEAD d6d502e，没有实现源码修改。随后主会话新增本阻塞/修复记录。
- 用户明确批准用户级 Pi 诊断与最小兼容修复；未改用 CLI/前台执行。

## 根因与范围
Pi 1.5.0 manifest 不声明 chord，当前 pi-subagents 的版本推断却要求 chord 根导出与 /context。不是模型服务错误，也不是 Hark 源码错误。

在已存在 dirty 修改的 pi-subagents 工作区，仅追加 runner-aliases 精确 1.5.0 manifest 检查与相应回归，保留旧变更；AGENTS 补充验证事实。修复前既有 tracked diff 和两个目标文件原文保存在本机临时 repair backup，不入产品仓库。不安装 chord、不改宿主依赖、不升级/降级 Pi、不代为提交扩展的其他改动。

## 实际执行
在 pi-subagents 根目录：

1. 新增 1.5.0 不依赖 chord 的回归，先运行 `node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test --test-name-pattern='chord is omitted' test/unit/host-peer-runtime-imports.test.ts`：**预期失败已复现**，actual missing 为两个 chord specifier。
2. 修复后执行 `node --experimental-strip-types --import ./test/support/isolated-temp-root.mjs --test --test-concurrency=2 test/unit/host-peer-runtime-imports.test.ts test/unit/async-spawn-preload.test.ts`：**7 tests / 7 pass / 0 fail**。
3. `npm run typecheck`：**exit 0**。
4. 用更新后的 resolveHostPeerAliases 对当前安装器 Pi 1.5.0 根目录实测：**missing=[]，aliasCount=10**。

未知/prerelease host、声明 chord 却缺失的安装、必需 core/TUI 导出缺失仍保留 fail-closed 检查。

## 尚未验证
当前父会话仍加载修复前扩展，需用户 `/reload`，然后以原 subagent 协议重新启动。未执行修复后真实后台模型 child，不把本地模块解析与单测当全链路成功。Hark F1–F3 实现仍 pending。
