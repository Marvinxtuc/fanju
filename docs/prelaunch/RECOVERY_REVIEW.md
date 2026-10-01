# RECOVERY_REVIEW

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

付款和退款 worker 在独立渠道成功、本地 ACK 前被确定性杀死，再启动后查询渠道事实并收敛；不是随机 kill 的概率观察。备份恢复测试在备份后制造渠道成功与隐私纠正，再恢复到新 generation，reconcile 发现丢失事实并 replay 较新的 privacy journal。过期席位保持过期、迟到付款保留全退义务，第二次恢复/对账不重复生成义务。pg_restore 只排除现存默认 public schema TOC，其他 restore 错误立即失败。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| final-2026-10-01T01-37-23-796Z-legacy-worker-compat-final | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/legacy-worker-compat-final.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/legacy-worker-compat-final.stderr.log |
| final-2026-10-01T01-37-23-796Z-prelaunch-process-tests | PASS | 0 | 109 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.source.json |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-process | PASS | 0 | 1 / 0 / 0 / 0 | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.source.json |
