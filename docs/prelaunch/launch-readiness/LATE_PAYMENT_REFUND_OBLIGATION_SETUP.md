# 锁位超时收款全退义务留证

2026-10-01。依据冻结DR01-03/04：正式锁位绝对10分钟，UNKNOWN不延长，超时后确认成功保留实收、不抢席位、建立F+D原路全退义务。

既有真实query worker在可信收款落账与组件分配后调用新处理器。登记独立wechat-late-refund-obligation-v11事件，精确记录原收款、报名、支付意图、F/D及合计、可信paidAt、锁位截止与规则引用；同事务创建V11_LATE_PAYMENT_FULL_REFUND_DUE异常和审计。锁位必须与报名acceptedAt+600000ms一致，收款与分配及原查询payload/hash/config完全匹配，worker租约有效。

覆盖正式非候补记录两种已知情形：渠道paidAt达到或超过绝对截止；或锁位实际EXPIRED并按截止释放、报名尚未取得支付资格且已EXPIRED，之后才由可信查询确认成功。及时渠道paidAt不能单独推翻已经释放的UNKNOWN锁位。既有登记不会因后续报名状态变化自动删除。

候补及缺少可靠锁位范围保持UNASSESSED；缺少完整可信查询证据拒绝处理并保留既有资金，不构造退款决定。该模块不是完整资格判定器，不关闭OP-04/05/08。没有资格、成员、资金预算、退款指令或渠道POST写入。整体资金对账仍INCOMPLETE。

义务状态明确为PENDING_FORMAL_DISPATCH_AUTHORITY。异常case使用既有工程处理deadline作升级提醒，不代表承诺退款到账时间或填入OP-11的未定批次/SLA。真实执行必须由正式授权与既有预算/发送/查询恢复流程完成，不能以缺少无关政策否认已知应退金额。

定向5项owned数据库测试通过。测试只使用合成F/D，不是正式定价。原收款不可变约束拒绝了首次测试的改写尝试；最终测试通过将查询证据标为MANUAL核验拒绝行为，没有弱化数据库约束。未执行真实渠道退款。

回滚：从backups/L04-late-refund-obligation/按diff恢复query handlers，停止新识别；移除新增模块和测试。无schema变更。已登记义务、收款、case和审计必须保留，不能通过回滚消除已有应退责任。
