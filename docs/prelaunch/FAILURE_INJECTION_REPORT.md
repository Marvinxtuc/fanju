# FAILURE_INJECTION_REPORT

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

http-journey-recovery.test.mjs 包含付款/退款渠道成功后、本地 ACK 前 kill/restart；money-state 包含迟到 T24、未知表状态、旧generation、取消后旧 PAY、UNKNOWN重入、损坏 policy snapshot；restore-reconciliation包含业务恢复丢失渠道事实、privacy后备份纠正、反向业务成功而渠道无凭据。所有故障只写合成task数据。未覆盖的渠道超时、全流程UI、极端规模及真实provider故障必须保留NOT_RUN，不用已有kill用例泛化。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| final-2026-10-01T01-37-23-796Z-prelaunch-process-tests | PASS | 0 | 109 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-process | PASS | 0 | 1 / 0 / 0 / 0 | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.source.json |
