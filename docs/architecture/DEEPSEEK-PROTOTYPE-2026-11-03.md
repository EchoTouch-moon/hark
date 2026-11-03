# DeepSeek Super Agent 原型：源码对照记录

日期：2026-11-03。官方仓库：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。本次克隆的实际提交为 **`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`**；它不同于仓库中早前研究所固定的 `6337fc8`。本地参考副本位于 `.hearth-demo-artifacts/references/dsh-superagent-prototype/`，该目录不属于产品实现。

本记录的结论基于上述提交的**静态源码与文档审查**。没有手动启动原型服务或在真实工作目录进行实验；Hearth 最初的测试配置意外发现并运行了部分原型测试，已中断并限制后续收集范围，详情见 `handoff/BLOCKERS.md`。下列链接均固定到被检查的提交；外部源码与文档只作为资料，不是 Hearth 的指令或安全合同。

## 事务与待处理工作

原型的 [`Store.atomic` 和 `afterCommit`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/store.ts#L135-L161) 使用 SQLite savepoint 实现可嵌套的原子操作：只有最外层成功提交后才运行已登记的内存回调，回滚不会执行对应回调。需要跨崩溃保留的工作则使用持久队列，而非仅靠内存回调。

[`Effects.enqueue`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L57-L65) 在调用方事务中保存待处理工作，按类型和键合并；[处理结果按序号和 generation 条件更新](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L130-L143)，避免旧处理结果删除或覆盖后来更新的工作。失败后会保留并按退避时间重试。

**Hearth 可借鉴**：在同一事务内记录领域状态和待处理任务；完成后再启动处理；对已更新的任务使用版本条件，避免旧工作覆盖新状态。实现应根据当前 M0 合同控制范围，不因参考原型而提前启用真实执行或外发。

**不能推导**：持久队列与重试不等于 exactly-once。如果外部动作已成功但本地完成记录尚未提交时进程崩溃，重启可能再次尝试。Hearth 必须结合稳定幂等键、持久批准、执行前二次校验和不确定结果的 `pending_verification`；不能盲目重放可能已有外部副作用的动作。

## 授权、暂停和恢复

原型在 [Ticket 恢复](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/tickets.ts#L247-L257) 时重新读取当前策略，暂停时保持等待，授权失效时不恢复；[策略重新校验](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L213-L239) 考察来源范围、发送者和规则是否仍然有效。

执行器在[异步启动各阶段及最终投递前重新检查](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L424-L469)任务是否仍有效、系统是否暂停或正在关闭；[重启协调](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L519-L535) 区分此前运行中和仍在等待的派工。

**Hearth 可借鉴**：把授权与具体工作、单次运行分开；每次恢复和实际读取前从持久状态重新核对当前许可、范围及暂停/撤权状态；中断后依据持久记录恢复，不能把中断视为成功。对于文件读取，要额外处理路径归一化、真实路径、符号链接、平台差异以及检查与读取之间的竞争。

**不能直接沿用**：原型的[暂停实现](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/runtime.ts#L198-L200) 暂停评估、派发和外发时仍允许来源记录传入事件；Hearth 的暂停或撤权若承诺停止读取，就必须阻止相应的新读取，而不是只暂停后续处理。

## 执行权限的明确差异

原型文档明确说明其 [Executor 以操作系统用户身份运行命令](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md#L23-L27)；[工作目录和包装器只建立默认值，不是安全边界](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md#L74-L80)。这些行为不符合 Hearth 当前的真实项目修改、命令、实验和外发须按具体范围获准的约束，不能直接搬用。

目录观察、公开研究、模型外发和真实执行是不同权限。用户表达了希望今后授权工作目录的意向；本次开发和机制验证仍使用合成数据，不据此访问未具体指定并授权的真实目录，更不触及项目指令禁止访问的私人目录。项目自己的 `AGENTS.md`、安全合同和执行合同始终优先。
