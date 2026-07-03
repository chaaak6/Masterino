# MasterLion 登录门控与 Aihub 凭证恢复交接

更新时间：2026-07-01

版本：v0.0.10

PR：[#23](https://github.com/chaaak6/MasterLion/pull/23)（已合并）

## 概述

本文档记录 PR #23 修复的三个问题，并沉淀「Lobe AI 字样替换」的完整现状清单与处理原则，避免后续重复排查或误改。

---

## 一、登录后未等 Aihub 数据就绪即进入功能页

### 现象

用户登录后立即落地 home/chat 页面，aihub 运行时态（agentMap、模型列表、凭证）尚未就绪，导致：
- 所有会话报错：`getAgentConfigById(agentId)` 返回 `undefined` → `conversationLifecycle.ts:761` 的 `const { model, provider } = ...` 解构抛错
- 模型列表为空

### 根因

`CacheHydrationGate`（`src/layout/GlobalProvider/CacheHydrationGate.tsx`）是所有 SPA 功能页的共同门控，但只等 `isAuthLoaded` + 缓存水合（1500ms 超时短路），**不等** `isUserStateInit` / `isInitAiProviderRuntimeState`。`useFetchAiProviderRuntimeState` 在 `DeferredStoreInitialization` 中并发执行，不阻断路由渲染。

### 修复

```src/layout/GlobalProvider/CacheHydrationGate.tsx```
- 已登录用户需 `isUserStateInit && isInitAiProviderRuntimeState` 才放行
- 等待期间渲染 `BrandTextLoading`（小宗狮品牌 loading）
- 1500ms 超时仅作用于缓存水合，**不短路 aihub 就绪**
- 未登录直接放行（auth 页为 SSR，不经此门）
- `#loading-screen` HTML splash 移除延迟到完全就绪后，避免闪烁

### 门控生效范围

`SPAGlobalProvider` 是所有 SPA 入口（web / desktop / mobile / popup 经 `RouterRoot`）的共同根，门统一生效。Auth 页为 Next.js SSR（`src/app/[variants]/(auth)/`），不经过此门。

---

## 二、Aihub 凭证删除后不自动恢复

### 现象

删除用户后重新登录（企业微信 SSO），模型列表为空，聊天报错：

```
服务器内部错误，请稍后再试
{ "error": {}, "provider": "newapi" }
```

服务端日志：

```
Route: [newapi] 500: Error: Aihub provider is not bound for the current user
```

### 根因

删除用户行会级联删除 `new_api_bindings`（绑定元数据）和 `ai_providers`（含 `keyVaults.apiKey` 凭证）。重新登录时：

1. WeCom enterprise provisioning（`provisionWecomLoginAccount`）会重建 `new_api_bindings` 元数据行（`status=active` + `managedTokenId`）
2. **但 provisioning 只存 token ID，不存 token key**——不会调用 `ensureManagedToken` 将 apiKey 写入 `ai_providers.keyVaults`
3. `getAiProviderRuntimeState`（`aiProvider.ts:130`）是**纯读操作**，读到空 keyVaults，"成功"返回空配置 → `isInitAiProviderRuntimeState` 置位 → 门控放行
4. 聊天时 `ModelRuntime/index.ts:175` 读不到 `payload.apiKey` → 抛 "Aihub provider is not bound for the current user"

关键链路：

| 组件 | 作用 | 是否自动恢复凭证 |
|------|------|-----------------|
| `provisionWecomLoginAccount` | 重建 `new_api_bindings` 元数据 | ❌ 只存 token ID |
| `getBindingStatus` | 查询绑定状态 | ❌ binding 已存在时直接 return，不调 `ensureManagedToken` |
| `getAiProviderRuntimeState` | 拉 runtime state | ❌ 纯读，无副作用 |
| `ensureManagedToken` | 取 token key + 写 `ai_providers.keyVaults` | ✅ 但无登录链路自动触发 |
| `syncModels` | `ensureManagedToken` + 同步模型列表 | ✅ 但仅手动触发（设置页按钮）|

### 修复

```apps/server/src/routers/lambda/aiProvider.ts```
- `getAiProviderRuntimeState` handler 返回前，检测 `ai_providers.keyVaults.apiKey` 是否缺失
- 缺失时自动调用 `newApiService.syncModels()`（含 `ensureManagedToken` + `syncModelsForBinding`）恢复凭证 + 同步模型
- 恢复失败不阻断 runtime state 返回（用户看到空模型列表，但不会白屏）

### 为什么放在 `getAiProviderRuntimeState` 而非 `getBindingStatus`

`getBindingStatus`（`useNewApiBindingStatus`）只在设置页和余额组件调用，**不在登录初始化链路上**。而 `getAiProviderRuntimeState`（`useFetchAiProviderRuntimeState`）在 `DeferredStoreInitialization` 中对每个登录用户触发，是门控等待的关键路径。在此处恢复凭证，可确保门控放行时数据已完整。

---

## 三、Onboarding 页面 Lobe AI 字样（PR #21 遗漏）

### 背景

PR #21（`fix/onboarding-lobe-ai-text`，已合并 2026-06-30）声称修复了 onboarding 的 Lobe AI 字样，但**只改了 locale 文案**（`telemetry.title3`），**漏改了组件代码中的 `name: 'Lobe AI'` 硬编码**。导致 `/onboarding` 页面打字机问候语仍渲染「嘿，你好，我是 Lobe AI」。

### 修复（PR #23 补齐）

| 文件 | 改动 |
|------|------|
| `src/routes/onboarding/features/TelemetryStep.tsx:73` | `name: 'Lobe AI'` → `name: BRANDING_NAME`（已导入但未使用）|
| `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx:63` | `name: 'Lobe AI'` → `name: BRANDING_NAME`（补导入）|

修复后渲染为「嘿，你好，我是 小宗狮」。

---

## 四、Lobe AI 字样替换现状与处理原则

### 品牌常量

```ts
// packages/business/const/src/branding.ts
export const BRANDING_NAME = '小宗狮';
export const ORG_NAME = '小宗狮';
export const LOBE_CHAT_CLOUD = 'MasterLion Cloud';
```

`BRANDING_NAME` 已在 `src/` 中被引用 **89 处**，是品牌文案的统一来源。

### 处理原则

1. **用户可见的品牌名称**一律用 `BRANDING_NAME`，不要写死 `'Lobe AI'` / `'LobeChat'` / `'LobeHub'`
2. **代码注释、变量名、存储 key 中的 "Lobe AI" / "LobeChat"** 是实现细节，**不需要改**（如 `LOBE_ONBOARDING_MODE_SWITCH_COLLAPSED` localStorage key、`LobeChat_Session` store name）
3. **legacy 包名**（`@lobehub/*`、`@lobechat/*`）是历史依赖名，**不要重命名**（AGENTS.md 明确要求）
4. **兼容性判断中的 `'Lobe AI'`**（如 `rawTitle === 'Lobe AI'`）用于识别旧数据中的 inbox 标题，**保留**，但应同时判断 `BRANDING_NAME`
5. **locale key 中的 `LobeAI`**（如 `storage.actions.copyLobeAI.*`、`workspace.general.copyLobeAI.*`）是 i18n key 名，改 key 需同步所有 locale 文件，**优先改 value 不改 key**

### 已处理清单（PR #23）

| 文件 | 行 | 原值 | 现值 |
|------|-----|------|------|
| `src/routes/onboarding/features/TelemetryStep.tsx` | 73 | `'Lobe AI'` | `BRANDING_NAME` |
| `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx` | 63 | `'Lobe AI'` | `BRANDING_NAME` |

### 待清理清单（inbox agent 标题 fallback）

以下文件中 `'Lobe AI'` 作为 inbox agent 的标题 fallback，用户可见，应改为 `BRANDING_NAME`。本次 PR 范围未覆盖，列为后续：

| 文件 | 行 | 用途 |
|------|-----|------|
| `src/routes/(main)/home/_layout/Body/InboxEntry.tsx` | 53 | 首页 inbox 入口标题 |
| `src/routes/(main)/home/_layout/Body/Agent/List/InboxItem.tsx` | 60 | Agent 列表中的 inbox 项标题 |
| `src/routes/(main)/home/features/AgentSelect/AgentList.tsx` | 68 | Agent 选择器 inbox 标题 |
| `src/routes/(main)/home/features/AgentSelect/index.tsx` | 61 | Agent 选择器 fallback 标题 |
| `src/routes/(main)/agent/_layout/Sidebar/Header/Agent/index.tsx` | 29 | 聊天侧栏 agent 标题 |
| `src/routes/(main)/agent/profile/features/AgentSettings/Content.tsx` | 89 | Agent 设置页标题 |
| `src/routes/(main)/group/features/Conversation/AgentWelcome/index.tsx` | 71 | 群组对话欢迎语 appName |
| `src/routes/share/t/[id]/features/ActionBar.tsx` | 20 | 分享页 inbox 标题 |

### 预期保留清单（无需改动）

| 文件 | 行 | 原因 |
|------|-----|------|
| `src/features/MobileHome/MobileInboxItem.tsx` | 38 | 兼容旧数据：`rawTitle === 'Lobe AI'` 判断，已同时判断 `'MasterLion'` |
| `src/features/Electron/ScreenCapture/overlaySnapshot.ts` | 4 | 桌面端内部常量，配合 `rawTitle === 'Lobe AI'` 兼容判断 |
| `src/features/DevPanel/RenderGallery/fixtures/index.ts` | 54 | DevPanel 测试 fixture，非生产代码 |
| `src/store/agent/slices/agent/action.ts` | 309 | 代码注释 |
| `src/store/home/store.ts` | 68 | Zustand store name（`LobeChat_Home`），内部标识 |
| `src/store/session/store.ts` | 47 | Zustand store name（`LobeChat_Session`），内部标识 |
| `src/store/brief/store.ts` | 31 | Zustand store name（`LobeChat_Brief`），内部标识 |
| `packages/locales/src/default/setting.ts` | 964-1635 | locale key 名含 `LobeAI`，value 已无品牌露出（描述性文案）|
| `packages/locales/src/default/common.ts` | 130 | `cmdk.askLobeAI` key 名，value 已是 `'Ask MasterLion'` |

### 排查命令

```bash
# 查找 src/ 中用户可见的 'Lobe AI' 硬编码（排除测试、注释、store name）
grep -rn "'Lobe AI'" src/ --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -v "node_modules" | grep -v "store.ts" | grep -v "//"

# 查找 locale value 中的 Lobe AI / LobeAI 品牌露出
grep -rn "Lobe AI\|LobeAI" packages/locales/src/default/ --include="*.ts" | grep -v "key:" | grep "//"
```

---

## 五、验收用户重置方法（更新）

验收用户 `10193226`（企业微信 SSO，`10193226@wecom.sso`）用于端到端验证。删除后重新登录会触发 WeCom provisioning 重建账号。

### 彻底删除（级联清空所有数据）

```bash
# 1. 查找当前 user_id（删除后重新登录会生成新 id）
docker exec masterlion-postgres psql -U postgres -d lobechat -c \
  "SELECT id, username, email FROM users WHERE username = '10193226';"

# 2. 删除用户（FK 级联 CASCADE 自动清理 agents/topics/messages/files/ai_providers/new_api_bindings 等）
docker exec masterlion-postgres psql -U postgres -d lobechat -c \
  "DELETE FROM agent_operations WHERE user_id = '<USER_ID>';
   DELETE FROM llm_generation_tracing WHERE user_id = '<USER_ID>';
   DELETE FROM workspace_audit_logs WHERE user_id = '<USER_ID>';
   DELETE FROM users WHERE id = '<USER_ID>';"

# 3. 清除 Redis session
docker exec masterlion-redis sh -c \
  "redis-cli -a '<REDIS_PASSWORD>' --scan --pattern '*<USER_ID>*' | xargs -r redis-cli -a '<REDIS_PASSWORD>' DEL"

# 4. 刷新页面用企业微信重新登录 → 创建全新用户 → provisioning 重建 binding → 自动恢复凭证 → 进入 onboarding
```

### 注意事项

- `agent_operations` / `llm_generation_tracing` / `workspace_audit_logs` 三张表的 `user_id` 是**纯文本列无 FK**，不会级联删除，需手动清理（否则历史 analytics 页面会显示旧数据）
- 删除后重新登录时，`getAiProviderRuntimeState` 会自动检测凭证缺失并调用 `syncModels` 恢复（PR #23 修复），无需手动操作
- Redis 密码在 `docker-compose/deploy/.env` 的 `REDIS_PASSWORD` 中

---

## 六、本地镜像构建与部署（测试环境）

### 构建本地镜像

```bash
cd /root/MasterLion
DOCKER_BUILDKIT=1 docker build -t masterlion:local -f Dockerfile . --build-arg USE_CN_MIRROR=true
```

### 重启容器（注意网络）

测试环境依赖容器在 `masterlion_masterlion-net` 网络上（含 DNS 别名 `postgresql` / `redis`）。`docker compose up --force-recreate` 会创建新网络，需手动连接：

```bash
cd docker-compose/deploy
MASTERLION_IMAGE=masterlion:local docker compose up -d --no-deps --force-recreate masterlion
docker network connect masterlion_masterlion-net masterlion
docker start masterlion
```

### 健康检查

```bash
docker logs masterlion --tail 10  # 等待 "✅ Gateway: Started successfully."
curl -s -o /dev/null -w "%{http_code}" http://localhost:3210/  # 302 → /signin
```

---

## 七、本次 PR 改动文件

| 文件 | 改动 |
|------|------|
| `src/layout/GlobalProvider/CacheHydrationGate.tsx` | 门控增加 aihub runtime state 就绪检查 |
| `apps/server/src/routers/lambda/aiProvider.ts` | `getAiProviderRuntimeState` 自动恢复缺失凭证 |
| `src/routes/onboarding/features/TelemetryStep.tsx` | `'Lobe AI'` → `BRANDING_NAME` |
| `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx` | `'Lobe AI'` → `BRANDING_NAME` |

净增 42 行，删除 4 行。type-check（`tsgo --noEmit`）通过，eslint 通过。
