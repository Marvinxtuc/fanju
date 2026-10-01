# 正式客户端构建隔离

2026-10-01。原BUILD_ARTIFACT_MANIFEST是启用本地验收工作区的工程产物，不能直接作为正式发布客户端。

```sh
node scripts/prelaunch-clean-build.mjs OWNED_SCRATCH HTTPS_API_ORIGIN
```

继续使用既有owned环境校验及锁定依赖。第二参数必须是规范HTTPS origin，不含凭证、端口、路径、query或fragment；拒绝IP、localhost及保留的本地/测试域后缀。仅验证URL结构，不证明DNS、域名归属、备案、TLS或微信域名白名单。

指定origin后在新独立构建目录，从当前候选源码重建shared/API/ops/weapp；关闭两端演示及prelaunch标志，并将两端API地址固定为该origin。小程序只在明确启用preview时将pages/prelaunch/index加入路由。既有微信登录页面保留，页面名称mock-auth不代表真实登录入口可删除。

生成FORMAL_CLIENT_BUILD_MANIFEST，独立记录candidate、构建文件摘要与产物检查。不会覆盖本地验收BUILD_ARTIFACT_MANIFEST。API编译产物仍须正式运行环境配置与业务授权，不能因客户端构建成功直接部署。

产物检查使用生成后的Vite入口在禁止网络的jsdom中验证预览query只能看到认证入口；验证小程序app.json及文件中不存在preview页面、产物中包含指定origin。最终回归新增formal-client-build步骤，使用https://api.synthetic-fanju.cn合成域名；不进行域名请求。该验证和manifest均为ENGINEERING_ONLY，没有真实域名、真机或发布授权。

定向构建的5个编译步骤及产物断言通过。正式业务入口、真实API/域名、微信真机与生产验收仍待完成。没有部署、上传小程序或Git操作。

回滚备份：backups/L06-formal-client-build/。按本切片diff恢复app.config及两份构建脚本，保留其他工作；停止使用新增正式manifest。构建产物位于owned scratch，未覆盖原有源码或原ZIP。
