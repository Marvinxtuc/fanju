# R1 用户端/运营端最终候选独立复核（2026-10-01）

审查对象：`/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局` 实际root源码；主控已导入USR06/客服/金额与退款展示、USR08软tie、closure和合同版本修复。此报告不是最终候选全量runner结果，不替代candidate hash绑定。下列执行结果明确区分本人隔离验证与主控报告。

## 发现与整改

发现一个实际客户端缺陷：`createPrelaunchClient.list` 原先每个请求校验自己的session，但整个分页旅程未绑定初始token。第一页请求校验完成后、list恢复前session发生变化时，第二页使用新账号token，返回拼接两账号资料。用实际microtask调度在隔离镜像复现：旧代码新增用例失败并返回first-user-row与second-user-row。最小整改在`ui-session-list/MANIFEST.json`：绑定initialToken，每页发起前及响应后检查，变化抛SESSION_CHANGED、不发第二账号分页、不清新session。修复后17个实际client用例与shared typecheck通过。主控导入和最终回归结果待其执行，不把草稿修复当目标候选已通过。

## 关键只读复核

- USR06/07：`routes.ts:53` 内部统计只OPS/REVIEWER，查询enabled USER关联资料只select availableTimes，返回固定时段匿名计数；不返回账号、手机号、gender或未知自由文本。重复账号指向同user不会重复计profile，单profile重复同code最多计一次。
- `routes.ts:54` activities仅本人USER session读取availableTimes，未登录不读取profile；原ID分页/活动集合保留，仅添加匹配boolean。`miniapp index.tsx:46` api.list收全页后按boolean稳定排序，匹配跨分页优先，其他活动不丢，空偏好原序。时间偏好不出现在registration资格判定或排桌条件。未知历史偏好不匹配且不触发准入拒绝；运营只计未知资料数不泄露文本。
- USR08：`domain.ts:98—120` 先选合法容量/截止/桌状态候选，再只在与原策略first相同占用人数的候选里内部soft tie；未知incoming/历史gender直接回原ordinal。软目标不要求1:1，不增加成团最低人数限制，审计只有动作/桌ID，没有公开gender比例。
- `domain.ts:127—145` promoteWaitlist仍按queueOrdinal/id遍历，先取当前候补再给该人分桌；软tie没有按gender重新选择候补，也没有跳过排在前面的有效候补。正式FIFO时钟仍OP-05，合成事务序号不是正式批准。
- closure：createRight与createRegistration都锁同User行；CLOSURE非RESOLVED即阻止新报名，既有session及订单恢复路径保留。processRight同User锁检查有效报名、未确认退款、未关闭争议/结算及已收D未处置余额；只登记OBLIGATIONS_PENDING或BLOCKED_POLICY，不伪装注销完成/删除资金事实。正式权利删除与保存期仍OP-15/RV-05。
- contract：服务端v11写操作（含login）缺/错header409；GET无header可用，显式错误版本拒绝，OPTIONS不被写guard阻断。客户端transport带正确header，拒legacy envelope、过期session只清原token；上述分页竞争已提出最小修复。

## 行为与证据范围

| 项目 | 已验证内容 | 保留边界 |
|---|---|---|
| PRE023 | 本次新response授权、FORMED详细地址、INVALIDATED名称保留、失败/刷新先清旧详情；独立DOM缓存用例 | 已展示历史地址不能物理撤回；不证明微信真机缓存 |
| PRE038 | 写版本guard及客户端legacy响应拒绝 | 最终同candidate结果由主控绑定 |
| PRE040/041 | 主控报告targeted joint wrapper通过/inner2通过：owned实际HTTP、React DOM重新挂载清cache明确重登录找回同报名，消息列表专用query500时订单/详情/F/D仍可查，不自动receive、receivedAt不变 | 通知专用查询故障非整库故障；非换物理设备、微信杀进程、原生支付弹窗、实际支付成功 |
| PRE042 | HTTP restaurant actor初始未绑定，ops绑定API后重登录，不再SQL补restaurant scope | 基础合成actor fixture仍是前置；真实账号供应/整场真机旅程未证明 |
| BR09/54 | 本人隔离12 DOM用例通过，其中F+D合计不含预计M；WAITING_BATCH及UNKNOWN只显示待处理，不称到账 | 不证明真实渠道退款到账 |
| BR52/OPS01 | 实际page显示小程序客服10:00—22:00、无固定首响、回复不改受理业务时钟，明确本地未接通真实客服，无电话企微 | 真实客服入口配置与排班可用性仍外部门禁 |
| USR06 | 本人隔离API/ops/mini三typecheck与12 DOM通过；native2源码已交主控，含显式合成匹配/非匹配活动及统计delta/角色 | 最终owned native执行结果以主控证据为准 |

React DOM用例显式适配Taro原生组件/storage/request桥；联合HTTP旅程业务响应实际来自owned API，不使用伪业务response。weapp编译属于编译证据，不等于微信真机。nested DOM2不再与父wrapper重复累计。joint元数据已补实际node/packageManager，每次执行独立flat `evidence/http-dom-${prefix}/`日志/JSON/RUNS，不覆写历史；FINAL_CANDIDATE仅绑定实际执行源码hash，最终总数由主控去重。

本轮未改正式政策、收费渠道、真实客服、部署、Git或真实私密资料。除分页session修复待导入/最终回归外，本次所查USR06/USR08/closure/contract路径未发现额外必须改动的问题。

最终runner扫描识别新增测试长合成token字面量。最小修复ui-synthetic-token/MANIFEST.json仅将`synthetic-second-session`改为`synthetic-second`，不修改扫描器、不放宽规则、不改变session竞争用例语义。草稿待冻结结束后主控导入重跑扫描。


主任务最终运行核验：候选 c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699，final-2026-10-01T01-37-23-796Z 全部28记录PASS，109原生进程断言/12组件；source-reproduction-2026-10-01T01-39-27-139Z PASS；实际ZIP解包 zip-proof-20261001T020213632529Z 包内checker/CRC/1590文件摘要与同source构建及四suite PASS。R1/R2镜像/源码审阅与此主任务实际runtime角色分开。首次沙盒构建超时保留于evidence/zip-timeout-history，不继承为最终通过，也不隐藏。正式OP/RV、真实接口、外部签字和生产禁令不由本地PASS自动解除。
