# 可信退款完成时间证据

Wechat退款查询成功应答如含 success_time，按带时区日期严格解析并归一化 refundedAt；缺失时间保持未知，不使用 updatedAt、请求时间或通知到达时间替代。提供错误时间则provider明确失败。本轮没有新增数据库列或修改既有资金事件payload。

refund-query-confirmation 在确认原收款、退款编号、金额、资金组件预算和绑定之后，同事务调用 refund-completion-time。新增来源 wechat-refund-time-query-v11，记录独立 REFUND_COMPLETION_TIME 事件，含来源指令、原收款、金融编号、金额与可信完成时间；不保存openid/手机号等身份信息。

已确认资金后来补充时间不会触发旧资金事件payloadHash冲突。首个有效时间保持独立原证据；不同时间创建独立MANUAL冲突事件，早于原支付或晚于DB当前时刻超过既有验签时钟容差时进入MANUAL。恢复原值不能自动解除未处理时间冲突。该容差仅为技术时钟校验，不是退款SLA。

时间缺失不隐瞒已确认退款资金；时间冲突不回退资金到账事实。时间事件、case和审计与当前可信查询确认同事务。未将时间事实当作政策批准、资格变化或退款批准。

验证：provider解析单测；owned PostgreSQL6条含父包装覆盖缺失、并发补充、原资金hash不变、时间变化、恢复原值仍保留冲突，以及早于付款时间。初始合成商户scope夹具未满足DB哈希约束被拒，已修正夹具，约束保留。

仍待：账单比较消费这些独立时间证据，核对退款在对应账期的缺失/冲突；通知时间证据补充路径、连续账期覆盖和真实商户验收。当前账单比较仍声明INCOMPLETE/退款账期UNRESOLVED。

回滚：恢复 backups/L04-refund-time/providers.ts 与 refund-query-confirmation.ts，移除新增时间模块及测试。保留已记录证据、case和审计，不删除资金数据。
