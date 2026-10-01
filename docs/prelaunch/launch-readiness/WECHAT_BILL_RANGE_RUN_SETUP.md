# 多日账单获取与恢复

2026-10-01。工程用途；整体固定 INCOMPLETE，无发布授权。

使用仓库外 secret 注入既有微信支付下载配置、DATABASE_URL、FINANCIAL_CASE_OWNER 和 RELEASE_VERSION。显式开启 FEATURE_V11_BILL_RANGE_RUN、FEATURE_V11_BILL_RECONCILIATION、FEATURE_V11_QUERY_RECOVERY，值均为 true。

```sh
node services/api/dist/prelaunch/wechat-bill-range-run-cli.js START_DATE END_DATE RANGE_UUID
```

日期范围含首尾，最多366日。首次生成一个UUID并保留；恢复同一任务使用同一UUID。数据库审计固定该UUID的完整起止日期、商户范围摘要、配置版本、负责人、发布版本和比较版本。改变上述任一字段会在渠道下载前拒绝整次启动。每日run编号由UUID和日期确定。已提交且绑定、负责人、发布版本、比较版本、摘要和审计序号一致的日期跳过下载与比较；任何恢复冲突使该日失败，不重新下载或覆盖记录。新UUID表示新的快照任务。

逐日顺序执行。失败日期输出FAILED，继续剩余日期；异常详情不进入输出。退出0表示请求范围处理结束且无执行失败，仍不证明资金一致或对账完整；退出2表示存在失败日期（优先于分段暂停）；退出3表示无执行失败但仍有未处理日期；退出1表示启动配置或全局错误。进程中断前已提交的日期可由审计恢复；未提交日期重新可信下载并使用同一run编号幂等提交。

恢复依赖数据库已提交审计，不信任本地完成标志。任务创建使用事务锁避免并发重复记录。失败日期独立写入审计，保留每次失败的日期、日run编号及任务身份摘要；不记录异常、凭证、渠道响应或下载URL。后续成功不删除历史失败。如果失败审计无法提交，CLI立即停止，不能声称该次失败已持久化。并发启动可能重复下载，但比较事务仍使用既有锁和run幂等。没有自动重试失败渠道、资金POST、资金状态改写、旧差异关闭或生产ready接入。

验证：9项范围/恢复单测、13项owned数据库账单测试通过。新增真实数据库断言覆盖并发任务建立、身份冲突、失败历史保留及错误日编号拒绝。未执行真实商户账单请求。回滚：停止调用此CLI并关闭新增flag；持久化改动前备份位于backups/L04-bill-range-journal/，仅按本次diff恢复，保留其他改动。无schema变更，保留已提交的审计及差异记录。

2026-10-01 分段执行与退出排空：可设置仓库外非密钥配置 `WECHAT_BILL_MAX_NEW_DAYS_PER_RUN`（1至366的十进制整数，默认366）。只限制本次新处理／失败日期的数量；已提交日期恢复不占预算。保持原START_DATE、END_DATE和RANGE_UUID再次执行，不能把nextDate改成新的任务起点；原完整任务身份仍由数据库审计固定。结果新增attemptedDays、pendingDays、nextDate、executionState及stopReason。pendingDays是本次尚未检查的日期数，不是资金差异数量。失败日期虽计入本次处理，仍需同任务重跑，不能仅凭pendingDays=0认定执行成功。

SIGTERM/SIGINT请求在日期边界停止：已开始的下载、比较及必要失败审计完成后返回；收到信号的异步恢复检查若尚未开始下载，会在下载前再检查信号。不会启动下一日，不取消已开始事务，也不会输出部分日期为OBSERVED。错误详情不进结果。SIGKILL或主机断电仍以已提交数据库快照恢复，不依赖本地完成文件。生产进程管理器须给当前下载及最多三次30秒比较事务足够排空时间；具体部署超时尚未验收。

定向证据：14项range/runner单测；17项owned native测试含两个信号子进程和数据库父包装。实际签名合成账单分两次运行时，恢复首日审计后只下载第二日；SIGTERM/SIGINT均等待当前日结束并exit3，未启动下一日。完整回归另见L04_BILL_RANGE_DRAIN.json。单日32MiB／10万行和单次比较事务限制未解除，这不是大文件上线验收。回滚恢复backups/L04-bill-range-drain中runner和CLI的本次差异，移除新增测试段／fixture，保留原任务及每日审计。无schema变更、新依赖或真实商户调用。
