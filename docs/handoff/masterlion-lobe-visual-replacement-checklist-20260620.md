# MasterLion / 小宗狮视觉替换执行任务

日期：2026-06-20

状态：P0 已执行。2026-06-20 用户确认开始处理后，已完成 `ML-VI-001` 到 `ML-VI-005`；P1/P2 仍待后续继续。

## 背景

本任务清单用于把历史 Lobe / LobeHub / Lobe AI 的用户可见视觉与品牌感知，收敛替换为 MasterLion / 小宗狮。

当前仓库已经加入功能收敛层：聊天、群聊、通用设置保留；社区、资源、页面、记忆、任务、Fleet、图片/视频生成等复杂非聊天核心能力已禁用；评测与开发工具入口已隐藏。视觉替换因此按“已暴露核心界面优先、禁用功能降级、隐藏功能暂缓”的顺序执行。

本清单只处理用户可见品牌、视觉、文案、图标和文档口径；不替换 `@lobehub/*`、`@lobechat/*`、provider id、数据库 enum、导入路径、CSS 变量、测试 fixture 等实现细节，除非它们直接出现在用户界面。

## 已上传 VI 资产

| 文件 | 用途判断 | 处理要求 |
| --- | --- | --- |
| `vi/masterlion_logo_static.svg` | MasterLion / 小宗狮主 logo，可作为 Web、PWA、默认助理头像和空状态视觉母版 | 先校正元信息，再导出所需 png/ico/webp 尺寸 |
| `vi/masterlion_gray_order_loading_loop(1).svg` | MasterLion 英文手写 loading 动画 | 用于桌面 splash、全局品牌 loading 的英文版本 |
| `vi/masterlion_gray_order_loading_loop(2).svg` | 中文手写 loading 动画 | 用于中文环境或品牌 loading 的中文版本 |

注意：三个 SVG 的 `title` / `aria-label` 当前写作“小宗师”，而产品口径为“小宗狮”。正式替换前必须统一为“小宗狮”，避免无障碍文本、SEO 或截图审查中出现错字。

## 功能收敛影响

| 功能面 | 当前处理 | 对视觉替换的影响 |
| --- | --- | --- |
| Chat / Group Chat / Settings | 保留 | P0/P1 必须替换，属于上线可见界面 |
| Community / Resources / Pages / Memory / Tasks / Fleet / Generation | 禁用但可能展示禁用页或灰态入口 | 只替换禁用页、灰态入口、命令菜单提示，不重做完整业务视觉 |
| Eval / Devtools | 隐藏 | 不做本轮视觉替换，只保留内部实现 |
| 旧市场、旧社区宣传图 | 入口已禁用 | P2 暂缓，除非仍被 SEO、分享、文档或静态资源引用 |

## P0 上线阻断任务

### ML-VI-001 校正并归档 VI 源文件

- 输入：`vi/masterlion_logo_static.svg`、`vi/masterlion_gray_order_loading_loop(1).svg`、`vi/masterlion_gray_order_loading_loop(2).svg`
- 目标：新增正式资产目录，例如 `public/brand/masterlion/`，保留可追溯源文件。
- 任务：
  - 将 SVG 内 `title`、`aria-label`、`desc` 的“小宗师”统一为“小宗狮”。
  - 生成语义化文件名：`logo-static.svg`、`loading-masterlion-en.svg`、`loading-masterlion-zh.svg`。
  - 保留 `vi/` 作为上传原件目录，不让业务代码直接依赖上传目录。
- 验收：
  - 业务引用只指向 `public/brand/masterlion/*`。
  - `rg -n "小宗师" public/brand vi src packages apps docs` 只允许在原件说明或迁移备注中出现。

### ML-VI-002 替换默认助理头像和默认助理身份

- 输入：最新 VI 主图标生成的头像版本。
- 目标路径：
  - `public/avatars/lobe-ai.png`
  - `packages/const/src/meta.ts`
  - `packages/builtin-agents/src/agents/inbox/index.ts`
  - `packages/builtin-agents/src/agents/task-agent/index.ts`
  - `packages/builtin-agents/src/agents/verify-agent/index.ts`
  - `packages/builtin-agents/src/agents/web-onboarding/index.ts`
  - `packages/builtin-agents/src/agents/group-supervisor/systemRole.ts`
  - `packages/prompts/src/prompts/task/taskManagerDefaults.ts`
