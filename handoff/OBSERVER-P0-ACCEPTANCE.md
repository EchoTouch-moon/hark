# Project Observer P0 验收记录

日期：2026-10-28

## 测试命令与结果

```
pnpm typecheck                          # pass
pnpm exec vitest run packages/project-observer apps/server/src/http/observer.http.test.ts
# 27 tests pass（fixture）
pnpm test                               # 158 tests pass（含既有 Hearth）
```

## 验收用例（自动化 / Git fixture）

| 用例 | 结果 | 说明 |
|---|---|---|
| T01 | PASS | 三仓库注册，重复路径 409 |
| T02 | PASS | 首次扫描仅 PROJECT_REGISTERED |
| T03 | PASS | 10 次脏提示合并为 1 条工作区事件 |
| T04 | PASS | commit / 新分支可追溯 |
| T05 | PASS | 重复扫描幂等 |
| T06 | PASS | A→B→A 两次转移 |
| T07 | PASS | JUnit PASS + 来源时间 |
| T08 | PASS | 无报告 UNKNOWN |
| T09 | PASS | 损坏报告 ADAPTER_ERROR，兄弟项目继续 |
| T10 | PASS | 重启后 GAP + 最新 HEAD，无中间轨迹 |
| T11 | PASS | 删除目录 UNAVAILABLE，历史保留 |
| T12 | PASS | 中文/空格文件名 |
| T13 | PASS | unborn / detached / worktree |
| T14 | PASS | 不执行 hook、不 fetch、不允许 git fetch/pull |
| T15 | PASS | 重启不重复事件 |
| T16 | PASS | 对账补回漏监听 |

真实试点（与 fixture 分开记录）：

| 仓库 | 结果 |
|---|---|
| `pindou` | 已注册，`main` @ `f57fc77`，工作区 dirty，测试 UNKNOWN，采集 OK |
| `prototype-skill-lab` | 已注册，`feat/m3-host-native` @ `3352b36`，工作区 dirty，测试 UNKNOWN，采集 OK |
| `agent-internet-lab` | 路径不存在，返回 `PATH_NOT_FOUND` |

浏览器核验：`/projects` 列表 + `/observe/:id` 详情、UNKNOWN 非绿色、立即重扫、Demo 项目仍在。截图在 `handoff/EVIDENCE/observer-*.png`。

审查后已修：runs 裁剪不再误删仍被 events 引用的行；相同 fingerprint 不再重复 `ADAPTER_ERROR`；`STALE` 只在 HEAD 变化时计算；git 子进程隔离全局 config / fsmonitor；报告路径注册时做根目录约束。

## 仍未完成 / 风险

- 未把 Vitest JSON 作为 Adapter（规格明确后续）。
- 未做大仓库空闲 CPU/内存基线实测冻结。
- Windows 仅保留路径/命令接口兼容，未做服务打包。
- 真实三试点人工验证待用户在本机执行注册脚本。
