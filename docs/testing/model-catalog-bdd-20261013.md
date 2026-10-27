# 模型说明维护与静默刷新验收

2026-10-20 的真实测试环境逐条结果、用例校正与回滚草稿修复见 [PR145 手工验收记录](model-catalog-manual-20261020.md)。本文保留此前 fixture / harness 的历史验证范围，不代表全部手工场景均已通过。

分支 `codex/model-catalog-maintenance` 已于 2026-10-19 rebase 到 `main` 的 `7394fbeb4ca5aa89f5e533f9264305a75ecb1aa0`。实现仍在独立 worktree；后续验收只写入 `masterino-test` 测试集群，不涉及生产环境。

## 实现范围

- 管理后台新增 `/models`：发现 Aihub 模型、搜索和待完善筛选、说明/类别/品牌/输入模态/工具等能力/上下文/最大输出/限制/来源/参考价编辑、草稿预览、发布、历史回滚。
- 元数据存 Masterino 的 `managed_model_catalog` 和 `managed_model_catalog_revisions`；草稿与发布版本分离。复用 `admin:access`、`aihub:manage` 权限及企业审计；版本检查防止并发管理员覆盖修改。
- 调用范围以 bridge 返回的精确绑定 token 授权为准。新协议返回并校验 tokenId；旧 bridge 不确认 ID 时拒绝接受其模型列表。不带 tokenId 的旧请求仍保留旧数组格式，便于旧 Masterino 与新 bridge 共存。
- Aihub 价格保留账户/公共 scope、人民币、缓存读写/阶梯/按次语义；人工参考价独立显示。失败价格不冒充有效价格。
- 新增独立 `modelCatalog.check` 只读接口。发布事务推进共享 DB generation，各服务副本下次读取感知；按用户、绑定和个人模型记录版本隔离缓存。目录缓存 5 分钟，按需重建，不在没有用户请求时持续扫描全部账号。缓存内只有脱敏模型 DTO，合并并发重建，短暂失败退避并保留上次成功目录。
- 进入主界面、已登录且 Aihub 就绪后，延后约 1 秒检查一次；之后每 30 分钟检查。隐藏/离线暂停，逾期恢复补一次，不严格等待 app 空闲。请求限时 45 秒，卸载/切换账号/手动刷新时取消旧请求。
- 打开聊天模型面板时复用同一控制器：距上次成功校验不足 2 分钟则展示现有列表；超过窗口时后台补查，进行中的检查只保留一份。版本变化后原位更新；失败保留旧列表并显示轻量重试。控制器可用时不再触发面板原有的重复 provider runtime 读取；静默链路关闭时仍回到原有读取路径。
- 静默链路不调用 `syncModels`，不建号、不修复凭据、不写用户模型表。原手动同步业务保留，仅增加客户端活动通知和旧响应保护；修改模型偏好会清除静默覆盖，避免重新启用用户关闭的模型。
- 原 SWR 的较旧结果不能覆盖较新静默目录。当前选择不自动替换，失效时标记需重选。运行任务冻结规格（含工具能力），受管 ModelRuntime 的后续调用重新检查授权和所用凭据是否仍匹配绑定。个人记忆 embedding 的模型选择也读取同一有效目录；其他 provider 保持原路径。
- 上下文和最大输出进入说明/能力快照；其余自由文本参数限制作为说明展示，不生成新的厂商请求协议或执行任意配置脚本。

## BDD 环境与边界

独立 PostgreSQL 16，监听本机 `15436`，数据库 `catalog_bdd`。使用真实迁移 SQL、Drizzle repository、TRPC catalog router、权限检查、目录缓存、生产调度器和客户端说明组件。上游 Aihub 与登录会话使用明确的本地 fixture；不调用真实模型、不消费真实额度。客户端使用浏览器时间控制器验证 30 分钟定时行为；运行状态 UI 是专用 harness，生产快照复制和授权逻辑另有服务测试覆盖。

后台与客户端 harness 均从 Vite 构建产物验收，避免 HMR 改写测试中的页面状态。此本地 fixture 验收不等同于真实 Electron 打包安装、IAM 登录或集群发布验收；下方另记录测试版 Electron 对测试集群的真实交互检查。

## 浏览器验收场景

1. 发现模型 → 填写容量与说明 → 保存草稿 → 预览公共价格与待确认能力 → 发布；客户端只取得已发布内容。编辑草稿不改变客户端版本；二次发布与回滚生效。
2. 主界面挂载后检查一次；29 分钟内不再检查，30 分钟时检查；发布后客户端更新，当前选择和运行状态保持；实际客户端说明组件展示输出容量及能力。
3. 手动刷新期间不执行静默检查；结束后恢复调度。静默开关关闭后回到原目录，重新启用后恢复新目录。
4. 隐藏/离线暂停；逾期恢复只补一次。
5. 权限撤销后，下一次真实授权调用路径拒绝请求；成功空目录不回退到内置模型。
6. 100 次已缓存的 HTTP 版本检查全部返回 unchanged，没有新增上游读取。典型本地耗时约 0.6 秒；该数字不代表生产容量上限。
7. bridge 故障保留旧目录并标记 stale，隐藏过期价格；不修改发布记录。
8. 未登录用户被拒绝，普通成员无法维护模型目录。
9. 面板打开时旧列表立即可用；成功检查后 2 分钟内反复打开不新增目录请求。超过 2 分钟、后台发布新版本后，单次检查原位替换列表与详情，同时保留搜索词和当前选择。
10. 面板检查失败后列表不清空，显示轻量重试；重试沿用同一控制器，成功后提示消失。

