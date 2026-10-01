# 正式关单发送权限复验

2026-10-01。真实渠道适配 closePayment 必须显式传入异步 beforeSend，缺失时在网络查询前拒绝。查询已成功或已关闭时只返回可信事实，不发关单；不存在订单不能推断永久关闭；PENDING 时先复验权限，再交给 provider。

真实 provider 在签名请求准备完成后、调用 HTTP client 前再次执行传入的 beforeSend。复验失败不发送 POST。provider 保留可选参数以兼容旧接口；正式 V1.1 channel 强制要求该参数，不得使用空授权器装配正式 worker。此参数是发送许可，不代表业务规则已定案。

关单请求成功仍必须可信查询确认；失败后查询可能发现用户付款获胜，必须保存实收并走既有资格/全退义务处理，不伪造 CLOSED。不得从本地 EXPIRED 或 HTTP 204直接推断资金终态。

定向 provider/channel 46项离线测试通过，含查询后权限撤销阻止 provider、最终签名后撤销阻止 HTTP、双层guard传播及关单付款竞态。没有真实商户网络或资金操作。

后续装配必须使用正式过期事务的原意图、固定binding和金额，发送前复验过期审计/恢复任务/无成功资金及有效资格；持久化可恢复关单任务、限制重试并核验租约；独立真实查询保持开启。主动关单worker尚未装配，该改动不代表完整关单验收。

回滚仅恢复 backups/L04-close-send-fence/providers.ts 和 wechat-channel.ts 的本次差异，保留无关后续修改；无schema迁移，未启动生产进程。
