# MINIAPP_ACCEPTANCE

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

用户端维持微信 Taro 项目；新增 V1.1 页面使用 prelaunchClient 契约表达资格、F/D、等待、退款、争议、隐私等本地流程。原生 miniapp 测试与 tests/ui/miniapp-prelaunch.test.tsx 的 DOM 交互证明组件状态/请求边界；Taro build 证明 weapp 工件生成。jsdom 不能证明微信授权弹窗、真机网络、支付控件或完整浏览器端到端 API旅程。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| clean-build-2026-10-01T01-38-14-569Z-weapp | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/weapp.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/weapp.stderr.log |
| final-2026-10-01T01-37-23-796Z-miniapp-tests | PASS | 0 | 21 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-tests.json |
| final-2026-10-01T01-37-23-796Z-miniapp-typecheck | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-typecheck.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-typecheck.stderr.log |
| final-2026-10-01T01-37-23-796Z-weapp-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/weapp-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/weapp-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-miniapp-dom-native | PASS | 0 | 12 / 0 / 0 / 0 | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-dom-native.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-dom-native.stderr.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/miniapp-dom-tests.json |
