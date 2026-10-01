# API R2：不同视角对抗审读（首轮）

状态：FINDINGS_OPEN。阅读时新API仍在并行构建；本报告只将已经存在的具体代码分支列为问题，未把尚未生成的文件算作缺陷。

范围：contracts/policy/ownership/domain 和现有contracts单测；未运行DB、HTTP或worker验证，不修改被审源码。

## R2-01 [P0] 候补待付跨T24后新建资格
定位：`services/api/src/prelaunch/domain.ts:269`。
观察：T24任务已处理当时队列后，T24之前创建但未成功的候补在10min内晚付能再次变成WAITLIST且无后续到期任务。
要求：到截止仍未转正结束候补并全退；保存实收，不能重开队列。
复核测试：T24执行→待付候补成功→资格终止/全退且没有FORMAL/WAITLIST；两类事件相反顺序相同结果。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-02 [P0] 迟T24任务误读当前人数并覆盖状态
定位：`services/api/src/prelaunch/domain.ts:323`。
观察：历史查询仍带active:true而遗漏cutoff后离开的人；随后refreshTable(cutoff)又按当前active数，不使用历史cutoff。
要求：以joinedAt<=cutoff且leftAt为空或>cutoff重建快照；旧截止事实不得覆盖后续当前状态。
复核测试：T24已成团→T20退出→T18才跑T24，仍formedAtT24=true且当前INVALIDATED；晚成员不进入历史人数。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-03 [P0] 租约检查未锁job行的间隙
定位：`services/api/src/prelaunch/domain.ts:22`。
观察：SELECT当前generation和lease后未锁job行，claim可在检查到最终写之间换generation。
要求：短事务锁/条件写保证旧generation不能覆盖新worker；外部渠道IO在锁外。
复核测试：A执行后暂停/过期，B接管，A恢复，A不得覆盖B也不得新加无约束收退款。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-04 [P0] 关闭后worker仍发起新收款
定位：`services/api/src/prelaunch/domain.ts:299`。
观察：V11_PAY query无fact后不检查reg是否取消/到期就pay。
要求：先查询与恢复已经发生的事实；关闭且可信无交易时禁止新的pay。
复核测试：用户cancel已提交→旧PAY job运行→渠道新支付次数0；已有渠道成功则记收款全退。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-05 [P1] 回调可靠接收与业务生效time混用
定位：`services/api/src/prelaunch/domain.ts:245`。
观察：apply使用执行时间决定qualification，而不是persist事件verifiedAt；ACK落盘后worker延迟可改变档位。
要求：持久事件与资格/库存可本地短事务同时收敛，或明确可信事件时间与到期协议；不能回填席位。
复核测试：接收成功ACK即杀进程→恢复，金额/截止和原acceptedAt不被处理延迟改写；到期后确认仍不复活。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-06 [P1] 正式报名绕过未结历史资金
定位：`services/api/src/prelaunch/domain.ts:128`。
观察：priorUnsettled只在WAITLIST分支，FORMAL重报可绕未结退款/UNKNOWN旧意图。
要求：OP08未决重报分支对两种入口一致隔离；保留请求及原责任。
复核测试：旧退款UNKNOWN/旧可能收款→FORMAL重报不能消除阻塞；其他用户可用已释放容量。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-07 [P1] 不同businessKey重复取消重算权益
定位：`services/api/src/prelaunch/domain.ts:209`。
观察：reg.cancelAcceptedAt只列保留first；每个新key payload使用新的dbNow和current table。
要求：重复同语义取消保持原可信受理/类别/当时桌事实，审核/拒绝不选后来请求重算。
复核测试：T25第一次取消→T20另key重试/审核→仍原T25权益和D去向。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-08 [P1] 未知桌状态默认失效
定位：`services/api/src/prelaunch/domain.ts:55`。
观察：不识别的String状态一律INVALIDATED，可让未知/低人数终态进入未成团退款分支。
要求：只映射明确合法状态，未知权益回block/manual，保留事实。
复核测试：人为未知桌状态不产生正式退款/扣款结果。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## R2-09 [P2] 已有政策快照未核验存储内容
定位：`services/api/src/prelaunch/policy.ts:28`。
观察：same digest已有row的docsJson不校验，update:{}原样返回，源hash检查不验证恢复库内快照。
要求：验证DB存储的source/public双摘要及身份，冲突人工，不覆盖历史正文。
复核测试：合法源文件+损坏existing docsJson→预览/同意拒绝，不误标完整VALID。
修复/复测状态：OPEN；API agent已收到，并认可R2-01—05的风险。

## 读取快照（只覆盖首轮读完的文件）

- `services/api/src/prelaunch/contracts.ts` SHA-256 `652d14d597176038e6331adcaf8eebc82ac6c341f5d6c5cce24a6bf81780cb4e`
- `services/api/src/prelaunch/policy.ts` SHA-256 `122ca113de882e14cef6affd4c5e58237d66f1cab64d028e775e8db8c1337f58`
- `services/api/src/prelaunch/ownership.ts` SHA-256 `77ad5059052509a6c994397db770e2268595db8aeadc3769b3bd5499add47d78`
- `services/api/src/prelaunch/domain.ts` SHA-256 `b1f40aa62b528ca8d85e4a967430c82113eec137d780fc9d1609f947f31eb923`
- `services/api/src/prelaunch/contracts.test.ts` SHA-256 `281a84bf5f8e7dd85c5ec6f59730d2f5ccf7b420ede07bf26e9e618b5ef4b81f`

后续API agent修复后，需要按新字节/实际DB证据做R2复核。原政策OP/RV状态不变；纯函数测试139通过不能替本报告中的持久并发/真实资金断言。
