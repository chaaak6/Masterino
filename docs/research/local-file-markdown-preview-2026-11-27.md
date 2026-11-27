# 工作区 Markdown 文件预览调研

基线为 2026-11-27 拉取的 `origin/main`，提交 `7af1f2c8`（v1.3.16）。范围是 Agent 会话右侧「文件」树打开 Markdown 后的「预览 / 原文」面板。现有渲染器已经支持常用 Markdown。截图中最值得优先补齐的是 GitHub 提示块、README 常用的 HTML 图片，以及图片外层的相对文件链接。

## 当前表现

| 样例                                                                    | Chromium 实测                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 表格、任务列表、删除线、围栏代码、脚注、行内公式                        | 均有对应的渲染结果。YAML front matter 已显示为元数据卡片。     |
| `<img src="docs/banner.svg" …>`、`<a href="docs/demo.mp4"><img …></a>`  | 整段显示为文本，不会发起图片加载。                             |
| `![Banner](docs/banner.svg)`、`[![Demo](docs/demo.gif)](docs/demo.mp4)` | 两张图都能加载为 Blob 图片。GIF 外层的相对链接仍交给应用路由。 |
| `> [!NOTE]`、`> [!IMPORTANT]`                                           | 默认是普通引用，标记出现在正文中。                             |
| `[章节](#target-heading)`                                               | 点击更新 URL fragment，但标题没有对应的 id。                   |
| `[指南](docs/guide.md)`                                                 | 点击导航到应用路由 `/docs/guide.md`，没有打开工作区文件标签。  |
| 缺失的相对图片                                                          | 404 后仍显示无文字的灰块，视觉上与加载中相同。                 |

文件树打开文件时传入设备、路径和工作区根目录。文本面板识别 `.md`、`.mdx` 和 `.markdown`，拆出 front matter，再把正文交给锁定版本 `@lobehub/ui@5.15.17`。该调用目前只覆盖 `img`，因此普通 Markdown 图片可以复用项目文件读取，HTML 图片没有进入这条链路。图片组件也没有消费 `width`、`height`，只读 SWR 的 `data` 来决定是否显示灰块。[文件树](<../../src/routes/(main)/agent/features/Conversation/WorkingSidebar/Files/index.tsx#L172>) · [预览调用](../../src/features/Portal/LocalFile/Body.tsx#L219) · [图片处理](../../src/features/Portal/LocalFile/MarkdownImage.tsx#L19) · [依赖锁定](../../pnpm-lock.yaml#L415)

实际应用的全局主题还将非 HTTP(S) 链接交给 React Router。工作区相对链接需要以当前文档所在目录解析，再交给文件面板打开。视频已有类型识别，但现有面板把它显示为通用二进制提示，相对 MP4 跳转和视频播放是两项独立能力。[全局主题](../../src/layout/GlobalProvider/AppTheme.tsx#L181) · [全局链接](../../src/components/Link.tsx#L15) · [本地类型分流](../../src/services/electron/localFileService.ts#L97) · [文件面板分流](../../src/features/Portal/LocalFile/Body.tsx#L394)

## 建议的实现顺序

1. **启用 GitHub 提示块。** 在此处的 `Markdown` 启用现成的 `enableGithubAlert`。实测标准换行写法的五种类型均有效，标记同行紧接粗体也有效，同行直接跟普通文字仍显示为引用。测试应覆盖这些区别，以及普通引用、围栏代码和中英文主题样式。若产品要兼容同行普通文字，可以加一条局部 AST 规则。[预览入口](../../src/features/Portal/LocalFile/Body.tsx#L311) · 本机依赖源码 `node_modules/@lobehub/ui/es/hooks/useMarkdown/useMarkdownRehypePlugins.mjs:10`。
2. **支持 README 常见 HTML。** 先覆盖 `img` 和嵌套的 `a > img`，让 SVG 和 GIF 走现有的项目图片读取，并支持 `alt`、`title` 和受约束的宽高。用 AST 解析和标签、属性、协议白名单，在文件预览入口限制范围。组件的 `allowHtml` 只启用 raw HTML 解析，本身没有清理步骤，同时会停用几项现有扩展。若采用 raw 解析加清理，需验证插件顺序以及表格、脚注、提示块图标、公式和代码样例。图片外层是链接时，验证点击和键盘行为，避免图片灯箱与链接争用。折叠块可随后用同样的方式支持 `details/summary`。[图片组件](../../src/features/Portal/LocalFile/MarkdownImage.tsx#L81) · 本机依赖源码 `node_modules/@lobehub/ui/es/hooks/useMarkdown/useMarkdownRemarkPlugins.mjs:16`。
3. **补齐文档内导航和资源反馈。** 同页锚点应在当前预览面板滚动，标题 id 覆盖中文及重名。相对链接复用文件标签动作和设备上下文，继续经过现有工作区授权及真实路径检查。缺图时显示 alt 和可辨认的失败状态。截图中的 MP4 可以先提供受工作区授权约束的打开动作，内嵌播放另需评估桌面文件协议和远端设备传输。[文件树动作](<../../src/routes/(main)/agent/features/Conversation/WorkingSidebar/Files/index.tsx#L172>) · [桌面授权](../../apps/desktop/src/main/core/infrastructure/LocalFileProtocolManager.ts#L343) · [远端 CLI 授权](../../packages/device-control/src/filePreview.ts#L94)。
4. **修齐一个跨设备扩展名差异。** 另从代码查到，远端 CLI 的 MIME 表包含 `.md` 和 `.mdx`，缺少 `.markdown`。这种文件会作为二进制返回，进不去面板里的 Markdown 分支。可补映射和已有路径的回归验证。[远端 CLI MIME](../../packages/device-control/src/filePreview.ts#L19) · [面板扩展名](../../src/features/Portal/LocalFile/Body.tsx#L74)。

首批验收可直接复用一份小 README，同时写入 HTML SVG、可点击的 HTML GIF、对应的原生 Markdown 写法、五种提示块、相对文档链接、标题锚点和缺图。浏览器实测还出现了链接图片在段落内生成块级图片包装的 React DOM 警告，值得在同一用例中检查。原文切换、远端设备和工作区边界应走产品入口回归。

## 复现范围

本地 Vite 测试页挂载了当前 worktree 的真实 `Portal/LocalFile/Body`、`MarkdownImage`、全局 `Link` 组件与锁定渲染器，用 Playwright Chromium 加载合成 README 和磁盘上的 SVG/GIF。文件服务响应、会话状态和原文编辑器使用测试适配器。组件级结果覆盖上表和提示块开关，完整 Electron、真实 IPC、远端 RPC 及原文编辑保存未做端到端验收。调研时 Docker daemon 未运行，采用了独立测试页。

现有 `Body.helpers.test.ts`、`Body.test.tsx`、`MarkdownImage.test.tsx` 共 12 个测试通过。`Body.test.tsx` 替换了真实 Markdown 组件，不能靠这些结果判断渲染兼容性。[Body 测试](../../src/features/Portal/LocalFile/Body.test.tsx#L37) · [图片测试](../../src/features/Portal/LocalFile/MarkdownImage.test.tsx#L100)

本机复现材料位于此 worktree 的 `.local-dev/md-preview-probe/`，包含样例、脚本、断言和截图。从 worktree 根目录启动 `pnpm exec vite --config .local-dev/md-preview-probe/vite.config.mjs`，再运行 `node .local-dev/md-preview-probe/observe.mjs`。