BDD 自检修正：基础组件的 Motion/主题上下文、弹窗关闭后的截图时机、旧 SWR 覆盖新目录的竞争、工具能力仍从静态配置读取、token 停用误报为网络失败、旧 bridge 不能确认 token ID 的兼容风险、过期价格误显示为当前价格。

## 复现

从仓库根目录执行，以下 PostgreSQL 仅用于本地 fixture，无真实账号密码：

```bash
docker run --detach --rm --name masterino-model-catalog-bdd \
  --publish 127.0.0.1:15436:5432 \
  --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=catalog_bdd postgres:16-alpine

bunx playwright test --config e2e/model-catalog/playwright.config.mts

CATALOG_BDD_DATABASE_URL=postgresql://postgres@127.0.0.1:15436/catalog_bdd \
  bunx vitest run --silent='passed-only' \
  apps/server/src/services/modelCatalog/repository.integration.test.ts

docker stop masterino-model-catalog-bdd
```

Playwright 配置自动启动本地后端、后台构建预览和刷新 harness；后端会清理这个专用数据库中的 fixture 表，请勿替换为业务数据库。结果与截图默认位于 `/tmp/masterino-model-catalog-bdd/`。

## 发布与回滚

1. 先发布新版 bridge：新增模型发现与精确 token 授权响应，无需改变 Aihub schema 或数据库写权限。
2. 对 Masterino 数据库执行迁移 `0124_managed_model_catalog`。
3. 发布 Masterino 服务与管理后台，访问 `/models` 维护并发布资料。未维护模型仍可按已有授权出现，能力保持待确认/已有证据。
4. 后台提供“应用已发布模型说明”和“客户端静默刷新”两个独立开关。关闭静默刷新后，客户端下次检查清除静默覆盖；手动同步入口继续可用。
5. 服务端部署覆盖开关：`MASTERINO_SILENT_MODEL_REFRESH_ENABLED=false` 禁用静默查询；`MASTERINO_MODEL_CATALOG_ENABLED=false` 使目录读路径、中央规格与新增调用 guard 回到旧路径。未设置时默认开启。环境覆盖优先于后台配置，改变环境变量须按现有部署方式重启服务。
6. 回滚应用代码时可保留新表和已维护资料；新 bridge 继续兼容不带 tokenId 的旧模型请求，无需删除数据。

测试集群已启用 `MASTERINO_SILENT_MODEL_REFRESH_ENABLED=true`，用本地测试版 Electron 连测试后端验证静默链路。生产环境未修改。本次客户端改动未构建或部署 Docker 镜像，测试 App 从本分支 worktree 运行。

## 最终验证结果

- 浏览器 BDD：10/10 通过，含实际后台页面及实际客户端说明组件；调度/选择/运行状态使用专用 harness。新场景覆盖面板打开、成功校验窗口、原位更新、搜索保留、失败重试及请求合并。
- 新链路及相关服务、价格、bridge、已有选择器定向测试：132/132 通过。
- 关闭中央目录开关的旧模型路由、手动刷新关联 store、运行时与任务执行：166/166 通过。
- 关闭开关的记忆 embedding 既有路径：10/10 通过。
- 独立 PostgreSQL 的发布、回滚、并发编辑与事务失败恢复：3/3 通过。
- `bun run type-check`、Admin type-check、Admin build、刷新 harness build、`git diff --check` 通过。针对改动文件 ESLint 无错误，已有两条未使用变量警告保持原样。
- 缓存命中路径的 100 次 HTTP 探测没有新增 Aihub 请求；多次本机观测约 0.5–1.2 秒，不作为生产压测结论。30 分钟定时检查若碰到服务端 5 分钟缓存过期，会按需读取上游以发现变动，而不是盲目信任旧版本。

2026-10-19 rebase 后复核：主语言资源契约 56080 项通过；旧服务路由、Agent、记忆与目录服务 84 项定向测试通过；模型选择器与静默调度 10 项通过；根项目及 Admin 类型检查通过。修复了越南语新键缺失，并让仅覆盖旧目录行为的测试显式关闭新目录开关。

2026-10-19 面板补查复核：测试管理后台通过真实浏览器 UI 发现并发布 16 个当前 Aihub 模型的基础说明，来源链接、容量与不确定字段均保留在对应记录；用 `qwen3.8-flash` 临时改名验证发布版本进入本地测试版 Electron 面板，随后发布恢复原名。DevTools Network 显示过期后打开面板各发出一次 `modelCatalog.check`，响应均为 200；面板保持打开并原位切换展示名，2 分钟内再次打开不增加目录请求。客户端 DevTools 中旧版 React/antd 警告仍可见，未发现由本次目录校验产生的未处理异常。服务 pod 无目录读取日志输出，真实请求次数以 DevTools Network 与 BDD 计数为准。

后台与客户端说明、调度 harness 均已按上述步骤验证。
