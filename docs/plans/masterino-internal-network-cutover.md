# Masterino 服务端 OSS 与 Aihub 内网切换计划

> 状态：已于 2026-09-14 实施切换，即时技术验收通过；60 分钟流量观察和真实业务抽检
> 仍需由当班人员完成。目标为 ACK 集群 `c23ea84b986c446d5b3fa9227962e77f4`、
> 地域 `cn-shenzhen`、生产 Namespace `masterlion` 和观测 Namespace
> `masterino-observability`。

## 1. 目标

- 将 ACK 内所有 Masterino 服务端 OSS 访问从公网 Endpoint 切换到深圳同地域内网
  Endpoint，避免不必要的公网流量、费用、时延和公网依赖。
- 保持浏览器预览、下载和签名 URL 使用现有公网域名，不影响客户端文件访问。
- 将 Masterino 到 Aihub 的服务间调用通过 VPC 私有 DNS 路由到用户确认的内网地址
  `10.80.136.84`，同时保留域名、TLS SNI、Host 和 Origin 语义。
- 修复 `onlyboxes.internal.bielcrystal.com` 在生产 Masterino Pod 内无法解析的问题。
- 采用测试先行、私有验证、逐组件滚动、明确回滚的方式实施，不中断客户端聊天。

## 2. 非目标

- 不迁移 OSS Bucket、对象 Key、目录前缀、Region、AccessKey 或加密方式。
- 不把浏览器访问的 `S3_PUBLIC_DOMAIN` 改为内网域名。
- 不重建 Masterino、Langfuse、Market 或 ClickHouse 镜像。
- 不修改数据库结构、业务数据、用户权限或 Aihub 数据。
- 不把 Aihub 和 OSS 切换合并为一个不可拆分的生产变更。

## 3. 已确认现状

### 3.1 OSS 公网链路

| 链路                | 当前 Endpoint                             | 当前解析 / 性质         | 目标 Endpoint                                      |
| ------------------- | ----------------------------------------- | ----------------------- | -------------------------------------------------- |
| Masterino 文件服务  | `https://oss-cn-shenzhen.aliyuncs.com`    | 公网，解析到 `112.74.*` | `https://oss-cn-shenzhen-internal.aliyuncs.com`    |
| Market 对象存储     | `https://s3.oss-cn-shenzhen.aliyuncs.com` | 公网，解析到 `112.74.*` | `https://s3.oss-cn-shenzhen-internal.aliyuncs.com` |
| Langfuse 事件上传   | `https://oss-cn-shenzhen.aliyuncs.com`    | 公网                    | `https://oss-cn-shenzhen-internal.aliyuncs.com`    |
| Langfuse 媒体上传   | `https://oss-cn-shenzhen.aliyuncs.com`    | 公网                    | `https://oss-cn-shenzhen-internal.aliyuncs.com`    |
| Langfuse 批量导出   | `https://oss-cn-shenzhen.aliyuncs.com`    | 公网                    | `https://oss-cn-shenzhen-internal.aliyuncs.com`    |
| ClickHouse 远端备份 | `https://oss-cn-shenzhen.aliyuncs.com`    | 公网                    | `https://oss-cn-shenzhen-internal.aliyuncs.com`    |

生产 Pod 内已验证两个内网域名均解析到 OSS 深圳内网 VIP `100.118.78.*`。
Market 的 `ListObjectsV2` 和 ClickHouse Backup 的远端备份列表已通过内网 Endpoint
完成认证只读访问。Masterino、Langfuse 和 ClickHouse Backup 均已使用现有凭据通过
内网 Endpoint 完成临时对象 Put/Get/Delete，临时对象和探针 Job 已清理。Market 凭据
不具备 `HeadBucket` 权限，因此以 `ListObjectsV2` 和 `/ready` 作为该链路的放行条件。

### 3.2 必须保留的公网访问

`S3_PUBLIC_DOMAIN=https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com` 面向浏览器预览、
下载和签名 URL，必须保持公网可访问。正确结构是：

