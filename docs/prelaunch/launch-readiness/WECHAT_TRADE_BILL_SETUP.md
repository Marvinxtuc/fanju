# 微信交易账单可信下载

入口：services/api/src/prelaunch/wechat-trade-bill.ts；受控 CLI：services/api/dist/prelaunch/wechat-trade-bill-cli.js。

先校验自然日格式、有效日期和中国时区已结束账期，固定 GET /v3/bill/tradebill?bill_date=YYYY-MM-DD&bill_type=ALL。复用既有商户 RSA 请求签名和平台证书验证，精确原始 UTF-8 元数据验签后解析；不接受未签名、过期、未知 serial 或篡改应答。

元数据必须为 hash_type=SHA1、40位摘要和下载 URL。只允许 https://api.mch.weixin.qq.com/v3/billdownload/file?token=...，拒绝其他域名、路径、userinfo、片段、额外参数或重复 token。下载仍签名，redirect=error。元数据限256KiB、文件流限32MiB，10秒/30秒请求预算；读完文件后校验签名元数据中的 SHA1，并生成独立 SHA256。

无 CSV 解析、事件入库、财务状态改变或 COMPLETE 覆盖声明。返回固定 VERIFIED_BILL_BYTES_ONLY / INCOMPLETE。接口不可用、404、摘要错误、截断和空文件均失败，不能推断零交易。

CLI 需要 FEATURE_V11_BILL_DOWNLOAD=true、WECHAT_PAY_ENABLED=true、真实 payment/refund provider 和既有微信支付私钥/平台证书配置。WECHAT_BILL_ARCHIVE_DIR 必须为绝对路径、仓库外私有目录（0700）；推荐仓库外 ~/.config/fanju/bills。命令示例：

    node services/api/dist/prelaunch/wechat-trade-bill-cli.js YYYY-MM-DD

CLI 只保存账单原始字节和私有验证元数据（0600）。禁止在 Git 内存放；独占创建，不覆盖既有不同字节或不安全文件。原始文件摘要相同允许重试，每次验证元数据单独保存。不输出原文、下载 token、商户号、授权头或密钥。失败日志为固定文本，不打印底层错误。

本轮未调用真实商户接口，也未归档真实账单。8项合成单测使用临时 OpenSSL 自签证书和实际 RSA 签名，测试后清理测试自己生成的临时证书；未新增运行依赖。CLI 缺配置退出1已验证。

下一步仍需 CSV 格式/汇总金额验证、完整账期清单、商户→本地反向枚举、本地→渠道交叉核对，以及实际商户账单验收。字节下载成功不能代替这些门禁。

回滚：不启用 FEATURE_V11_BILL_DOWNLOAD；删除新增三个账单模块，恢复 backups/L04-bill-download/providers.ts 的导出变化。保留仓库外已有财务档案，不删除数据。

官方来源（2026-10-01现场读取，固定SDK提交1dab7bec717989e4a4f006d2469c3eebe9eabba7）：

- https://github.com/wechatpay-apiv3/wechatpay-java/blob/1dab7bec717989e4a4f006d2469c3eebe9eabba7/service/src/main/java/com/wechat/pay/java/service/billdownload/BillDownloadService.java — GET交易账单/日期/ALL参数。
- https://github.com/wechatpay-apiv3/wechatpay-java/blob/1dab7bec717989e4a4f006d2469c3eebe9eabba7/service/src/main/java/com/wechat/pay/java/service/billdownload/BillDownloadServiceExtension.java — 下载后消费文件流并验证摘要。
- https://github.com/wechatpay-apiv3/wechatpay-java/blob/1dab7bec717989e4a4f006d2469c3eebe9eabba7/service/src/main/java/com/wechat/pay/java/service/billdownload/model/QueryBillEntity.java — hash_type/hash_value/download_url，URL五分钟有效，摘要针对原始未压缩账单。本模块未请求gzip。
- https://github.com/wechatpay-apiv3/wechatpay-java/blob/1dab7bec717989e4a4f006d2469c3eebe9eabba7/service/src/main/java/com/wechat/pay/java/service/billdownload/model/HashType.java — SHA1枚举。

官方PHP仓库的历史V2 ALL CSV夹具仅作为格式线索读取，未复制用户标识/商户数据到本仓库，也未当作当前V3解析验收证据。
