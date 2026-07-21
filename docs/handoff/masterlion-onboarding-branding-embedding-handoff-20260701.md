# Masterion Onboarding 品牌修复与测试环境运维交接

更新时间：2026-07-01

版本：v0.0.10

## 概述

本文档记录 v0.0.10 发布周期内完成的三项工作：
1. 修复 `/onboarding` 欢迎页残留的 "Lobe AI" 品牌字样
2. 修复用户记忆 embedding 维度与 DB schema 不一致的问题
3. 测试环境镜像更新与验收用户重置流程

同时沉淀「重置验收用户」的标准操作方法，供后续测试复用。

---

## 一、Onboarding 欢迎页 Lobe AI 字样修复

### 背景

`/onboarding` 首页 TelemetryStep 的打字机问候语硬编码了 `name: 'Lobe AI'`，中文环境下渲染为「嘿，你好，我是 Lobe AI」，与 Masterion 品牌（小宗狮）不一致。

### 根因

`src/routes/onboarding/features/TelemetryStep.tsx:73` 与桌面端 `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx:63` 均写死：

```tsx
t('telemetry.title', { name: 'Lobe AI' })
```

而 `BRANDING_NAME`（`小宗狮`）已从 `@lobechat/business-const` 导入（web 端）或可直接导入（桌面端漏导入）。

### 修复内容（PR #21，已合并）

| 文件 | 改动 |
|------|------|
| `src/routes/onboarding/features/TelemetryStep.tsx` | `'Lobe AI'` → `BRANDING_NAME` |
| `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx` | 补 `BRANDING_NAME` 导入并替换 |
| `packages/locales/src/default/onboarding.ts` | `telemetry.title3`: `Loooobe! Let's get started!` → `Ready? Let's get started!` |
| `locales/en-US/onboarding.json` | 同上 en-US 镜像 |

zh-CN 本就已是无 Lobe 文案（`准备好了就开始吧`），无需改动。

### 验证

修复后渲染为「嘿，你好，我是 小宗狮」。

---

## 二、用户记忆 Embedding 维度一致性修复

### 背景

`9059547`（feat: adapt to 2048-dim TI embedding service）把所有 `vector()` 列改成 2048、4 个 RAG 调用点也改成 2048，但**漏改了用户记忆 embedding 路径**。

### 根因

`packages/const/src/userMemory.ts:36` 的 `DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS` 仍是 `1024`，被以下调用点引用：

- `apps/server/src/services/memory/userMemory/embedding.ts:107`（默认维度）
- `apps/server/src/services/memory/userMemory/extract.ts:898,1395`（记忆提取）

导致记忆 embedding 请求 1024 维向量，无法插入 `vector(2048)` 列（pgvector 维度不匹配错误）。

### 修复内容（PR #22，已合并）

| 文件 | 改动 |
|------|------|
| `packages/const/src/userMemory.ts` | `DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS` 1024 → 2048 |
| `apps/server/.../embedding.test.ts` | 测试断言 1024 → 2048 |
| `packages/database/.../userMemories.test.ts` | 测试辅助函数默认值 1024 → 2048 |

### 说明

列名 `summary_vector_1024` / `detailsVector1024` 仍含 "1024" 字样但实际维度已是 2048——这是 9059547 保留的命名，重命名需迁移且无功能影响，保持不动。

---

## 三、测试环境镜像更新

### ACR 镜像构建状态

- ACR 实例：`cri-8velxg2aueo822e4`（实例名 `boen`，深圳）
- 仓库：`biel_client/masterlion`（RepoId `crr-7thpo7idrw2qnt3e`）
- 构建规则：`main` 分支推送触发 `latest` tag 自动构建
- 最新构建：基于 `main` commit `8a8b76b`（v0.0.10 release，含 PR #21 + #22），状态 `SUCCESS`

### ACR 查询命令