```text
浏览器 -> Masterino 同源上传代理 -> Masterino Server -> OSS 内网 Endpoint
浏览器 <- 公网 S3_PUBLIC_DOMAIN/签名 URL <- OSS
```

不得把所有包含 `aliyuncs.com` 的地址一刀切成内网地址。GitHub Actions、桌面更新下载、
外部用户浏览器等不在 ACK VPC 内的调用仍需公网地址。

### 3.3 其他服务网络状态

| 服务                          | 当前状态                                                               | 处理         |
| ----------------------------- | ---------------------------------------------------------------------- | ------------ |
| ACR                           | 使用 `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com`，解析到 `10.80.*` | 保持         |
| Aihub RDS                     | `rm-*.mysql.rds.aliyuncs.com` 在 ACK 内解析到 `10.80.139.141`          | 保持         |
| PostgreSQL、Redis、ClickHouse | 私网 IP 或 Kubernetes ClusterIP/Service                                | 保持         |
| Masterino -> Langfuse         | `langfuse-web.masterino-observability.svc.cluster.local:3000`          | 保持         |
| Masterino -> Aihub            | `aihub.bielcrystal.com` 当前解析到公网 `47.106.93.9`                   | 第二阶段切换 |
| Masterino -> Onlyboxes        | `onlyboxes.internal.bielcrystal.com` 当前 `ENOTFOUND`                  | 单独修复 DNS |

用户已确认 `aihub.bielcrystal.com` 的内网地址为 `10.80.136.84`。

## 4. 配置改动矩阵

### 4.1 仓库内配置

| 文件                                                | 配置                             | 变更                          |
| --------------------------------------------------- | -------------------------------- | ----------------------------- |
| `k8s/overlays/test/configmap.yaml`                  | `S3_ENDPOINT`                    | 先改测试内网 Endpoint         |
| `k8s/overlays/test-market/kustomization.yaml`       | `MARKET_OBJECT_STORAGE_ENDPOINT` | 先改测试 S3 兼容内网 Endpoint |
| `k8s/overlays/production/configmap.yaml`            | `S3_ENDPOINT`                    | 改生产内网 Endpoint           |
| `k8s/overlays/production-bluegreen/configmap.yaml`  | `S3_ENDPOINT`                    | 与生产保持一致                |
| `k8s/overlays/production-market/kustomization.yaml` | `MARKET_OBJECT_STORAGE_ENDPOINT` | 改生产 S3 兼容内网 Endpoint   |

Market NetworkPolicy 还必须显式允许深圳 OSS 内网 VIP 网段
`100.118.78.0/24`、`100.118.203.0/24`、`100.118.204.0/24`、
`100.118.217.0/24` 的 TCP 443。不能依赖当前 CNI 对既有规则的宽松行为，因为现有通用
公网 HTTPS 规则明确排除了包含这些 VIP 的 `100.64.0.0/10`。

以下值明确不改：

```text
S3_PUBLIC_DOMAIN=https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com
S3_REGION=cn-shenzhen
S3_BUCKET=masterlion-prd
```

### 4.2 Langfuse 配置

将生产 `langfuse-config` 中三项改为：

```text
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com
LANGFUSE_S3_BATCH_EXPORT_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com
```

当前 Langfuse ConfigMap 与核心部署配置主要存在于 live 集群，仓库中没有完整声明。
实施前应增加不含凭据的声明式 Patch/Manifest，Secret 继续只引用现有 Secret，禁止把
AccessKey 写入仓库。

### 4.3 ClickHouse Backup 配置

修改 `ClickHouseInstallation/langfuse` 的 Pod Template 中
`clickhouse-backup` 容器：

```text
S3_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com
```

必须修改 Operator 的源资源 `ClickHouseInstallation`，不能直接编辑生成的 StatefulSet，
否则会被 Operator 覆盖。该修改会变更整个 Pod Template，可能重建 ClickHouse Pod，须
放在独立维护步骤。

### 4.4 Aihub 私有 DNS

保留应用配置和域名：

