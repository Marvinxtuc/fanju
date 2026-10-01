# API_ACCEPTANCE

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

V1.1 API 以模拟身份登录后签发会话，角色来自服务端 actor，不接受客户端自报 reviewer/person 身份。strict body 拒绝字段漂移，权限限制供应历史、队列、资金案件、隐私导出及餐厅数据。routes.ts/contracts.ts 的 parser/status 行为必须保留可信 Fastify 400/413，其他内部异常只返回泛化错误。HTTP 原生测试验证本地应用真实响应；直接调用服务函数测试不能冒充 HTTP 契约验证。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| clean-build-2026-10-01T01-38-14-569Z-api | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/api.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/api.stderr.log |
| final-2026-10-01T01-37-23-796Z-api-tests | PASS | 0 | 160 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-tests.json |
| final-2026-10-01T01-37-23-796Z-api-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-api-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-prelaunch-process-tests | PASS | 0 | 109 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/prelaunch-process-tests.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-process | PASS | 0 | 1 / 0 / 0 / 0 | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-process.source.json |
