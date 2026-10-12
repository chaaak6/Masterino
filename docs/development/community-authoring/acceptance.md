# 社区 MCP / Skill 管理后台创建与导入

## 范围

管理后台 `/mcp` 新增远程 Streamable HTTP MCP 创建与单个 `mcpServers` JSON 导入，保留 headers，支持公司共用 Bearer API Key。`/skills` 新增根目录包含 SKILL.md 的 ZIP 上传和 SKILL.md 内容创建。提交后沿用既有扫描、审批、发布流程。没有改动 Agents、用户、工作区、SSO 或现有社区资源。

独立管理后台沿用现有中文、antd 组件约定；本次没有新增后台国际化框架。

## BDD 验收边界

通过真实管理后台 API 提交和发布，再使用独立员工账号安装和调用：

1. MCP 测试连接发现工具 → 提交 → 审批发布 → 员工安装 → 实际调用工具；社区响应无公司凭证。
2. Skill ZIP 提交 → 审批发布 → 员工下载 → `agentSkills.importFromMarket` 安装 → 读取 Skill 内容。
3. 缺少 SKILL.md 的 ZIP 返回可读错误，不创建目录资源。
4. 缺少有效 frontmatter 的 Skill 返回解析错误，不创建目录资源。

连接验收分为真实外部 Microsoft Learn MCP 和测试命名空间内强制 Bearer 认证的 MCP 探针。后者验证服务端凭证转发；员工无需填写 Key。未获得未脱敏的元典 API Key，不宣称已完成元典真实法条调用。

## 回归约束

新建 MCP 连接仅从可信服务端读取，加密字段不出现在社区目录。旧云网关仅在连接解析返回 404 时继续执行既有调用；认证错误、503 和网络失败明确报错。原后台请求保持 15 秒超时，只有新资源提交请求使用 90 秒。

原工作区存在未提交的其他任务修改，本功能在基于 origin/main 的独立工作区完成，不包含这些修改。测试预览使用已有镜像和独立服务，只接管本功能页面与接口，不重建镜像，不改生产环境。

## 重跑

在 `e2e/` 使用 Cucumber 的 `community-authoring.config.cjs`。设置 `ADMIN_ACCEPTANCE_CREDENTIALS` 为仓库外 JSON 文件路径，内容包含 `admin`、`employee` 邮箱和临时测试 `password`；默认目标是测试后台。可设置 `ADMIN_ACCEPTANCE_MCP_URL` 与 `ADMIN_ACCEPTANCE_MCP_KEY` 验证需认证的 MCP。凭证及其临时文件不提交。

运行命令：`pnpm exec cucumber-js --config community-authoring.config.cjs`。

## 实际验收结果（2026-10-09，测试环境）

- Microsoft Learn：4 个 BDD 场景、18 个步骤全部通过；工具发现、发布、员工安装及真实 `microsoft_docs_search` 调用成功。
- 强制 Bearer 认证探针：4 个场景、18 个步骤全部通过；缺少公司凭证会拒绝连接，员工不填写 Key 仍可安装和调用，社区响应不包含 Key。
- Skill：两轮均通过上传、发布、下载、员工安装和内容读取；不含 SKILL.md、无有效 frontmatter 两种错误均不创建目录资源。
- 浏览器实际操作：JSON 导入 → 密码字段承载 Bearer Key → 发现 `company_key_probe` → 提交 → 扫描通过 → 批准 → 发布，界面状态逐步变化，投稿审核列表随后为 0。
- 回归：Market API / repository 22 项；MCP 客户端 / 社区查询 / 导入 62 项；既有后台 router 67 项，合计 151 项通过。
- 既有后台真实接口 `overview`、`listUsers`、`listWorkspaces`、`listRoles`、Agents 目录全部 HTTP 200；原首页、用户、工作区、角色页面全部 HTTP 200。
- 构建：Next.js、管理后台 Vite、Market TypeScript 编译均成功。
- 后台 `type-check` 未全绿：发现未修改的共享类型、prompts 等文件中的类型导出错误。本次变更文件没有报错；没有将这些跨域问题混入本 PR。

