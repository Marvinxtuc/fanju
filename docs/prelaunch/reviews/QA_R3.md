# R3：安全与恢复复核

审核对象：FJ-PRELAUNCH-MASTER-V1.1-20261001-01 本地合成工程；QA agent 复核，不作为政策、真实渠道或独立外部评审批准。工作仅制作 /tmp 草稿，目标导入和真实 native 验证由 root 执行。

已发现并整改的工程问题：

- `services/api/src/prelaunch/routes.ts:35` 把 Fastify parse/body-size 错误交给通用 errorResponse，原先将400/413变成500。当前 `contracts.ts:24` 只保存已知 Fastify code 的可信400/413/415，不采用任意error.statusCode；仍不返回stack。API agent 已提供 native HTTP 回归。最终候选具体结果以同candidate原生日志为准。
- secret扫描把 frozen policy 中SHA数字片段当手机号。`scripts/check-secrets.ts:76` 和 `secret-scan-digest.mjs`只豁免整个phone匹配落在独立完整64hex token内的情形；63hex、65hex、非hex/underscore邻接、普通字母邻接、hash外独立phone均不豁免。`tests/prelaunch/secret-scan.test.mjs`同时检查helper和实际CLI，不输出测试phone值。未改政策原文、未排除整个文件。
- synthetic备份包含public schema而新恢复库已经存在public。`scripts/prelaunch-recovery.mjs:45`要求唯一SCHEMA-public TOC项，注释这一项；其余schema对象/数据/约束仍由 `--exit-on-error`恢复。新generation保留旧库，禁止用drop或忽略所有错误处理。

确认的防线：`domain.ts:23`在当前RUNNING/generation/owner/leaseUntil条件下锁DurableJob行，随后事务内业务效果才可继续；不是只在finish时检查围栏。`worker.ts:55`明确kind allowlist；compat consumer是起始272源码加当前旧worker allowlist的受控兼容修补，不能称完全未改旧版本。实际测试须证明旧DELIVER_INBOX完成而未知kind和真实V11_REFUND保持READY/attempts0/generation0，NEW退款instruction及F/D 600/10000保持完整。

恢复证据分层：backup/restore脚本的table-content digest只证明合成public schema恢复。`restore-reconciliation.test.mjs`另在备份后制造渠道成功与隐私纠正，恢复后从独立渠道库发现事实、保持失效席位、建立全退义务、重放原privacy disposition ID/time，再次执行无重复。`http-journey-recovery.test.mjs`在CHANNEL_SUCCEEDED_BEFORE_LOCAL_ACK确定性barrier杀付款/退款worker并重启，验证两次窗口；这不是随机杀进程后观察ready。上述证据不证明真实微信网络、灾备基础设施或任意规模灾难恢复。

已知边界：正式取消/批次小时/未决默认裁定/retention/结算细则继续由OP/RV阻断；必须保留受理和资金义务，不能发明默认退款裁定。source-only复现只验证完整交付清单与显式相同lockfile依赖复用，不证明异机fresh安装。DOM不证明真实微信控件与完整UI→API闭环。结构checker只能检验schema与hash链接。

root反馈上一候选 `final-2026-10-01T00-59-17-877Z` 全部通过，唯一测试口径453（225shared、160API、21miniapp、15ops、5miniDOM、27Node；A1 52已含shared）。这是root观察的原生结果；新增legacy/source-repro导致候选变化后必须重新取完整同candidate证据，不沿用此数字为新候选PASS。R3整改可追溯，最终关闭仍以root最终RUNS/hash与覆盖台账为准。


最终候选前更新（2026-10-01）：完整台账保留104条规则、139个场景、24项任务与19项正式政策/评审依赖。新增真实缺口USR06（本人时间偏好优先展示及匿名需求统计）与USR08（仅合法等填充候选桌软目标tie，不影响硬容量/FIFO）已有源实现和精确native测试引用；不能继续保留旧“未实现”结论。PRE035渠道账单/逐笔查询不可用测试验证拒绝完成，不能返回成功零差异；BR59通过HTTP供给修订与独立合成新政策验证旧注册、同意、供给、政策、支付原行保持不变。上述新增证据等待最终同candidate日志，不沿用历史PASS。

取消与截止覆盖新增9个参数分支（普通未成团/成团、晚报名、24h/8h等号）、候补主动退出/T24全退、当前INVALIDATED取消、T24最低人数/失败不复活、T20补招、T8关闭及晚到款；直接DB事务内受控clock替身保留真实row locks与持久化，但不是系统墙钟等候测试。正式移除OP04、边界资格OP05、晚窗餐厅决定OP07保留BLOCKED_POLICY，不以未决审批掩盖已定款项计算或保护原成员的验证。新增履约上午/跨上海午夜与特批午夜前、特批三方案、通知CREATED/SENT缺收到凭据不启不利clock、完整可信receipt准入与多个receipt原F/D预算均应单列最终标题。

剩余完成条件：所有最新源的完整同candidate原生检查及构建、R1–R4修订与真实剩余语义缺口核对、最终报告candidate/evidence绑定、TASK_STATUS与EXECUTION_STATE一致，以及ZIP完整清单/哈希/解包结构复核。文件/哈希一致性不作为139个场景语义通过证明；真实微信/渠道/异机fresh依赖安装等保持明确外部边界。


