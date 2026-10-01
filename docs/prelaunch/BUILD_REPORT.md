# BUILD_REPORT

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

clean-source-build从当前candidate inventory逐文件核对再复制，排除dist/cache/generated，显式复用锁定dependency链接。真实shared/API/Vite/Taro build产出BUILD_ARTIFACT_MANIFEST，打包只从该manifest hash一致的native工件导出，拒绝stale worktree dist回退。源码脱离Git复现入口核验delivery FILE_MANIFEST和candidate，使用new output+explicit dependency root；fresh依赖安装与跨机器安装仍未证明。



| Run | Result | Exit | Passed / failed / skipped / todo | Raw artifacts |
|---|---|---:|---|---|
| clean-build-2026-10-01T01-38-14-569Z-generate | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/generate.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/generate.stderr.log |
| clean-build-2026-10-01T01-38-14-569Z-shared | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/shared.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/shared.stderr.log |
| clean-build-2026-10-01T01-38-14-569Z-api | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/api.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/api.stderr.log |
| clean-build-2026-10-01T01-38-14-569Z-ops | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/ops.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/ops.stderr.log |
| clean-build-2026-10-01T01-38-14-569Z-weapp | PASS | 0 | N/A / N/A / N/A / N/A | docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/weapp.stdout.log, docs/prelaunch/evidence/clean-build-2026-10-01T01-38-14-569Z/weapp.stderr.log |
| final-2026-10-01T01-37-23-796Z-tool-versions | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/tool-versions.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/tool-versions.stderr.log |
| final-2026-10-01T01-37-23-796Z-generate | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/generate.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/generate.stderr.log |
| final-2026-10-01T01-37-23-796Z-shared-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/shared-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-api-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/api-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-ops-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/ops-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-weapp-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/weapp-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/weapp-build.stderr.log |
| final-2026-10-01T01-37-23-796Z-clean-source-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/clean-source-build.stdout.log, docs/prelaunch/evidence/final-2026-10-01T01-37-23-796Z/clean-source-build.stderr.log |
| worker-compat-2026-10-01T01-38-26-571Z-legacy-worker-build | PASS | 0 | None / None / None / None | docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stdout.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.stderr.log, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/RUNS.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/CONSUMER_PROVENANCE.json, docs/prelaunch/evidence/worker-compat-2026-10-01T01-38-26-571Z/legacy-worker-build.source.json |
