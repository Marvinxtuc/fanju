# 正式政策材料校验接缝

2026-10-01：新增 formal-policy-material.ts。未挂载业务路由、未写数据库、未改变草稿约束、未赋予政策启用或财务授权。

调用方必须提供原始 JSON 字节对应的发布 SHA256、releaseVersion、继承基线 hash，以及 referenceId 对应的实际附件原文。发布摘要应来自独立核验后的发布材料；本模块不会产生或批准该摘要。

材料 scope 为 FORMAL_POLICY_RELEASE_MATERIAL。它包含 bundleId、version、releaseVersion、inheritedBaselineHash，及三份 USER_AGREEMENT / PRIVACY_NOTICE / REFUND_POLICY 文档。各文档包含 documentId、version、fullText/fullHash、publicText/publicHash；公开正文须为唯一 PUBLIC_POLICY_START/END 标记之间的原字节，不接受 PUBLIC_DRAFT_START。

必须逐项引用12个剩余OP的 BUSINESS_DECISION 附件和7个RV的 SPECIALIST_CONCLUSION 附件，共19项；缺项、重复项、错类别或附件摘要不符均拒绝。原已冻结的3个OP继续通过继承基线追溯，不能由此重写。

校验结果只说明材料集合和字节完整性；不判断附件结论是否成立、签收人真实身份/权限、业务参数充分性、渠道允许性或当前有效性。即使 VALID，也固定返回 activation=NOT_ASSESSED、releaseAuthorized=false。测试附件全部为 synthetic 内容，不代表真实业务决定或专项签收。

后续还须完成实际19项结论核验、正式参数schema、不可变正式快照与用户同意存储、历史权益授权、正式业务装配和真实验收。本模块不能用作支付或退款 authorizer，也不能作为 READINESS_STATE 的 FORMAL_POLICY_SIGNOFF 证据。

无新增依赖、迁移、公开API。回滚仅移除两个新增 formal-policy-material 文件；保留原冻结文档和无关改动。
