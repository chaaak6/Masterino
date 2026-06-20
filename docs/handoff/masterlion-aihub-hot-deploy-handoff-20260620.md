# MasterLion Aihub 联调交接

更新时间：2026-06-20

状态：已关闭。2026-06-20 用户确认任务 1 已处理完，本文件保留为历史交接记录，不删除。

## 2026-06-21 Disabled 状态追加

- `desktopApp` 当前在 `PRODUCT_FEATURES` 中置为 `disabled`，桌面应用入口保留但阻断，统一显示“敬请期待”。
- 应用设置隐藏“设备”分类，相关路由和底层能力暂不删除，便于后续恢复。
- 系统 - 关于暂时隐藏更新日志、升级/检测更新、商务合作、Discord、X/Twitter、YouTube 和法律声明内容。
- 待客户端开发完成后，再恢复桌面应用下载、设备接入入口和关于页更新检测能力。

## 当前目标

本轮工作围绕 Aihub 联调、开发热验证、动态访问地址和 NewAPI 设置页收口：

- 主应用继续通过 `aihub-db-bridge` 读取 Aihub 用户、托管 token、模型、余额和用量数据，不直接连接 Aihub 数据库。
- 模型列表必须按 Aihub 用户组 abilities 和托管 token `model_limits` 过滤，`default` 用户不能看到 VIP-only 模型。
- `/settings/provider/newapi` 隐藏内部字段，把托管 Token 展示改成下拉选择。
- 开发验证避免每次小改都重建镜像，使用 hot compose 和本地依赖缓存。
- 支持不同 IP 或域名访问，避免固定 `APP_URL` 导致 auth callback、静态资源和 SPA 黑屏问题。

## 本轮主要改动

### Aihub DB Bridge

- `apps/aihub-db-bridge/src/repository.ts`
  - 新增 `listManagedTokens(userId, tokenName)`，只返回 token 元数据，不返回 token key。
  - `listAccessibleModels` 在有 token 用户信息时改为按用户实际 group abilities 查询，再与 token `model_limits` 求交集。
- `apps/aihub-db-bridge/src/http.ts`
  - 新增 `GET /v1/users/:userId/managed-tokens`。
- 相关测试：
  - `apps/aihub-db-bridge/src/http.test.ts`
  - `apps/aihub-db-bridge/src/repository.test.ts`

### Server NewAPI 服务

- `apps/server/src/services/newApi/readSource.ts`
  - 扩展只读数据源接口，增加 `listManagedTokens`。
- `apps/server/src/services/newApi/bridgeClient.ts`
  - 通过 bridge 调用 managed token list endpoint。
- `apps/server/src/services/newApi/readOnlyDb.ts`
  - 只读 DB 数据源增加 managed token 列表查询。
- `apps/server/src/services/newApi/index.ts`
  - `getBindingStatus` 返回 `managedTokens`。
  - 如果数据源不支持列表，则 fallback 到单个 `managedTokenId`。
- `packages/types/src/newApi.ts`
  - 新增 `NewApiManagedTokenOption` 和 `managedTokens` 字段。

### NewAPI 设置页

- `src/routes/(main)/settings/provider/detail/newapi/index.tsx`
  - 隐藏 `Aihub 用户 ID`、`托管 Token 可用额度`、`Total Token`、`Prompt Token`、`Completion Token`。
  - 将 `托管 Token ID` 改为 `托管 Token` 下拉框。
  - 默认选中后端返回的第一个 managed token。
  - 当前下拉选择只用于展示选择状态，未把选中 token 写回绑定关系。

### 模型列表

- `packages/database/src/repositories/aiInfra/index.ts`
  - 当 branding provider 存在 Aihub remote models 时，不再混入 stale builtin fallback models。
  - 设置页和可用模型列表优先展示 Aihub 同步后的 remote models。
- 相关测试：
  - `packages/database/src/repositories/aiInfra/__tests__/getAiProviderModelList.test.ts`
  - `packages/database/src/repositories/aiInfra/__tests__/getEnabledModels.test.ts`

### 动态访问地址和开发热验证

- `src/libs/url/requestOrigin.ts`
  - 从请求头解析当前访问 origin，支持 `APP_URL_DYNAMIC=1` 和 `APP_URL_ALLOWED_HOSTS`。
- Auth / SPA route / BetterAuth 配置支持按当前请求 origin 生成 base URL。
- `docker-compose/deploy/docker-compose.hot.yml`
  - 使用已有 `masterlion:test-builder` 镜像和 bind mount 源码。
  - 避免每次小改都重新 build image。
  - 当前已按用户要求回到原本直接访问 Vite `:9876` 的代理方式。
- `package.json`
  - 新增 `dev:spa:container`。
- `scripts/devStartupSequence.mts`
  - 支持 `DEV_PACKAGE_MANAGER=pnpm`、`NEXT_HOST`、`DEV_SPA_SCRIPT`。
  - 文件里保留了 `DEV_REVERSE_PROXY` 的同源代理实现，但 hot compose 当前没有启用。

### S3 上传

