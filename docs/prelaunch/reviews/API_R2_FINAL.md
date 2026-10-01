# API R2 最终候选复审草稿

结论：本轮已观测的代码缺陷均已在本地候选修复；目前没有已知未修复代码缺陷。该结论不是全部104规则/139场景通过声明。主任务完整final运行中，最终PASS/FAIL及证据ID须以该候选日志绑定。

## 代码修复范围

- 可信payment/refund原channel、merchantScope、providerConfig与originalTrade绑定；异常保留MANUAL/case，原收款事实不抹除。
- 锁后notice时钟重读、immutable acceptedAt、canonical核心变更幂等、缺binding恢复计数真实性。
- 锁内job fencing、UNKNOWN单调、取消先提交阻止旧PAY、可信receipt金额异常保留、原intent未知禁止新收费。
- 个体合法核心拒绝刷新桌态，T24历史membership重建，合法释放后优先既有队首；聚合取消不复活候补。
- 注销审理关联有效报名、未完退款、争议、settlement及D余额；只已完成D disposition减少heldD，保留资金及用户资料。
- USR08只在合法且同填充人数的桌候选内部采用snapshot性别软tie；不绕max/FIFO/既有成员，不输出比例。
- PRE034已结算D翻案：审批结论与原completed实付保留，建立SETTLED_DEPOSIT_CORRECTION，用户退款责任、原receipt/disposition、资金来源/追回责任可查；来源责任UNRESOLVED并OP14/RV06阻塞，不复用旧D，不执行真实渠道。
- mutation write contract、sanitized parser、精确CORS、基础dirty与frozen guard均为当前候选组成。

## 已观察验证与最终待绑定

主任务确认：cancellation/lifecycle targeted 16/16 PASS，closure targeted 4/4 PASS，aftersales/receipt/soft tie修正ISO后13/13 PASS，settled correction targeted1/1 PASS。更早R2-01—09与本轮binding/notice/queue/history/race等具体通过见主任务历史候选日志，不将旧日志当当前最终日志。

新场景proof均已导入：remaining-scenarios PRE012/020/033/034，以及admission-policy BR02/03/04/05/08 RB06/07/09 DR08。最终完整候选执行中，未单独观测到的PASS不预先宣称。新test exact title/file/line映射见review-fixes/EXACT_NATIVE_MAPPING.json。

## 精确边界

- 资金、身份、通知、delivery、expiry及批次时钟只属owned PostgreSQL+持久Mock/synthetic harness；实际微信、真实渠道、结算资金来源审批、会计/税务和发布门禁仍独立。
- 批次明确Shanghai次日10时，跨午夜取结束/批准时刻所属上海日；调度受理、审核通过、worker运行与渠道CONFIRMED逐层区分。
- OP04正式自退和OP05/07/08等未定政策保留显式blocker；不得将simulation执行当政策激活。
- PRE034纠正为义务/来源框架，真实垫付与追回规则保持OP14/RV06，不能泛称已退款。
- 无Git修改、真实凭据、旧5432访问、生产渠道或冻结政策内容变动。

最终报告应绑定唯一候选run ID、最终source hashes及具体test标题；如final失败仅修本次候选失败并重跑受影响门禁，再进行最终绑定。


主任务最终运行核验：候选 c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699，final-2026-10-01T01-37-23-796Z 全部28记录PASS，109原生进程断言/12组件；source-reproduction-2026-10-01T01-39-27-139Z PASS；实际ZIP解包 zip-proof-20261001T020213632529Z 包内checker/CRC/1590文件摘要与同source构建及四suite PASS。R1/R2镜像/源码审阅与此主任务实际runtime角色分开。首次沙盒构建超时保留于evidence/zip-timeout-history，不继承为最终通过，也不隐藏。正式OP/RV、真实接口、外部签字和生产禁令不由本地PASS自动解除。
