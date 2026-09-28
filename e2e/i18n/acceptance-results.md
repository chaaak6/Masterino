# 三语言界面验收记录 — 2026-09-28

## 版本、环境与范围

- 基于 `origin/main` 提交 `a8a3cb8e`，独立 worktree，分支 `codex/three-language-support`。
- 本地 Electron / Vite 连接 `https://mlai-test.bielcrystal.com`；preload 后端地址在 E2E 中断言。没有本地 API/数据库，也没有生产部署或 Docker 重建。
- 目标：简体中文、英文、越南语界面。保留既有 AI 回复语言设置，不新增回复语言控制，不修改系统提示词。
- Aihub 指客户端设置中的 AI 服务商和用量界面，不是独立 Aihub 管理后台。

## 实施结果

1. 统一语言码和日期映射，修复 `vi` / `vi-VN`、大小写和系统语言别名；保存自动/指定语言模式。
2. 修复 Electron 主窗口、弹窗启动语言恢复；截图浮层读取并接收主进程语言更新。
3. 登录页面加载三语言资源和对应组件库语言；异步缺失资源正确回退。
4. Aihub 绑定、状态、余额、刷新模型、用量和日期改用三语言资源；不修改数值换算、权限筛选及 Token 安全边界。
5. 补齐越南语缺失词条、原生菜单/通知/对话框、加载/空状态/可访问性标签，修正把 AI Agent 翻译为“经销商”的旧词条。
6. 新增源字典/三语言 JSON/原生字典契约检查和 CI，检测漏键、值类型及插值变量数量不一致。

## 自动化结果

| 验收层              | 结果                                                  | 证据/入口                                           |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| 资源契约            | 55,765 项键/插值检查通过                              | `node scripts/i18nWorkflow/checkPrimaryLocales.mjs` |
| 启动模板            | 12 个测试通过                                         | `node --test e2e/i18n/bootstrap.test.mjs`           |
| 资源 BDD            | 4 场景、14 步骤通过                                   | `cucumber.config.mjs`                               |
| 干净 Electron E2E   | 1 个完整场景通过，含三语言与重启                      | `playwright.config.mjs`                             |
| 独立桌面 BDD        | 4 场景、19 步骤通过                                   | `cucumber.desktop.config.mjs`                       |
| 登录后 Electron E2E | 1 个完整场景通过（三语言设置、绑定/用量、聊天及重载） | `authenticated.config.mjs`                          |
| 前端定向单元/组件   | 8 文件、46 测试通过                                   | `/tmp/masterino-final-unit.log`                     |
| 额外主流程/UI 回归  | 6 文件、31 测试通过（含与前一组重叠的语言切换测试）   | `/tmp/masterino-ui-tests.log`                       |
| 原生客户端回归      | 7 文件、116 测试通过                                  | `/tmp/masterino-native-final.log`                   |
| locales 包          | 5 文件、43 测试通过                                   | `/tmp/masterino-locales-final.log`                  |
| 首页默认模型        | 2 测试通过                                            | `/tmp/masterino-home-tests.log`                     |

单元测试范围包括语言码、日期、登录加载、Aihub 配额/余额/绑定、路由双配置一致性、托盘/菜单、系统语言 IPC、截图会话管理、登录引导和反馈。没有运行整库耗时测试来代替针对性验收。

## 真实测试账号操作

使用专用用户 `MTEST10020`，通过可见 UI 执行：

- 依次切换中文、英文、越南语，确认界面和 Aihub 绑定/用量页正确显示；现有回复语言下拉框仍保持未指定状态。
- 刷新 Aihub 模型成功，显示同步 11 个模型；保留当前用户组和模型可用性。
- 越南语日期、金额、本地化文案截图检查，无观察到的文本截断。
- 发出无工具测试消息，收到指定标记回复；刷新后历史和消息仍在。
- 添加 `i18n-acceptance.txt` 并发送，消息附件和模型回复正常。界面显示“本地附件”，没有将其误报为云端上传通过。
- 没有把历史中文标题、用户给定的助手名称或模型标识当作界面漏译，也没有修改它们。

