# 模型说明维护与静默刷新方案（初始讨论记录）

后续已确定进入主界面后检查一次、每 30 分钟检查，以及独立静默链路与开关。当前实现和验收见 `../testing/model-catalog-bdd-20261013.md`；下文保留初始调研与方案比较。

日期：2026-10-13。源码基准：最新远端 `main`，`87705b4166292b5366af272eb56ec3149fc1cfb4`。
工作分支：`codex/model-catalog-maintenance`。本次只调研、记录方案，没有实现功能。

## 建议结论

在现有 Masterino 企业管理后台增加独立“模型目录”页；说明、能力、上下文、参数限制存 Masterino PostgreSQL。Aihub bridge 提供模型发现和用户调用权限，Aihub 的价格接口提供计费数据。增加统一的 EffectiveModelCatalog 模块，客户端选型、模型设置、服务端预检和运行开始时的能力快照都通过这个模块取得一致数据。

静默刷新采用“只读目录快照 + 内容版本 + SWR 前台轮询/唤醒/网络恢复”，不调用会创建或修复 token 的同步方法，也不在说明发布时批量更新每个用户的模型表。第一版不必新增 WebSocket 或 SSE。

## 已确认的代码事实

| 事实                                                                                                                                      | 源码依据                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理后台已经是独立的 Vite/React 应用，有资源目录、审计、用户可用性等页面，无模型说明管理页面                                              | `apps/admin/src/App.tsx:1`，`apps/admin/src/layout/AdminShell.tsx:25`                                                                       |
| 后台使用同一 Masterino 服务的 TRPC；生产和测试后台的 `/trpc` 都路由到各自环境 Masterino 服务                                              | `apps/admin/src/lib/trpc.ts:11`；`k8s/overlays/production-admin-cutover/ingress.yaml:23`；`k8s/overlays/test-admin-cutover/ingress.yaml:23` |
| 已有 admin 接口、细分权限检查和企业审计写入模式；adminProcedure 本身仅含认证和 DB，不能仅凭其名称认为有管理员授权                         | `apps/server/src/routers/lambda/admin.ts:1555`、`:1920`；`apps/server/src/services/enterprise/adminPermissionService.ts:142`                |
| `ai_models` 是按用户组织的数据，不是企业全局目录；有 displayName、description、organization、abilities、context、pricing、settings 等字段 | `packages/database/src/schemas/aiInfra.ts:78`                                                                                               |
| 已有模型 kind、输入模态三态、人工覆盖、provider metadata、内置目录、observed 证据合并与 drift                                             | `packages/types/src/modelCatalog/index.ts:1`；`packages/business/model-bank/src/modelCatalog.ts:33`、`:493`                                 |
| 人工覆盖包含 context、maxOutput、输入模态，但 functionCall、reasoning 等能力尚不属于这个三态合并契约；现有物化路径仍从内置目录取这些能力  | `packages/business/model-bank/src/modelCatalog.ts:48`；`apps/server/src/services/newApi/index.ts:358`                                       |
| 同步从 bridge 取得允许的模型 ID，再用 `/v1/models` 补充 metadata，并加载静态 model-bank                                                   | `apps/server/src/services/newApi/index.ts:258`、`:1165`                                                                                     |
| bridge 已按用户 group 的 enabled abilities 与 token model_limits 交集查询模型                                                             | `apps/aihub-db-bridge/src/repository.ts:435`                                                                                                |
| 已有 Aihub 人民币价格、账户/公共 scope、倍率、输入/输出/缓存/按次/阶梯价格、stale/unsupported 表达                                        | `apps/server/src/services/newApi/index.ts:1079`；`apps/server/src/services/newApi/pricing.ts:131`                                           |
| 截图中的详情展示已有基础：上下文、能力、Aihub 价格组件                                                                                    | `src/features/ModelSwitchPanel/components/ModelDetailPanel.tsx:1`；`src/features/ModelSwitchPanel/components/AihubPricing.tsx:1`            |
| runtime state 查询明确只读，仅读取现有本地记录并解析价格展示，不会同步 Aihub 变化                                                         | `apps/server/src/routers/lambda/aiProvider.ts:130`；`packages/database/src/repositories/aiInfra/index.ts:272`                               |
| 客户端已有 SWR 和 store 整体更新逻辑，可复用而无需重载页面                                                                                | `src/store/aiInfra/slices/aiProvider/action.ts:474`、`:553`                                                                                 |
| Agent 开始执行时已有 operation-frozen 模型能力快照，应延续这个语义                                                                        | `apps/server/src/services/aiAgent/index.ts:748`、`:1785`                                                                                    |

