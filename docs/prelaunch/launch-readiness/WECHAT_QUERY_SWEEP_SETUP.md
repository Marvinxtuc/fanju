# V1.1 本地义务向微信渠道核对

2026-10-01：已实现，尚未在真实商户或生产环境运行。

运行构建后的 `services/api/dist/prelaunch/wechat-query-sweep-cli.js <run UUID>`。必须显式注入 `FEATURE_V11_RECONCILIATION_QUERY=true`、`FEATURE_V11_QUERY_RECOVERY=true`、`DATABASE_URL`、`FINANCIAL_CASE_OWNER`、`RELEASE_VERSION`，以及既有真实微信支付/退款 provider 配置。凭据通过仓库外文件或部署 secret 注入，不打印配置、不写入 repo。

UUID 是运行重试身份；输出丢失或进程死亡后用同一个 UUID 重试。一次后续新的核对用新的 UUID。绑定、负责人和发布版本发生变化时，不允许重用此前 UUID。

入口在同一个数据库语句快照中枚举指定 channel/merchantScope/providerConfigId 的全部 V11PaymentIntent 和 V11RefundInstruction，包含 inactive、CLOSED、CONFIRMED 等终态。任务与审计在一个事务提交。旧任务和原财务记录保留，新任务由现有 v11-wechat-query worker 处理，沿用可信查询、事件幂等、原交易与组件预算规则。无需新的迁移或依赖。

输出中的 queued 计数仅指已持久化查询任务，不表示查询已运行、渠道一致或零差异。即使零条记录也固定标记 INCOMPLETE。入口不会下载完整商户账单，不会更新 ReconciliationBatch 的完整覆盖状态；商户账单反向核对、漏本地订单发现和完整账期覆盖仍未实现。

事务超时或错误将回滚该次任务与审计；已提交后的 UUID 重试返回同一结果。停用后不再调用该命令，既有查询任务仍保留资金恢复义务。回滚新增代码可移除两个 wechat-query-sweep 文件，并使用 backups/L04-query-sweep/payment-preparation-native.test.mjs 恢复本次修改前的测试文件；不得清除原财务记录或无关 dirty。

## 正常关闭与到账冲突

可信渠道查询返回 CLOSED 时，只有本地 intent 已 inactive/CLOSED 且不存在该商户单号的 receipt 或该 intent 的成功支付查询事件，查询任务才可收口。该观察用独立来源 wechat-closed-query-v11 持久化；不改报名、支付意图、收款记录、退款预算或完整账单覆盖。后续真实到账通知仍可创建独立查询任务，正常走收款证据链。

本地仍 active、非 CLOSED 或渠道 NOT_FOUND/PENDING 时继续保持未确认。存在成功支付证据却观察到渠道 CLOSED 时，关闭观察进入 MANUAL，任务按 DATA_CONFLICT 升级；原到账记录保留。同一观察曾进入 MANUAL 时不会由下一次重复查询自行解除。

关闭观察的 payloadHash 不一致时，新证据用独立 conflict 键保存，并在审计中关联原 event；原 payload 不覆盖。并发重复只产生一份冲突证据及审计。存在未处理的 MANUAL 冲突记录时，后来恢复为原值的查询不会自动解除异常。
