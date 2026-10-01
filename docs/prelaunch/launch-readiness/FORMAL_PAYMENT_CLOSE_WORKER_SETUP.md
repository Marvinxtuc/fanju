# 正式过期支付关单任务

2026-10-01。仅对已提交的正式绝对锁位过期登记 V11_CLOSE_EXPIRED_PAYMENT，与原 V11_QUERY_PAYMENT 同事务持久化。独立进程：

```sh
node services/api/dist/prelaunch/formal-payment-close-worker.js
node services/api/dist/prelaunch/formal-payment-close-worker.js --once
```

显式 FEATURE_V11_FORMAL_PAYMENT_CLOSE=true、FEATURE_V11_QUERY_RECOVERY=true、PAYMENT_PROVIDER/REFUND_PROVIDER=wechat、DATABASE_URL、FINANCIAL_CASE_OWNER、RELEASE_VERSION，以及完整仓库外真实渠道配置。默认不启动。worker仅消费关单任务，复用既有30秒DB租约、8次重试预算和MANUAL升级；这些是工程恢复参数，不是退款批次或业务SLA。--once仅处理至多一项，不代表清空队列或真实商户验收。

handler要求inactive待付资金状态NEW/SUBMITTING/UNKNOWN、合法准备状态NOT_STARTED/SUBMITTING/UNKNOWN/PREPARED、EXPIRED非候补报名、acceptedAt+600000ms截止、匹配过期审计及原查询任务、无成员/有效支付/取消申请，并校验固定channel binding、商户单号和金额。检查同报名所有本地意图的收款和可信成功证据，避免只检查单笔而丢失其他资金冲突。

每次尝试网络I/O前，同事务登记按job generation去重的恢复查询和尝试审计；查询后发送前及签名后HTTP前重复复验租约和上述依据。异常或进程死亡不抹除恢复任务，下个有效generation先查询同商户单号；关单POST可针对相同原单再次尝试，绝不生成新支付单或退款。付款赢得竞态时，可信成功事实交给独立query worker的收款/组件/全退义务链路。

渠道返回后再提交独立结果查询，防止前置恢复任务已提前跑完。仅记录观察审计，不把HTTP成功写成本地资金CLOSED，不改成员、退款金额或资格。结果提交时仍验证租约；失租结果依赖已提交恢复任务。正式query worker必须持续运行。

worker记录v11-formal-payment-close同release心跳，SIGTERM排空；尚未接入生产ready与告警。日志使用固定错误信息，不输出支付标识、密钥或provider异常。

owned定向10项测试通过，含恢复任务先于I/O、同原单结果查询、UNKNOWN保留、发送前租约替换拒绝和资金冲突拒绝。生产CLI缺配置退出1。尚未执行真实商户、worker真实部署、子进程故障全矩阵或已过期历史记录补扫；既有过期记录不会因此自动补建关单任务。

回滚停用新flag并停止独立worker；恢复backups/L04-formal-close-worker/formal-hold-expiry.ts本次差异。保留已登记查询/关单任务、审计与真实实收，不能清空恢复责任。无schema迁移。重新启用前核对任务与商户配置绑定。

状态覆盖补充：使用共享isUnsettledPayment区分资金与预下单准备状态；12种合法组合均可在有完整过期依据后关单并消费可信CLOSED观察，不改变任何一个状态轴。SUCCEEDED记录留在过期审核，未知准备状态及无prepayId的PREPARED由DB约束拒绝，运行时也拒绝。定向35项owned测试通过；首次非法夹具被原v11_preparation_value_check拒绝，修正夹具后重跑，未弱化约束。回滚共享判定适配的原件在backups/L04-close-state-coverage/。
