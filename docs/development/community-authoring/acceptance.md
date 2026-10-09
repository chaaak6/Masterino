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

新建 MCP 连接仅从可信服务端读取，加密字段不出现在社区目录。旧云网关在连接解析返回 404、503 或网络失败时继续执行既有调用。原后台请求保持 15 秒超时，只有新资源提交请求使用 90 秒。

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
