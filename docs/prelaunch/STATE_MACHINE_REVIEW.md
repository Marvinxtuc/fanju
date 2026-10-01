# STATE_MACHINE_REVIEW

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

资格状态、会员有效性和支付/退款事实保持分离。付款成功先保存渠道事实和 F/D 原始额度，再确定资格；迟到事件不得复活失效席位。T24 重建使用 leftAt 历史而不覆盖现在的 INVALIDATED。取消幂等返回第一次 acceptedAt 和当时裁定；UNKNOWN 付款阻止重入。未知桌状态 fail closed，既不生成退款权利也不抹掉会员。tests/prelaunch/money-state.test.mjs 的 R2-01 至 R2-09 是这些边界的实际 DB 验证入口。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。
