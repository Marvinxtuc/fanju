# 历史正式过期关单补扫

2026-10-01。显式一次调用只处理最多50条固定wechat商户/config的inactive待付、EXPIRED报名记录；无网络渠道调用。

```sh
node services/api/dist/prelaunch/formal-close-sweep-cli.js
node services/api/dist/prelaunch/formal-close-sweep-cli.js NEXT_CURSOR
```

配置FEATURE_V11_FORMAL_CLOSE_SWEEP=true、FEATURE_V11_QUERY_RECOVERY=true、PAYMENT_PROVIDER/REFUND_PROVIDER=wechat、DATABASE_URL、FINANCIAL_CASE_OWNER、WECHAT_PAY_CONFIG_VERSION和仓库外MCH/App绑定。scheduler不需要支付私钥；真实发送worker仍需完整可信provider配置。

返回counts、nextCursor、channelCalled=false。必须使用nextCursor继续下一页，null才代表该轮扫描结束；不是完整资金对账或上线结论。显式cursor可恢复页边界，丢失输出时重新运行上一页可保留原任务。一页内任务、核对case和审计同事务提交，失败整体回滚；运行中不要修改配置绑定。

与发送handler共享hasFormalExpiryCloseAuthority：正确报名/intent关联、wechat、合法资金/准备状态、过期deadline/releasedAt、原过期审计/原查询任务、无成员或资金冲突。缺失依据进入V11_FORMAL_CLOSE_SWEEP_REVIEW；不补造过期审计，不以本次扫描时间替代旧期限。

复用稳定businessKey v11:formal-expire-close:INTENT_ID。已存在任务仅验证身份，保持原DONE/MANUAL、attempts、generation和errorClass，不重新批准失败任务。指定scope/config之外记录不变；发送时仍再次复验，补扫不是资金授权凭证。每次执行留下独立页审计，重复执行可以有新观测审计，但不产生第二个同业务任务。

owned定向12项通过，包括删除本测试历史关单任务后的补建、异scope拒绝、MANUAL状态保留、缺审计case唯一和51条分页。所有删除仅针对本测试创建的合成任务/审计，未触及用户数据。CLI缺配置拒绝启动（退出1）；需review退出2。未执行真实商户补扫。

回滚停用新flag，移除新增scheduler/CLI；恢复backups/L04-close-sweep/formal-payment-close.ts共享校验提取的对应差异。保留已提交查询/关单任务、审计和case，不清理资金恢复责任。无schema迁移。
