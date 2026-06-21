# MasterLion / 小宗狮 Aihub 改造迁移记录

更新时间：2026-06-20

当前版本：`0.0.1`

GitHub 私有仓库：`https://github.com/biel-cc/MasterLion`

## 项目位置

当前改造目录：

```text
E:\MasterLion\lobehub-canary
```

迁移时建议整体移动该目录，尤其保留：

- `.env`
- `.env.desktop`
- `docker-compose/deploy/.env`
- `docker-compose/dev/.env`
- `public/brand/masterlion/`
- `package.json`
- `packages/database/package.json`
- `packages/openapi/package.json`

## 品牌替换

- 明显标题、浏览器标题、主要品牌名：`小宗狮`
- 产品、动画、图标、较弱可见品牌：`MasterLion`
- Aihub 供应商显示名：`Aihub`
- VI 资源已接入：`public/brand/masterlion/`

保留的内部兼容标识：

- `newapi`
- `ModelProvider.NewAPI`
- `@lobechat/*`
- `@lobehub/*`

这些是上游 provider id、包名、数据库枚举或运行时路径，不应直接全局改名，否则会破坏 monorepo 依赖和已有数据。

## Aihub 配置

Aihub 地址：

```text
https://aihub.bielcrystal.com
```

主要环境变量：

```env
AIHUB_PROXY_URL=https://aihub.bielcrystal.com
AIHUB_DEFAULT_MODEL=
AIHUB_MANAGED_TOKEN_NAME=masterlion-managed
AIHUB_USAGE_PAGE_SIZE=100
AIHUB_ADMIN_USER_ID=
AIHUB_ADMIN_ACCESS_TOKEN=
AIHUB_DATA_SOURCE=db
AIHUB_READONLY_DATABASE_URL=mysql://newapi_read:<url-encoded-password>@47.106.93.9:13306/newapi
```

真实只读数据库密码已经写在本地 `.env` 和 docker env 文件中，且在 URL 中做了编码。迁移或提交代码时请注意不要公开这些 env 文件。

## Aihub DBLink 逻辑

当前默认使用 `AIHUB_DATA_SOURCE=db`。

用户登录 MasterLion 后，服务端会：

1. 读取当前 MasterLion 用户的 `email` / `username`。
2. 通过 Aihub 只读 MySQL 查询 `users` 表，匹配 Aihub 用户。
3. 查询该 Aihub 用户可用 token：
   - 优先 token 名称 `masterlion-managed`
   - 找不到时回退到最新可用启用 token
4. 查询模型清单：
   - token 开启模型限制时使用 `tokens.model_limits`
   - 否则按用户 group 查询 `abilities` 表启用模型
5. 查询余额、已用额度、请求次数。
6. 查询 `logs` 表聚合 token 用量、模型分布、请求数和 quota。
7. 将 Aihub token 加密保存到 MasterLion 的 provider keyVault，不暴露给浏览器。

核心文件：

- `apps/server/src/services/newApi/readOnlyDb.ts`
- `apps/server/src/services/newApi/index.ts`
- `apps/server/src/routers/lambda/newApi.ts`
- `src/services/newApi/index.ts`
- `src/store/newApi/index.ts`

## 唯一供应商策略

当前部署只允许 Aihub：

- 全局默认 provider 仍使用内部 id `newapi`
- 前端供应商列表只显示 Aihub
- 自定义 provider、其他 provider 启用、手工更新 provider key 均被服务端拒绝
- Aihub provider 详情页只读，不显示 API Key 输入框

相关文件：

- `apps/server/src/globalConfig/index.ts`
- `apps/server/src/routers/lambda/aiProvider.ts`
- `apps/server/src/routers/lambda/aiModel.ts`
- `packages/model-bank/src/modelProviders/newapi.ts`
- `packages/model-bank/src/aiModels/newapi.ts`
- `packages/business/const/src/llm.ts`
- `packages/env/src/llm.ts`

## Docker 变更

Docker deploy 环境已传入 Aihub 变量：

```text
docker-compose/deploy/docker-compose.yml
docker-compose/deploy/.env
docker-compose/dev/.env
```

迁移后需要确认目标机器可访问：

- `https://aihub.bielcrystal.com`
- `47.106.93.9:13306`

如果目标环境不能直连 Aihub MySQL，需要调整 `AIHUB_READONLY_DATABASE_URL` 或切回 `AIHUB_DATA_SOURCE=hybrid/api` 并补充管理员 access token。

## 已验证结果

单测：

```powershell
node .\node_modules\vitest\vitest.mjs run apps/server/src/services/newApi/readOnlyDb.test.ts apps/server/src/services/newApi/index.test.ts apps/server/src/services/newApi/client.test.ts apps/server/src/routers/lambda/__tests__/aiProvider.test.ts apps/server/src/routers/lambda/__tests__/aiModel.test.ts "src/routes/(main)/home/features/InputArea/starterModels.test.ts"
```

结果：

```text
6 test files passed
42 tests passed
```

类型检查：

```powershell
corepack pnpm run type-check
```

结果：通过。

真实 Aihub 只读库连通验证：

```text
users: 123
activeTokens: 112
enabledModels: 23
```

本地页面验证：

- `http://localhost:3010/settings/profile` 返回 200
- 页面标题包含 `小宗狮`
- onboarding 不再出现 `Debug ID: CommonOnboarding/userState`

## 迁移后建议检查

1. 在新目录执行依赖安装：

   ```powershell
   corepack pnpm install --ignore-scripts
   ```

2. 确认 `.env` 未丢失，尤其是 `AIHUB_*` 配置。
3. 确认目标机器网络可访问 Aihub URL 和只读 MySQL。
4. 执行：

   ```powershell
   corepack pnpm run type-check
   ```

5. 按需启动服务，进入：

   ```text
   http://localhost:3010/settings/provider/newapi
   ```

6. 登录一个 MasterLion 用户，确认：

   - Aihub 绑定状态正常
   - 可见模型列表来自 Aihub
   - 余额与用量可读取
   - 聊天请求使用该用户对应 Aihub token

## 注意事项

- `.env` 中包含真实只读数据库连接信息，迁移可以保留，提交或外发前应排除。
- `newapi` 字样在代码路径和 provider id 中仍会存在，这是兼容层，不是用户可见品牌。
- `lobechat/lobehub` 字样在 package name、import、内部类型和历史兼容配置中仍会存在，这是上游 monorepo 结构，不建议直接重命名。
- 如需彻底改包名，需要单独规划 monorepo rename、数据库枚举迁移、构建别名和第三方包兼容，不属于本轮 Aihub 接入范围。
