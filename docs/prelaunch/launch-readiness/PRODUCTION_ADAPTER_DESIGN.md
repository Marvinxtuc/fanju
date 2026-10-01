# L01 生产适配初稿

状态：DRAFT，未实现、未生产启用。

## 入口选择

保留prelaunch/server.ts和owned mock channel供隔离回归。新增正式装配入口，使用既有微信provider和正式session，不通过修改APP_ENV允许列表把模拟server直接转生产。V1.1 domain/aftersales与生产适配共享经过验证的业务行为，先抽取最小可替换依赖，避免复制整套规则后产生两份事实。

## 接缝与必须保持的约束

| 接缝 | 当前实现 | 正式要求 |
|---|---|---|
| 主体认证 | V11Actor密码/HMAC session | 验证既有正式USER/OPS session后映射principal；角色不可由客户端指定；REVIEWER与RESTAURANT独立授权、停用和version撤销 |
| 微信用户映射 | 模拟actor预建userId | 微信provider成功后事务建立唯一身份映射；失败不建用户；personId由服务端不可变身份确定，避免异人复核被多账号绕过 |
| 渠道装配 | routes/worker/finance直接new PersistentMockChannel | 注入经过绑定校验的真实gateway，保留真实callback/query/refund一致状态机；禁止混用mock与真实事实 |
| 政策 | LOCAL_DRAFT与assertSimulationPolicy | 新正式不可变policy snapshot关联真实签收证据；原draft不原地改为有效；同意精确hash、历史权益不重算 |
| 通知 | SIMULATED_READ | 记录获签收送达规则和真实渠道证据；未知送达不启动违约期限 |
| 到场码 | SIMULATION_ONLY与固定工程TTL | 生产scope、签名、餐厅活动绑定、过期/重放控制；TTL需正式参数，不照搬测试值 |
| 客户端 | loopback与模拟密码登录 | 正式HTTPS origin白名单、wx登录授权、不同session缓存隔离；测试入口从生产包不可达 |
| 资金恢复 | channelDb模拟持久事实 | 在途先持久SUBMITTING；未知不重发，先查询；原支付组件、账单覆盖、manualcase和资金守恒不削弱 |

## 首次实施切片

先定义principal认证与channel装配接口，在原隔离入口中保持mock行为和现有测试；再添加真实身份principal映射。不得在接口抽取期间启用真实收费或激活policy。每次只改一个责任边界，对关联HTTP权限与退款权利做回归，并生成新的代码候选摘要。

## 需要实际输入

正式小程序主体、商户主体、身份与付款归属关系、部署域名；用户最新确认主体、商户已准备好，具体渠道能力和部署状态另行核实。运营/餐厅角色来源及同人复核判定依据也须明确。专项签收材料不得虚构签字。

## 已确认的资金语义差异

2026-10-01源码核对：V11_PAY在worker中调用mock pay直接得到SUCCEEDED。微信JSAPI预下单只产生prepay_id，用户必须在小程序授权付款；因此生产适配不能实现一个同签名pay函数后继续自动确认。必须分离预下单/前端requestPayment/签名callback或可信query确认，前端成功只触发查询。receipt.channel及merchantScope、reserveRefund的mock限定、persistMockEvent/applyMockEvent和reconciliation均要逐一适配；不能只替换routes里的构造器。

生产支付时间使用渠道可信paidAt，资格受理时刻继续独立记录。关闭订单和正在付款的竞争必须通过渠道close/query以及本地锁处理；未知结果保持资金义务，不按关闭UI丢弃回调。refund先查询原商户退款号，已存在不得重复发起；原支付交易绑定与F/D预算不可绕过。

真实身份历史已通过M3.1.1-B，不重新标成项目从未接入。新的V1.1 principal、policy和资金链仍需在其新候选上复验。
