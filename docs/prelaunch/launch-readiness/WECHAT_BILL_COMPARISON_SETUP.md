# 微信 ALL 账单格式及资金快照比较

本轮模块：wechat-bill-csv.ts、wechat-bill-reconciliation.ts、wechat-bill-reconcile-cli.ts。

输入只接受本进程 downloadWechatTradeBill 已验签、校验文件摘要的对象。模块以 WeakMap 记录来源，冻结下载结果及绑定，使用前再校验原始字节 SHA256。复制结构相同的 JSON、改写归属、商户配置或修改原始文件均不能进入可信比较。归档验证 JSON 本身不能当作可信导入授权。

CSV 支持27列 ALL 格式，第四列名称可为“特约商户号”或“子商户号”；只支持直连商户、CNY、SUCCESS 收款及成功 REFUND 记录。支持 UTF8 BOM、CRLF/LF、CSV引号和转义；不输出商品内容、用户标识、设备或原始商户号。未知格式、状态、子商户、精度、时间、币种、重复商户/渠道编号或截断均拒绝。

逐项核验尾部记录数及六个总额：应结订单金额、退款金额、充值券退款金额、手续费、订单金额、申请退款金额。使用十进制整数运算，手续费最多5位小数且要求精确汇总一致；不猜测舍入规则。金额字段按分计算，无浮点截断。SUCCESS 金额取“订单金额”，REFUND 金额取“申请退款金额”；不把净结算/扣券金额替代原订单或申请退款金额。

已现场读取官方PHP仓库历史V2 ALL夹具的头/尾格式，只作为支持格式的来源线索，未复制原始商户/用户行到仓库。当前真实V3商户导出仍待验收，格式不符将明确失败。来源固定：
https://github.com/wechatpay-apiv3/wechatpay-php/blob/3c9f5c2b71d181e9c244494f695cf5abb53cadc4/tests/fixtures/bill.ALL.csv

同一商户的其他App行仍计入全文件格式/总额核验，并统计 outsideApplicationRows；只对当前 App 业务域比较，不静默丢弃跨App交易。运行结果声明应用域范围，不能用来声称整个商户所有系统已经核对。

比较事务使用 Serializable、显式 run UUID 幂等和最多三次序列化冲突重试。原始账单SHA与日期、绑定、owner、release构成重放身份；同UUID改变这些输入被拒绝。新UUID允许对同一文件再取本地快照。每次比较的差异任务独立保留，audit关联caseIds；既有人工处理结果不被覆盖，也不自动关闭旧任务。

- 商户→本地：寻找已有V11支付意图/退款指令，比较原交易号、订单编号、金额、原收款、收款时间及本人归属绑定；缺失/冲突记录独立资金case。
- 本地→商户：枚举账期内已有可信收款 paidAt，查找其在当前App账单中的对应收款行；缺失时保留差异并调度查询。
- 已知本地编号调度 V11_QUERY_PAYMENT / V11_QUERY_REFUND；不预下单，不发送退款，不改变账本金额、资金预算、报名资格或成员。
- 未知商户流水只保存最少金融编号、金额、时间等 ReceivedEvent 证据，固定 MANUAL，不创建报名或无来源订单。case的sourceRef指向证据或既有本地记录，便于受控运营跟进。原用户标识和商品材料不入库。
- legacy交易单独计数，未宣称旧业务域对账完成。跨providerConfig版本保留冲突，不用当前凭据替代原绑定。
- 空账单仍比较本地资金；接口失败/零行都不代表零差异。

每次事件、case、查询job、ReconciliationBatch(INCOMPLETE)和审计同事务提交，中途证据冲突则全部回滚。金额矛盾不会覆盖原账本。

运行开关：FEATURE_V11_BILL_RECONCILIATION=true、FEATURE_V11_QUERY_RECOVERY=true、真实payment/refund配置、WECHAT_PAY_ENABLED=true、DATABASE_URL、FINANCIAL_CASE_OWNER、RELEASE_VERSION。显式命令：

    node services/api/dist/prelaunch/wechat-bill-reconcile-cli.js YYYY-MM-DD RUN_UUID

该CLI执行可信下载后比较，只输出计数、范围与状态，不打印交易号、商户号、原文、下载token或底层错误。缺少配置时联网前退出。本轮未调用真实商户或生产库。

保留限制：

- 现有确认退款没有可信渠道完成时间，不能将本地 updatedAt 作为退款发生账期。本地→商户退款账期覆盖仍 UNRESOLVED；本模块不标 COMPLETE。
- 账期范围清单、多账期连续覆盖、资金账单/手续费会计核对、真实商户样本、差异实际闭环仍未完成。
- 单文件至多100000行/32MiB；数据库快照限30秒。过大账单明确失败回滚，尚需可恢复分批处理才能覆盖高交易量。
- case沿用既有资金任务24小时工程告警deadline，不是用户退款SLA或政策定案。

验证：8条CSV单测与既有8条下载验签单测；owned PostgreSQL定向9条（含父包装）覆盖并发、伪造来源、错误汇总、空账单、本地缺失、金额冲突、事务中途回滚和旧case保留。首次夹具试图修改不可变paidAt被DB正确拒绝，已修正测试，未松动约束。

回滚：关闭新增比较开关；移除三个新模块及测试/夹具，恢复 backups/L04-bill-reconciliation/wechat-trade-bill.ts。保留已提交金融证据、差异case、审计；需要停止该轮查询时按记录run UUID仅处理该轮job，不删除其他任务或资金数据。
