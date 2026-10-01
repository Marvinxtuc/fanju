# V1.1资金运行监控

2026-10-01。只读数据库全局V11聚合观测；不是单商户、单活动或正式生产域证明。模拟V11记录也计入范围。

仓库外注入DATABASE_URL、RELEASE_VERSION及FEATURE_V11_FINANCIAL_MONITOR=true。必须显式设置以下正整数，无默认阈值：

- MONITOR_DUE_JOBS：到期READY/RETRY任务数量。
- MONITOR_MANUAL_JOBS：MANUAL任务数量。
- MONITOR_EXPIRED_LEASES：RUNNING任务已过租约数量。
- MONITOR_OVERDUE_CASES：逾期OPEN的V11异常，含关联V11人工任务的JOB_REQUIRES_REVIEW。
- MONITOR_OLDEST_DUE_SECONDS：最早到期任务已等待秒数。
- MONITOR_HEARTBEAT_SECONDS：同RELEASE_VERSION的v11-wechat-query心跳窗口，最多30秒。

所有阈值最大86400，达到等号触发告警。未来任务、已解决异常、非V11任务、旧发布版本和过期心跳不当作正常当前worker。缺心跳始终告警。参数无效在连接DB前失败。

```sh
node services/api/dist/prelaunch/financial-monitor-cli.js
```

单次只读RepeatableRead事务，使用数据库时钟和5秒语句预算。输出仅日期、聚合计数、固定告警码及状态；不输出任务编号、商户、异常负责人、渠道payload、配置值或异常详情。退出0：未触发阈值；退出2：需要处理；退出1：配置/数据库错误导致观测不可用。观测不可用不能视为零异常。任何结果都不授权发布，不关闭既有资金差异或门禁。

告警平台应区分退出2和退出1，保存观测并通过现有值班渠道处理。本切片没有创建计划任务、发送消息、变更生产配置或接入外部告警平台。实际告警路由、接收人、演练和SLA仍待生产验收。

定向验证：3项阈值单测、1项owned数据库测试通过，覆盖精确前缀、队列状态、任务未来时间、异常终态、同发布心跳、心跳过期、聚合无标识及不写数据。无配置CLI退出1。测试过程中不合法合成状态被原数据库约束拒绝，已修正测试夹具，未修改约束。

回滚：关闭新增flag并停止调用CLI；移除本切片新增financial-monitor模块/CLI/test及native测试。没有schema或生产数据变更。
