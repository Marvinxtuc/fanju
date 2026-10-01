# EXTERNAL_DEPENDENCIES

Candidate: `c7aac17812c1b7708f3397638451533f423898315f558e5a864b04475f08e699`

本地使用已有锁定依赖，未新增生产依赖、未执行网络安装。微信身份、手机号、支付、退款、真实通知、餐厅转账均未接入或执行；模拟渠道成功仅是持久 synthetic fact。WeChat DevTools/真机、正式商户配置和政策剩余 OP/RV 输入必须单独完成。跨机器 frozen-lockfile 安装没有验证，不将本机依赖复用构建描述为全新环境可重复安装。



此报告不将总测试结果自动推导为业务验收；逐条结论见 COVERAGE_LEDGER.json 和 EVIDENCE_INDEX.json。
