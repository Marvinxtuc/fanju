# SECURITY_REVIEW

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

运行环境隔离采用 owner 标签和精确 TCP 允许集；外网、5432、其他 loopback 与未绑定进程的 listener 在建 socket 前拒绝。原始 credential/runtime 不进入报告或交付。响应投影不返回 passwordHash/令牌/direct identifier，日志 redaction 使用已知 runtime secret。check-secrets 的 SHA-256 例外只允许独立完整64hex token内的手机号样式数字，保留63/65hex和邻接普通字符误判保护；不会整文件豁免 frozen policy。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| final-2026-10-01T01-37-23-796Z-network-guard | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/network-guard.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/network-guard.stderr.log |
| final-2026-10-01T01-37-23-796Z-check-copy | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/check-copy.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/check-copy.stderr.log |
| final-2026-10-01T01-37-23-796Z-check-secrets | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/check-secrets.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/check-secrets.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-network-guard | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/network-guard.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/network-guard.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/network-guard.source.json |
