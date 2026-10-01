# 正式退款申请受理（工程切片）

默认关闭。需要 FEATURE_V11_REFUND_INTAKE=true、FEATURE_V11_IDENTITY=true、真实微信 auth/phone provider 和 demo 关闭。

- POST /api/v11/registrations/:id/refund-requests，正文仅 idempotencyKey。
- GET /api/v11/refund-requests/:id，仅本人可查。

正式 JWT 验证后重验 USER actor；受理事务共享锁 actor、重验 enabled/person/version/user，锁本人报名，数据库时间 acceptedAt。用户、报名和幂等键共同定义业务键，同键并发只保存一份申请和审计。不同键保留独立申请，不代表多笔退款授权。

来源 FORMAL_USER_INTAKE，种类 FORMAL_REFUND_APPLICATION，状态 BLOCKED_POLICY。响应仅受理时间、状态、申请和报名 ID；不收集自由文本或证明材料，不承诺金额、时限或审核结果。旧模拟售后读取请求后拒绝非 SIMULATION_ONLY 来源；独立种类也不符合旧 dispute worker 的消费条件。

无退款预留、发送、模拟通知、worker job、成员移除或报名状态写入。尚须正式运营审核流程、用户界面、政策定案和真实渠道验收。

验证：owned PostgreSQL、合成 JWT，覆盖并发重试、本人读取、跨用户拒绝、金额输入拒绝、旧模拟决定拒绝、无退款/job/报名变化。该证据不代表真机或商户渠道验收。

回滚：关闭 FEATURE_V11_REFUND_INTAKE；恢复 docs/prelaunch/backups/L04-refund-intake 中对应源文件，移除新增 refund-request-intake 模块。保留已受理记录和审计，不删除数据。
