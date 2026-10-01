# 本轮完整工程交付

基线5b0510052f447051004d8f2ebac950bb99aa8dab，独立worktree codex/fanju-stage0-baseline。未覆盖主工作区或后续成果。当前候选见CURRENT_SOURCE_SNAPSHOT.json。

已完成正式主交易/退款/对账/政策来源接线及本轮同候选回归：30步骤全部PASS；shared226、API342、miniapp36、ops33、旧DOM18、进程261及独占空库HTTP1。A1 52属于shared226，不重复累计；正式主DOM3项由一个原生父测试执行，包含在进程测试中。补充正式客户端6及保留历史回滚拒绝1独立留证。四项新迁移上/空下/重建全部26项通过。本地合成验证不代商户、真机、生产或政策签收。

本轮重点源码：formal-action-authority/runtime-policy/authority-source/policy-consent/supply/registration/payment-service/qualification/refund-service/refund-followup/reconciliation-coverage/lifecycle/business-worker及主miniapp/ops。正式渠道默认关闭、所有恢复保留原渠道和原权益、未决参数明确阻断。未改COMPLETE常量或用空authorizer冒充批准。未激活生产政策，未真实收付，未部署。

阅读顺序：FINAL_REGRESSION_SUMMARY.json（实际日志索引）→FORMAL_ENTRY_MATRIX.md（正式入口）→SELF_REVIEW_AND_REMEDIATION.md（整改和仍缺工程验收）→OPERATIONS_AND_DEPENDENCIES.md/GATE_CURRENT_STATUS.json（29门禁依赖）→FORMAL_RULE_COVERAGE.json（104规则、139场景原证据和本轮覆盖边界）。原审查报告仅作输入，历史evidence/manifest均保留原日期、候选和失败退出码，不是当前PASS。

当前生产NO_GO。低人数继续、核心变更补偿、特殊资料/争议、履约失联、完整隐私注销等尚无唯一权益定案，不能自行批准。旧Order只读历史入口和两类异常正文/金额正式DOM已验证；旧资金迁移/原渠道恢复/旧退款执行与全部正式权益分支验收尚未完成，具体分项见自审。主体/商户按用户报告已准备；本轮当前能力证据仍待真实核验。不得因此重复开户或把站点安全阻断归咎于账号。

下载ZIP含候选清单全部源码、锁文件、完整docs/prelaunch历史与当前证据、迁移和保护回滚，以及相对基线patch。排除依赖目录、生成物、真实.env/密钥/数据库；pnpm install --frozen-lockfile及pnpm exec prisma generate后再按隔离运行说明重建。跨机器fresh安装尚未实证；本轮干净源码build复用锁定的本地依赖，来源写在原生build manifest。

回滚不删除已有义务或重置用户数据：只在无正式历史时允许guarded结构回滚；保留历史采用前向修复。本轮工程自审和测试日志不是外部专业批准，不要求你逐包人工审批。
