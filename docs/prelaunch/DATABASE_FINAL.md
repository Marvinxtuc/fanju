# DATABASE_FINAL

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

prisma/migrations/20261001000000_prelaunch_v11_expand/migration.sql 为 additive V1.1 表；后续资金约束迁移以真实 PostgreSQL 检验。主业务库、渠道事实库和恢复库属于当前 task 的明确 owner，端口 5432 永久排除。运行前验证容器标签、库名、用户、映射端口和进程绑定。恢复使用全新 generation，保留旧库，不 drop 用户数据。数据库迁移的 deploy/schema diff 结果应取最终 run；schema diff 不可拿生成 SQL 当作已执行。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。
