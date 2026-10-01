# TEST_REPORT

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

最终 runner 先验证 owner/network guard、迁移和 schema diff，再独立 A1 52、四包 native test/typecheck/build、文案/secret扫描、组件DOM和clean-source-build。进程测试串行运行，避免不同fixture间抢队列；各单项内部仍执行真实并发。Vitest native JSON和Node TAP逐项保存 pass/fail/skipped/todo，不把 helper/adapter 输出计成 native。总数不合并重复 A1；每个规则/场景只按明确 test 名和 raw run证据关联。

最终台账覆盖104条规则、91个原始场景加48个补充场景、24项任务。逐项运行证据已绑定候选 `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`，具体 PASS_BOUND_FINAL_CANDIDATE 记录及原始产物摘要见 COVERAGE_LEDGER.json 与 EVIDENCE_INDEX.json。本地104规则、139场景均PASS，E00—E23全部COMPLETED，本地失败与未运行项为0。整体仍有101规则、77场景BLOCKED_POLICY，19项OP/RV门槛未关闭；本地通过不代表真实渠道或生产启用。历史尝试保留为历史记录，不替代最终绑定证据。

| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| final-2026-10-01T01-37-23-796Z-a1-frozen-52 | PASS | 0 | 52 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/a1-frozen-52.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/a1-frozen-52.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/a1-tests.json |
| final-2026-10-01T01-37-23-796Z-shared-tests | PASS | 0 | 226 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-tests.json |
| final-2026-10-01T01-37-23-796Z-shared-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-api-tests | PASS | 0 | 160 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.json |
| final-2026-10-01T01-37-23-796Z-api-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-miniapp-tests | PASS | 0 | 21 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.json |
| final-2026-10-01T01-37-23-796Z-miniapp-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-ops-tests | PASS | 0 | 15 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-tests.json |
| final-2026-10-01T01-37-23-796Z-ops-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-prelaunch-process-tests | PASS | 0 | 109 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stderr.log |
