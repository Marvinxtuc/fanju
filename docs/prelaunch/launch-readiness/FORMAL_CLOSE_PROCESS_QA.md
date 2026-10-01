# 正式关单进程恢复工程验证

2026-10-01。生产入口与owned fixture调用同一个runFormalPaymentCloseWorker。fixture验证owned DB后注入合成wechat provider；保留mock环境变量和网络隔离，不启动生产provider或真实商户。

定向13项测试通过。子进程矩阵包括：

- 前置恢复查询已提交、第一次原单查询时SIGKILL；租约仍RUNNING，按DB过期条件接管新generation，继续同商户单号。
- 合成渠道已记录关闭、尚未提交结果查询时SIGKILL；恢复先查询既有合成关闭事实，不再次发送。合成关闭记录唯一，不创建新支付意图或退款，资金状态仍UNKNOWN。
- 合成发送后SIGTERM；当前处理排空并提交结果查询、任务DONE，正常exit0。
- 任务已有8次attempts；第9次领取不执行渠道handler，进入MANUAL并保留恢复责任。

仅对本测试创建的任务将runAt置于队首，并把被杀进程对应的leaseUntil置为已过期，以验证DB租约接管而不等待实际30秒。未改租约算法、重试预算或用户数据。合成渠道状态存在独立owned-test-close-channel事件，不作为资金事实或渠道证据。

该矩阵不证明真实支付竞态、真实商户权限、生产调度、告警或备份恢复。正式worker尚需核对多商户任务领取隔离，避免配置不匹配的worker消耗其他商户预算；尚未接入生产ready/监控。已有发送前binding复验会拒绝不匹配发送，但不等于领取隔离完成。

回滚仅恢复backups/L04-close-process/formal-payment-close-worker.ts对应的runtime提取差异，删除新增runtime/fixture和本轮测试段；保留已提交恢复任务、审计、资金事实，不清空队列。无schema迁移，未执行真实关单。
