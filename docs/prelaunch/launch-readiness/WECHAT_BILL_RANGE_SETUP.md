# 明确日期范围的账单覆盖检查

新模块 wechat-bill-range.ts 与 operator CLI wechat-bill-range-cli.ts。只读检查，不下载渠道账单、不写资金/审计、不批准发布。

输入必须提供当前微信渠道绑定、releaseVersion、开始日期和结束日期。严格日期校验，范围为1至366个自然日；跨月及闰年按UTC日期枚举（账单日标签本身仍指中国时区自然日）。不能只查末日、总次数或最后水位。

每个账单比较快照现在在审计metadata内保存当次数据库 decisionOrdinal 的精确字符串。其值从事务内更新后的 ReconciliationBatch 读取，连同事件、case、job和审计提交。后续同文件的新快照不会改写旧审计中的序号。比较版本升为 v11-bill-snapshot-3，旧run UUID不在新版本中重新解释。

范围检查以该商户/应用scope每日最新序号的快照为依据，再检查完整绑定、当前release和比较版本。较新的不兼容版本不会回退到旧兼容结果；重复序号、未知排序、错误scope/status或声称COMPLETE的非预期材料均不会被识别为有效观察。

状态：
- MISSING：该日期无scope证据。
- UNSUPPORTED_ORDERING：历史证据没有可验证序号；不猜测排序，不用createdAt替代，也不篡改旧审计补序号。
- AMBIGUOUS_ORDERING：最高序号不唯一。
- VERSION_MISMATCH：最新观察与当前release/config/比较版本不符。
- INVALID_EVIDENCE：快照字段、计数或范围声明不符合当前契约。
- INCOMPLETE：存在当前兼容观察，但仍不能证明完整对账/差异闭环。

observedDays只统计当前兼容的INCOMPLETE观察。即使expectedDays全部有记录，overall coverageState仍INCOMPLETE、releaseAuthorized=false。该检查尚未替代生产/ready中的既有检查；完整发布范围及真实商户接受标准仍待装配。

显式CLI配置：FEATURE_V11_BILL_RANGE_CHECK=true、DATABASE_URL、RELEASE_VERSION、仓库外微信商户/App绑定配置。命令：

    node services/api/dist/prelaunch/wechat-bill-range-cli.js START_DATE END_DATE

CLI不需要支付私钥即可检查本地数据库证据，只输出日期/状态/差异计数，不输出商户号、交易号、secret或底层错误。缺配置时退出1，不连接数据库。

验证：5条纯单测覆盖闰日、缺日、范围错误、最新不兼容版本不能回退、排序歧义/缺失、伪称完成及scope隔离；owned PostgreSQL账单定向11条含父包装，使用真实提交的审计序号检出缺日，并验证检查不新增审计。

多日顺序下载、数据库审计恢复及失败历史保留已由WECHAT_BILL_RANGE_RUN_SETUP.md说明。仍待单日大文件下载/比较恢复、历史缺序号材料的正式处理、差异实际闭环、连续范围作为生产门禁和真实商户验收。没有伪造COMPLETE证据或关闭上线门禁。

回滚：关闭新增CLI开关；恢复 backups/L04-bill-range/wechat-bill-reconciliation.ts，移除范围模块/CLI/单测及native新增断言。保留旧审计序号和case，不删除资金证据。

2026-10-01 高量历史快照检查：仅查询请求日期和当前商户scope；RepeatableRead事务内按audit ID稳定分页，每页250条，最多保留366个日期的最新证据及排序冲突标记。分页顺序不用于选择最新，仍按decisionOrdinal判定；未知序号、最高序号重复、新版本不兼容继续阻断，不回退旧匹配记录。30秒事务超时只会失败，不返回部分范围成功。owned数据库501条快照实际页大小250/250/1通过，后续页重复及未知序号继续阻断。没有资金写入、差异关闭、完整性授权或真实商户验收。回滚恢复backups/L04-bill-range-paging/wechat-bill-range.ts并移除本次测试段，保留其他改动。
