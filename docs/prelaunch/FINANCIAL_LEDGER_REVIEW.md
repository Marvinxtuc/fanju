# FINANCIAL_LEDGER_REVIEW

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

收款绑定、原始 F/D component、处置 reservation、退款 instruction 和渠道交易事实分开持久化。退款事务锁住 component，20 个竞争请求不能突破原始预算；独立渠道库还按 originalTradeNo 限制累计实际退款。正常履约只退 D，随后补退 F 仍受各分项余额限制；退款成功、留存与结算义务不能重复消耗同一额度。finance.ts 不允许关闭未知差异类别。餐厅结算仍为义务记录，未执行真实转账。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。
