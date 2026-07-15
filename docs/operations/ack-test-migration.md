# MasterLion 测试环境部署至 ACK

目标为深圳 ACK 集群 `c23ea84b986c446d5b3fa9227962e77f4`、Namespace
`masterlion-test` 和域名 `mlai-test.bielcrystal.com`。测试环境默认使用全新的 PostgreSQL
与 Redis；旧数据库迁移和旧 COS 附件迁移均为可选操作。

## 1. 连接与保护参数

使用仓库外 kubeconfig，并显式指定 context 和 API Server：

```bash
export KUBECONFIG=/secure/path/masterlion-test-ack-c23ea84b.yaml
export ACK_CONTEXT=ack-c23ea84b-masterlion-test
export ACK_API_SERVER=https://example-api-server:6443

export MASTERLION_IMAGE_DIGEST=sha256:<64-hex-digest>
export BRIDGE_IMAGE_DIGEST=sha256:<64-hex-digest>

bash ./deploy.sh --env test preflight
bash ./deploy.sh --env test validate
```

脚本会核对 context、API Server、节点地域和 Namespace 中的 Cluster ID 标注。任一项不匹配
都会立即退出。

## 2. 集群准备

1. 确认至少有 4 vCPU、8 GiB 可调度资源，节点处于 Ready。
2. 确认云盘 CSI 和 `nginx` IngressClass 可用。
3. 执行 `bash ./deploy.sh --env test bootstrap`，创建 Namespace 和 Retain StorageClass。
4. 在测试 Namespace 中单独准备通配符 TLS Secret 和 ACR imagePullSecret。
5. `masterlion-test` OSS Bucket、RAM 用户和 CORS 必须与生产环境隔离。

## 3. Secret

复制以下模板并填写真实值，文件已被 Git 忽略：

```bash
cp k8s/overlays/test/secret.env.example k8s/overlays/test/secret.env
cp k8s/overlays/test/bridge-secret.env.example k8s/overlays/test/bridge-secret.env
bash ./deploy.sh --env test create-secret
```

`KEY_VAULTS_SECRET`、`AUTH_SECRET` 和 `JWKS_KEY` 可继续沿用旧测试环境值。
`AIHUB_READONLY_DATABASE_URL` 只能存在于 Bridge Secret。测试环境默认关闭第三方联网搜索，
因此不需要 Bocha API Key。

## 4. 全新数据库部署

```bash
bash ./deploy.sh --env test deploy
bash ./deploy.sh --env test rollout
```

此时 PostgreSQL、Redis 和 Aihub DB Bridge 运行，MasterLion 保持 0 副本。检查 PostgreSQL
同时提供 `vector` 与 `pg_search` 扩展。确认数据库与 OSS 配置正确后启动应用：

```bash
CONFIRM_DATABASE_READY=masterlion-test bash ./deploy.sh --env test start
```

MasterLion 首次启动会执行应用数据库 migration。migration 或 rollout 失败时不要修改 DNS。

## 5. 验收与切换

1. 先用 port-forward 或 hosts 验证登录、SSO、Aihub 权限、模型调用和流式响应。
2. 验证新文件上传下载、embedding 和 100 MB 上传。
3. 确认浏览器中不存在 Aihub 管理 Token、数据库地址或 OSS 密钥。
4. 验证通过后，将 `mlai-test.bielcrystal.com` 指向新 Ingress 地址。

全新数据库不会包含旧用户、会话、Agent、知识库、记忆或历史附件记录。若以后决定恢复旧数据，
可在应用保持 0 副本时使用 `scripts/migrateTestToAck.sh` 执行可选的 dump/restore 流程。

## 6. 回滚

- DNS 切换前失败：不修改 DNS，MasterLion 保持 0 副本。
- DNS 切换后失败：执行 `bash ./deploy.sh --env test stop` 并回切 DNS。
- 不自动删除 Namespace、PVC、云盘、旧服务器或旧 COS；清理必须单独审批。
