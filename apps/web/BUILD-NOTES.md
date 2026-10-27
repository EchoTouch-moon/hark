# BUILD NOTES — @hearth/web (M1-T04)

记录本任务构建自检的真实输出，供验收复核。

## 环境

- 日期：2026-10-28
- Node v22.23.2 / pnpm workspace
- TypeScript 5.7.2（strict，含 noUncheckedIndexedAccess）
- Vite 6.4.5 + @vitejs/plugin-react

## 命令 1：`pnpm --filter @hearth/web build`

在仓库根目录执行（= `tsc -p tsconfig.json --noEmit && vite build`）。

```
$ tsc -p tsconfig.json --noEmit && vite build
vite v6.4.5 building for production...
transforming chunks...
✓ 50 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.59 kB │ gzip:  0.41 kB
dist/assets/index-D2AgALnI.css   11.29 kB │ gzip:  2.92 kB
dist/assets/index-Bh-DRDCy.js   218.31 kB │ gzip: 71.56 kB
✓ built in 540ms
```

**exit code: 0**

## 命令 2：`pnpm typecheck`（仓库根）

= `tsc -p tsconfig.json --noEmit && pnpm --filter @hearth/web typecheck`

```
$ tsc -p tsconfig.json --noEmit && pnpm --filter @hearth/web typecheck
$ tsc -p tsconfig.json --noEmit
```

**exit code: 0**

## 冒烟检查

`vite preview` 起在 127.0.0.1:4183，`curl /` 返回 `HTTP 200`，
HTML 为 `lang="zh-CN"` 的 Hearth 入口页。

## 备注

- `@hearth/contracts` 通过 vite alias 指向 `packages/contracts/src/index.ts`
  （类型经 package exports 由 tsc bundler resolution 解析）。
- CSS 总量约 11.3 kB（gzip 2.9 kB）；JS 218 kB（gzip 71.6 kB，主要为 React
  + react-router-dom 运行时）。
- 本任务仅交付框架层：六个路由均为占位页，业务页面在 M1-T05..T08 接入。
