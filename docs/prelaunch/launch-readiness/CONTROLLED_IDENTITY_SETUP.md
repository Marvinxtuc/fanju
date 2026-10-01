# 正式身份切片配置说明

状态：代码切片已实现和本地验证；尚未使用真实账号启用，不代表整体V1.1可上线。

## 启用条件

FEATURE_V11_IDENTITY默认关闭。开启需有效真实auth/phone provider、非demo，以及现有正式JWT配置。此切片未启动资金链路、未激活draft policy。旧环境不受默认关闭的新接口影响。

新增接口：GET /api/v11/identity、POST /api/v11/identity/initialize（请求体必须{}）、POST /api/v11/ops/login（username/password）、GET /api/v11/ops/identity。

## 用户绑定

使用现有真实微信登录签发的USER token；initialize仅为已存在User创建USER actor，使用事务锁避免重复，passwordHash标记EXTERNAL_SESSION_ONLY不支持模拟密码登录。禁用或重复绑定不会自动修复或重建。用户personId是不可变本地用户ID引用，不能据此声称强实名或自然人去重。新报名仍使用业务黑名单门禁；身份读取保持既有售后可访问性。

## 运营、复核、餐厅身份

V11_CONTROLLED_ACCOUNTS_JSON通过仓库外安全配置或部署secret注入，不放入repo。每个账号包含accountId、username、accountVersion、enabled、passwordHash、actorId、personId、actorVersion、role、restaurantId。role只允许OPS/REVIEWER/RESTAURANT；餐厅角色必须绑定明确restaurantId，其他角色必须null。accountId/username/actorId各自唯一。账号密码hash使用既有受控管理员hash工具的string-salt编码。正文不含可登录真实账号或hash。

这些账号属于独立V1.1登录体系，不需要创建旧AdminUser或赋予旧OPS角色。令牌aud为fanju-v11-controlled、有效期15分钟；不能访问旧用户/OPS接口，旧令牌也不能冒充此范围。每请求校验issuer/audience/有效期/sessionVersion/accountVersion/actorVersion/账号enabled及数据库personId、role、userId、restaurantId。角色、账号版本或归属改变需同步受控配置，既有令牌会被拒绝。SESSION_REVOKED_SUBJECTS可撤销对应accountId。

业务复核仍按真实已核验personId比较异人，不能把不同登录账号当成不同自然人；具体人员授权由运营实际配置，不自动生成签收。API层限制登录并发和IP/账号尝试，生产多实例入口还需统一限流。身份初始化和受控登录写审计。

## 尚需完成

客户端正式登录、业务API正式装配、受控actor管理与配置更新流程；真实微信新版本联调；资金渠道、政策/通知正式生效、运营及部署条件。以上未由身份切片测试自动通过。
