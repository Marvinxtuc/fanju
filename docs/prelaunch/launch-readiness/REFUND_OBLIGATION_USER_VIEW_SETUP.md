# 本人应退义务与进度

2026-10-01。扩展既有正式本人资金查询，不新增写接口或开关。依赖FEATURE_V11_IDENTITY及FEATURE_V11_FINANCIAL_RECORDS；仍要求真实身份provider、demo关闭。

资金响应保留v11-funds-1，增加refundObligations、obligationEvidenceConflicts、refundObligationCoverage=RECORDED_ONLY。旧响应/旧客户端仍可兼容；新增客户端字段可选。不将“没有已登记证据”说成没有应退权益或完成对账。

只读取本人原收款对应的独立late义务事件。严格核验source、APPLIED、eventKey、商户范围、provider配置、原收款/报名/意图、F/D组件、精确payload字段和SHA256。所有字段均不经客户端输入选择owner。响应仅收款内部ID、应退总额、渠道确认额、剩余额、登记时间和状态；不暴露商户号、交易号、审核角色或原政策材料。

应退总额保持历史登记金额，不因部分退款下降。剩余应退=该笔义务总额-同原收款已CONFIRMED退款。AWAITING_EXECUTION表示尚无未确认执行记录；EXECUTION_RECORDED表示执行记录存在，不证明渠道已接收；CONFIRMED只在全部金额有渠道退款确认后展示。新登记不会发起退款或自动关闭异常case。

义务证据冲突单独计数、提示核对，不隐藏其他已记录收款和渠道退款、不填成剩余零元。普通用户不能读取别人记录；既有session撤销、隐藏页面、账号切换和迟到响应隔离继续有效。

小程序收款与退款页面展示已登记应退、该笔渠道确认额和剩余金额及上述阶段；不显示到账时限或把登记当作退款已发送。

定向验证：2项证据单测、6项页面DOM测试、9项owned资金HTTP/DB测试通过。覆盖部分/执行记录/全额确认、异人拒绝、敏感字段不出参、JSONB键顺序、坏证据和页面保留资金事实。所有数据合成，未真实退款或真机验收。

回滚备份：backups/L03-obligation-view/。按本切片diff恢复API reader、小程序API类型及页面，移除新增view模块/test；保留其他工作。没有schema或资金写入，不删除义务历史。
