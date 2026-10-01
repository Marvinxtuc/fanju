# 退款账期证据消费与比较

模块 refund-period-evidence.ts 接入 wechat-bill-reconciliation。只使用来源 wechat-refund-time-query-v11 的唯一 APPLIED 时间证据，不使用本地 createdAt/updatedAt、通知到达时间或CSV记录推断本地退款账期。

重建独立时间事件的精确payload并复验hash、允许字段集合、material/config版本、sourceId、receiptId、原交易号、退款编号、金额、币种、原收款及当前 CONFIRMED 状态。完成时间必须规范化、不得早于原付款或超出验证时刻的既有技术时钟容差。

同编号有任何时间冲突记录、主证据非APPLIED、字段损坏或绑定不一致，均返回CONFLICT；证据缺失返回MISSING。不会因恢复旧值或账单看似一致解除冲突。

比较按中国时区自然日 [00:00, 次日00:00) 定位当前应用域的本地已确认退款：

- 可信完成时间在账期内：核对账单的商户退款编号、渠道退款编号、原支付交易、名义申请退款金额和时间；缺失或矛盾产生 V11_BILL_LOCAL_REFUND_ABSENT_OR_CONFLICT 并调度可信查询。
- 账单退款行的可信本地完成时间与账单观察时间不同：独立 V11_BILL_REFUND_TIME_CONFLICT。
- 时间缺失或冲突：产生 PERIOD_UNKNOWN / PERIOD_CONFLICT 记录，维持UNRESOLVED并调度查询；不把其随意归到当前账期。
- 完成时间落在其他账期：不因当前账单缺失而误判；测试已覆盖精确次日00:00上界排除。

refundPeriodCoverage=OBSERVED 仅表示当前扫描的本地已确认退款均可确定所属账期，不代表金额一致、所有商户渠道流水都已闭环或连续账期完整。即使OBSERVED，overall coverageState仍固定INCOMPLETE、releaseAuthorized=false。

新快照声明 BILL_AND_RECORDED_FUNDS_SNAPSHOT。重放身份含 comparisonVersion=v11-bill-snapshot-2；旧比较版本run UUID不能在新版本内重新解释，需新UUID；原审计保留。

没有新增数据库列、资金状态写入、退款发送、政策授权或资格变化。本轮未运行真实渠道。正式账期清单、连续覆盖、异常处理实际闭环、legacy域、真实V3样本及高交易量分批恢复仍未完成。

验证：5条证据纯单测（hash/material/额外字段/来源/时间边界/本地更新时间不能替代），owned PostgreSQL账单定向10条含父包装。合成测试通过可信下载的真实RSA验签，退款时间写入使用内部合成查询证据seam，不能当作真实银行时间验收。覆盖本地退款缺账单、已确认状态保留、时间冲突转未覆盖、次日账期排除。

回滚：恢复 backups/L04-refund-period/wechat-bill-reconciliation.ts 与对应native测试；移除新增证据模块及纯单测。保留时间/账单证据和case，不删除资金记录。服务未自动启用。
