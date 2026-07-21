# Masterion 部署踩坑交接文档

更新时间：2026-06-22

版本：v0.0.5

## 概述

本文档汇总 Masterion 从 v0.0.1 到 v0.0.5 部署过程中遇到的所有坑和解决方案，供后续部署和运维参考。每一条都是实际踩过的，不是理论推测。

---

## 一、环境变量必填项（缺一不可）

部署时 `docker-compose/deploy/.env` 必须包含以下变量，否则容器启动失败或功能异常：

| 变量 | 说明 | 踩坑表现 |
|------|------|----------|
| `KEY_VAULTS_SECRET` | 加密密钥，base64 编码，解码后须为 16/24/32 字节 | 缺失 → 容器启动报错；格式错误 → 运行时解密失败 |
| `AUTH_SECRET` | BetterAuth 签名密钥，64 位 hex | 缺失 → 登录/auth callback 全部 500 |
| `JWKS_KEY` | 内部 JWT 签名用 RSA JWKS JSON | 缺失 → `docker compose up` 直接报错退出；chunk 任务失败 |
| `AIHUB_BRIDGE_TOKEN` | Aihub DB Bridge 鉴权 token | 缺失 → bridge 拒绝请求，模型列表/用户信息全部空 |
| `DATABASE_DRIVER` | 设为 `node`（非 `node` 时走不同链路） | 默认值可能不对，必须显式设 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | 缺失 → 数据库连接失败 |
| `REDIS_PASSWORD` | Redis 密码 | 缺失 → Redis 连接失败 |
| S3 五件套 | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | 缺失 → 文件上传失败 |

### 生成命令参考

```bash
# KEY_VAULTS_SECRET (base64, 解码后 32 字节)
openssl rand -base64 32

# AUTH_SECRET (64 位 hex)
openssl rand -hex 32

# JWKS_KEY (RSA JWKS JSON)
node scripts/generate-oidc-jwk.mjs

# AIHUB_BRIDGE_TOKEN
openssl rand -hex 32
```

---

## 二、SSRF 防护拦截内网请求（重要！）

### 坑

上传图片后，AI 分析图片报错：

```
SSRF blocked: request to https://<bucket>.cos.ap-guangzhou.myqcloud.com/...
failed, reason: DNS lookup 169.254.0.47 is not allowed. Because, It is private IP address.
```

### 原因

腾讯云 COS 域名在服务器内网解析到 link-local 地址 `169.254.0.47`，被 Masterion 的 SSRF 防护拦截。AI 模型在分析图片时需要从 COS 下载图片，这个请求从服务端发出，经过 SSRF 检查。

### 解决

```env
SSRF_ALLOW_PRIVATE_IP_ADDRESS=1
```

**必须加到 `.env` 中，每次部署都不能漏。**

### 适用场景

- 使用腾讯云 COS 且服务器在腾讯云内网
- 使用任何 S3 兼容存储且域名可能解析到内网 IP（如 RustFS 部署在同一机器）
- 使用阿里云 OSS 且服务器在阿里云内网

---

## 三、PostgreSQL 必须有 pgvector + pg_search 扩展

### 坑

使用 1Panel 默认的 `postgres:18.4-alpine` 容器，数据库迁移报错：

```
extension "pgvector" is not available
extension "pg_search" is not available
```

### 原因

Masterion 的数据库迁移依赖 `pgvector`（向量存储）和 `pg_search`（全文搜索），普通 PostgreSQL 镜像不带这些扩展。

### 解决

使用 ParadeDB 镜像（内置 pgvector + pg_search）：

```yaml
postgresql:
  image: paradedb/paradedb:latest-pg17
```

**不要用普通 PostgreSQL 镜像，也不要用 1Panel 自带的 PostgreSQL。**

---

## 四、SPA 首屏 Loading 资源 404

### 坑

部署后首屏 loading 动画不显示，浏览器控制台报：

