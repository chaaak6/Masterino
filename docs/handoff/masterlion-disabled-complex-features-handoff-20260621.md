# Masterion 暂时禁用复杂功能交接

更新时间：2026-06-21

## 目标

本文件集中记录当前为了先稳定聊天、群聊、Aihub 模型和基础设置体验而暂时禁用、隐藏或降级的复杂功能，方便后续逐项恢复。

当前产品收敛原则：

- 保留：Chat、Group Chat、Settings、Aihub / NewAPI 基础模型使用链路。
- 禁用但保留灰态入口或禁用页：复杂非聊天核心能力，后续可逐项恢复。
- 隐藏：内部评测、开发工具等不适合当前用户直接访问的能力。
- 降级：上传链路保留，自动 embedding / 向量化暂时关闭。

## 总开关位置

主要配置在：

- `packages/app-config/src/productFeatures.ts`
- `src/features/ProductFeatureGate/index.tsx`
- `src/features/ProductFeatureGate/FeatureDisabledPage.tsx`

当前状态：

| Feature key | 状态 | 当前处理 | 主要影响 |
| --- | --- | --- | --- |
| `chat` | enabled | 正常可用 | 核心聊天 |
| `groupChat` | enabled | 正常可用 | 群聊 |
| `settings` | enabled | 正常可用 | 通用设置、Aihub / NewAPI 设置 |
| `advancedSettings` | disabled | 访问显示禁用页 | Agent channel、高级 workspace 设置 |
| `community` | disabled | 灰态入口 + 禁用页 | 社区 / Discover / 市场类页面 |
| `generation` | disabled | 灰态入口 + 禁用页 | 图片生成、视频生成 |
| `resources` | disabled | 灰态入口 + 禁用页 | Resource / Knowledge Base 页面 |
| `pages` | disabled | 灰态入口 + 禁用页 | Page / 文档页面工作台 |
| `memory` | disabled | 灰态入口 + 禁用页 | 记忆管理页面 |
| `tasks` | disabled | 灰态入口 + 禁用页 | 跨 agent 任务工作台 |
| `fleet` | disabled | 访问显示禁用页 | Fleet 多 agent dashboard |
| `eval` | hidden | 直接重定向到 `/agent` | 评测页面 |
| `devtools` | hidden | 直接重定向到 `/agent` | 内部开发工具页 |

`disabled` 与 `hidden` 的差异：

- `disabled`：`featureGateElement` 渲染 `FeatureDisabledPage`，导航可灰态展示，并通过 `productFeatures.disabled` 给统一提示。
- `hidden`：`featureGateElement` 直接 `redirectElement('/agent')`，导航入口不展示。

## 路由拦截范围

桌面 / Web SPA：

- `src/spa/router/desktopRouter.config.tsx`
- `src/spa/router/desktopRouter.config.desktop.tsx`

当前被 gate 的主要路由：

| 功能 | 路由 | Feature key |
| --- | --- | --- |
| Agent 高级 channel | `/agent/:aid/channel` | `advancedSettings` |
| Fleet | `/fleet` | `fleet` |
| Community / Discover | `/community/*` | `community` |
| Resources / Knowledge Base | `/resource/*` | `resources` |
| Memory | `/memory/*` | `memory` |
| Video generation | `/video` | `generation` |
| Image generation | `/image` | `generation` |
| Eval | `/eval/*` | `eval` |
| Tasks / Task detail | `/tasks`, `/task/:taskId` | `tasks` |
| Pages | `/page`, `/page/:id` | `pages` |
| Workspace Skill / Stats / Plans / Billing / Credits / Usage / Creds / API Key / Storage | `/:workspaceSlug/settings/*` 部分子页 | `advancedSettings` |
| Devtools | `/devtools/*` | `devtools` |

移动端：

- `src/spa/router/mobileRouter.config.tsx`

当前被 gate 的主要路由：

| 功能 | 路由 | Feature key |
| --- | --- | --- |
| Community / Discover | `/community/*` | `community` |
| Tasks / Task detail | `/tasks`, `/task/:taskId`, `/agent/:aid/task/:taskId` | `tasks` |
| Workspace Plans / Billing / Credits / Usage | `/:workspaceSlug/settings/*` 部分子页 | `advancedSettings` |

## 导航与入口收敛

桌面侧边栏由 `src/hooks/useNavLayout.ts` 统一收敛：

- 灰态展示：Tasks、Pages、Generation、Community、Resources、Memory。
- Memory 在 workspace 模式隐藏，个人模式显示但 disabled。
- Eval footer 入口由 `isProductFeatureHidden('eval')` 隐藏。
- User panel 中 Data Importer 与 Memory 入口当前固定不展示。

