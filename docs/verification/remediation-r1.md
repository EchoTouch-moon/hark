# R1 自动消费门禁 · 2026-10-29

状态：PASS。浏览器运行时注册合成项目并写入JUnit失败报告后，自动出现且仅一张测试Insight；重复通知保留相同Insight ID，来源AVAILABLE，分析Run数为0、浏览器分析POST数为0。证据 handoff/EVIDENCE/r1-browser.txt（1 passed，16.1秒）。

服务启动时创建单一 InsightCoordinator，绑定只读 Observer port，顺序运行 consumeProjectBatch→processProjectRules。默认每秒一轮、每轮最多8项目、单批100事件/信号；同一轮无重叠，项目轮转，错误隔离，停止时等待当前批次。消耗 checkpoint 和规则 progress 均使用现有持久化事务；进程在两步间中断时，下次即使没有新增事件也会补跑规则。

没有 AnalysisService、Pi 或 Provider 依赖；后台不调用模型。用户暂停项目即从轮转列表排除。health单独展示确定性协调器状态/错误计数。Feed首页每3秒只读刷新，用户展开多页时保留分页。

本地证据：r1-coordinator.txt（3测试：后台新JUnit失败唯一测试洞察；重启不重复，静默tick数据库total_changes不变；删除重注册保留断流冻结），r1-tests.txt（41文件341测试），r1-typecheck.txt，r1-lint.txt。重启允许产生真实观察间隙信号，不能误报为重复测试洞察。证据中的合成仓库不涉及真实项目。