```text
AIHUB_PROXY_URL=https://aihub.bielcrystal.com
MODEL_PROVIDER_ALLOWED_ORIGINS=https://aihub.bielcrystal.com
```

在 ACK 所在 VPC 关联的阿里云 PrivateZone 中增加 / 修正：

```text
aihub.bielcrystal.com A 10.80.136.84
```

不要把应用配置改为 `https://10.80.136.84`，否则会破坏证书校验、SNI、Host 路由和
Origin 校验。内网入口必须接收 `Host: aihub.bielcrystal.com`，其证书必须包含该域名。

### 4.5 Onlyboxes 私有 DNS

先确认 Onlyboxes 当前权威内网 IP、内部负载均衡 / Ingress 和证书，再在 PrivateZone 中
恢复 `onlyboxes.internal.bielcrystal.com` 的 A/CNAME 记录。不得启用公网 fallback 来掩盖
内部 DNS 故障。

## 5. 实施阶段

### 阶段 0：变更前保护和审计

1. 使用临时 ACK kubeconfig 执行 STS 身份、集群 ID、Region、Namespace 和只读 RBAC
   预检；不修改默认 kubectl context。
2. 导出本次涉及资源的脱敏快照和 resourceVersion：
   - Masterino/Market ConfigMap；
   - Langfuse ConfigMap；
   - 相关 Deployment；
   - `ClickHouseInstallation/langfuse`；
   - Aihub/Onlyboxes PrivateZone 记录。
3. 记录各工作负载当前镜像不可变 digest、副本、PDB、滚动策略和就绪状态。
4. 确认 OSS Bucket 均位于 `cn-shenzhen`，且 Bucket Policy/RAM Policy 允许来自当前 VPC
   的内网 Endpoint 访问。
5. 确认 ClickHouse 最近一次完整备份、增量链和 PVC `Retain` 状态。
6. 建立回滚文件，不记录 Secret 值，只记录原 Endpoint、资源版本和恢复命令。

### 阶段 1：测试环境验证

1. 先修改 `masterino-test` 和测试 Market 的服务端 Endpoint。
2. 仅滚动测试 Masterino、Memory Worker 和 Market，不部署新镜像、不执行数据库迁移。
3. 完成以下真实业务验证：
   - 通过 `/api/upload/s3-proxy` 上传测试文件；
   - 服务端读取并删除测试对象；
   - 浏览器通过现有公网 `S3_PUBLIC_DOMAIN` 预览和下载；
   - Market 素材写入、列表、读取；
   - Pod 内 Endpoint 解析到 `100.118.78.*`；
   - 日志无 `SignatureDoesNotMatch`、`PermanentRedirect`、TLS、DNS 或超时错误。
4. 至少观察 30 分钟；失败则恢复测试公网 Endpoint，不进入生产。

### 阶段 2：生产 Market

1. 更新 `masterino-market-config` 的 `MARKET_OBJECT_STORAGE_ENDPOINT`。
2. Market 当前 2 副本并有 readiness/PDB，逐个滚动，保持至少 1 个可用副本。
3. 验证素材读取、写入、列表和错误率。
4. 确认新 Pod 解析 / 连接内网 Endpoint 后再继续。

### 阶段 3：生产 Masterino 与 Memory Worker

1. 使用当前生产镜像 digest 创建不接公网 Ingress 的单副本私有验证实例，只覆盖
   `S3_ENDPOINT` 为内网地址。
2. 通过原有同源上传代理完成上传、读取、下载和删除闭环；验证客户端公开下载域名不变。
3. 私有验证通过后更新正式 `masterino-config`。
4. 先滚动 `masterino`。当前 4 副本、readiness、`maxUnavailable=0`，保持零不可用。
5. 再滚动单副本 `masterino-memory-worker`；其短暂停止不得影响在线聊天，但需监控任务
   队列和失败重试。
6. 验证上传成功率、预签名 URL、文件预览、知识库 / 附件处理及服务端 OSS 错误。

### 阶段 4：生产 Langfuse