- 任务：
  - 新增 `public/avatars/masterlion-ai.png` 或 `public/brand/masterlion/avatar.png`。
  - 将默认 inbox / assistant 中文名称从 `Lobe AI`、`LobeAI` 改为“小宗狮AI”。
  - 英文默认名称暂按 `MasterLion` 处理。
  - 保留旧头像文件作为兼容路径时，不再由新默认配置引用。
- 验收：
  - 新建会话、默认助手、任务助手、验证助手不再显示 Lobe AI 名称或头像。
  - `packages/locales/src/default/chat.ts`、`locales/en-US/chat.json`、`locales/zh-CN/chat.json` 同步更新。

### ML-VI-003 替换 App / PWA / favicon 图标体系

- 输入：`logo-static.svg`。
- 目标路径：
  - `public/favicon.ico`
  - `public/favicon-dev.ico`
  - `public/favicon-progress.ico`
  - `public/favicon-done.ico`
  - `public/favicon-error.ico`
  - `public/favicon-32x32*.ico`
  - `public/apple-touch-icon.png`
  - `public/icons/icon-192x192.png`
  - `public/icons/icon-192x192.maskable.png`
  - `public/icons/icon-512x512.png`
  - `public/icons/icon-512x512.maskable.png`
  - `src/app/[variants]/metadata.ts`
  - `src/app/manifest.ts`
  - `src/layout/GlobalProvider/FaviconProvider.tsx`
- 任务：
  - 从主 logo 导出 favicon、PWA、maskable icon、运行状态 favicon。
  - 确认 metadata / manifest 中的应用名称为 MasterLion / 小宗狮。
- 验收：
  - 浏览器 tab、PWA 安装卡片、移动端添加到主屏幕、运行状态图标均不再显示旧 Lobe 视觉。

### ML-VI-004 替换全局分享图和 SEO 图

- 输入：`logo-static.svg`，必要时补充 Aihub 相关背景元素。
- 目标路径：
  - `public/og/og.webp`
  - `public/og/agent-og.webp`
  - `public/og/mcp-og.webp`
  - `packages/const/src/url.ts`
  - `src/app/[variants]/metadata.ts`
  - `src/server/ld.ts`
- 任务：
  - 重做 OG 图为 MasterLion / 小宗狮内部 AI 工作台口径。
  - 如果保留 agent / mcp 分享图，文案避免 LobeHub 市场化表达，改为 MasterLion 与 Aihub 能力。
- 验收：
  - 分享链接预览不出现 LobeHub、LobeChat、Lobe AI 字样或旧头像。

### ML-VI-005 替换桌面启动与全局 loading

- 输入：`loading-masterlion-en.svg`、`loading-masterlion-zh.svg`。
- 目标路径：
  - `apps/desktop/resources/splash.html`
  - `src/components/Loading/BrandTextLoading/index.module.css`
  - 现有引用 `.lobe-brand-loading` 的组件样式
- 任务：
  - 将桌面 splash 内嵌旧 LobeHub 字形替换为 MasterLion / 小宗狮 loading SVG。
  - 将 CSS 类名迁移为产品中性命名；旧类名如需兼容，只作为 alias。
  - 中文界面优先展示中文 loading，英文界面展示英文 loading。
- 验收：
  - 桌面启动页、页面级 loading、品牌 loading 均不出现旧 LobeHub 字标。

## P1 核心界面替换任务

### ML-VI-006 替换品牌组件 fallback

- 目标路径：
  - `src/components/Branding/ProductLogo/index.tsx`
  - `src/components/Branding/OrgBrand/index.tsx`
  - `src/features/Electron/connection/ConnectionMode.tsx`
- 任务：
  - fallback 从 `@lobehub/ui/brand` 的 LobeHub 图标改为 MasterLion 资产。
  - 自定义品牌配置存在时仍尊重用户配置。
