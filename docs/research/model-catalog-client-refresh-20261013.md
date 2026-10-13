# 模型目录与客户端静默刷新源码调研

基准：`origin/main` / `87705b4166292b5366af272eb56ec3149fc1cfb4`，2026-10-13。本文为方案调研，不实现功能。源码引用使用仓库相对路径和一基行号。

## 已有能力

1. 模型目录并非从零开始：`ModelCatalogEntry` 已含模型类型、上下文、最大输出、输入模态三态（supported / unsupported / unknown）、证据来源、验证时间、上游 revision；操作快照已有独立 `ModelCatalogSnapshot`。目前它不含显示名称、价格、工具调用与 reasoning 等完整产品能力。[packages/types/src/modelCatalog/index.ts:1](../../packages/types/src/modelCatalog/index.ts#L1)、[同文件:23](../../packages/types/src/modelCatalog/index.ts#L23)、[packages/model-bank/src/types/aiModel.ts:36](../../packages/model-bank/src/types/aiModel.ts#L36)。
2. 合并引擎已有 `manual`、上游 metadata、内置 catalog、observed；manual 必须有 owner/reason/createdAt，可过期。上下文拒绝观测能降低有效窗口（forceContextWindow 特例），合并输出 drift 供追踪。直接扩展这个 seam 比另写一套能力判定稳妥。[packages/business/model-bank/src/modelCatalog.ts:49](../../packages/business/model-bank/src/modelCatalog.ts#L49)、[同文件:234](../../packages/business/model-bank/src/modelCatalog.ts#L234)、[同文件:443](../../packages/business/model-bank/src/modelCatalog.ts#L443)、[同文件:489](../../packages/business/model-bank/src/modelCatalog.ts#L489)。
3. `ai_models` 是用户级投影，PK `(id, providerId, userId)`，列已有 description/pricing/abilities/contextWindowTokens/settings。不能直接当全局维护主表；应另建部署级目录，再按用户授权投影到现有 DTO。[packages/database/src/schemas/aiInfra.ts:71](../../packages/database/src/schemas/aiInfra.ts#L71)。
4. `NewApiService.materializeNewApiModel` 从用户旧行取 manual/observed，并合并上游 metadata 与本地 model-bank；同步会事务性更新 remote 行、插入新增行、删除撤销行。新增管理目录需要在这里或其后继统一投影服务读取全局 override，避免每个用户各维护一份全局信息。[apps/server/src/services/newApi/index.ts:313](../../apps/server/src/services/newApi/index.ts#L313)、[同文件:1119](../../apps/server/src/services/newApi/index.ts#L1119)。
5. 截图所需详情 UI 基本已存在：模型详情由 enabledChatModelList 获取名称、description、context、abilities；输入模态 hook 额外从 enabledAiModels 找完整持久化 catalog，保证列表和详情一致。Aihub 专用价格已显示 CNY 输入/输出/缓存读/缓存写/每请求费用，不可用或 stale 显示暂无价格。[src/features/ModelSwitchPanel/components/ModelDetailPanel.tsx:345](../../src/features/ModelSwitchPanel/components/ModelDetailPanel.tsx#L345)、[src/components/ModelSelect/hooks.ts:22](../../src/components/ModelSelect/hooks.ts#L22)、[src/features/ModelSwitchPanel/components/AihubPricing.tsx:6](../../src/features/ModelSwitchPanel/components/AihubPricing.tsx#L6)。
6. chat normalizer 优先使用 inline description/pricing，否则调用内置 model-bank fallback；现有目录 DTO 兼容管理员维护后的详细信息。注入信息时必须同时更新完整 enabledAiModels 和 normalized lists，避免能力图标与发送前检查不一致。[src/store/aiInfra/slices/aiProvider/action.ts:60](../../src/store/aiInfra/slices/aiProvider/action.ts#L60)、[同文件:101](../../src/store/aiInfra/slices/aiProvider/action.ts#L101)。

## 静默刷新真实现状

全局 DeferredStoreInitialization 已挂载 `useFetchAiProviderRuntimeState`；它使用 `useClientDataSWR`，默认 focus 节流 5 分钟、reconnect 重验证、离线不刷新，无轮询 interval。onSuccess 一次 zustand set 更新所有模型列表与配置。已有 `refreshAiProviderRuntimeState()` mutate 登录与未登录 key，因此“刷新 UI 无须整页刷新”已经具备。[src/layout/GlobalProvider/DeferredStoreInitialization.tsx:14](../../src/layout/GlobalProvider/DeferredStoreInitialization.tsx#L14)、[src/store/aiInfra/slices/aiProvider/action.ts:333](../../src/store/aiInfra/slices/aiProvider/action.ts#L333)、[同文件:463](../../src/store/aiInfra/slices/aiProvider/action.ts#L463)、[src/libs/swr/index.ts:37](../../src/libs/swr/index.ts#L37)。

但 runtime API **只读**本地 user ai_models，显式禁止 SWR polling 触发 Aihub repair；重新取它不等于同步上游模型。上游增删必须先由 `syncModelsForBinding` 重新获取授权模型、同步投影。当前刷新链条缺少这一段。[apps/server/src/routers/lambda/aiProvider.ts:130](../../apps/server/src/routers/lambda/aiProvider.ts#L130)、[packages/database/src/repositories/aiInfra/index.ts:272](../../packages/database/src/repositories/aiInfra/index.ts#L272)、[apps/server/src/services/newApi/index.ts:1165](../../apps/server/src/services/newApi/index.ts#L1165)。

## 必须处理的风险

- 空授权集合：`getEnabledModels` 仅用“存在至少一条 Remote 行”决定隐藏 branding builtin；删掉最后一条 remote 后会恢复内置模型。另一方面只读模式零授权会抛异常，可能遗留旧列表。应持久化/返回 `authoritative` 或同步完成 marker，与模型数解耦。成功获取的空集合就是最新结果，网络/bridge 失败才保留旧快照。[packages/database/src/repositories/aiInfra/index.ts:242](../../packages/database/src/repositories/aiInfra/index.ts#L242)、[apps/server/src/services/newApi/index.ts:1183](../../apps/server/src/services/newApi/index.ts#L1183)。
- 操作 snapshot ≠ 当前授权：客户端与服务端都冻结模型 catalog，保障运行中预算、压缩不漂移；server `resolveFrozenModelCatalog` 检查 chat 类型，没有在这个函数验证最新上游可访问列表。provider readiness 只拿 userId/provider，不拿 modelId，所以不能当逐模型授权 gate。新实现需要在调用上游前按精确 managedTokenId 校验最新可用集合，保留操作能力快照；具体授权入口还需统一覆盖普通 chat、agent、压缩、图像/视频等调用路径。[apps/server/src/services/aiAgent/index.ts:748](../../apps/server/src/services/aiAgent/index.ts#L748)、[apps/server/src/modules/ModelRuntime/index.ts:102](../../apps/server/src/modules/ModelRuntime/index.ts#L102)、[同文件:533](../../apps/server/src/modules/ModelRuntime/index.ts#L533)。
- 当前客户端 snapshot 建立时按 model/provider/operationId 复用，并提前检查最新用户图片；静默更新只影响后续新操作，不应改正在运行的 snapshot。[src/store/chat/slices/aiChat/actions/streamingExecutor.ts:117](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts#L117)、[同文件:243](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts#L243)、[同文件:430](../../src/store/chat/slices/aiChat/actions/streamingExecutor.ts#L430)、[apps/server/src/services/agentRuntime/AgentRuntimeService.ts:511](../../apps/server/src/services/agentRuntime/AgentRuntimeService.ts#L511)。
- SWR workspace key：`useClientDataSWR` 对 key 附加 workspaceId，但 `refreshAiProviderRuntimeState` 原始 mutate key 未附加。新刷新 hook 优先用 bound mutate，或统一 key factory，避免 workspace 场景手动 invalidate 无效。[src/libs/swr/index.ts:21](../../src/libs/swr/index.ts#L21)、[src/store/aiInfra/slices/aiProvider/action.ts:333](../../src/store/aiInfra/slices/aiProvider/action.ts#L333)、[src/libs/swr/mutate.ts:54](../../src/libs/swr/mutate.ts#L54)。

## 建议的增量方案（设计建议，非已有事实）

1. 在 Masterino 管理后台维护全局 `model_catalog_entries`（精确 providerId/modelId），draft/published revisions + 审计历史。字段包括 displayName、description、厂商/logo、kind、上下文、maxOutput、输入/输出模态三态、工具/reasoning/structuredOutput/search；发布后产生 catalog revision。不写 Aihub DB。
2. Aihub bridge 继续负责真实可用集合、精确 token/group 限制；Aihub pricing/status 接口负责实际计费数据；目录只 enrich 可用集合，不能通过填写模型信息授予访问权。管理价格可作为标明来源的参考价；客户端消费 Aihub 实际人民币计费投影，不能让参考价格覆盖用户组/token 的有效费率。
3. 服务端统一 `ModelCatalogService`：bridge access snapshot ∩ 管理状态 + published metadata + fallback catalog + user observed evidence，输出兼容现有模型 DTO。全局发布即时读/失效共享缓存，避免向所有用户 fan-out 更新大量 ai_models。ai_models 保留用户偏好/观测及迁移兼容，逐步移除 metadata 主事实职责。
4. 新增轻量 `getModelCatalogVersion`，返回 opaque revision（包含可用集合/计费/全局信息改变）、authoritative、generatedAt、schemaVersion；实际 revision 必须经服务端有 TTL 的 bridge 探测更新，不能只比较管理表版本。MVP 用 60–120 秒可见在线轮询 + focus/reconnect；changed 时拉取完整投影，无变化不更新 store。不接 readiness provisioning，也不反复重写 provider token。
5. 请求合并/single-flight、短缓存和 jitter 防止所有 app 同时请求；失败保留 last-good UI 数据，返回 stale/freshness 指标；禁止把成功空集合当网络失败。目录 revision 原子配套 models 响应，防止异步旧响应覆盖新版本。
6. 刷新不更改选中的 model 或 agent 持久化配置。已选模型撤销时保留名称并标记不可用，下一次发送提示选新模型；运行中能力/预算 snapshot 保持冻结，上游权限已撤销则调用安全拒绝，不能拿冻结 snapshot 继续越权。
7. 测试聚焦：新增/撤销（含清空全部）模型、目录发布/回滚、metadata unknown 不误报支持、精确 token 限制、bridge 故障保留旧值且不开放旧授权、workspace invalidation、乱序响应、运行中能力 snapshot 稳定与新操作消费新 revision。本文不运行测试，因为没有更改功能代码。

## 只读拼接的过渡调用面与 readiness 协调

- 用 server `EffectiveModelCatalog` 聚合服务替代 `getEnabledModels` 中 newapi 的本地行事实，其他 provider 代码按现有边界处理；`getAiProviderRuntimeState` 返回该结果。设置/管理模型列表 API `aiModel.getAiProviderModelList` 同样需读聚合服务，避免聊天页新目录、设置页旧 ai_models 的分裂。[packages/database/src/repositories/aiInfra/index.ts:194](../../packages/database/src/repositories/aiInfra/index.ts#L194)、[同文件:420](../../packages/database/src/repositories/aiInfra/index.ts#L420)、[apps/server/src/routers/lambda/aiModel.ts:146](../../apps/server/src/routers/lambda/aiModel.ts#L146)。
- 服务端新操作 freeze 通过相同聚合服务按 exact model ID 取能力，不再直接将 user ai_models 行视为最新目录。客户端仍从已更新 store freeze，新请求服务端以可信服务侧目录为准；后续上下文拒绝观测继续写现有 user row，聚合时只读取 observed 与个人偏好，不允许旧 remote metadata/manual 意外盖过全局 published 内容。
- 每次全局发布只更新中央 revision/共享缓存；所有在线用户下次探测再拉新投影，不全量写用户模型表。历史 remote rows 留作迁移兼容/last-good 数据，标明来源与 freshness，但不作为新授权的正证据。
- readiness 当前 provision 将 `Math.max(runtime.modelCount, synced.models.length)` 当模型数量，并要求 `modelCount > 0`；这既将合法零授权视为 entitlement 错误，也可能由旧本地模型数掩盖新的零授权。迁移必须区分“身份/credential 就绪”与“当前目录空、暂不可调用模型”，不能将空授权反复触发 provisioning。账户可保持绑定就绪，模型目录成功返回空集，发送 gate 返回明确模型不可用原因。[apps/server/src/services/newApi/readiness/production.ts:161](../../apps/server/src/services/newApi/readiness/production.ts#L161)。