自定义侧边栏弹窗：

- `src/routes/(main)/home/_layout/Body/CustomizeSidebarModal.tsx`
- Tasks、Pages、Generation、Community、Resources、Memory 同步 disabled。

移动端底栏：

- `src/routes/(mobile)/_layout/NavBar.tsx`
- Community 当前按 `community` feature 状态置灰。

统一禁用文案：

- `packages/locales/src/default/common.ts`
- `locales/en-US/common.json`
- `locales/zh-CN/common.json`

当前 `productFeatures.disabled*` 文案为“敬请期待”，后续建议替换为更明确的 Masterion 口径，例如“当前聚焦聊天与 Aihub 模型能力，复杂功能正在整理中”。

## 已临时降级的上传 / 向量化能力

文件上传链路保留，但自动 embedding 暂时关闭：

- 配置位置：`docker-compose/deploy/.env`
- 当前值：`CHUNKS_AUTO_EMBEDDING=0`
- 相关交接：`docs/handoff/upload-s3-jwks-embedding-handoff-20260620.md`

原因：

- `/api/upload/s3-proxy` 对象上传已验证可用。
- 文件行创建与 chunking 已验证可用。
- 自动 embedding 打开后会创建向量化任务，但账号 `10193226` 当前在 Aihub 可访问模型中没有 embedding 模型，任务失败为 `EmbeddingError: ModelNotFound`。

恢复前置条件：

1. Aihub 为目标用户组 / token 暴露可用 embedding 模型。
2. 配置：

```bash
DEFAULT_FILES_CONFIG="embedding_model=newapi/<real-embedding-model>,query_mode=full_text"
CHUNKS_AUTO_EMBEDDING=1
```

3. 重启 `masterlion`。
4. 用 `/resource` 上传文件验证 chunk task 和 embedding task 都为 `success`。

注意：当前 `resources` 页面本身被 product feature gate 禁用。即使恢复 embedding，也需要同时决定是否恢复 `resources` / knowledge base UI。

## 存在实现但当前未启用或未闭环的能力

### Dev reverse proxy

位置：

- `scripts/devStartupSequence.mts`
- `docker-compose/deploy/docker-compose.hot.yml`

状态：

- `scripts/devStartupSequence.mts` 保留 `DEV_REVERSE_PROXY` 同源 dev reverse proxy 实现。
- 当前 hot compose 按用户要求回到直接访问 Vite `:9876` 的代理方式，没有启用同源 reverse proxy。

恢复前需验证：

- HMR 是否稳定。
- JS / CSS MIME type 是否正确。
- auth callback 和动态 origin 是否仍正确。
- Debug proxy URL 是否仍符合线上环境访问方式。

### NewAPI 托管 token 切换

位置：

- `src/routes/(main)/settings/provider/detail/newapi/index.tsx`
- `apps/server/src/services/newApi/index.ts`
- `packages/types/src/newApi.ts`

状态：

- 设置页已能展示 Aihub managed tokens 下拉。
- 当前下拉选择只影响 UI 展示，不会把选中 token 写回绑定关系。

恢复 / 完善方向：

1. 增加后端 mutation：按当前用户 / workspace 安全切换 managed token。
2. 服务端校验 token 属于当前 Aihub 用户，不能暴露 token key。
3. 切换后重新拉取模型、余额、用量。
4. 增加前端保存态、失败提示和测试。

### 企业 RBAC / Capability / SSO 管理闭环

位置：

- `docs/handoff/masterlion-enterprise-architecture-plan-20260620.md`
- `apps/admin/*`

状态：

- 已有企业架构规划与 `apps/admin` 初步页面。
- Web 端当前主要靠静态 `PRODUCT_FEATURES` 收敛复杂入口，还没有接入服务端 RBAC capability。

后续方向：

1. 服务端提供 `enterpriseCapabilities.current`。
2. Web 关键入口从静态 feature gate 过渡到服务端 capability。
3. 管理后台维护角色、组织、SSO、Aihub 初始化和审计。
4. 所有关键 mutation 增加服务端鉴权，不能只依赖前端禁用。

## 各功能恢复建议

### Resources / Knowledge Base

当前状态：disabled。

恢复前置：

- 明确对象存储配置和 `/api/upload/s3-proxy` 已稳定。
- 决定是否启用 embedding；若启用，需要 Aihub embedding 模型。
- 确认 knowledge base 权限、资源可见范围和失败提示。
- 补齐上传、chunk、embedding、检索的 Playwright 主链路。

