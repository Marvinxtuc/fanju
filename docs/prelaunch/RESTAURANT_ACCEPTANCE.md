# RESTAURANT_ACCEPTANCE

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

餐厅签收与供应修订保持不可变版本；签收的人、版本摘要和 acceptedAt 被持久保存，后续修订不能覆盖历史。API 按 actor.restaurantId 限制餐厅可见数据，核心变更另行用户选择与义务记录。餐厅端界面构建和 native HTTP 角色测试不是实际餐厅工作人员验收；真实通知、合作签收和结算未执行。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| clean-build-2026-10-01T01-38-14-569Z-ops | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/ops.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/ops.stderr.log |
| final-2026-10-01T01-37-23-796Z-ops-tests | PASS | 0 | 15 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.json |
| final-2026-10-01T01-37-23-796Z-ops-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-ops-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-prelaunch-process-tests | PASS | 0 | 109 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-process | PASS | 0 | 1 / 0 / 0 / 0 | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.source.json |
