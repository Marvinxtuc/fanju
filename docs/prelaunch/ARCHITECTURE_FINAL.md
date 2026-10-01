# ARCHITECTURE_FINAL

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

services/api/src/prelaunch/domain.ts 管资格、席位与支付事实，aftersales.ts 管履约、争议、核心变更与隐私处置，finance.ts 管 F/D 摘要及人工资金差异案件，reconciliation.ts 比较业务库与独立渠道库。routes.ts 只通过 actor/session 与 strict contracts 暴露这些边界。持久任务 worker.ts 用数据库租约和 generation 围栏衔接异步渠道；旧 worker 仍以 kind allowlist 处理旧任务。shared prelaunchBusiness/prelaunchPolicy/prelaunchClient 承载纯规则和客户端契约。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。