- 浏览器上传保持同源 `/api/upload/s3-proxy` 路径，不直接暴露 `rustfs:9000`。
- deploy compose 改为外部 S3/COS/OSS 配置，不再默认启动 RustFS。
- 相关文档已更新：
  - `docs/self-hosting/environment-variables/s3.mdx`
  - `docs/self-hosting/environment-variables/s3.zh-CN.mdx`

## 当前运行状态

- 已验证 `masterlion-aihub-db-bridge` 的 managed token endpoint 可从 `masterlion` 容器访问，返回 token id/name，未返回 key。
- 当前容器曾通过 `docker restart masterlion-aihub-db-bridge masterlion` 重启。
- 直接 `docker compose up` 当前会被环境变量校验拦住，因为 `JWKS_KEY` 未设置：

```text
required variable JWKS_KEY is missing a value: Set JWKS_KEY for internal JWT signing
```

继续部署前需要在 `docker-compose/deploy/.env` 中补齐至少这些变量：

- `JWKS_KEY`
- `KEY_VAULTS_SECRET`
- `AUTH_SECRET`
- `AIHUB_BRIDGE_TOKEN`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION`（按对象存储要求填写）

不要把真实值写进仓库。

## 快速验证方式

热验证建议：

```bash
docker compose -f docker-compose/deploy/docker-compose.yml -f docker-compose/deploy/docker-compose.hot.yml up -d
```

代码小改后优先重启容器或让 dev server 热更新，不要重新 build 镜像。只有确认发版时再 build release image。

如果使用 direct Vite 模式，需要浏览器能访问：

- MasterLion Next 服务端口：`3210`
- Vite SPA 端口：`9876`

## 已跑过的定向验证

Aihub managed token / NewAPI 设置页：

```bash
docker run --rm \
  -v /root/MasterLion/src:/app/src:ro \
  -v /root/MasterLion/packages:/app/packages:ro \
  -v /root/MasterLion/apps:/app/apps:ro \
  -v /root/MasterLion/package.json:/app/package.json:ro \
  masterlion:test-builder \
  sh -lc "pnpm exec vitest run --silent='passed-only' 'src/routes/(main)/settings/provider/detail/newapi/index.test.tsx' 'apps/server/src/services/newApi/index.test.ts' 'apps/aihub-db-bridge/src/http.test.ts' 'apps/aihub-db-bridge/src/repository.test.ts'"
```

结果：已在提交前合并进完整根目录定向测试，见下方。

动态 origin / dev proxy / SPA HTML：

```bash
docker run --rm \
  -v /root/MasterLion/src:/app/src:ro \
  -v /root/MasterLion/packages:/app/packages:ro \
  -v /root/MasterLion/apps:/app/apps:ro \
  -v /root/MasterLion/scripts:/app/scripts:ro \
  -v /root/MasterLion/package.json:/app/package.json:ro \
  masterlion:test-builder \
  sh -lc "pnpm exec vitest run --silent='passed-only' 'src/libs/url/requestOrigin.test.ts' 'src/libs/next/proxy/define-config.test.ts' 'src/libs/next/config/define-config.test.ts' 'src/app/(backend)/api/auth/[...all]/route.test.ts' 'src/libs/better-auth/define-config.test.ts' 'src/server/spaHtml.test.ts' 'src/scripts/devProcessCleanup.test.ts'"
```

结果：2026-06-20 提交前重跑，11 个测试文件通过，72 个测试通过。

数据库模型过滤：

```bash
docker run --rm \
  -v /root/MasterLion/packages:/app/packages \
  -v /root/MasterLion/package.json:/app/package.json:ro \
  masterlion:test-builder \
  sh -lc "cd packages/database && pnpm exec vitest run --silent='passed-only' 'src/repositories/aiInfra/__tests__/getAiProviderModelList.test.ts' 'src/repositories/aiInfra/__tests__/getEnabledModels.test.ts'"
```

结果：2026-06-20 提交前重跑，2 个测试文件通过，55 个测试通过。

## 当前阻塞和风险

- GitHub CLI 当前认证失效：`gh auth status` 显示 `/root/.config/gh/hosts.yml` token invalid。上传 PR 前需要重新 `gh auth login -h github.com`，或提供可用的 GitHub 凭据。
- 当前本地分支是 `main`，工作区有较多同一轮联调改动。提交前必须确认没有把真实 `.env` 或密钥文件纳入 staged changes。
- `docker-compose/deploy/docker-compose.yml` 已移除默认 RustFS 服务，部署必须提供外部 S3-compatible 对象存储配置。
- `scripts/devStartupSequence.mts` 保留了未启用的同源 dev reverse proxy 能力。当前 hot compose 没有打开它，若后续再启用，需要重新验证 HMR、MIME type 和 auth callback。
- NewAPI 设置页 token 下拉目前只是 UI 选择，不会切换实际绑定 token；如果业务需要“选择后切换使用 token”，需要新增后端 mutation 和权限校验。

## 建议下一步

1. 重新登录 GitHub CLI。
2. 运行本文的完整定向 vitest 集合。
3. 从 `main` 创建 `codex/aihub-hot-deploy-provider-ui` 分支。
4. 提交当前联调改动和本 handoff。
5. push 分支并创建 draft PR。
6. 部署前补齐 `docker-compose/deploy/.env` 中的 `JWKS_KEY` 和 S3/Aihub bridge 变量。