```bash
# 查询构建记录
aliyun cr ListRepoBuildRecord --RegionId cn-shenzhen \
  --InstanceId cri-8velxg2aueo822e4 --RepoId crr-7thpo7idrw2qnt3e --PageSize 5

# 查询构建状态
aliyun cr GetRepoBuildRecordStatus --RegionId cn-shenzhen \
  --InstanceId cri-8velxg2aueo822e4 --RepoId crr-7thpo7idrw2qnt3e \
  --BuildRecordId "<record-id>"

# 查询镜像 tags
aliyun cr ListRepoTag --RegionId cn-shenzhen \
  --InstanceId cri-8velxg2aueo822e4 --RepoId crr-7thpo7idrw2qnt3e
```

### 测试环境镜像更新步骤

测试环境（`mlai-test.bielcrystal.com`）用 `docker-compose.custom.yml`，默认镜像走 ACR VPC 端点，但本机不在 VPC 内，需用公网端点拉取后 retag。

```bash
# 1. 获取 ACR 临时凭据（每小时刷新）
aliyun cr GetAuthorizationToken --RegionId cn-shenzhen --InstanceId cri-8velxg2aueo822e4
# 返回 TempUsername (cr_temp_user) + AuthorizationToken

# 2. 登录（用临时 token 作密码）
echo "<AuthorizationToken>" | docker login boen-registry.cn-shenzhen.cr.aliyuncs.com \
  -u cr_temp_user --password-stdin

# 3. 拉取镜像（公网端点）
docker pull boen-registry.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion:latest
docker pull boen-registry.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion-aihub-db-bridge:latest

# 4. retag 为 -local（compose 用 -local tag）
docker tag boen-registry.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion:latest masterlion:local
docker tag boen-registry.cn-shenzhen.cr.aliyuncs.com/biel_client/masterlion-aihub-db-bridge:latest masterlion-aihub-db-bridge:local

# 5. 重启容器（显式传 IMAGE 变量，避免 compose 重新拉 VPC 端点）
cd /root/MasterLion/docker-compose/deploy
MASTERLION_IMAGE=masterlion:local MASTERLION_BRIDGE_IMAGE=masterlion-aihub-db-bridge:local \
  docker compose -f docker-compose.custom.yml up -d --force-recreate --no-deps masterlion
```

### 注意

- compose 文件默认镜像是 `boen-registry-vpc.cn-shenzhen...`（VPC 端点），本机 DNS 解析不到，必须用环境变量 `MASTERLION_IMAGE` 覆盖为已 retag 的 `masterlion:local`。
- `--no-deps` 避免重建依赖的 postgres/redis/bridge（它们已健康运行）。

---

## 四、Embedding 请求参数同步

### 背景

测试环境 `.env` 缺失 embedding 配置，文件上传后向量化失败。

### 生产配置（`/root/masterlion_prd/deploy/.env.prod`）

```env
DEFAULT_FILES_CONFIG=embedding_model=newapi/text-embedding-3-large,query_mode=full_text
CHUNKS_AUTO_EMBEDDING=1
```

### 已同步到测试环境

`/root/MasterLion/docker-compose/deploy/.env`（gitignored）已写入相同配置，插在 S3 与 Aihub 配置之间。

### 维度匹配注意

- 本地 `9059547` 把 embedding 维度改成了 2048（针对腾讯 TI，不支持 Matryoshka 截断）
- 生产/测试配的 `text-embedding-3-large` 是 OpenAI 系（支持 `dimensions` 参数，默认 3072 维）
- 代码硬编码请求 `dimensions: 2048`，DB 列为 `vector(2048)`，二者一致，向量可正常插入

---

## 五、重置验收用户的标准方法

验收用户 `10193226`（陈灿，企业微信 SSO 登录）用于端到端验证。有两种重置方式，按需选择。

### 方式 A：仅重置 Onboarding（保留数据，可逆）

适用场景：只需重新走 onboarding 欢迎流程验证，保留聊天/Agent/文件数据。

```bash
USER_ID="user_UInHtOcDErRDlfs7YZW9UA9lB35"

# 1. 清空 onboarding 状态（DB）
docker exec masterlion-postgres psql -U postgres -d lobechat -c \
  "UPDATE users SET onboarding = NULL WHERE username = '10193226';"

# 2. 清除 Redis session（强制下次访问重新加载用户状态）
docker exec masterlion-redis redis-cli -a <REDIS_PASSWORD> --no-auth-warning \
  DEL "lobechat:better-auth:active-sessions-${USER_ID}"

# 3. 刷新页面用企业微信重新登录 → 自动进入 /onboarding
```