1. 用现有 Langfuse Secret 和内网 Endpoint 运行一次短生命周期、只读 / 临时对象探针，
   完成 HeadBucket、Put、Get、Delete；临时对象使用独立前缀并在验证后删除。
2. 更新 Langfuse 三个 Endpoint，Bucket、Prefix、Region、SSE 和凭据保持不变。
3. 先逐个滚动两个 Langfuse Worker，再滚动单副本 Langfuse Web。
4. Worker 当前无 readinessProbe；实施前增加可靠健康探针，或在发布脚本中一次只重建一个
   Worker，并以 Redis 队列消费和错误日志作为放行条件。
5. 验证新 Trace、Observation、Score、媒体和批量导出；检查 Redis 队列无持续积压、
   ClickHouse 数据时间连续。

### 阶段 5：ClickHouse Backup

1. 独立安排维护窗口。先再次确认最近完整备份、增量链、PVC/PV `Retain` 和当前
   ClickHouse 健康状态。
2. 可暂停 Langfuse Worker 消费，让 Web 继续把原始事件持久化到 OSS 并将引用排入
   Redis；确认队列容量和保留时间足够。
3. 更新 `ClickHouseInstallation` 中 Backup sidecar 的 `S3_ENDPOINT`，等待 Operator
   调谐，不直接修改 StatefulSet。
4. 等待 ClickHouse、Backup sidecar 和 Service 全部恢复 Ready，再恢复 Worker。
5. 通过内网 Endpoint 创建一份小型验证备份、执行远端列表，并验证下一次正式备份成功。
6. 如生产流程允许，执行恢复清单 / 元数据级校验；未经单独授权不覆盖现有数据库。

### 阶段 6：Aihub 内网路由

1. 在变更 DNS 前，从 Masterino Pod 直连 `10.80.136.84:443`，携带
   `Host: aihub.bielcrystal.com`，验证：
   - TCP/HTTPS 可达；
   - TLS 证书覆盖 `aihub.bielcrystal.com`；
   - 健康检查、模型列表和鉴权路径返回预期结果；
   - 内部入口不会绕回公网负载均衡。
2. 将 PrivateZone 记录 TTL 临时降至 60 秒，确认仅关联目标 VPC。
3. 设置 `aihub.bielcrystal.com -> 10.80.136.84`，不修改应用 URL。
4. 在一个私有验证实例中确认模型调用、流式响应、Aihub 鉴权、用户 / Token / 额度查询正常。
5. 逐个刷新正式 Masterino Pod DNS 缓存或滚动工作负载。
6. 观察模型错误率、首 Token 延迟、流式中断、Aihub 入口日志和公网地址流量至少 60 分钟。

### 阶段 7：Onlyboxes DNS 修复

1. 从 Onlyboxes 所有者确认内网 IP、端口、证书、Ingress Host 和安全组。
2. 修复 PrivateZone A/CNAME 记录并验证 Masterino Pod 能解析。
3. 验证 JIT 签发、任务创建、执行、文件导入导出及回调。
4. 保持 `MARKET_ALLOW_EXTERNAL_FALLBACK=0` 及现有安全边界，不增加公网兜底。

## 6. 防回退测试与发布守卫

新增配置测试或审计脚本，检查：

- ACK `production`、`production-bluegreen`、`test` 的服务端 `S3_ENDPOINT` 必须包含
  `oss-cn-shenzhen-internal.aliyuncs.com`。
- ACK Market 的 `MARKET_OBJECT_STORAGE_ENDPOINT` 必须包含
  `s3.oss-cn-shenzhen-internal.aliyuncs.com`。
- Langfuse 三个服务端 S3 Endpoint 和 ClickHouse Backup Endpoint 必须为内网地址。
- `S3_PUBLIC_DOMAIN` 必须保持公开 Bucket 域名，不允许使用 `-internal`。
- 镜像必须继续使用 ACR VPC 地址和不可变 digest。
- Aihub 的应用 URL 必须保持域名，禁止配置裸 IP；ACK 内 DNS 必须解析为
  `10.80.136.84`。
