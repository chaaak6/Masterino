# Masterion Onlyboxes 0.7.1 部署包

此目录用于把 Onlyboxes Console 与 Docker Worker 部署到独立内网 Linux 节点。Masterion 仍运行在 K8s，通过 `https://onlyboxes.internal.bielcrystal.com` 调用 Console。这里固定 Onlyboxes `0.7.1`，不在启动或沙箱执行时访问外部镜像仓库。

## 1. 预先镜像全部产物

发布前，在有公网访问能力的受控构建机完成来源校验、漏洞扫描和摘要记录，并把以下产物镜像到内部仓库：

- Console：`coolfan1024/onlyboxes:0.7.1` → `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/onlyboxes:0.7.1`
- Python 运行时：`ghcr.io/astral-sh/uv:python3.12-bookworm-slim` → `.../onlyboxes-python:python3.12-bookworm-slim`
- Terminal 运行时：`coolfan1024/onlyboxes-runtime:0.7.1-lobehub` → `.../onlyboxes-runtime:0.7.1-lobehub`
- GitHub Release `0.7.1` 中与节点架构匹配的 `onlyboxes-worker-docker` 二进制 → 内部制品库

生产节点只从内部仓库拉取这些产物。部署记录必须保存上游摘要、内部摘要和 Worker 二进制 SHA-256；禁止使用 `latest`。

## 2. 安装 Console

1. 将本目录复制到节点的 `/opt/onlyboxes`，把 Worker 二进制安装为 `/opt/onlyboxes/bin/onlyboxes-worker-docker`。
2. 创建专用用户和持久化目录：`onlyboxes` 用户、`/var/lib/onlyboxes/console`，目录仅允许 root 和服务用户访问。
3. 将 `.env.example` 复制到 `/etc/masterlion/onlyboxes-console.env`，替换所有 `CHANGE_ME`，设置权限为 `root:root 0600`。
4. `CONSOLE_HASH_KEY` 与 Dashboard 密码分别生成；`CONSOLE_JIT_SIGNING_KEY` 使用至少 32 字节随机值。该 JIT 值必须与 K8s Secret 中的 `ONLYBOXES_JIT_SIGNING_KEY` 完全一致。
5. 安装 `masterlion-onlyboxes-console.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload && systemctl enable --now masterlion-onlyboxes-console`。

Compose 只把 HTTP `8089` 和 gRPC `50051` 映射到宿主机回环地址。`CONSOLE_ENABLE_REGISTRATION=false` 禁止 Onlyboxes 自身注册。SQLite 数据保存在 `/var/lib/onlyboxes/console`。

## 3. 配置内部 HTTPS

1. 用内部 CA 为 `onlyboxes.internal.bielcrystal.com` 签发证书。
2. 渲染 `nginx/onlyboxes.conf.template` 中的 `${MASTERLION_EGRESS_CIDR}` 和 `${OPERATIONS_CIDR}`，安装到 Nginx。
3. 让内部 DNS 只解析到专用节点地址，并确保 Masterion Pod 信任内部 CA。
4. 先运行 `nginx -t`，再重新加载 Nginx。

Dashboard 和 REST/MCP API 共用 HTTPS 入口，模板默认仅允许 Masterion 的固定出口 CIDR 与运维网段。Worker 与 Console 位于同一节点，直接通过 `127.0.0.1:50051` gRPC 通信，不对网络暴露 gRPC。

## 4. 注册并启动 Worker

1. 通过受限运维网段登录 Dashboard，创建 `normal` Worker，立即保存只显示一次的 `WORKER_ID` 和 `WORKER_SECRET`。
2. 将 `onlyboxes-worker.env.example` 复制到 `/etc/masterlion/onlyboxes-worker.env`，填入凭据并设为 `root:root 0600`。
3. 预拉取两个内部运行时镜像，确认 Terminal 镜像包含 `python3`、`node`、`npx`/`tsx`、`base64`、`find` 和 `grep`。
4. 安装 `onlyboxes-worker.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload && systemctl enable --now onlyboxes-worker`。
5. 在 Dashboard 确认 Worker 状态为 `online`。

`WORKER_CONSOLE_INSECURE=true` 仅用于同机回环 gRPC；任何跨主机 Worker 都必须在 gRPC 前增加 TLS 网关并移除此设置。

## 5. Masterion 生产配置

仓库的 production ConfigMap 已设置：

```dotenv
SANDBOX_PROVIDER=onlyboxes
ONLYBOXES_BASE_URL=https://onlyboxes.internal.bielcrystal.com
ONLYBOXES_JIT_ISSUER=https://masterlion.bielcrystal.com
AUTH_DISABLE_EMAIL_SIGNUP=1
AUTH_DISABLE_EMAIL_PASSWORD=0
```

在生产 Secret 的外部 env 文件中加入以下值，再通过现有 `deploy.sh --env production create-secret ...` 流程更新 Secret：

```dotenv
ONLYBOXES_JIT_SIGNING_KEY=<与 Console 相同的随机值>
```

默认沿用 Masterion 的 `ONLYBOXES_JIT_TTL_SEC=1800` 和 `ONLYBOXES_LEASE_TTL_SEC=900`。不要把 Dashboard、Worker 或 JIT 密钥写入 ConfigMap、Git 或命令历史。

## 6. 出口隔离

在 Onlyboxes 节点上游防火墙 / 安全组实施默认拒绝公网出口。允许项应精确到目的地址和端口：

- 内部 DNS（TCP/UDP 53）和内部 NTP（UDP 123）
- 明确批准的内网镜像仓库、日志、监控与运维服务
- `masterlion-prd.oss-cn-shenzhen.aliyuncs.com:443`，用于沙箱文件初始化和导出

Docker 会创建自己的 iptables 规则，因此 Docker/UFW 不能作为唯一隔离层。安全边界必须由上游防火墙或云安全组强制执行，并对放行项记录负责人和到期复核时间。

## 7. 备份与恢复

每天对 `/var/lib/onlyboxes/console` 做应用一致性备份，并把加密备份复制到受控备份存储。备份前短暂停止 Console，或使用 SQLite 在线备份能力；至少每季度在隔离节点恢复并验证 Dashboard、Worker 注册信息和访问令牌。密钥配置单独进入企业密钥备份，不与数据库快照存放在同一位置。

## 8. 上线前烟测

完成配置但在实际 rollout 前，依次验证：

- Python、JavaScript 和 Shell 命令执行
- 同一会话内的文件写入、读取和状态保持
- 从 Masterion 上传文件完成沙箱初始化
- 生成文件并通过 Aliyun OSS 预签名 URL 导出
- 停止 Worker 后，Masterion 返回明确的 Worker 离线错误
- 临时使用不匹配的 JIT 签名密钥后，Masterion 返回明确的认证 / 签名错误；测试后立即恢复正确密钥
- Onlyboxes Dashboard 无法注册新账号，公网无法访问 Console HTTP/gRPC，沙箱无法访问未放行的公网地址

本部署包不会自动构建镜像、修改防火墙或执行 K8s/Onlyboxes rollout；这些步骤必须在发布确认后由运维流程执行。