线上后台 URL 的公开抓取未成功，未验证实际部署版本和登录后 UI；上述判断来自当前 main 源码和部署配置。仓库 AGENTS.md 引用的 `.agents/skills/ux/SKILL.md` 未存在，故本稿不声称完成该技能要求的界面验收。

## 数据职责与维护体验

### 模型说明：Masterino 为事实来源

新增全局目录表，例如 `managed_model_catalog`，以 `(providerId, modelId)` 精确唯一。第一版 provider 限定 `newapi`；原厂/品牌另作字段，不能把品牌当调用 provider。相似别名必须精确绑定、分别覆盖，不做字符串模糊匹配。

建议维护字段：

- 身份：调用 ID（不可随意改名）、展示名称、厂商/品牌、模型类别、简介、推荐用途、限制说明、官方资料 URL、模型修订标识。
- 容量：上下文 tokens、最大输出 tokens，分开维护；未验证允许为空。
- 能力：文本、图片、音频、视频、文件输入；工具调用、推理、结构化输出、联网搜索、图像输出。所有可验证能力使用支持/不支持/待确认三态，并记录来源、验证时间、维护者。
- 条件能力与参数：如推理开启时工具调用限制、最大图片数量、文件限制、可用推理档位。先只实现已有运行路径实际需要的结构化字段；其它限制为说明，不能凭说明自动打开运行参数。
- 管理：草稿、已发布修订、维护负责人、变更原因、乐观并发版本、最后发现时间。

已发布记录始终独立于草稿。不要通过把一条记录状态改成 draft 来让客户端丢掉旧的发布内容。可用独立修订表保存历史，目录主表指向 active revision；发布和回滚都事务性推进目录 generation，防止旧客户端响应覆盖新状态。

新增模型只自动发现为“待完善”，不伪造能力和容量。建议默认仍沿用现有允许的聊天新模型可见策略（`classifyModelKindById` 对未知 ID 的 default chat），能力展示待确认；非聊天分类继续分流。企业全局隐藏/停用属于额外模型治理策略，若第一版要加，单独命名和记录，不与“草稿未发布”混用。

### 模型发现与权限：bridge 为事实来源

后台需要一个新的服务端受控发现接口：读取所有启用的 abilities 的 distinct model ID，可以附最近发现状态；不能用某个管理员自己的可访问集合代表全平台目录。发现不等于授权，不向普通客户端返回其它 group 的模型。bridge 不保存运营说明、不连接 Masterino DB，不增加新的 Aihub 写入权限。

用户列表必须使用当前已绑定 token ID 及其 owner，读取 token 状态、expiry、group/model_limits 和账号状态。现有 group 授权计算应保持一致，不能未经 Aihub 语义核实就改成 token.group。计费 group 的选择和调用权限 group 的选择是不同问题。

### 价格：实际计费与参考说明分开

源码已经对接 `/api/pricing` 和 `/api/status`，因此“AIHub 不维护模型说明”不意味着“AIHub 没有价格数据”。截图里的 RMB 输入/输出/缓存价格应复用 Aihub 的有效价，不再人工复制一份覆盖它。

后台展示实际计费价及来源、scope、更新时间；需要运营维护官方/参考价时增加独立的 referencePricing，带币种、单位、适用条件、生效时间和来源。公共价、账户价、官方价不可混称，缺失不是免费，stale/unsupported 不得被静默转换为有效价。参考价缺省不替代实际费用；实际扣费仍由 Aihub 完成。

跨时间段、上下文长度、按次等价格继续使用现有类型，不压成 input/output 两个数。价格快照版本需包含倍率、兑换参数及动态生效区间，而不仅是上游 pricing_version。

## 统一有效目录模块

核心关系：

```text
bridge：用户当前可调用 ID 集合 ──┐
Masterino：已发布说明修订 ───────┤
Aihub：当前价格/账户倍率 ────────┼→ EffectiveModelCatalog → 客户端目录 + 服务端模型预检
静态 model-bank 与 observed ────┤                         → operation 能力快照
用户排序/启用/偏好 ────────────┘
```

小接口建议：`readSnapshot(userContext, knownRevision?)`（已变化/未变化/暂不可用），`resolveModel(userContext, modelId)`（授权并取得模型规格）。后台草稿与发布由独立维护模块管理。合并、缓存、价格解析、授权检查留在内部，不让调用者自己拼装五类数据。