冻结前最终整改核查：PRE034专项审阅发现已结算D翻案原先只拒绝复用余额，却没有纠正来源/追回义务记录，属于真实可修工程缺口。当前`aftersales.ts`决策分支在COMPLETED RESTAURANT D处置后生成唯一SETTLED_DEPOSIT_CORRECTION：保留原component/receipt/amount/sourceRef，记录userRefundObligationCents及可适用F义务，correctionFundingSource/recoveryResponsibility为UNRESOLVED，originalDepositReusable=false，状态BLOCKED_POLICY/OP14+RV06；原disposition不变，不发起重复原D退款。新专项native还断言重试唯一请求、无重复退款instruction和channel退款。实际test PASS仍等最终同candidate运行。PRE042现已在同fresh-empty库通过HTTP/独立worker构成4人团、扫码、正常与异常履约、通知签收、不同person两轮复核、D批次确认、原渠道流水和F/D资金守恒/对账；只加速合成活动时间与job.runAt，不注入资金/资格/争议状态。

最新候选曾因shared client新增合成session-token fixture触发secret扫描，root/UI已准备缩短fixture字符串；不会削弱scanner或读真实凭证。该失败不能被构建/其他PASS覆盖；source变化后须重新freeze/full final。binder逐具体native JSON/TAP title核PASS，JSON title还需与hash核验原生verbose stdout一致；source/copy/build由各条明确源码hash审阅和专项run证据支持。TASK completion只在作用域审阅hash、required run与特定acceptance IDs共同满足后产生，不用汇总测试数推断。


最终原生复核结论（当前已实跑，c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699）：`final-2026-10-01T01-37-23-796Z`完整28项run全PASS/exit0，原生测试543＝shared226＋API160＋mini21＋ops15＋ReactDOM12＋Node109。旧A1 dedicated52已在shared226内，不能重复相加；joint实际HTTP+DOM内层2单列且counts_toward_final_total=false。该数字是原生测试口径，不能说成543唯一业务场景；104规则/139场景语义另以逐条source审阅及exact title/hash证据绑定。

`source-reproduction-2026-10-01T01-39-27-139Z`同candidate独立source-only复现PASS/exit0：generate、shared/API/ops/weapp四build及shared226/mini21/ops15/DOM12重跑、实际ops产物可见性PASS。复现明确同lockfile现有依赖复用、无Git、无network/install、新DBruntime；未声称异机安装。controlledcompat inner1经parentwrapper显式link，保留原ENGINEERING_PROGRESS_NOT_FINAL provenance；candidate前后/hash/完整源码snapshot/consumerallowlist/toolchain来源/TAP0fail0skip0todo已验证后加入FINAL_COMPAT_DETAILS。

QA binder v8逐具体native JSON/TAP标题、源码SHA独立API/UI审阅、专项copy/buildrun绑定，目前104规则本地验证PASS，138场景本地验证PASS，23任务COMPLETED；PRE048/E23等待实际ZIP提取/CRC/逐字节清单与extractedsource复现，未提前标ZIP通过。所有19项正式政策/评审依赖与真实渠道门禁另保留；如BR35只证明OP07保护分支，不能把真实餐厅正向决定标已获批准。INFO02源/DOM/P2/member proof只保证后续隐藏地址，用户已知/记住/截图地址不可物理撤回。无已观测未修本地代码缺陷，最终交付仍待ZIP实际证据收口。


## Actual ZIP closure and final v9 binding

Same frozen candidate `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`: actual `zip-proof-20261001T020213632529Z-zip-verification` and `zip-proof-20261001T020213632529Z-source-reproduction` both PASS/exit0. Safe extraction, ZIP CRC,1590 file size/hash checks and package-contained checker passed. Extracted source generation, shared/API/ops/weapp builds, shared226/mini21/ops15/DOM12 native cases and generated artifact visibility passed. Checker remains structure/hash evidence only. Dependencies reused only after identical-lockfile verification; no fresh-machine install or DB-runtime recreation claim. Initial sandbox weapp360s timeout was preserved under zip-timeout-history; owner process group termination and elevated unchanged-source retry are recorded, not hidden.

v9 exact runtime/source scope binding:104/104 rules local PASS;139/139 scenarios local PASS;24/24 tasks COMPLETED;0 local FAIL,0 local NOT_RUN,0 remaining local acceptance gaps.1146 observed runtime title records include repeat source reproductions; this is not the final native count (543), nor unique business scenario count. Formal overall gates remain separate:19 OP/RV blockers retain specific input residuals/signoff requirements. Final exporter must recheck final metadata-containing ZIP bytes and manifest links; these changes do not change source candidate.


Final v10 correction: EXC-02 now links exact observed BR46/BR47 REFUND_D, REFUND_FD and REJECT native titles plus private exception non-reflection unit title, secret scan and API typecheck. Its source review is limited to strict synthetic material adapter (four reason codes, optional trimmed1..1000 syntheticEvidence, owner scope, SYNTHETIC_ONLY and OP10/RV05 blockers, realMaterialCollectionEnabled=false); no real medical/material upload approval or implementation claim. Every local PASS row has native evidence IDs. Stale prior gap/result labels preserved under historical fields and current review_status corrected. Counts remain104/139/24 with0 local remaining.