- 验收：
  - 未配置自定义品牌的环境不会回退到 LobeHub。

### ML-VI-007 更新用户可见核心文案

- 目标路径：
  - `packages/locales/src/default/chat.ts`
  - `packages/locales/src/default/common.ts`
  - `packages/locales/src/default/hotkey.ts`
  - `packages/locales/src/default/setting.ts`
  - `locales/en-US/*.json`
  - `locales/zh-CN/*.json`
  - `src/features/CommandMenu/AskAIMenu.tsx`
  - `src/features/CommandMenu/AskAgentCommands.tsx`
  - `src/features/Conversation/hooks/useAgentMeta.ts`
- 任务：
  - `askLobeAI`、`Lobe AI`、`LobeHub` 等用户可见文案替换为“小宗狮”或 MasterLion。
  - 与本轮功能收敛一致：隐藏或禁用功能中的旧推广文案不再作为核心入口展示。
- 验收：
  - 中文界面核心聊天路径中不出现 Lobe / LobeHub / Lobe AI。
  - 英文界面核心聊天路径使用 MasterLion，不使用 LobeChat。

### ML-VI-008 更新禁用功能页与灰态入口口径

- 目标路径：
  - `src/features/ProductFeatureGate/FeatureDisabledPage.tsx`
  - `packages/locales/src/default/common.ts`
  - `src/hooks/useNavLayout.ts`
  - `src/routes/(mobile)/_layout/NavBar.tsx`
  - `src/routes/(main)/home/_layout/Body/CustomizeSidebarModal.tsx`
- 任务：
  - 禁用页文案使用 MasterLion / 小宗狮，不引用旧社区、旧市场或 LobeHub。
  - 灰态入口只解释“当前聚焦聊天核心能力”，不承诺复杂功能上线日期。
- 验收：
  - 访问禁用路由时显示 MasterLion 品牌禁用页。
  - 命令菜单、侧边栏、移动底栏的灰态提示文案一致。

### ML-VI-009 更新登录、引导、分享与截图相关露出

- 目标路径：
  - `src/routes/onboarding/features/TelemetryStep.tsx`
  - `src/routes/(desktop)/desktop-onboarding/features/WelcomeStep.tsx`
  - `src/features/ShareModal/ShareImage/Preview.tsx`
  - `src/routes/share/t/[id]/features/ActionBar.tsx`
  - `src/features/Electron/ScreenCapture/overlaySnapshot.ts`
  - `public/screenshots/shot-*.desktop.png`
  - `public/screenshots/shot-*.mobile.png`
- 任务：
  - 替换引导页、分享卡片、截图遮罩中仍带旧品牌的文案或图片。
  - 重新截取功能收敛后的主聊天、设置、Aihub 模型选择界面。
- 验收：
  - 对外截图展示的是收敛后的 MasterLion UI，不包含已禁用复杂功能入口作为主卖点。

## P2 暂缓或后置任务

### ML-VI-010 社区、市场、资源类视觉资产降级处理

- 目标路径：
  - `public/images/community_header_light.webp`
  - `public/images/community_header_dark.webp`
  - `public/images/community_footer_light.webp`
  - `public/images/community_footer_dark.webp`
  - `public/images/banner_creator.png`
  - `public/images/banner_market_modal.webp`
  - `public/images/screenshot_background.webp`
  - `packages/locales/src/default/discover.ts`
  - `packages/locales/src/default/plugin.ts`
  - `packages/locales/src/default/memory.ts`
  - `packages/locales/src/default/taskTemplate.ts`
- 任务：
  - 因入口已禁用，本轮不重做完整社区/市场视觉。
  - 如这些资源仍被 SEO、分享或静态页面加载，先替换为中性 MasterLion 占位。
- 验收：
  - 已禁用功能不会通过 banner、弹窗或命令菜单继续露出旧 LobeHub 市场视觉。

### ML-VI-011 移动端旧远程构建资源确认

- 目标路径：
  - `src/app/spa/[variants]/[[...path]]/mobileHtmlTemplate.source.ts`
- 当前残留：
  - `https://web-assets.lobehub.com/mobile/...`
