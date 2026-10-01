# SHARED R1：V1.1 独立纯函数内部实施核查

日期：2026-10-01。范围：E03/E04/E05/E07/E08/E09/E10/E13 共享层纯函数；工程候选，不是正式政策启用或发布验收。

## 已写文件

- `packages/shared/src/rules/prelaunchPolicy.ts` / `.test.ts`
- `packages/shared/src/rules/prelaunchBusiness.ts` / `.test.ts`
- `packages/shared/src/index.ts`：仅追加三个 prelaunch 模块 export；prelaunchClient 模块由 root 负责。
- `docs/prelaunch/analysis/SHARED_RULE_MAP.json`：104 Rule + 91 target，各自源、函数、测试定位和剩余集成范围。

原 docs/policy、policyBundle.ts、V1.0 fixture、A1/旧断言冻结，本代理未写这些文件。未执行 DB、migration、真实调用、配置读取、部署、Git 写操作。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 新 policy/business 单元测试，最后执行 | 139 passed / 0 failed / 0 skipped |
| shared 全部五个测试文件 | 222 passed / 0 failed / 0 skipped |
| shared typecheck，加入 client export 后 | exit 0 |
| V1.1 SHA256SUMS 清单 | 本轮只读验证原件摘要；不重写原政策 |
| DB/API/worker 集成、实际发布包 | 本代理 NOT_RUN，由总控另收证据 |
| 真实资金、送达、专业/餐厅签收 | NOT_RUN / 保持未批准 |

完整共享测试发现新增 policy 类型与 client 的 PrelaunchDocument 导出重名；只将本代理新类型改名为 PrelaunchPolicySourceDocument，重跑 typecheck 和新测试通过。旧接口不改。

## 契约与证据边界

所有函数输入来自受控 server adapter：原 acceptedAt、渠道可信完整成功事实、订单 F/D 快照、具体桌及成员状态、事务序号和供给事实。纯函数不访问 DB/API/网络/配置/系统当前时间，也不能把输入 booleans 当权限授予。API 必须继续做身份、权限、真实生效序与短事务锁/CAS。

- policy：固定 V1.1 manifest canonical payload SHA、基线全文 SHA、104 rule/15 OP/7 RV 状态及三篇正文全文/原始公开 slice 双摘要；摘要函数由受信服务器注入。禁止 Node crypto 进入共享浏览器公共入口。输出恒为 NOT_ACTIVATABLE；旧 AgreementPolicy、Gate 和 approved 不授予生效。
- money：F+D 一笔，F/D 独立，不包括 M；覆盖 F 优先；D 及上下限、WAITLIST_MAX 无正式默认；供给快照固定版本。退款预算扣除已退和在途/UNKNOWN。
- qualification：绝对 10 分钟，UNKNOWN 到期释放但恢复继续；过期完整成功记录实收并全退，不恢复席位；恰好 T24 归类、未过计时但跨 T8 均 OP05。
- cancellation：按原 acceptedAt/current table/category/reason；未成团等号全覆盖，当前成团 >24h 的 D=PLATFORM_RETAINED、accountingRevenue=null。例外拒绝回原权益不恢复成员；成员移除时点单独 OP04。
- formation/access：min 决定成团、target 为偏好；失败桌不复活；只有 T24 有效成团历史可 T24—T8 直接补招；低人数 T8 保留餐厅决定，OP07/RV03。只给本人有效正式桌即时地址，失效保名藏址。已成团原成员不可重排，可追加 FIFO 新成员；只分未承诺候选。
- waitlist：退出/转正按已授权的 server 事务序号唯一效果；T24 全退义务；上限/未结重报/在途暴露保留 OP08。新 FIFO 尾序只有明确 SIMULATION_ONLY authority 的 harness，不作为真实时钟批准。
- fulfillment：扫码≠餐厅确认；未确认待办≠违约，正常确认仅 D 义务，按活动结束后的上海自然日；异常先平台审核。
- dispute/change/privacy：两轮 48h 分别以各自通知送达为起点；同一个 person 不能用两个账号做两轮复核；复核中不结算。真实送达 OP13/RV02，期限 OP09、材料 OP10、账户与翻案 OP14、注销新报名/终态 OP15 仍阻断。注销请求保留资金和争议责任。

## 正向与候选分列

正向金额/桌位/锁位测试使用明确 TEST_ONLY 金额及合成身份，不填正式 F/D 边界。所有送达定义、变更具体期限和 FIFO authority 测试在 PROPOSAL_HARNESS describe 中；只证明参数化机制，不报告正式商业方案 PASS。原 91 target 的 NOT_RUN 不修改。

## 已确认的剩余风险

1. 纯函数通过不能证明 API 没有伪造 acceptedAt、身份、原价、原桌或原资金预算；要求 R2 集成代码审读和真实 owned PostgreSQL 测试。
2. 供给 flags 只是受控适配器输入，需要实际不同 actor 及 restaurant/activity scope、revision 的证据；不得把 request 的 approved=true 直接传入。
3. 权益未决保持请求/原事实/已有退款义务；返回 blocker 不能删除、悄悄拒收或无限挂款。
4. 历史政策/收款记录隔离与新同意快照必须由 DB/API/前端集成证明；本报告不标整条规则完成。

回滚范围仅上述新增文件及 index 三条 export，由总控按本包改动定位处理；不得 reset/clean 或丢弃其他未提交文件。
