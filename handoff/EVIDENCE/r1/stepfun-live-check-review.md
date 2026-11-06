# StepFun 用户亲启验收结果复核

原始脱敏证据：`stepfun-live-check-summary.json`。主会话已读取并检查，没有 Key、请求头、完整请求/响应正文或个人项目内容，可作为真实请求失败证据保留；不改写原始结果。

## 实际观察
- 用户在本地TTY亲启，liveTransport=true。
- 固定模型 step-3.7-flash，国内目标 https://api.stepfun.com/v1/chat/completions。
- requestCount=1、attemptCount=1，返回 HTTP 402。
- firstText=fail，sawStreamDelta=false；tool=incomplete / not-sent。
- autoRetry=false、redirect=error、backupModel=false。
- realProjectRead=false，rustJointClosedLoop=false，claimsProductAcceptance=false，boundedLiveObservation=false。

## 裁决与限额
**真实模型验收未通过。** 这只证明本次真实HTTP尝试获得402响应，不证明API Key有效、模型可用、流式或工具协议兼容，也不能从摘要推断具体计费原因或费用为0。402通常提示账户/支付或计费权限问题，具体需要用户在国内StepFun账户查看；本会话不操控账户或充值。

此前用户授权总上限3次真实请求，已使用1次尝试，最多剩余2次。本会话没有追加请求。原脚本自身上限按单次运行计算3次，**当前不得换摘要名字直接重跑**，否则可能超过本次累计许可；恢复前应把新运行限制为剩余2次并明确验证目标，或由用户另行批准新的请求预算。默认已有摘要也会在新请求前拒绝覆盖。

恢复条件：用户处理国内API账户余额/该模型计费可用权限并确认继续，再确定剩余预算下的复测方案。保持同一模型/域名，不自动换Provider/Key/模型；双token字段、dotted工具、真实流式和用量仍未验证。离线底座已通过的本机结论不受此次HTTP402改变，但不因此宣称完整R1完成。
