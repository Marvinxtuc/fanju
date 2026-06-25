# 上海本地餐厅兴趣体验工具 MVP

本项目是一个面向上海本地用户的微信小程序 MVP。核心入口是微信小程序，配套 API 服务、运营后台和后台任务，用于完成活动浏览、报名、测试支付、排桌、信息解锁、取消退款、评价举报、黑名单和审计管理。

默认产品不得被实现或表达为交友、相亲、约会、脱单、匹配对象或陌生人社交工具。若后续要改变定位，必须先完成 `PRD.md` 和 `docs/PROJECT_CONTEXT.md` 中定义的高风险变更审批。当前用户可见表达仍围绕餐厅体验、约饭局、同城活动、兴趣餐桌和周末两小时体验。

## 当前阶段

当前处于 M3.1.1-B：本机安全注入配置后的真实微信身份手工联调待执行阶段。本轮只验证身份链路，不接真实微信支付、真实退款，也不改变订单、支付、退款状态机。

阶段状态：

```text
M3.1.1-A passed
M3.1.1-B pending
M3.2 blocked
```

已完成：

- 任务文档已导入 repo。
- 技术选型已确认：TypeScript monorepo，Taro + React Admin + Fastify + PostgreSQL。
- 环境变量模板见 `.env.example`。
- 第一批共享纯业务规则和测试已建立在 `packages/shared`。
- 小程序、运营后台、API、Prisma/PostgreSQL 初始脚手架已建立。
- Docker/PostgreSQL、Prisma migration、真实 PostgreSQL API DB 集成测试已跑通。
- API 层已阻断报名截止、容量满、重复报名、未审批退款回调、已退款再次审批、受保护订单被支付回调改回已支付等非法路径。
- 运营后台根路径 `/` 可服务，小程序和运营后台已接最小 API 调用。
- 微信能力 provider interface 已建立，默认 mock provider。
- `AuthProvider` 已支持微信 `jscode2session` 登录路径。
- `PhoneProvider` 已支持微信手机号授权 code 换手机号路径。
- `docs/WECHAT_REAL_IDENTITY_QA.md` 已新增真实微信登录与手机号授权手工联调检查表。
- M3.1.1-A 已通过：真实身份联调准备与门禁固化完成。

尚未完成：

- M3.1.1-B：本机安全注入配置后的真实微信登录和手机号授权网络联调。
- 生产微信支付和真实退款。
- 生产微信支付上线评审、真实商户号、证书和密钥管理。
- 成团、排桌、通知、评价举报等完整业务闭环。

M3.1 已验证的是微信登录与手机号 provider 路径。M3.1.1-A 只证明联调准备与门禁固化完成；M3.1.1-B 完成前，不得进入 M3.2 微信支付/退款实现。

## 关键文档

- `PRD.md`：产品需求与验收标准。
- `Codex_Brief.md`：Codex 实施边界、任务拆分、质量门槛。
- `docs/PROJECT_CONTEXT.md`：项目上下文、不可变更契约、暂停条件。
- `AGENTS.md`：本 repo 的 Codex 工程规则。
- `docs/DECISIONS.md`：M0 技术选型方案与待确认决策。
- `docs/COMPLIANCE_REVIEW.md`：敏感个人信息和高风险产品能力准入条件。
- `docs/PAYMENT_PRODUCTION_REVIEW.md`：生产微信支付上线评审条件。
- `docs/WECHAT_REAL_IDENTITY_QA.md`：真实微信登录与手机号授权联调检查表。

## 预期目录结构

当前采用 pnpm workspace，先建立共享业务规则包。其余应用和服务会按里程碑补齐：

```text
.
├── apps/
│   ├── miniapp/        # 微信小程序用户端
│   └── ops/            # 运营后台
├── services/
│   └── api/            # API 服务和后台任务入口
├── packages/
│   └── shared/         # 共享类型、状态机、校验规则
├── migrations/         # 数据库迁移
├── tests/              # 集成测试、E2E、QA 脚本
└── docs/               # 架构、决策、测试、发布文档
```

## 本地运行

安装依赖：

```bash
pnpm install
```

启动本地 PostgreSQL：

```bash
docker compose -p timeleft_shanghai up -d postgres
```

由于当前目录名包含中文，Docker Compose 需要显式 `-p timeleft_shanghai`，避免 project name 推导失败。

校验和生成 Prisma Client：

```bash
pnpm db:validate
pnpm db:generate
```

执行数据库迁移：

```bash
pnpm db:migrate
```

启动 API：

```bash
pnpm dev:api
```

启动小程序开发构建：

```bash
pnpm --filter @timeleft-shanghai/miniapp dev
```

启动运营后台：

```bash
pnpm --filter @timeleft-shanghai/ops dev
```

## 测试

运行当前全部测试：