```
GET /_spa/brand/masterlion/loading-masterlion-zh.svg 404
GET /_spa/favicon-32x32.ico 404
```

### 原因

Vite 生产构建配置 `base: '/_spa/'`（`vite.config.ts:105`）会自动重写 HTML 模板中所有资源路径：

```
/brand/...  →  /_spa/brand/...
/favicon-32x32.ico  →  /_spa/favicon-32x32.ico
```

但 `brand/`、`favicon` 等静态资源在 `public/` 根目录下，`/_spa/` 下不存在。

**注意**：React 组件中的 `<img src="/brand/...">` 不受影响（JSX 字符串不被 Vite 重写），问题仅出在 HTML 模板。

### 解决

在 `index.html` 中：
1. 将 `<img src="/brand/...">` 替换为内联 SVG（零网络延迟，免疫 base 重写）
2. favicon 用 JS 动态设置路径：`<script>document.getElementById('favicon-shortcut').href='/favicon-32x32.ico';</script>`
3. CSS 选择器 `img` → `svg`

---

## 五、SearXNG 境外搜索引擎不可达

### 坑

聊天搜索功能报错 `Premature close`，SearXNG 所有引擎 ConnectTimeout。

### 原因

SearXNG 默认引擎（Google、DuckDuckGo、Brave 等）均为境外站点，国内服务器无法直连。

### 解决

方案 A（推荐）：切换到国内可达搜索提供商：

```env
SEARCH_PROVIDERS=bocha
BOCHA_API_KEY=your-key
```

方案 B：为 SearXNG 配置出站代理（需额外维护代理服务）。

---

## 六、运行态模型列表合并 Bug

### 坑

设置页有 `glm-5.1`，首页模型选择器里没有，`service-model` 显示 `newapi/glm-5.1` 原样回显，Agentic 工具调用误报"不支持"。

### 原因

`getEnabledModels()` 先用全部 builtin models 建去重 key，再隐藏 builtin `newapi` fallback。导致 remote Aihub 的 `glm-5.1` 先被 builtin 同 ID 去重过滤，随后 builtin 又被整体隐藏，两边都丢失。

### 解决

修复 `packages/database/src/repositories/aiInfra/index.ts`：先计算 visible builtin models，再基于 visible 去重 remote models。

### 排查准则

遇到"设置页有模型，首页选不到"时：
1. 先对比两个页面的数据源（`getAiProviderModelList` vs `getEnabledModels`）
2. 直接在运行容器内验证 repository 输出
3. 不要用命名映射掩盖数据链路问题
4. `provider/model` 原样回显 → 优先怀疑 options 缺失

---

## 七、文件上传后向量化失败

### 坑

文件上传成功但后续任务报 `EmbeddingError: ModelNotFound`。

### 原因

`CHUNKS_AUTO_EMBEDDING` 默认开启，但 Aihub 用户没有可用的 embedding 模型。

### 解决

```env
CHUNKS_AUTO_EMBEDDING=0
```

等 Aihub 提供 embedding 模型后再开启，并配置：

```env
DEFAULT_FILES_CONFIG="embedding_model=newapi/<embedding-model>,query_mode=full_text"
CHUNKS_AUTO_EMBEDDING=1
```

---

## 八、RustFS CORS 配置格式

### 坑

`mc cors set` 使用 JSON 格式报错。

### 解决

必须使用 XML 格式的 CORS 配置文件：

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
  </CORSRule>
