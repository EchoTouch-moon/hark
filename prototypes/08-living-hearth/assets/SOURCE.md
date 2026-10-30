# 火焰资产来源

`living-fire.png` 来自本仓库既有资产，未重新生成、裁切或改变像素。初次复制逐字节相同；本轮随后仅嵌入原始来源元数据，文件字节因此变化，RGBA像素逐字节相同，核对见handoff/EVIDENCE/living-hearth-2026-10-31/asset-provenance.json。

- 原始路径：`apps/web/src/assets/living-fire.png`
- 核对时仓库提交：`8c339296af11457b1ab6b76912d7f1a77afc2d2b`
- 原始文件 Git blob：`3d5b114cbc79043b9a291e32fbf142e2f4c204ce`
- 原始文件SHA-256（元数据写入前复制件一致）：`b495cc4616d532562d50906e16fd089b8545036e1b1ff342cf22d7cccf120f20`

原始文件在该提交可用 `git show 8c339296af11457b1ab6b76912d7f1a77afc2d2b:apps/web/src/assets/living-fire.png` 核对。本说明只记录仓库内可验证来源，不推断原始图像创作方式或版权授权。

`../flame-renderer.ts` 由既有 `apps/web/src/features/flameRenderer.ts` 移植，保留原双层纹理采样和湍流 shader，改用浏览器本地 URL、受限分辨率和最多六颗触发火星的接口上限，移除环境火星；当前交互层不调用火星喷出。`../flame-shape.ts` 复制既有 `apps/web/src/features/flameShape.ts` 的视觉参数并解除项目状态类型依赖。生产源码未修改。
