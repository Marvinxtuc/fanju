# 配置、恢复与真实依赖

## 启动边界

FEATURE_V11_IDENTITY=true 且正式wechat身份provider；FEATURE_V11_FORMAL_BUSINESS 和 FEATURE_V11_FORMAL_PAYMENT 默认false。开发合成注入仅接受受控ci/test、已核验数据库所有权；正式启动从仓库外固定摘要文件读取动作授权/公钥/证据/撤销表。

动作签发资料须包含政策/材料/参数摘要、版本、环境、channel/merchantScope/providerConfigId、期限、实际专业材料引用。动作权限按POLICY_RUNTIME、供给/报名/付款及恢复/退款/差异分别验证。测试临时签发者不属于生产信任根。

未决参数文件用JSON null表达，schema严格校验，原文hash入运行binding；不在.env.example放生产值。F/D范围、候补数量/敞口/FIFO/并发、成员移除时刻、批次/时限、自动义务核定均有明确依赖。政策改变必须创建新快照；不能更新已存在快照或把资料归档改为政策批准。

进程：pnpm start:formal-business-worker、pnpm start:formal-hold-expiry-worker、pnpm start:formal-payment-close-worker。需要明确责任OPS、数据库、当前release、原wechat渠道配置。历史政策授权注册表按digest保留原version/env/channel许可；商户配置变更时必须单独保留对应原渠道worker，不可将历史查询指向新商户。

新收费发送仍需canStartRealPayment和签发的REQUIRED_BILL_SCOPE范围覆盖。覆盖组件不改原COMPLETE常量，COMPLETE_WITHIN_DECLARED_SCOPE只证明特定声明范围，并返回releaseAuthorized:false。

## 不唯一的用户权益分支

| 依赖 | 必须明确的输入 | 本轮保留/阻断 |
|---|---|---|
| OP03/RV01/RV06 | F、D范围、主体账户/票据、保留费用专业结论 | 缺配置不出新报价；可信旧实收和已有退款义务不删除 |
| OP04 | 各申请类别移除成员时刻 | 普通请求按明确REQUEST_ACCEPTED或DECISION_ACCEPTED；未定不擅自移除；原申请时刻保存 |
| OP05/OP08 | FIFO时钟、T24/T8新客类别、失效桌类别、候补敞口/并发 | 已定事务序号/有限队列实现；未定时钟或新客类别明确阻断；不无限收费 |
| OP07/RV03 | T8低人数继续门槛/答复/失联/后退人 | 正式LOW_PERSON_DECISION待办保留；不自行批准继续收费；须定案后接正式交互 |
| OP09 | 核心变更期限/逐人旧权益/补偿责任 | 已发布供给替换拒绝并明确OP09；既有快照保留；变更/补偿正式流程仍依赖定案 |
| OP10/RV04/RV05 | 准入、最小敏感资料、证明清单/访问/留存 | schema和最小授权测试用合成材料；真实采集/特殊申诉流程未获专业签收 |
| OP11 | 自动义务核定、批次/漏批/争议SLA | 有责任24h普通待办、批次幂等/提醒；auto未定/false分别阻断/人工待办；不抹去义务 |
| OP12 | 履约确认终止期限、午餐/跨夜、失联/漏扫码 | 未确认不能判违约；完整履约正式入口仍需定案 |
| OP13/RV02 | 可靠送达/失败处理/客服受理 | CREATED/实际送达区分；绝不凭SENT启动不利时钟；正式通知渠道和客服证明未核验 |
| OP14/RV06 | 真实结算/翻案垫付/追回/账户凭证 | 义务/在途/实付分离；非退款分项RECOGNITION_BLOCKED或AWAITING_SETTLEMENT_AUTHORITY，不执行真实转账 |
| OP15 | 注销/消息撤回/历史记录/更正共享留存 | 旧钱款责任不消灭；完整权利交互仍需明确并验收 |

## 外部门禁

现有主体和商户按用户说明已准备；本轮未重复开户，也没有以浏览器站点安全阻断认定账号未准备。EXT01/02仍需当前小程序认证/类目/隐私能力及当前商户绑定、支付退款、凭据安全注入位置的实际证据。EXT03需目标域名TLS/部署/DB证据。QA01需当前候选真机；QA02需明确小额参与人与金额范围的真实收付/查单/账单验收；OPS01需真实运营责任/值守签收；REL01需目标环境恢复告警灰度回退。此次指令没有新增真实收付、政策激活或发布许可。

迁移0900–1200共四项，空库上行/guarded下行/重建已演练。历史存在时下行SQL主动拒绝；保持数据并前向修复。隔离演练只操作本任务拥有的数据库，不连接旧5432，不清理手工记录。
