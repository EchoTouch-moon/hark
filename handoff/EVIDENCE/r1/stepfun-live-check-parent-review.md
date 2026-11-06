# StepFun 有界验收脚本主会话复核

合入来源：隔离分支 `dev/r1-stepfun-live-check` 的 `882a723` + `9e5fd43`，未包含其他分支生产 Host/Core 改动。主会话另外将 CLI 离线测试的固定输出名改为 PID/时间唯一名，取消测试开始时对固定证据文件的预删除，避免误删已有用户记录。

实际执行（主工作区，set -euo pipefail）：
- `bash -n scripts/stepfun-live-check.sh`：exit 0。
- `npm run typecheck`：exit 0。
- `npm run test:stepfun-live-check`：18/18 pass。
- `npm run test:host`：14/14 pass。
- `npm run test:pi-sdk-smoke`：1/1 pass，出站网络与子进程/环境凭据探测均为0。

## 已核对边界
Key 在 env-i 清洁 shell 内才隐藏读取/export，env/bash/node 启动器 argv 不含合成 Key 的 PTY+spy 负例通过；预置全局 Key 不作为fallback。最终摘要与父级 symlink/嵌套路径/已存在目标会在fetch之前拒绝，输出O_NOFOLLOW+O_EXCL，outside canary不变。已发送后异常保留真实请求计数，不标成0或成功。

最多3次fetch发送，失败也计入，无自动重试/redirect/Provider切换；固定国内API与step-3.7-flash。每个请求被硬限两个输出cap字段为512。token字段双写、dotted Tool与真实模型服务行为仍待实测，不因离线通过宣称协议兼容。

## 批准与未执行
用户明确允许一次仅合成材料的有界真实验收，并选择专用独立进程临时env Key、step-3.7-flash、国内平台。主会话只准备脚本和跑离线/mock/PTY测试，尚未读取真实Key、尚未向StepFun发送请求。用户需在本地交互TTY亲启并隐藏输入Key；不要把Key贴聊天或带参数。

默认摘要 `handoff/EVIDENCE/r1/stepfun-live-check-summary.json` 必须不存在。若脚本失败，先保留并审查脱敏摘要，不自行循环重跑/换名字再花请求。任何额外实跑应先核对已消耗请求与用户授权。

## 限制
不是OS sandbox，不承诺抵御同权限本地攻击者在父目录校验后替换目录。只为本次用户控制的repo证据输出使用。SIGKILL可能留临时Session目录，正常退出清理；Key不写入其中。真实测试为生产Host/Pi SDK与合成Core交互，不是Rust+真实私人项目整产品闭环，summary固定claimsProductAcceptance=false。
