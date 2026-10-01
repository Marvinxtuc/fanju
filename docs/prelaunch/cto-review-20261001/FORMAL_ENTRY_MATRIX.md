# 正式入口与证据边界

本轮直接测试 main buildApp、拟发布主小程序组件与受控运营组件。隔离传输和签发材料为合成；不是商户验收、真机证据、政策正式签收或生产批准。所有正式服务默认关闭。

| 主入口 | 业务路由/进程 | 已实现行为 | 验证来源 |
|---|---|---|---|
| 首页→活动详情 | GET /api/v11/formal/activities（游标）、/:id | 已批准供给、原F/D/合计、正文阅读、三项明确同意；不可用历史授权不伪造报价 | formal-main-http-dom；formal-supply-native |
| 活动详情报名 | PUT /formal/profile；/policies/:id/delivery、/consents；POST /formal/registrations | 本人身份、完整正文hash、独立正式快照、供给报价、有限锁位和候补、幂等业务键 | formal-runtime-policy-native；formal-supply-native；主HTTP/DOM |
| 报名列表→详情 | GET /formal/registrations、/:id | 本人记录、历史报价与权益、原申请受理时刻；重新登录/清缓存可恢复 | formal-supply-native；主HTTP/DOM |
| 报名详情支付 | /registrations/:id/payment/prepare、/query | 新收费授权与恢复许可分离；可信查询事实回到资格状态机；晚到/额外收款独立义务 | 主HTTP/DOM；formal-business-branches-native |
| 报名详情退款 | /refund-requests、/refunds/query | 受理时刻不变、OPS明确核定、分项预算、真实渠道确认前保持在途；单次合成出站 | 主HTTP/DOM；formal-supply-native |
| 餐厅受控工作区 | /restaurant/activities/:id/supply-proposals | 本餐厅提交供给，不获得批准/发布权限 | formal-supply-native；主HTTP/DOM |
| OPS正式工作区 | /ops/supply-proposals/:id/approve；/ops/formal/activities/:id/publish | 原报价快照、权限/版本核验、分页加载，不批准未决参数 | formal-supply-native；主HTTP/DOM |
| OPS退款工作区 | /ops/formal/refund-requests（游标）、/:id/decide | 原申请分类、未决权益阻断、分项指令、原政策授权 | formal-supply-native；branches；主HTTP/DOM |
| OPS对账工作区 | /ops/formal/reconciliation/assess；/differences/:id/close | 范围签发、当前快照、查询/worker/差异核验；同账单独立重跑关闭；新差异使旧证明失效 | formal-reconciliation-native（含实际主应用受控路由） |
| 持久恢复进程 | start:formal-business-worker | bounded查询/退款/生命周期、历史授权、单个跟进失败有责任待办、不阻塞其他申请 | branches；主HTTP/DOM；reconciliation |
| 锁位到期/关单 | start:formal-hold-expiry-worker；start:formal-payment-close-worker | 十分钟到期释放，原渠道查询及可信关单；候补适用同一时钟 | 原formal-hold-expiry/formal-close测试；最终回归 |
| T24/T8 | V11_FORMAL_LIFECYCLE 持久任务 | T24历史成员快照（停机后可重建）、原权益；T8低人数未决不自行扣留 | branches T24 restart；共享规则；T8正式逐分支仍需补足验收 |

路径省略前缀处均为 /api/v11。旧Order业务的历史入口仍属旧业务；不能把V11记录的通过宣称旧资金迁移/展示已完成。运营对账UI提供正式接口入口，但端到端DOM目前重点为供给/退款，对账由主HTTP测试覆盖。