- 任务：
  - 确认该模板是否仍在生产路径使用。
  - 如仍使用，迁移到 MasterLion 自有构建资源；如已废弃，删除旧模板或加明确废弃注释。
- 验收：
  - 生产移动端 SPA 不再加载 `web-assets.lobehub.com`。

### ML-VI-012 文档和历史图片清理

- 目标路径：
  - `docs/**/*.md`
  - `docs/**/*.mdx`
  - `docs/.cdn.cache.json`
  - 文档中的 `lobeobjects.space`、`github.com/lobehub/lobe-chat/assets/*` 图片引用
- 任务：
  - 用户可见文档改为 MasterLion / 小宗狮 / Aihub 口径。
  - 历史 upstream 说明可保留在开发者备注中，但不得作为产品文档主叙述。
- 验收：
  - 面向用户的安装、环境变量、自托管、安全说明不再把产品描述为 LobeChat。

## 替换扫描命令

```bash
rg -n "LobeHub|LobeChat|Lobe AI|LobeAI|lobehub|lobeobjects|web-assets\\.lobehub|/avatars/lobe-ai" src packages apps public docs -g '*.{ts,tsx,md,mdx,json,html,svg}'
rg -n "小宗师" vi public src packages apps docs
```

扫描结果需要人工分流：

- 用户可见品牌：纳入 ML-VI-002 到 ML-VI-012。
- 依赖包名、import、provider id、数据库 enum、测试 mock：默认不改。
- 已隐藏 eval/devtools 路径：暂缓，不阻塞本轮。

## 建议实施顺序

1. ML-VI-001 到 ML-VI-005：先完成资产归档、默认身份、图标、OG、loading，解决最明显旧视觉。
2. ML-VI-006 到 ML-VI-009：再处理核心聊天、设置、引导、分享、截图。
3. ML-VI-010 到 ML-VI-012：最后处理已禁用功能、远程旧资源和文档历史图片。

## 本次建议执行范围

本次先执行 P0 上线阻断任务：

1. `ML-VI-001`：校正并归档 VI 源文件。
2. `ML-VI-002`：替换默认助理头像和默认助理身份。
3. `ML-VI-003`：替换 App / PWA / favicon 图标体系。
4. `ML-VI-004`：替换全局分享图和 SEO 图。
5. `ML-VI-005`：替换桌面启动与全局 loading。

本次不执行：

- `ML-VI-006` 到 `ML-VI-009` 的 P1 核心界面替换。
- `ML-VI-010` 到 `ML-VI-012` 的 P2 后置清理。
- 依赖包名、provider id、数据库 enum、import path、CSS 变量、测试 fixture 等实现细节替换。

## 已确认产品决策

- 默认中文助理名称固定为“小宗狮AI”。
- 英文默认助理名称暂按 `MasterLion` 执行。
- 助理头像使用最新 VI 主图标，不单独设计头像裁切版。
- App icon、favicon、PWA maskable icon 统一使用同一图形母版。
- OG 图需要中英文两套。
- 中文 loading 作为中文 locale 默认 loading；英文 loading 仅随英文 locale 使用。

## P0 执行记录

执行时间：2026-06-20

已完成：

- `ML-VI-001`：已将 VI SVG 中的“小宗师”元信息修正为“小宗狮”，并归档到 `public/brand/masterlion/`：
  - `logo-static.svg`
  - `loading-masterlion-en.svg`
  - `loading-masterlion-zh.svg`
- `ML-VI-002`：已新增 `public/brand/masterlion/avatar.png`，并将默认 inbox / 内置用户可见代理头像切到 MasterLion 头像；默认中文助理名为“小宗狮AI”，英文文案使用 `MasterLion`。
- `ML-VI-003`：已从同一 VI 主图形母版生成 favicon、运行状态 favicon、Apple touch icon、PWA any/maskable icon。
- `ML-VI-004`：已生成中英文 OG 图：
  - `og-en.webp` / `og-zh-CN.webp`
  - `agent-og-en.webp` / `agent-og-zh-CN.webp`
  - `mcp-og-en.webp` / `mcp-og-zh-CN.webp`
  - 兼容文件 `og.webp`、`agent-og.webp`、`mcp-og.webp` 保留并指向英文版本内容。
