# 持久化一致资金快照

2026-10-01。数据库快照层已实现，分批checkpoint与完整pipeline尚未实现；生产未启用。

新增V11BillComparisonSnapshot及20261001060000迁移，只应用本任务owned scratch。ensure/load仅为内部模块，没有新HTTP入口或真实渠道调用。来源仍须可信下载对象、匹配绑定与完整CSV/footer校验；进程重启需重新可信获取账单，缓存或JSON不能作为plan。owner/release/run UUID必须明确提供。

任务固定v11-bill-facts-1、scope/config、日期、source SHA、owner、release、总行数及其他应用行数，并保存identityHash。Serializable事务及同run advisory lock捕获一致的本地intent/receipt/refund/legacy引用及当时派生的退款时间结果。重复调用必须恢复同一行，不重新读取活表覆盖已有快照；首次并发唯一或序列化冲突最多重试三次。v3旧最终审计的UUID不能转为新快照；已有新快照的UUID不能走旧完整比较。

快照保存最小投影，不含原始CSV、prepayId、手机/openid、session/key/secret或时间事件原始body。结构包含支付/退款参考，属于内部资金证据，不能导出为报告或写普通日志。snapshot JSON及存储限制32MiB，各集合最多10万；legacy仍有同scope引用枚举，正式高量捕获需继续限制非必要引用。超限明确失败，不保存部分有效标志。

数据库禁止UPDATE，包括不改变值的UPDATE。加载校验固定身份、checksum、严格结构、集合唯一ID、原scope、退款时间覆盖及日期格式，然后恢复Date与内部品牌；拒绝损坏及复制的外部JSON，不能fallback到当前活表。同一快照只代表捕获时刻，不表示未来资金状态相同。捕获审计仅含摘要/总行数和CAPTURE_ONLY_NO_COMPARISON_OR_RELEASE，不产生v3最终对账审计或发布授权。

定向17项含父包装通过：并发一个快照/捕获审计、快照后新增收款不混入、全新子进程原快照恢复及Date重建、页执行、owner/release/config/App改变拒绝、UPDATE禁令、坏checksum拒绝、旧/新run互斥。新进程使用合成RSA验签和owned DB，不代表真实商户验收。完整候选见L04_BILL_FACT_SNAPSHOT.json。

回滚前停止未来snapshot/batch消费者并按证据保留制度保存所需新快照。专用迁移注释给出DROP TABLE与函数；它只删除新快照证据，不删除原资金、订单、refund、case/job或旧审计。代码局部恢复backups/L04-bill-fact-snapshot的schema/core，并移除reconciliation.ts新增的V11BillComparisonSnapshot UUID互斥检查及本次native测试/fixture，重新generate。不要覆盖其他后续修改。没有改生产数据库或自动删除用户数据。