建议优先级：P0/P1。它和企业知识库、文件问答直接相关，但依赖对象存储与 embedding 模型。

### Community / Discover / Market

当前状态：disabled。

恢复前置：

- 去除旧 LobeHub / LobeChat 市场化文案和视觉。
- 明确 Masterion 内部市场是否需要 agent、skill、mcp、model、provider 全量模块。
- 接入企业可见范围和审核策略。

建议优先级：P2。当前内部工作台不必优先恢复外部社区体验。

### Generation

当前状态：disabled，覆盖 `/image` 和 `/video`。

恢复前置：

- 确认 Aihub 暴露的图片 / 视频模型与调用协议。
- 确认生成结果存储、审核、额度扣费和失败提示。
- 替换旧生成页里的外部品牌素材。

建议优先级：P2，除非业务明确需要图片 / 视频生成。

### Pages

当前状态：disabled。

恢复前置：

- 明确 Page 工作台在 Masterion 中的定位：文档编辑、知识沉淀，还是分享页。
- 替换旧品牌视觉和分享图。
- 梳理与 Resources / Knowledge Base 的关系，避免两个内容系统并行造成用户困惑。

建议优先级：P1/P2。

### Memory

当前状态：disabled，个人模式侧边栏可见但灰态，workspace 模式隐藏。

恢复前置：

- 明确企业环境下记忆的隐私、保留周期和可删除策略。
- 接入 workspace / 组织权限和审计。
- 补齐用户可解释的启停入口。

建议优先级：P1/P2。隐私和合规口径明确前不建议贸然打开。

### Tasks

当前状态：disabled。

恢复前置：

- 明确任务工作台与聊天内 agent task detail 的边界。
- 校准任务状态、责任人、工作区权限和通知。
- 保证跨 agent 任务不会绕过当前 Aihub 模型能力和权限收敛。

建议优先级：P1。

### Fleet

当前状态：disabled。

恢复前置：

- 明确多 agent dashboard 的目标场景。
- 验证多 agent 并发、成本、模型权限和失败隔离。
- 与群聊能力去重。

建议优先级：P2。

### Advanced Settings

当前状态：disabled。

影响：

- Agent channel。
- Workspace skill、stats、plans、billing、credits、usage、creds、apikey、storage 等部分高级设置页。

恢复前置：

- 区分“企业管理员设置”和“普通用户设置”。
- 与 `apps/admin` 权限模型对齐。
- 高风险配置需要服务端权限校验和审计。

建议优先级：P0/P1。部分 Aihub / 企业管理配置后续会需要逐项放开，但不能一次性打开所有高级页。

### Eval / Devtools

当前状态：hidden。

恢复前置：

- 仅面向内部管理员或开发者。
- 放到独立 admin/dev 入口，并受权限保护。
- 不在普通用户导航中展示。

建议优先级：内部 P2。

## 恢复通用检查清单

每恢复一个 feature key，至少检查：

1. `packages/app-config/src/productFeatures.ts` 状态是否需要从 `disabled` / `hidden` 改为 `enabled`。
2. 桌面、Electron 同步路由、移动端路由是否都覆盖：
   - `src/spa/router/desktopRouter.config.tsx`
   - `src/spa/router/desktopRouter.config.desktop.tsx`
   - `src/spa/router/mobileRouter.config.tsx`
3. 导航是否匹配：
   - `src/hooks/useNavLayout.ts`
   - `src/routes/(main)/home/_layout/Body/CustomizeSidebarModal.tsx`
   - `src/routes/(mobile)/_layout/NavBar.tsx`
4. 禁用页和 tooltip 文案是否同步更新默认、en-US、zh-CN。
5. 是否仍有 LobeHub / LobeChat / Lobe AI 用户可见文案或视觉。
6. 是否需要服务端 RBAC / capability，而不是只改前端 gate。
7. 是否补齐定向测试和必要 Playwright 主链路。

建议定向测试：

```bash
bunx vitest run --silent='passed-only' \
  packages/app-config/src/productFeatures.test.ts \
  src/hooks/useNavLayout.test.tsx
```

涉及路由时同时跑：

```bash
bunx vitest run --silent='passed-only' src/spa/router/desktopRouter.sync.test.tsx
```

涉及上传 / knowledge base 时参考：

- `docs/handoff/upload-s3-jwks-embedding-handoff-20260620.md`

涉及视觉替换时参考：

- `docs/handoff/masterlion-lobe-visual-replacement-checklist-20260620.md`

涉及企业能力时参考：

- `docs/handoff/masterlion-enterprise-architecture-plan-20260620.md`
