# 不可变政策材料归档

2026-10-01：独立 V11PolicyMaterialArchive 表与 createFormalPolicyArchive 内部接缝，未挂载上传/启用/收费路由，也不替代 V11PolicySnapshot。表仅允许 MATERIAL_ONLY；不存在 ACTIVE 状态或审批字段。材料、发布摘要和附件实际语义仍须独立核验。

archive 在既有材料校验后，事务共享锁定实际 V11Actor，重新核对 enabled/role/personId/version/userId/restaurantId；仅 OPS/REVIEWER 可操作。调用方须先验证正式会话，此内部接缝本身不验证JWT或颁发角色。按材料摘要加锁，原始JSON字节完整保存，归档与审计一起提交；重试返回同一归档。相同 bundleId/version/releaseVersion 不允许改用新摘要替换。原附件只引用摘要、不复制进归档表。

read 重新核对当前角色、发布摘要、材料字节和附件摘要，返回公开正文投影。它仍固定 activation=NOT_ASSESSED、releaseAuthorized=false。没有正式业务/用户同意或支付授权作用。

数据库触发器拒绝普通 UPDATE/DELETE，提交者FK限制删除；不宣称可抵御数据库超级用户拆表/改触发器等管理操作。未来内容变更应新版本、新摘要、新归档；不得覆盖历史版本。

增量迁移20261001050000_v11_policy_material_archive只加表/索引/触发器，不改原政策、订单、资金或同意记录。已在owned合成PostgreSQL部署并验证，新增表不产生生产接入。19条迁移fresh deploy/status/schema diff通过；历史合成退款/账本/事件/任务逐字段保留的升级演练通过。

7项定向PostgreSQL测试通过，包括10并发幂等、读时重验、不可变约束、同名发布替换拒绝、审计故障回滚、角色/版本撤销和停用。完整回归及实际归档行备份恢复另附证据。

无新增依赖。尚未部署时可移除新增源/测试和迁移并从backups/L05-material-archive/schema.prisma恢复本次前schema；已有用户工作保留。若未来已部署，回退应用装配但保留扩展表、原记录和迁移历史，不用DROP/TRUNCATE回滚。任何表删除另需先证明为空、备份和依赖情况；本任务未执行删除或生产迁移。