数据层次：

1. 调用资格取实时授权集合，说明绝不能增加调用资格；只对允许模型做元数据投影。
2. 已发布精确模型覆盖参与现有证据合并；通常高于 provider metadata 与静态目录。
3. context 的真实 observed rejection 仍可降低宣称上限；管理员普通发布不能抹掉它，forceContextWindow 作为有理由、有期限、有审计的例外。
4. 新增工具/推理等三态能力契约，统一投影到旧 boolean 消费者；unknown 不转换为明确 unsupported，也不能直接启用功能。
5. 个人偏好最后投影，保持启用、排序、收藏、默认选择；企业受管的能力规格由全局已发布目录控制，避免旧 per-user manual 记录永久盖过后台更新。确需用户特例时另定义有审计、到期的 scope。

现有 `ai_models` 保留作为个人偏好与旧接口兼容记录。第一版至少同时改造 runtime state、模型设置列表、Agent 能力快照，以及受管模型的图像/视频和后台自动任务等真实调用入口；不能只修改选择器展示。针对 newapi，旧持久化能力记录不得覆盖当前中央规格和授权。静默读取不写 token、不创建账号、不设置 provider enabled、不批量覆盖用户 model rows；手动同步和 readiness 的建号/凭据职责继续走显式路径。

这样说明发布即可影响后续读取，无需“后台发布后给全量用户执行 syncModels”。旧链路可逐步迁移，但在第一版的消费者范围内必须保持一个最终规格来源。

## 静默刷新协议

建议第一版参数（设计值，不是现有代码事实）：

- 服务端授权缓存约 30–60 秒；价格快照缓存约 60 秒，按账户和真实认证 scope 隔离。按账户/token/revision 防止跨用户缓存混用；共享目录可长缓存，但发布后通过 generation 校验失效。多副本不能仅靠进程内通知。
- 可见、已登录客户端约每 2 分钟探测，带随机抖动；窗口唤醒、网络恢复、打开模型面板时按短节流再探测。隐藏、离线暂停；桌面睡眠唤醒与移动端恢复不能仅假定浏览器 focus 全覆盖。
- 初次读取返回完整有效目录及 revision。后续带 knownRevision；未变化返回小响应，变化返回完整快照，使用 TRPC 的 unchanged 响应即可，不必为 HTTP 304 新建接口。
- revision 为稳定内容摘要，包含允许 ID、已发布相关修订、能力结论、价格显示结果/时间条件和用户偏好版本；排除 fetchedAt 等每次变化的时间戳。只改变其它 group 的模型不应刷新本用户列表。
- 同一次 refresh 原子更新目录、chat/image/video 列表和详情；用认证 scope key、请求序号或服务器单调 generation 丢弃旧请求及旧登录用户的响应。
- 已选模型仍允许则保持；被撤销/停用时保存历史选择，标记不可用，在下次发送前要求重选，不静默换模型。当前流式回复继续；下一次新请求由服务端重新校验调用资格。
- 运行中的 operation 能力快照保持不变；权限撤销必须在下一次真实上游调用时有效，不能被冻结快照长期保留。目录展示允许短缓存；权限敏感调用应新鲜校验或受明确更短 TTL 约束，Aihub 仍是扣费与调用最终执行方。
- 网络/bridge 失败时保留上一次目录作显示并标记 stale；不可把错误响应当空列表删除数据。已知无权限的空集合是有效成功结果，必须立即替换显示；关键授权无法确认时服务端应拒绝新调用，不能回退内置列表扩权。
- 探测去重、超时和指数退避；只对显著可操作错误给用户提示。静默刷新不触发全屏 loading、成功 toast、凭据修复或重新建号。

以 60 秒服务端缓存和 2 分钟前台探测估算，正常前台发现变更的窗口约 3 分钟以内；这是待压测确认的目标，不能宣称即时推送。后台发布可立即推进 generation，下一次读取感知；上游模型变动不依赖后台人工发布。将来真有秒级 SLA 再加事件通知，通知只提示客户端重取目录，轮询保留兜底。

## 现有代码必须一起处理的问题

