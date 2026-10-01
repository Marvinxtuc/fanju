# 正式待付锁位绝对超时

2026-10-01。只实施冻结DR01-03/04的10分钟容量上限，不替代正式资格/候补/取消规则。

```sh
node services/api/dist/prelaunch/formal-hold-expiry-worker.js
node services/api/dist/prelaunch/formal-hold-expiry-worker.js --once
```

显式配置FEATURE_V11_FORMAL_HOLD_EXPIRY=true、FEATURE_V11_QUERY_RECOVERY=true，PAYMENT_PROVIDER/REFUND_PROVIDER=wechat，DATABASE_URL、FINANCIAL_CASE_OWNER、RELEASE_VERSION、WECHAT_PAY_CONFIG_VERSION及仓库外MCH/App绑定。该进程只做本地状态和查询任务登记，不调用渠道，不需支付私钥；独立真实query worker仍必须配置完整可信渠道能力。

使用DB时钟，按当前商户范围扫描到期HELD记录，每批50、按hold ID推进游标；整轮结束后重新扫描。冲突/失败不会使后续页永久饥饿。单次--once仅处理一批，不宣称完成所有到期项。退出2代表该批存在核对/失败，缺配置或全局错误退出1。

事务按既有活动/用户/报名锁顺序串行检查绑定、金额、绝对acceptedAt+600000ms、待付active状态、无已有支付资格/成员/取消申请。正确过期时同事务标记hold和报名EXPIRED、停止本地intent新提交权限、写原意图的V11_QUERY_PAYMENT及审计。intent的UNKNOWN状态保留，不写渠道失败或关闭；回调与查询仍可记录实收。

及时可信成功证据、候补、既有资格/成员、取消申请、不匹配配置/金额/锁位时间进入V11_FORMAL_HOLD_EXPIRY_REVIEW，不自动重分类或改既有权利。HELD的截止仍用于容量计算；该case要求正式业务处理，并非新规则或退款SLA。不得将此切片标为整个OP-04/05/08完成。

审计分别记effectiveDeadline（绝对上限）和observedAt（实际写入时间），不伪造早先执行。迟到义务识别使用可信查询确认是否达到绝对截止，而不是把worker处理延迟当作用户新期限。已过期后确认成功的F+D全退义务继续记录，不重抢席位。实际渠道关单、正式资格及退款发送仍待装配。

worker记录v11-formal-hold-expiry同发布心跳，可SIGTERM排空；未接入生产ready要求。日志只含固定scope及计数，不含用户、订单、商户或异常详情。未启动真实商户或生产进程。

定向8项owned数据库/子进程测试通过，覆盖并发幂等、UNKNOWN保留、后续可信收款→全退义务、未来/异范围拒绝、既有权利、及时成功、51项分页及共享runtime的SIGTERM排空。生产CLI缺配置退出1。子进程使用owned fixture入口和相同runtime，继续保留mock provider和网络隔离；不是生产CLI真实商户验收。首次测试的重复active报名被原唯一约束拒绝，已改用各自合成用户，未改约束。

回滚：停用新增flag并停止worker，保留已提交EXPIRED、query任务、义务与审计；不能因回滚抢回已释放容量。移除新增模块/fixtures/tests；迟到义务的前一版本备份位于backups/L01-formal-hold-expiry/，按diff恢复且保留后续责任记录。无schema变更。

可信 CLOSED 查询现可在已提交正式过期审计、原查询任务、正确截止和金额、无有效资格/成员/取消申请的前提下记录独立关闭观察。仍保留 intent UNKNOWN，不改报名或资金。缺审计仍 UNCONFIRMED，已有成功/收款证据进入 CONFLICT，不丢弃资金。定向锁位及支付准备共33项测试通过。回滚本次关闭观察适配时，仅恢复 backups/L04-expired-closure/payment-query-intake.ts 对应差异，保留新观察事件和审计。
