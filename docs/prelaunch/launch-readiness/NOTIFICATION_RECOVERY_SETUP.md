# V1.1渠道通知恢复装配

当前为已实现、合成环境已验证的接收链路，尚未通过真实商户验收。

正式API复用 `/api/wechat/pay/notify` 与 `/api/wechat/refund/notify` 的原始正文验签、解密和商户校验。独立开关 `FEATURE_V11_PAYMENT_NOTIFICATIONS=true`、`FEATURE_V11_REFUND_NOTIFICATIONS=true` 仅启用对应V1.1通知路由分流；默认关闭。必须配置对应真实provider、显式 `FINANCIAL_CASE_OWNER` 和 `RELEASE_VERSION`。这些开关不批准收费、报名或退款发起。

匹配V1.1商户单号的回调，在事务内持久化可信触发事件、审计和 `V11_QUERY_PAYMENT`／`V11_QUERY_REFUND` 任务后才确认接收。其他单号继续现有回调路径。冲突保留独立MANUAL证据和资金工单，原事件不被覆盖。

查询进程入口为 `services/api/dist/prelaunch/wechat-query-worker.js`；其启动另需 `FEATURE_V11_QUERY_RECOVERY=true`、明确DATABASE_URL、资金工单负责人、RELEASE_VERSION和真实支付/退款provider配置。真实凭据仅从仓库外secret注入。当前未在真实商户环境启动。

回调事件是恢复线索，不表示业务资格已授予或预算已完成。取消后的收款仍由查询、收款账本与分项分配处理；退款须可信查询确认后完成资金处置。原查询任务已经结束或进入MANUAL时，每个新可信回调的独立任务可唤醒恢复，同时保留原任务审计记录。

上线仍需同一候选上的真实回调、查询、资金守恒、告警与业务验收；本文件不替代这些证据。

启用任一V1.1通知开关后，`/ready` 自动要求 `v11-wechat-query` 的新鲜同版本心跳及五个V1.1迁移完成记录；自定义REQUIRED_WORKER_MODES不能去掉这一要求。该检查只验证运行依赖，不替代正式业务政策或上线条件。