1. **合法空集合**：`syncModelsForBinding` 对桥返回空列表在 required 模式抛 NOT_FOUND、其它模式可能回退远程 `/v1/models`，无法表达明确无模型。`apps/server/src/services/newApi/index.ts:1175`。bridge client 也把无数据变成 `[]`，需要成功空集合与错误/缺失的显式区别（`bridgeClient.ts:206`）。
2. **精确绑定 token**：服务先按 managedTokenId 取 token，但 bridge listAccessibleModels 只传 tokenName，HTTP 层再次按名称挑 token，可能与实际凭据不一致。`bridgeClient.ts:206`；`apps/aihub-db-bridge/src/http.ts:309`；`newApi/index.ts:667`。发现、同步和 runtime 都应沿用精确 token ID，验证 owner，不能回落到另一个同名 token。
3. **零 Remote 行的 builtin fallback**：部分模型列表通过“有 Remote 行才隐藏 builtin”判断，新空集合会恢复内置模型。须用明确的 managed/initialized 状态，不用数组长度作为授权来源选择。`packages/database/src/repositories/aiInfra/index.ts:446`；该文件 `getEnabledModels` 也需一起改造。
4. **readiness 与空权限**：production readiness 用 modelCount>0 判断可用；空权限应成为明确 entitlement 状态，不当作网络故障而反复 provision。它不能影响目录“成功读到空集合”的语义，也不能沿用历史模型数量伪装为 active。`apps/server/src/services/newApi/readiness/production.ts:163`。
5. **偏好覆盖**：当前远端物化默认 enabled=true，更新远端行时可能重新启用用户关闭的模型；saveManagedProviderToken 还会启用 provider。静默刷新不可直接复用这些副作用。`apps/server/src/services/newApi/index.ts:221`、`:638`、`:1133`。
6. **能力变更一致性**：后台修改 tool/reasoning 等能力，现有合并类型尚未能接收；必须扩充类型、merge、DTO、前后端投影。contextWindowTokens 不能只有 UI 变更，必须进入同一 runtime 快照。`newApi/index.ts:316`；`modelCatalog.ts:48`；`aiAgent/index.ts:748`。

## 后台第一版范围与迁移

建议有模型目录列表、发现更新、缺失资料筛选、精确 ID 详情、能力/容量/说明编辑、来源和计费信息、草稿预览、发布和回滚、审计。说明主表不塞进一个 system_configs 大 JSON：独立表便于唯一约束、搜索、修订和并发编辑；已有 system_configs 更适合配置项（`packages/database/src/schemas/enterprise.ts:49`）。

权限建议新增 `model_catalog:read/manage/publish`，沿用现有 RBAC/legacy admin 兼容规则并显式执行；发布影响所有用户应记录 before/after、维护原因、revision、操作者。后端 schema 校验容量为正整数、价格为精确合法数值、受控枚举，不能允许后台填写任意运行脚本。

初始数据从 bridge 全量发现 + model-bank 精确匹配导入草稿，保留来源，批量人工核验后发布。不要把名称猜测来的值当成 verified。不需要一次把所有历史模型补完，未完善仍有明确状态。测试、生产说明数据分库；后续可加按精确 ID 导出/导入草稿，生产发布与实际权限独立，不自动覆盖生产 token/授权/价格。

实施顺序：

1. 扩展模型能力契约、目录 schema/repository/修订/审计和 bridge 精确 token/发现接口。
2. 做统一只读有效目录，修复空集合/fallback，将选择器、设置、预检和能力快照接入。
3. 加后台编辑/发布/回滚，复用现有详情和价格展示，增加来源/待确认状态。
4. 加客户端版本刷新、唤醒与断网处理、性能和业务验收；在测试环境验证后按正常发布流程上线。

关键验收：新增上游模型自动出现；已发布能力无需重新登录更新；空权限清空可选集合；同名多 token 精确过滤；价格及倍率更新；其它用户不可见的数据不泄露；偏好不重置；撤销当前选择不换模型；断网不丢目录；过期响应不回滚；运行中快照不漂移；下一次调用重新校验；轮询不创建 token；多副本发布失效一致。实际改动时只跑对应 Vitest，不跑全量 test。本次没有代码变更，不运行功能测试。

## 讨论时需要确定的产品语义

- 推荐默认：主价格展示 Aihub 实际计费价，后台维护的是模型说明/能力；若要填价格，填独立参考价，不能改变真实扣费。
- 推荐默认：新增已授权模型自动可见但显示资料待完善；草稿不阻挡调用。是否增加“必须审核才开放”的全局治理策略，应单独作产品决策。
- 推荐默认：前台约 3 分钟内静默感知，唤醒和面板打开加速刷新；无需第一版推送设施。

补充代码链路分析见同目录 `model-catalog-client-refresh-20261013.md`。