```bash
pnpm test
```

只跑 provider 单测：

```bash
pnpm test:providers
```

默认测试不会连接真实数据库；API 的 PostgreSQL 集成测试需要先启动 PostgreSQL 并显式打开：

```bash
docker compose -p timeleft_shanghai up -d postgres
pnpm db:migrate
pnpm test:api:db
```

运行 M2.1 黑盒非法状态探针：

```bash
pnpm probe:api:state-machine
```

该探针会启动本地 API 到随机端口，通过真实 HTTP 请求验证报名截止、容量满、重复报名、未审批退款 callback、已退款再次审批、受保护订单支付 callback 和 audit log。探针使用 `probe_` 前缀数据，结束后只清理自己创建的数据。

类型检查：

```bash
pnpm typecheck
```

构建：

```bash
pnpm build
```

禁用词和 secret/PII 扫描：

```bash
pnpm check:copy
pnpm check:secrets
```

最低测试范围：

- 登录、手机号、协议确认报名前置校验。
- 问卷必填校验。
- 活动、订单、支付、退款、桌位状态机。
- 支付和退款回调幂等。
- 退款规则。
- 排桌规则。
- 信息解锁规则。
- 禁用词检测。
- 权限和审计。
- 敏感日志检查。

M3 前必须持续执行：

```bash
pnpm test:api:db
pnpm probe:api:state-machine
pnpm check:copy
pnpm check:secrets
```

真实微信支付、真实微信退款和真实微信回调不得直接写订单或退款状态，必须复用现有 API 状态机规则。

## 环境变量

按 `.env.example` 的占位配置准备本地环境。不要提交真实 `.env`、secret、token、生产凭证、商户号密钥或真实用户数据。

Provider mode 默认配置：

```bash
AUTH_PROVIDER=mock
PHONE_PROVIDER=mock
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
ALLOW_MOCK_PAYMENT_IN_PRODUCTION=false
```

`AUTH_PROVIDER` / `PHONE_PROVIDER` / `PAYMENT_PROVIDER` / `REFUND_PROVIDER` 只允许 `mock` 或 `wechat`。本地开发默认使用 mock。M3.1 中，`AUTH_PROVIDER=wechat` 会调用微信登录凭证校验接口，`PHONE_PROVIDER=wechat` 会调用微信接口调用凭证与手机号换取接口；缺少 `WECHAT_MINIAPP_APP_ID` 或 `WECHAT_MINIAPP_APP_SECRET` 时必须失败，不会 fallback 到 mock，也不会 silent success。

启用真实微信登录或手机号 provider 前必须提供：

- `AUTH_PROVIDER=wechat` 或 `PHONE_PROVIDER=wechat`
- `WECHAT_MINIAPP_APP_ID`
- `WECHAT_MINIAPP_APP_SECRET`

日志和文档不得记录登录 code、手机号授权 code、session_key、AppSecret、access_token 或手机号明文。`session_key` 不返回给业务层或小程序。

M3.1.1-B 真实身份联调请使用 shell 环境变量、部署平台 secret 或仓库外的本地 secret 文件注入真实值。当前 `pnpm check:secrets` 会拒绝 repo 根目录中的真实 `.env` 文件；联调检查表见 `docs/WECHAT_REAL_IDENTITY_QA.md`。

推荐的仓库外本地 secret 文件路径：

```bash
/Users/marvin.x/.config/fanju/wechat-identity.env
```

该文件不得放入 `/Users/marvin.x/Documents/饭局` repo 内，且建议设置为 `chmod 600`。

启用 `PAYMENT_PROVIDER=wechat` 或 `REFUND_PROVIDER=wechat` 前必须提供：

- `WECHAT_PAY_ENABLED=true`
- `WECHAT_PAY_MCH_ID`
- `WECHAT_PAY_API_V3_KEY`
- `WECHAT_PAY_PRIVATE_KEY_PATH`
- `WECHAT_PAY_CERT_SERIAL_NO`
- `WECHAT_PAY_CALLBACK_URL`
- `WECHAT_REFUND_CALLBACK_URL`

生产环境默认禁止 mock payment。若必须在生产环境演示 mock payment，必须显式设置 `ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true`，且不得接真实商户号、真实证书或真实密钥。

真实支付回调和退款回调不得直接写订单、支付或退款状态，必须复用 API 层既有状态机 helper。

## 不可变更契约

未经确认不得改变：

- 产品定位。
- 禁用词策略。
- 数据采集范围。
- 订单、支付、退款状态机。
- 活动、桌位、地址解锁规则。
- 用户和后台权限模型。
- 支付和退款回调幂等逻辑。
- 数据库 schema 或持久化格式。
- 公共 API 路径、参数和响应格式。
- 配置文件格式。
- 生产依赖。
- 部署拓扑。
