# Pi 认知工具接线

主会话直接实现，分支dev/r1-memory-tools。使用原Core v4/官方Pi SDK/现有stdio，未增加migration、后台提取、独立模型请求或新权限平台。用户随后明确批准更新重启。已合入主线376d75e；主会话复跑Host/UI类型、UI29与UI/桌面build通过，随后正常请求自身旧桌面退出（返回true），启动新进程并激活到前台（返回true），Vite HTTP200。未发真实模型请求，没有截图或控件点击验收。

## 行为
- 新增 memory_propose_change、opinion_propose_change、memory_recall，SDK callable allowlist由2个workspace工具扩到这5个，内置bash/read/write等仍关闭。
- 参数不包含workspace/run/operation/currentUser/caller。Host按实际run+SDK toolCallId派生稳定operationId；Native从Active绑定已存user_message，观点自动附本轮用户原文引用。文件工具返回真实sourceId供引用，不让模型编造。
- Core在提议事务内复用普通run的running/当前授权快照核对；结束或取消后的新提议不能写。原User反馈不受远程模型开关限制。
- 只在普通对话写入。opening可recall，但写入明确返回不可用，不用caller=host绕过，也不宣称首次理解已经自动保存身份记忆。
- Core recorded=true收据才表示写入；待澄清/冲突/NOOP不显示新保存。观点保持结构化独立权威。
- 新增只读list_memory_receipts，最多最近100条实际提交的记忆操作。重启后由Core收据投影UI memory_receipt artifact，放在相关用户消息后，不插入/篡改conversation_events。撤销反映真实Core状态，历史收据不冒充当前决定。
- 修复存储收据重放丢失committedAt：从真实revision行恢复时间，不编时间。UI回归覆盖缺时间/未提交/错workspace不显示保存。
- 回合完成刷新真实消息/观点/证据。失败/取消也读取此前已实际提交的独立记忆，失败不伪造助手消息；显示真实run错误。提前事件缓冲仍遵循原持久化核验。
- 回忆保留历史、不可用、LIKE/OR召回标签。当前L0/L1仍未自动投影，使用按需recall，不声称完整CTX-01通过。

## 实际验证
均set -euo pipefail：Host/UI类型、Host16+套餐2、UI29、SDKsmoke1、Core69、Native21、UIbuild、Tauri check通过。新增Native probe经过真实Node+PiSDK+Core stdio（transport明确scripted）：
1. 开场沿旧read_file路径；
2. 普通对话写决定/独立观点、按需recall，实际Core收据关联真实本轮user_message；
3. 否定原话被模型摘成肯定提议时needs_clarification，没有第二张保存收据；
4. run结束后追加新提议被拒；
5. 另一回合工具已提交后取消，已提交记忆仍保留，但不产生助手消息；
6. 停止/重开，收据和观点仍在。

原有全部回归通过后，对扩充的取消probe及Host/UI回归再次实际复跑通过。新增Host2项检查稳定operationId与工具参数边界；新增UI2项检查收据重载和未提交/缺时间的显示行为。

合成SSE helper原来固定call_local；多工具调用需要不同SDK toolCallId，现使用本进程递增ID，避免假重复调用掩盖真实幂等行为。没有改用户真实模型流程。

## 未证明
没有实际StepFun请求、新Key、用户私人项目读取、Native控件点击或截图。模型是否按需正确调用、遗漏率、真实协议/体验仍待用户主动对话验证；不能把本slice标为完整R1或自动语义记忆正确性通过。全局记忆、Observer、L0/L1投影、memory_get_evidence与opening写入仍未做。
