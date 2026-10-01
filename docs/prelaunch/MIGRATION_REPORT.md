# MIGRATION_REPORT

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

迁移只在 task-owned synthetic PostgreSQL 执行。V1.1 additive schema 保留旧表；两项历史索引以 schema 声明补齐而不执行删除 diff。迁移回退的本地兼容方式是旧 consumer 在 additive schema 中按 allowlist 处理旧任务并保留 V11_REFUND 与 F/D/退款记录。删除 additive 表不属于本次授权，也不应作为回滚命令。实际 deploy/diff/旧 consumer 的原生日志分别列证据，不互相替代。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| final-2026-10-01T01-37-23-796Z-empty-migrate | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/empty-migrate.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/empty-migrate.stderr.log |
| final-2026-10-01T01-37-23-796Z-channel-migrate | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/channel-migrate.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/channel-migrate.stderr.log |
| final-2026-10-01T01-37-23-796Z-schema-validate | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/schema-validate.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/schema-validate.stderr.log |
| final-2026-10-01T01-37-23-796Z-migrate-deploy | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/migrate-deploy.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/migrate-deploy.stderr.log |
| final-2026-10-01T01-37-23-796Z-schema-diff | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/schema-diff.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/schema-diff.stderr.log |
| final-2026-10-01T01-37-23-796Z-legacy-worker-compat-final | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/legacy-worker-compat-final.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/legacy-worker-compat-final.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.source.json |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-process | PASS | 0 | 1 / 0 / 0 / 0 | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.source.json |
