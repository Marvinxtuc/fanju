# E00 隔离环境与起点基线证据

状态：起点基线完成；长任务仍在实施。这里的通过不是最终候选或发布批准。

## 已核验的环境

- 工作区：`/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局`。
- 起点：`codex/fanju-stage0-baseline` / `003200820922d11b374b84a9e756d4d763bea3f2`，包含此前 V1.1/A1 dirty。
- Node `v22.23.1`，pnpm `9.15.9`，既有 Docker daemon `29.2.1`，Colima 已运行。未安装全局服务或新依赖。
- 实际 `5432` 监听者为用户既有 `ssh` 进程；没有向该端口建立连接，也没有运行旧 Compose。
- 新 owner：`fanju-prelaunch-20261001-b48140fda0c1`。独立容器、volume 和 network 的所有权标签必须全部匹配。
- PostgreSQL `16.14`；既有镜像完整 ID：`sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb`。
- 新数据库：`fanju_prelaunch_a755def387dc`，仅 `127.0.0.1:32772`，未复用旧数据卷。
- 数据库标记：`prelaunch_control.owner(task_id text, owner_id text, purpose text)`，恰好一行。真实连接检查数据库名、角色、任务和 owner。
- 公共元数据见 [OWNED_ENVIRONMENT.json](OWNED_ENVIRONMENT.json)。合成私有连接和签名材料只保留在 task-owned scratch，未写入仓库日志。

Docker 29 的 internal network 没有 host 发布端口。本轮使用独立 bridge，关闭 outbound masquerading；没有把该设置单独视为应用网络隔离。每个受控应用子进程同时运行 Node preload allowlist，拦截非 loopback fetch/http/https/net/tls 及旧 5432。四项 provider 明确为 mock；真实收费开关全部关闭。

## 起点运行副本

起点 272 文件逐项摘要来自 `docs/prelaunch/baseline/BASELINE_SNAPSHOT.json`。完整原字节复制到 task-owned `baseline-run`，没有漏掉既有未提交文件。包依赖只链接既有安装；workspace shared 指向该起点副本。

新模块在 live 工作区并行新增，不进入这次起点回归。每条执行记录标为 `BASELINE_NOT_FINAL_CANDIDATE`；不能将它转作最终候选证据。

## 原生执行结果

原始 stdout/stderr、Vitest JSON 和命令、cwd、时间、退出码、源码身份在：

`docs/prelaunch/evidence/baseline-2026-09-30T22-37-55-223Z/RUNS.json`

| 项目 | passed | failed | skipped | 退出码 |
| --- | ---: | ---: | ---: | ---: |
| 历史 A1 单独回归 | 52 | 0 | 0 | 0 |
| shared 全包 | 70 | 0 | 0 | 0 |
| API 全包，RUN_DB_TESTS=1 | 145 | 0 | 0 | 0 |
| ops 全包 | 3 | 0 | 0 | 0 |
| miniapp 全包 | 21 | 0 | 0 | 0 |
| 四包 typecheck | 不适用 | 不适用 | 不适用 | 全部 0 |

全包合计 **239 个**用例。A1 的 52 项包含在 shared 的 70 项中，其单独重跑不能重复计算为 291 个不同用例。所有 todo 为 0。

历史迁移 deploy、Prisma generate 和 shared 真实产物生成退出码均为 0。shared/API tsconfig 排除测试文件；typecheck 不证明测试源已经受 tsc 检查。测试文件由原生 runner 实际加载。

网络保护自检在创建任何目标 socket 前拒绝五种路径：微信 fetch、外网 net、微信 https、外网 tls、旧 loopback 5432。该自检和每个运行的 owner 核验为实际执行。

## 环境问题与修复

| 发现 | 修复与验证 |
| --- | --- |
| Docker internal network 未发布 host port | 仅清理核验过标签的失败尝试 owned 对象；改用独立、无 outbound masquerading 的 bridge，并保留应用 allowlist |
| Docker 镜像临时 Unix 初始化服务令 pg_isready 提前成功 | 改为该 owned 容器内 TCP 查询 `SELECT 1`，确认目标数据库初始化完成后建立标记 |
| macOS `/tmp` 与 `/private/tmp` 的同一路径形式不同 | 对 run root 和 scratch 都采用 realpath，保留所有权验证 |

没有把失败尝试标为测试通过；这些问题均局限于本任务新建对象。

## 未完成范围

- 此处没有执行前端发布构建、UI 端到端、完整新业务场景或真实渠道。
- 新 Schema、worker、新 V1.1 实现须单独执行并绑定后续源码候选。
- 当前默认 Mock 渠道与业务库共库；独立渠道账和恢复损失演练需要后续工程证据。
- 所有真实密钥、用户材料、现有数据库、部署、收费和 Git mutation 均未使用。