- Endpoint 检查按配置用途分类，不能对所有公网 URL 做无差别替换。

## 7. 验收标准

- Masterino、Market、Langfuse、ClickHouse Backup 的服务端 OSS DNS 均解析到 OSS 内网
  VIP，不再连接 `112.74.*` 公网 OSS 地址。
- NAT Gateway/CNI Flow Log 中不再出现这些 Pod 到公网 OSS IP 的新连接；观察窗口至少
  60 分钟，并覆盖一次 Langfuse 批量导出和一次 ClickHouse 备份。
- 文件上传、读取、删除、预览、浏览器下载、Market 素材和知识库附件全部正常。
- Langfuse Trace 数据连续，Redis 队列无持续积压，ClickHouse 查询与备份正常。
- 浏览器继续通过公网 `S3_PUBLIC_DOMAIN` 下载，不把客户端流量错误导向内网 Endpoint。
- Masterino Pod 内 `aihub.bielcrystal.com` 解析到 `10.80.136.84`，模型调用和 Aihub
  业务接口正常，公网 `47.106.93.9` 不再收到 Masterino 服务间请求。
- `onlyboxes.internal.bielcrystal.com` 可解析并完成真实沙箱任务闭环。
- 全程客户端聊天可用，Deployment 不出现不可接受的 unavailable 副本。

## 8. 回滚方案

### OSS 与 Langfuse

1. 将对应服务端 Endpoint 恢复为原公网地址。
2. 按 Market、Masterino/Memory Worker、Langfuse Worker/Web 的逆序滚动恢复。
3. Bucket、Key、Region、Prefix 和凭据均未变化，已写对象无需迁移。

### ClickHouse Backup

1. 恢复 `ClickHouseInstallation` 中原公网 `S3_ENDPOINT`。
2. 等待 Operator 调谐并确认 ClickHouse Ready。
3. 恢复 Langfuse Worker，检查队列回落和 Trace 连续性。
4. 不删除 PVC/PV，不执行破坏性恢复。

### Aihub

1. 将 PrivateZone 记录恢复为原记录；若需删除整个 Zone，必须先解除 VPC 绑定再删除
   Zone（已绑定 Zone 不能直接删除）。
2. 等待低 TTL 生效，并确认 Pod 内重新解析到原公网地址。
3. 应用配置始终保留域名，因此无需更改 Secret 或重新签发证书。

### Onlyboxes

恢复原 PrivateZone 记录；如果修复前记录不存在，则删除新增记录并恢复到变更前状态。
不得通过启用公网 fallback 作为回滚手段。

## 9. 风险与控制

| 风险                                           | 控制措施                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| 内网 Endpoint 与 SDK 签名 / 虚拟主机模式不兼容 | 测试环境和私有实例先做真实 Put/Get/Delete；Market 保留已验证的 `s3.` 形式 |
| ConfigMap 已改但旧 Pod 仍使用旧环境变量        | 显式按组件滚动并检查新 Pod 实际环境与 DNS                                 |
| 误把客户端下载域名改成内网                     | 独立守卫 `S3_PUBLIC_DOMAIN`，浏览器下载列为必测项                         |
| Langfuse Worker 无 readiness                   | 先补探针或逐个重建，以队列和错误日志作为放行门槛                          |
| 修改 Backup sidecar 导致 ClickHouse Pod 重建   | 独立窗口、确认备份与 Retain、暂停 Worker、等待 Operator 完整恢复          |
| PrivateZone 影响范围过大                       | 只关联 ACK 所在 VPC，低 TTL 灰度，保留原 DNS 快照                         |
| Aihub 内网入口证书 / Host 不匹配               | 保留域名，通过 SNI/Host 探针验证后再切 DNS，不配置裸 IP URL               |
| 配置只存在 live 集群导致漂移                   | 把非敏感 ConfigMap/CHI Patch 纳入仓库，Secret 仍留在集群                  |

## 10. 建议执行顺序与变更窗口

