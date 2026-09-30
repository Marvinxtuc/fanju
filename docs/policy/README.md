# 饭局V1.0政策包｜阅读、导入与授权边界

| 项目 | 当前事实 |
| :--- | :--- |
| 政策包版本 | FJ-POLICY-V1.0-20260930-REBASE-01 |
| 上游基线 | FJ-BUSINESS-BASELINE-20260930-V1.0；原文未修改 |
| 原基线SHA-256 | `48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187` |
| 五份派生文件 | REBASED_DRAFT；已对齐文字，未批准发布、未设生效日 |
| 已完成范围 | 六文件组装、规则映射、文档检查及本地Codex交接材料 |
| 工作区接入 | 首次连接和按用户要求重试均返回HTTP 404；未读到最新本地源码 |
| 远端只读核对 | 开发分支bc25f5b；main c0b5a9f；不是清单报告的本地整改版本 |
| 仓库导入 / 代码Gap / 代码开发 | 未执行 / 未执行 / 未执行 |
| 生产、真实微信和资金 | 本轮不授权，也未执行 |

## 1. 六份主文件

| 层级 | 文件 | 用途 |
| :--- | :--- | :--- |
| 业务来源 | [BUSINESS_RULES_BASELINE.md](BUSINESS_RULES_BASELINE.md) | 本轮100项问答归并，保留104个显式规则ID及未闭合表 |
| 用户政策 | [USER_AGREEMENT.md](USER_AGREEMENT.md) | 用户完整条款草案、付款前提示与正文范围 |
| 用户政策 | [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) | 最小资料、实际共享、证明材料、留存与注销流程要求 |
| 餐厅履约 | [RESTAURANT_SERVICE_STANDARD.md](RESTAURANT_SERVICE_STANDARD.md) | 逐场参数、签收、到场确认、异常与补偿责任 |
| 资金政策 | [REFUND_POLICY.md](REFUND_POLICY.md) | F/D分项、窗口、责任、申诉、原路与批次 |
| 实施证据 | [POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md](POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md) | 30核对域、104规则目录、64原场景和12新增跨模块场景、候选工作包 |

建议先读基线第1、10、17节，再按退款→餐厅→隐私→用户协议→实施矩阵阅读。源码、PRD和AGENTS用于核实现状和工程约束，不因业务基线“优先”而被自动覆写。

本包不更改上游基线原文字节。基线的“当次未修订五文档”“建议归档路径”等历史交付说明依然保留；本README记录此次新增工作。原基线状态也没有被悄悄改成Approved。

## 2. 配套材料不是新增经营政策

| 文件 | 用法 |
| :--- | :--- |
| [POLICY_REBASE_CHANGELOG.md](POLICY_REBASE_CHANGELOG.md) | 五份旧稿到本版的实质变化、继承项与输入哈希 |
| [OPEN_DECISION_REVIEW.md](OPEN_DECISION_REVIEW.md) | 原样保留15个OP和7个RV；按少量评审包处理，不再开启100题问答 |
| [CODEX_NEXT_TASK.md](CODEX_NEXT_TASK.md) | 本地可执行的文档导入、实际代码差分和候选设计任务；完成后停止 |
| [CONSISTENCY_REPORT.md](CONSISTENCY_REPORT.md) | 本次实际文档检查结果及不能据此证明的事项 |
| [TRACEABILITY_INDEX.json](TRACEABILITY_INDEX.json) | 机器可读规则/测试定位索引，**不是运行配置或Schema** |
| [sources/REFERENCE_NOTES.md](sources/REFERENCE_NOTES.md) | 来源、历史版本及专项复核参考；不替代人工批准 |

原`START_HERE.md`里的D01—D16和旧IA/QA-P编号仅作历史材料，不是本轮重新收集业务决定的入口。本包不覆盖用户下载目录中的旧原件；导入仓库前须先审查已有同名文件。旧安全、幂等、对账、恢复测试不能因政策升版而删除。

## 3. 对齐的含义与限制

已明确业务采用同一口径；确实未决的事项在六文件中保持未决。**文档之间无相反的已批准答案，不等于所有交集已经有答案。**不允许删除OP/RV提示后把草案直接展示给用户；应先补批准决定并升版。

尤其保留：服务费金额及定价方式待定；T-24h至T-8h成团失效、曾成团后待成团者取消、未成团取消的两个等号、候补竞争、特殊申诉和多类审核时限、实际补偿结算等。成团后=24h的D归餐厅是明确决定，不能和其他未签收等号混淆。

三份用户文本中PUBLIC_DRAFT标记只划定候选正文；**不应包含内部任务、证据表或评审材料对外发布**。当前候选正文也因待定项尚不可启用。版本绑定应保留三份全文及其映射，不能把隐私处理都塞进一项捆绑同意。

## 4. 继续推进的最小动作

本地Codex读取[下一轮任务](CODEX_NEXT_TASK.md)，先核对工作区与包哈希；确认没有文档冲突后导入`docs/policy/`，再对实际代码只读分析，交回四份文档。无需先把全部OP答完才能定位代码；但相关实现及真实资金启用必须等对应审批。

本轮可进行文档导入、只读差分与候选设计。**不能据本包直接修改业务代码、Schema、状态机、依赖、部署或执行数据库脚本；不得调用真实微信、处理真实资金、提交/推送Git。**如AGENTS规定更严格的写入范围，按更严格边界报告阻塞。后续每个代码工作包单独授权。

## 5. 下一道验收

本地交回`POLICY_GAP_ANALYSIS.md`、`POLICY_DECISION_PROPOSALS.md`、`POLICY_TECH_DESIGN.md`、`POLICY_WORK_PACKAGES.md`。审核其真实定位、金额/状态一致性、OP/RV处理、迁移兼容和最小首包，再批准实施。没有本地证据时不得出具“全部已实现”。
