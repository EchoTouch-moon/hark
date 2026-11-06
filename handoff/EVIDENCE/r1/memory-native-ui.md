# 认知 Native / UI 接线

由主会话在用户明确批准后直接实现；Grok容量不足，不再重派。隔离分支dev/r1-memory-integration，用户原前端目录和主线运行窗口未改动。

## 已实现
- Native/Tauri白名单增加 get_opinion、list_workspace_opinions、submit_opinion_feedback、revert_memory_operation、search_workspace_memory、get_message_evidence。
- 读写复用Core v4；反馈caller固定User、expectedRevision和requestId原样交Core。提议/收据完成字段仍不可由前端写入。
- native-adapter对应方法改为真实invoke。查询观点按workspace核对归属，缓存ID归属。用户消息引用从同workspace真实conversation_events回读，不用文件API猜路径。
- pending_revision/retracted有真实中文状态；评论不假装生成新判断，前端不编造revision+1。独立保存观点可直接显示在对话面，不伪造聊天事件，并按当前workspace过滤/去重。
- 历史搜索保留历史/短词LIKE/OR召回标签，支持identity/experience筛选，不把其归为文件事实。
- 撤销只接受Core reverted及实际revision/time收据，不在失败时宣称已撤销。

## 实际验证
set -euo pipefail，退出码均0：
- cargo fmt（desktop workspace）。
- Native全量20：原18 + 新cognition2。新增真实SQLite/temp集成覆盖保存/观点查询/消息来源回读/反馈待修订/幂等/冲突/检索/撤销/重开与workspace隔离；模型未启用。
- cargo check desktop。
- UI类型与27测试（原24 + 新3）、Vite build。
- Host类型与原14+2回归；Host本轮没有代码变更。

初次UI测试暴露旧“未实现接口不invoke”断言仍包含已实现的本地检索，已只移除该过期断言，父子workspace/联网搜索未实现约束仍保留。新增3个测试验证真实invoke参数、待修订状态、原消息引用、历史/LIKE标签与撤销收据。

## 未完成/边界
- 未接 memory_propose_change / opinion_propose_change / memory_recall Pi工具；应用还不会因本切片自动创建新长期记忆/观点。
- 观点为空时是真实Core查询结果，不造种子。历史搜索可检索已有用户/助手消息和已存文件来源。
- 没有真实模型/Key/私人目录读取、没有Native控件点击或截图。不将测试当完整R1通过。
- 本分支还未部署至运行桌面。更新Rust二进制需要重启，会清空本次内存Key；由用户选择更新时机。