</CORSConfiguration>
```

---

## 九、浏览器上传必须走同源代理

### 坑

浏览器直连 `rustfs:9000` 上传失败（跨域 + 内网地址不可达）。

### 原则

浏览器上传必须走同源路径 `/api/upload/s3-proxy`，不要直连对象存储内网地址。

---

## 十、Docker 镜像拉取和 npm 安装

### 坑

国内服务器拉取 Docker Hub 镜像和 npm 包超时。

### 解决

Docker 镜像加速（`/etc/docker/daemon.json`）：

```json
{
  "registry-mirrors": [
    "mirror.ccs.tencentyun.com",
    "docker.1ms.run"
  ]
}
```

npm 镜像：构建时加 `--build-arg USE_CN_MIRROR=true`。

---

## 十一、Git 网络超时

### 坑

`git fetch` / `git pull` 频繁超时（GnuTLS recv error）。

### 解决

- 重试即可，GitHub HTTPS 在国内不稳定
- 或配置 `http.postBuffer` 增大缓冲区
- SSH 方式需先配置 host key

---

## 十二、动态访问地址

### 坑

固定 `APP_URL` 导致 auth callback、静态资源路径在不同 IP/域名访问时出错。

### 解决

```env
APP_URL_DYNAMIC=1
APP_URL_ALLOWED_HOSTS=*
```

---

## 部署 Checklist

每次部署前逐项确认：

- [ ] `.env` 包含所有必填变量（见第一节）
- [ ] `SSRF_ALLOW_PRIVATE_IP_ADDRESS=1` 已设置
- [ ] PostgreSQL 使用 ParadeDB 镜像（非普通 postgres）
- [ ] `CHUNKS_AUTO_EMBEDDING=0`（除非有 embedding 模型）
- [ ] `APP_URL_DYNAMIC=1` + `APP_URL_ALLOWED_HOSTS=*`
- [ ] S3 配置完整（五件套 + `S3_PUBLIC_DOMAIN`）
- [ ] 搜索提供商已配置（`SEARCH_PROVIDERS=bocha` + `BOCHA_API_KEY`）
- [ ] 浏览器上传走 `/api/upload/s3-proxy`，不直连对象存储
- [ ] Docker 镜像加速已配置
- [ ] 构建命令加 `--build-arg USE_CN_MIRROR=true`
- [ ] 不要把真实 `.env` 或密钥提交到仓库

---

## 当前部署架构

```
服务器 159.75.83.112
├── 1Panel 容器 (1panel-network)
│   ├── PostgreSQL (1Panel-postgresql-bjeC) — 不用于 Masterion
│   ├── Redis (1Panel-redis-TyNJ) — 不用于 Masterion
│   └── RustFS (1Panel-rustfs-oROT) — 不用于 Masterion
│
└── Masterion 容器 (masterlion-net + 1panel-network)
    ├── masterlion (port 3210) — 主应用
    ├── masterlion-postgres (ParadeDB pg17) — 数据库
    ├── masterlion-redis (redis:7-alpine) — 缓存
    ├── masterlion-aihub-db-bridge (port 3218) — Aihub 数据桥接
    └── masterlion-searxng — 搜索（当前未使用，已切 Bocha）
```

外部依赖：
- 腾讯云 COS：文件存储（`mlai-test-1435304320.cos.ap-guangzhou.myqcloud.com`）
- Aihub MySQL：只读数据源（`47.106.93.9:13306/newapi`）
- Bocha API：搜索服务
- Aihub Proxy：模型代理（`aihub.bielcrystal.com`）

---

## 关键文件索引

| 用途 | 路径 |
|------|------|
| 部署 compose | `docker-compose/deploy/docker-compose.custom.yml` |
| 部署环境变量 | `docker-compose/deploy/.env` |
| 本地构建脚本 | `docker-compose/dev/build-local.sh` |
| Dockerfile | `Dockerfile` |
| Bridge Dockerfile | `apps/aihub-db-bridge/Dockerfile` |
| Vite 配置（base 路径） | `vite.config.ts:105` |
| SPA HTML 模板 | `index.html` |
| 运行态模型列表 | `packages/database/src/repositories/aiInfra/index.ts` |
| SSRF 防护配置 | 环境变量 `SSRF_ALLOW_PRIVATE_IP_ADDRESS` |
| 搜索服务 | `apps/server/src/services/search/index.ts` |
| S3 上传代理 | `/api/upload/s3-proxy` |