截图与机器报告位于 `/tmp/masterino-i18n-acceptance`；不提交测试身份令牌、用户配置或运行时报告。

## 验收驱动修复

- 干净客户端重启测试发现越南语回到中文：开发入口原先未读取 `lng`，且 `app://` cookie 不可靠。现保存语言模式并在三个 HTML 入口恢复；重启复测通过。
- 登录后实测发现英文首页仍显示“敬请期待”：修正英文源词条及 JSON，中文保持中文。
- 首页 Aihub 默认模型标题原为中文常量：渲染时按界面语言取词条，保持模型 ID/provider 和选择行为。
- 越南语 Agent 模式显示成“Đại lý”：改为“Trợ lý”，并同步相关界面上下文。
- 登录自动化首次失败是路由跳转后过早点击旧页面 combobox；脚本增加 URL 和控件内容等待，避免把脚本竞争条件当成功能问题。

## 验收边界

- 本分支尚未发布；测试集群 SSR 登录页仍是已部署版本，登录资源加载变更通过本地组件测试验证。
- 截图浮层语言和原生截图会话单元测试通过，但没有把系统级实际捕获、截图云端上传及失败重试声明为已完成 E2E。
- 当前本地附件路径通过；云端上传、所有模型/插件/第三方服务和全部隐藏管理页面不属于本轮已逐页实测的范围。
- 原生项目 `pnpm exec tsgo --noEmit -p tsconfig.json` 通过。根项目类型检查仍有 42 条诊断，错误文件均未在此分支修改，与本轮首次检查的诊断签名一致；没有声称全仓类型检查通过。
- 品牌、模型名称、用户内容、服务端自由文本错误、第三方内容和开发日志不会机械翻译。其他语言保留已有能力，本轮不承诺完整覆盖。

## 主流程补充回归（2026-09-28）

针对聊天、工作目录和执行环境另行执行已有回归测试，均通过：

- 前端 10 文件、149 测试：WorkspacePicker、WorkspaceControls、workspaceBindingIntent、topicExecutionIntent、executionContext、resolveFrozenClientExecutionContext、agentWorkingDirectory、executionTarget、clientToolExecution、agentEnvPolicy。
- 原生客户端 3 文件、34 测试：executionEnvSrv、GatewayConnectionCtr.executionContext、WorkspaceCtr。
- 覆盖首次/重复绑定、禁止已绑定会话重绑、设备隔离、冻结目录优先于模型传参、工具成功/失败/取消/超时、环境变量解析和缓存隔离。以上是单元/组件测试，不冒充远端沙箱 E2E。
- 分支差异未涉及上述工作目录/执行环境/工具调用核心实现。

日志：`/tmp/masterino-mainflow-frontend.log`、`/tmp/masterino-mainflow-native.log`。

真实测试集群会话补验（越南语 UI、专用测试用户）：

1. 通过项目侧栏 `demo_test` 的新增会话按钮创建项目草稿；界面显示 `/Users/a10507479/Desktop/codes/demo_test`，执行目标为本机。
2. 发送只读测试要求，仅运行 `pwd`，不读文件内容、不修改文件；通过可见发送按钮提交。
3. 展开真实工具卡片，命令为 `pwd`，输出为 `/Users/a10507479/Desktop/codes/demo_test`；模型继续正常回复。
4. 重载会话后检查目录、只读执行目标和回复仍保留。测试会话 `tpc_X7VrGSiXi2vx`，截图 `/tmp/masterino-i18n-acceptance/mainflow-pwd-vi-VN.png`。

这补足了本机“选项目 → 绑定目录 → 发消息 → 执行工具 → 返回回复 → 历史恢复”的实测链路。未对云沙箱或其他远端设备进行真实命令执行，不把环境解析单元测试等同于这些环境的 E2E。
