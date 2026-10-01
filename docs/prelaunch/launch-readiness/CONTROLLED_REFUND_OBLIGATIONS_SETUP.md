# 受控应退义务核对入口

2026-10-01。显式FEATURE_V11_CONTROLLED_OBLIGATIONS=true、FEATURE_V11_IDENTITY=true、PAYMENT_PROVIDER/REFUND_PROVIDER=wechat和仓库外当前商户/App/config绑定及受控账号配置。默认关闭。

GET /api/v11/ops/refund-obligations仅接受专属受控会话，OPS/REVIEWER可读；普通用户令牌和餐厅角色不得访问。每次复验账号/actor绑定及版本，RepeatableRead中再核对actor。查询只接收可选cursor（最多160字符），调用者不能指定商户、config或用户范围。

每页最多50个与当前商户/config关联的迟到全退case，稳定case ID游标。保留已记录总应退、已确认、剩余及执行记录阶段；记录退款指令不代表渠道已受理。校验义务hash、原收款、组件及退款金额/状态一致性；冲突保留case且obligation=null，不输出虚构零应退。无商户归属的孤立source不能混入当前商户列表；该列表覆盖RECORDED_ONLY，不宣称完整资金对账。

工程升级deadline输出engineeringEscalationAt，不是业务审核/退款SLA。仅显示ownerAssigned，不输出负责人个人信息、openid、手机号、商户单号或渠道交易号。返回dispatchAuthorized=false；没有批准、资金预留、发送或case关闭操作。

先前29步完整回归通过，跨进程200；扩展HTTP后16项定向通过，验证受控登录读取、无会话/普通令牌拒绝、调用者范围及长游标拒绝、账号版本变更403、禁用401。首次状态码断言误写401，已按既有契约修正，无权限逻辑放宽。扩展后的完整回归运行中；运营UI/真实账号验收尚未完成。

回滚关闭新flag，恢复backups/L03-controlled-obligations/production-identity-routes.ts对应差异并移除新增只读模块/测试段；保留资金与case证据。无schema变更、无新增依赖、未连接真实商户或发送退款。

运营界面已增加 OPS/REVIEWER 应退分页查看；金额冲突不显示虚构零值，退款指令记录与渠道确认分开显示。退出、身份刷新、页面隐藏清理记录，并拒绝迟到响应。定向18项与ops类型检查通过；完整回归以当前RUNS终态为准。UI无退款发送或审批入口。回滚按backups/L03-controlled-obligations-ui中的原文件局部差异恢复并移除新增投影模块，保留其他修改。