验收创建的临时社区资源通过现有下架流程退出社区，保留审核记录；原有精选资源保持不变。测试身份的临时管理员权限在验收后撤销。测试预览服务使用已有镜像，只为本功能提供独立构建产物，不替换其他测试预览服务。

## Review 修复验收（2026-10-12，测试环境）

按确认范围，保留现有 MCP SDK 服务器端调用、用户信任令牌和 Runner；不新增服务端 Key，也不改 review 第 1、2 项。

- CLI 在读取内容前检查目录 2,000 文件、单文件 25 MiB、原始总量 100 MiB；已有 ZIP 在读取前检查 16 MiB，并在解压 SKILL.md 前检查展开大小 25 MiB。压缩后仍保留 16 MiB 检查。
- 后台 ZIP 提供移除入口，清空文件输入和 artifact，保留手写内容，取消旧读取并拒绝过期回调。
- MCP 仅 404 回退旧网关；调用日志记录用户、标识符、工具、耗时、结果和连接查询状态，不记录调用参数、返回内容或凭证。
- 新投稿使用独立事务提交资源、版本、文件关联、审计和待审状态，现有其他资源管理方法不改。数据库检查成功后上传，上传成功后提交；失败回滚。每次上传采用唯一对象键，提交失败时只尝试清理本次对象。
- Market 最终投稿接口直接检查实际 ZIP 内 SKILL.md 的必填 name / description，非法内容在对象上传前拒绝。

针对性测试：CLI 67 项、后台 UI / 原导入解析 6 项、Market 26 项、主服务 MCP / 原后台 router 113 项，共 212 项通过。Next.js、CLI、后台 Vite 和 Market 构建通过。

真实 Cucumber：`community-review-fixes.config.cjs` 的 4 场景 / 12 步通过，覆盖构建后的 CLI 大文件拒绝、直接 Market 非法 frontmatter 拒绝、对唯一测试标识符注入版本插入失败后资源回滚及同标识符重试、发布后普通员工实际调用 Microsoft Learn MCP。服务日志确认调用用户、工具、耗时和成功状态。测试故障触发器已移除，成功测试投稿已拒绝或下架。

浏览器验收：在 `/skills` 先填写手写内容，再通过真实文件选择器选择测试 ZIP，移除后文件输入显示未选择文件、手写内容恢复编辑且保留；随后真实提交成功进入待审，测试投稿已退出发布流程。

回归：原总览、用户、工作区、角色、Agents 接口及原页面均 HTTP 200，已提供的 CLI Key 保持有效。仅更新独立测试预览，没有重建 Docker 镜像、修改生产或包含其他任务的改动。

对象存储清理为尽力执行，不承诺跨 PostgreSQL 和 S3 的原子性。测试账号的 DeleteObject 权限被 bucket ACL 拒绝；最初运行旧预览代码留下的两个小测试 ZIP 无法删除，相关数据库测试草稿已清理。未扩大存储权限，新实现的版本插入失败发生在上传前。极少数上传成功、数据库最终提交失败仍可能留下孤立对象，清理失败记录固定日志。

重跑：先构建 CLI，将 `e2e/src/fixtures/community-review-control.cjs` 复制到独立测试 Market 的 `/app/dist/bdd-review-control.cjs`，测试结束移除；该 helper 仅在测试环境运行，使用既有测试管理员身份，故障只匹配当次 `bdd-review-<timestamp>-rollback` 标识符，不加入运行时镜像。设置 `COMMUNITY_CLI_CREDENTIALS`、`ADMIN_ACCEPTANCE_CREDENTIALS`、`COMMUNITY_REVIEW_KUBECONFIG`、`COMMUNITY_REVIEW_MARKET_POD` 和指向测试 Market 端口转发的 `COMMUNITY_REVIEW_MARKET_URL`，在 `e2e/` 运行 `pnpm exec cucumber-js --config community-review-fixes.config.cjs`。
