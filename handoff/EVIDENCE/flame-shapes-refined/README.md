# 火影五态精细化

白天和夜间对照图均由隔离本地服务上的合成数据驱动真实页面渲染；1440×900、火焰大小 100%、减少动态效果下截取稳定帧。对照图隐藏文字以观察火影，`day-spark-full.png` 保留完整界面。单独的十张图及 `comparison.txt` 记录每个状态和实际 WebGL 参数；截图不代表真实项目状态。

`stage-transition.webm` 记录合成对话从初火星成长至初生火苗，并检查手动调节、暂停及恢复；`transition-check.txt` 还记录无 WebGL 且减少动态效果时的降级检查。`unit-check.txt`、`typecheck.txt`、`lint.txt` 和 `build.txt` 为验证输出。运行截图脚本和动效检查前需先启动项目独立合成数据服务于 4404；脚本分别为 `scripts/qa/capture-flame-states.mjs` 与 `scripts/qa/flame-shape-transitions.mjs`。