`onboarding` 字段重置为 `NULL` 后，`finishedAt` 清除，前端判定 onboarding 未完成，重定向到 `/onboarding`。

### 方式 B：彻底删除用户（级联清空所有数据，不可逆）

适用场景：需要从零开始完整测试（新用户注册 → onboarding → 对话）。

```bash
USER_ID="user_UInHtOcDErRDlfs7YZW9UA9lB35"

# 1. 删除用户（所有 FK 级联 CASCADE，自动清理 agents/topics/messages/files 等）
docker exec masterlion-postgres psql -U postgres -d lobechat -c \
  "DELETE FROM users WHERE username = '10193226';"

# 2. 清除 Redis session
docker exec masterlion-redis redis-cli -a <REDIS_PASSWORD> --no-auth-warning \
  DEL "lobechat:better-auth:active-sessions-${USER_ID}"

# 3. 刷新页面用企业微信重新登录 → 创建全新用户 → 进入 onboarding
```

### 级联删除影响范围

`users` 表有 30+ 外键约束，全部 `ON DELETE CASCADE`。删除用户会自动清空：

- `agents` / `agents_files` / `agents_knowledge_bases` / `agents_to_sessions`
- `topics` / `messages` / `messages_files` / `message_chunks` / `message_plugins` / `message_queries` / `message_tts` / `message_translates`
- `files` / `file_chunks` / `chunks` / `embeddings` / `unstructured_chunks`
- `knowledge_bases` / `knowledge_base_files`
- `sessions` / `session_groups`
- `user_settings` / `user_installed_plugins`
- `async_tasks` / `threads`
- `rag_eval_*` 系列
- `ai_models` / `ai_providers`
- `oidc_*` 系列
- `global_files`（`ON DELETE SET NULL`，不级联）

### 查找用户的 user_id

```bash
docker exec masterlion-postgres psql -U postgres -d lobechat -c \
  "SELECT id, username, email, full_name FROM users WHERE username = '10193226';"
```

### Onboarding 状态字段结构

`users.onboarding` 是 jsonb 列，结构为：

```json
{
  "version": 1,
  "finishedAt": "2026-06-23T16:25:12.392Z",
  "currentStep": 4
}
```

- `finishedAt` 存在 → onboarding 已完成，不再进入欢迎页
- `finishedAt` 不存在 / 整个字段为 NULL → 进入 onboarding 流程

---

## 六、本地与远端 Git 状态

### 分支与 PR

| 分支 | PR | 状态 | 内容 |
|------|-----|------|------|
| `fix/onboarding-lobe-ai-text` | #21 | MERGED | onboarding Lobe AI 字样修复 |
| `fix/embedding-dimensions-consistency` | #22 | MERGED | 用户记忆 embedding 维度对齐 |

### commit 9059547 说明

`9059547`（远端）与本地曾经的 `58dc9dca`（已丢弃）patch-id 完全相同（`d8044ef5`），是同一个 embedding 2048 提交。远端历史里多了 release v0.0.9 + PR #20 合并，导致哈希不同。本地 `main` 已 reset 对齐远端 `9059547`。

### 当前 main

```
8a8b76b 🔖 chore(release): release version v0.0.10 [skip ci]
```

---

## 七、环境清单

| 环境 | 域名 | 部署目录 | 镜像 |
|------|------|----------|------|
| 生产 | masterlion.bielcrystal.com | `/root/masterlion_prd`（k8s） | ACR `latest` |
| 测试 | mlai-test.bielcrystal.com | `/root/MasterLion/docker-compose/deploy` | `masterlion:local`（retag 自 ACR） |

### 生产 .env 位置

`/root/masterlion_prd/deploy/.env.prod`（gitignored，本机另一路径，非仓库内）

### 测试 .env 位置

`/root/MasterLion/docker-compose/deploy/.env`（gitignored）
