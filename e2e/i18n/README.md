# 中文、英文、越南语界面验收

本套件独立于现有带 Mock 的业务 E2E。界面语言为 `zh-CN`、`en-US`、`vi-VN`；AI 回复语言、系统提示词和用户内容不由本套件改写。

## 环境和隔离

- 基线：`origin/main` 的 `a8a3cb8e`，分支 `codex/three-language-support`。
- 服务端仅使用 `https://mlai-test.bielcrystal.com`。不启动本地 Next.js/API/数据库，不连接生产集群，不重建 Docker 镜像。
- 运行本地 Vite 前端和真实 Electron 主进程。无登录测试用随机 `local-<12位十六进制>` profile，独立配置和存储；登录回归单独使用专用 `test-server` profile，启动前核对登录签发方为测试集群。不会复用日常 App 登录态。
- 依赖 Node.js 24、项目根目录和 `apps/desktop` 的依赖，以及已安装的 Electron。资源检查和启动模板测试不需要安装依赖。
- 自动化报告默认放在 `/tmp/masterino-i18n-acceptance`，避免 HTML 报告触发 Vite HMR 干扰测试。

先将以下配置保存为 `/tmp/masterino-i18n-runtime.json`：

```json
{
  "cloudServer": "https://mlai-test.bielcrystal.com",
  "cloudServerAliases": [],
  "marketBaseUrl": "https://mlai-test.bielcrystal.com/market"
}
```

在 `apps/desktop` 目录启动前端与本地 App：

```sh
NODE_ENV=development MASTERINO_DEV_ENV=test \
  MASTERINO_DESKTOP_PROFILE=local-092820260001 \
  MASTERION_DESKTOP_CONFIG=/tmp/masterino-i18n-runtime.json \
  OFFICIAL_CLOUD_SERVER=https://mlai-test.bielcrystal.com \
  NEXT_PUBLIC_DESKTOP_CLOUD_SERVER=https://mlai-test.bielcrystal.com \
  NEXT_PUBLIC_MARKET_BASE_URL=https://mlai-test.bielcrystal.com/market \
  DEVICE_GATEWAY_URL=https://mlai-test.bielcrystal.com/device-gateway \
  DISABLE_APP_UPDATE=1 pnpm exec electron-vite dev
```

## 执行顺序

在项目根目录执行：

```sh
node scripts/i18nWorkflow/checkPrimaryLocales.mjs
node --test e2e/i18n/bootstrap.test.mjs
pnpm exec playwright test --config e2e/i18n/playwright.config.mjs
```

在 `e2e` 目录分别执行两套独立 BDD：

```sh
pnpm exec cucumber-js --config i18n/cucumber.config.mjs
pnpm exec cucumber-js --config i18n/cucumber.desktop.config.mjs
```

1. 资源契约：源字典、英文 JSON、中文和越南语键及插值变量对齐；包含原生菜单和对话框。模型库动态生成的 `models/providers` 源文件不作为人工字典求值，现有对应 JSON 仍参加语言对齐检查。
2. 启动模板：真实 HTML 初始化脚本在隔离上下文执行，验证持久化、旧缓存迁移、主进程 `lng` 参数及自动语言模式。
3. Electron E2E：真实语言选择器、IPC 保存、独立截图窗口、三语言截图和重启保留；并检查实际 preload 的后端地址。
4. 桌面 BDD：独立启动另一份 profile，经真实 UI 切换语言，同时断言原生菜单及独立截图窗口的译文，最后重启验证越南语。

## 已执行结果（2026-09-28）

- 资源 BDD：4 个场景、14 个步骤通过。
- 启动模板：12 个测试通过。
- Electron E2E：1 个完整场景通过，包含三语言和越南语重启。
- 桌面 BDD：4 个场景、19 个步骤通过。
- 相关单元/组件测试：覆盖语言归一化、日期映射、登录资源、Aihub 状态/余额/配额、客户端菜单/托盘/IPC、截图会话和引导页；具体命令及结果见 `acceptance-results.md`。
- 实际发现并修复：开发入口不读取客户端的 `lng`，导致切换越南语后重启恢复中文。另补存语言模式，避免“自动”被已解析语言的缓存固定。

## 登录后业务回归

已使用专用测试用户 `MTEST10020` 验证三语言设置、Aihub 绑定/余额/用量、刷新模型、聊天回复、历史重载和本地附件。登录态保持在系统原有加密存储中，不导出到测试文件。只有显式运行以下命令才会复用专用测试登录：

```sh
pnpm exec playwright test --config e2e/i18n/authenticated.config.mjs
```

运行前需保证 `test-server` profile 已在测试集群登录为 `MTEST10020`，且没有其他进程使用此 profile。脚本会产生一条无工具的测试聊天；不会删除已有历史、修改模型权限或设置 AI 回复语言。实际执行情况见 [验收结果](./acceptance-results.md)。

截图窗口自动化验证了真实渲染与语言初始化；系统屏幕捕获和截图云端上传没有在本轮端到端验收。文件测试走当前客户端的本地附件模式，不能作为云上传验证。集群登录 HTML 是已部署版本；本分支登录加载逻辑由组件测试覆盖，尚未部署到测试服务器。

## 维护规则

新增界面文案同步更新源字典及三种 JSON；自动翻译工作流不能代替本轮越南语的手工补齐。运行 `i18n:check` 可发现新增源键未同步到英文 JSON、漏译及插值变量不一致。CI 同时运行这项检查和启动模板回归。

品牌名、模型/服务商标识、用户和第三方内容、代码示例、日志及开发调试面板不做机械翻译。现有其他语言选项保留，但本轮不承诺其完整覆盖。