- `ML-VI-005`：桌面 splash 已改用嵌入式 MasterLion 英文 loading SVG；全局 `BrandTextLoading` 已按 locale 使用中文或英文 loading SVG。

已增加/更新验证：

- `packages/const/src/meta.test.ts`
- `src/const/masterlionBranding.test.ts`
- 任务 prompt 测试中的默认助理名称断言。

已跑验证：

```bash
docker run --rm -v /root/MasterLion/packages:/app/packages -v /root/MasterLion/package.json:/app/package.json:ro masterlion:test-builder sh -lc "cd packages/const && pnpm exec vitest run --silent='passed-only' src/meta.test.ts"
docker run --rm -v /root/MasterLion/src:/app/src -v /root/MasterLion/packages:/app/packages:ro -v /root/MasterLion/package.json:/app/package.json:ro masterlion:test-builder sh -lc "pnpm exec vitest run --silent='passed-only' src/const/masterlionBranding.test.ts"
docker run --rm -v /root/MasterLion/packages:/app/packages -v /root/MasterLion/package.json:/app/package.json:ro masterlion:test-builder sh -lc "cd packages/prompts && pnpm exec vitest run --silent='passed-only' src/prompts/task/buildTaskListPrompt.test.ts src/prompts/task/buildTaskDetailPrompt.test.ts"
docker run --rm -v /root/MasterLion/src:/app/src -v /root/MasterLion/packages:/app/packages:ro -v /root/MasterLion/package.json:/app/package.json:ro masterlion:test-builder sh -lc "pnpm exec vitest run --silent='passed-only' src/server/metadata.test.ts 'src/app/spa-auth/[locale]/[[...path]]/seoMeta.test.ts'"
```

验证结果：

- 以上定向测试全部通过。
- `rg -n "小宗师" public/brand vi src packages apps docs` 仅在本 handoff 的历史说明和扫描命令中命中。
- P0 目标路径扫描未命中旧默认名、旧头像或“小宗师”。
- 已人工抽查 `public/brand/masterlion/avatar.png` 和 `public/og/og-zh-CN.webp` 可正常渲染。

已知未通过项：

- `bun run type-check` 仍失败，但当前报错位于既有 Aihub/S3/aiInfra/devStartup/NewAPI 相关改动，不在本轮 P0 视觉替换文件。

## 执行前最终确认（历史记录）

如确认执行，本轮将按“P0 上线阻断任务”修改资产和引用，并在完成后跑以下检查：

```bash
rg -n "小宗师" public/brand vi src packages apps docs
rg -n "LobeHub|LobeChat|Lobe AI|LobeAI|lobehub|lobeobjects|web-assets\\.lobehub|/avatars/lobe-ai" src packages apps public docs -g '*.{ts,tsx,md,mdx,json,html,svg}'
```

扫描结果会人工分流：用户可见残留继续修复；依赖包名、provider id、数据库 enum、import path、CSS 变量、测试 fixture 等实现细节保留。

用户已确认开始处理，P0 已按上方记录执行。

## 暂不替换范围

- `@lobehub/ui`、`@lobehub/icons`、`@lobechat/*` 包名。
- `lobehub` provider id、数据库 enum、协议字段、导入路径。
- `--lobe-*` CSS 变量、内部 debug namespace、历史兼容 localStorage key。
- 测试 fixture、dev panel fixture、注释中的 Lobe 字样，除非会展示给最终用户。

## 原产品确认记录

- 默认助理中文名是否固定为“小宗狮”，英文名是否固定为 `MasterLion`。回复：默认中文助理名称固定为“小宗狮AI”。
- `logo-static.svg` 是否可直接用于助理头像，还是需要单独头像裁切版。回复：用最新的 VI 主图标。
- App icon、favicon、PWA maskable icon 是否统一使用同一图形母版。回复：是的。
- OG 图是否需要中英文两套。回复：要。
- 中文 loading 是否作为默认 loading，英文 loading 是否仅随英文 locale 使用。回复：是的。