```text
配置与守卫 PR
  -> masterino-test OSS
  -> 生产 Market
  -> 生产 Masterino + Memory Worker
  -> 生产 Langfuse Web/Worker
  -> ClickHouse Backup 独立维护窗口
  -> Aihub PrivateZone 独立窗口
  -> Onlyboxes DNS 独立修复
```

每一阶段都必须具备独立验收和独立回滚能力。任一阶段失败时停止后续阶段，不能通过继续
切换其他组件来尝试掩盖问题。

## 11. 2026-09-14 执行结果

### 11.1 已完成变更

- `masterino-test` 和 `masterlion` 的 Masterino、Memory Worker、Market 已切换到深圳 OSS
  内网 Endpoint；Market NetworkPolicy 仅额外允许官方深圳 OSS 内网 CIDR 的 TCP 443。
- Langfuse Event Upload、Media Upload、Batch Export 三条 OSS 链路已切换内网 Endpoint；
  Worker 先滚动并恢复至 2/2，Web 恢复至 1/1。
- ClickHouse Backup sidecar 已通过 `ClickHouseInstallation` 交由 Operator 调谐，CHI、
  StatefulSet 和实际 Pod 环境均为内网 Endpoint；PVC/PV 未改动，Worker 已恢复。
- 新建 PrivateZone `aihub.bielcrystal.com`，Zone ID
  `da3862ac2a7d1bd20d36760fbd2abe4a`，记录 ID `211535771000511`，`@ A`
  指向 `10.80.136.84`，TTL 60。
- 新建 PrivateZone `onlyboxes.internal.bielcrystal.com`，Zone ID
  `88c64b487fe76e333b238da64715d6d7`，记录 ID `211535885000141`，`@ A`
  指向 `10.80.137.220`，TTL 60。
- 两个 PrivateZone 均仅绑定 `cn-shenzhen` 的 `BE-VPC`
  (`vpc-wz9c6sxsanqh7isml50lf`)；生产 Namespace 已补齐目标集群、地域和环境元数据守卫。

### 11.2 即时验收证据

- 测试环境 3 个目标工作负载均 1/1 Ready；生产 Masterino 4/4、Market 2/2、Memory
  Worker 1/1 Ready；Langfuse Web 1/1、Worker 2/2、ClickHouse 1/1 Ready。
- 所有目标 Pod 的实际环境变量均为内网 Endpoint；`S3_PUBLIC_DOMAIN` 未修改。
- 生产 Pod 解析 OSS 内网域名为 `100.118.78.2/3`，解析 Aihub 为 `10.80.136.84`，
  解析 Onlyboxes 为 `10.80.137.220`。
- 生产 Pod 使用原域名和 TLS/SNI 请求 Aihub、Onlyboxes 均返回 HTTP 200，实际对端分别为
  `10.80.136.84` 和 `10.80.137.220`；Market `/ready` 和 Langfuse health 均返回 200。
- ClickHouse Backup 通过内网 Endpoint 成功列出远端备份链，最新核验备份为
  `shard0-increment-20260913104357`。
- 切换后 30 分钟目标工作负载日志未命中 `SignatureDoesNotMatch`、
  `PermanentRedirect`、`AccessDenied`、`NoSuchBucket`、`ENOTFOUND` 或连接超时 / 重置；
  三个 Namespace 均无遗留探针 Job。

### 11.3 尚需持续观察

- 即时技术验收不能替代原计划要求的至少 60 分钟 CNI/NAT 流量观察；需要确认目标 Pod
  不再产生到公网 OSS `112.74.*` 或 Aihub 公网 `47.106.93.9` 的新连接。
- 在观察窗口内覆盖一次正式 Langfuse 批量导出和下一次 ClickHouse 定时备份，并由业务
  侧抽检浏览器公开下载、真实模型流式调用和 Onlyboxes 沙箱任务闭环。
- 如任一抽检失败，按组件独立回滚；PrivateZone 回滚时先解绑 VPC，再删除新增 Zone。
