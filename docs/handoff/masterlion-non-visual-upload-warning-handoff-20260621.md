# MasterLion 非视觉模型图片上传提示交接

更新时间：2026-06-21

状态：已完成并经用户确认通过。当前分支：`fix/non-visual-upload-warning`。

## 背景

用户反馈：`glm-5.1`、`glm-5.2`、`kimi-k2.7-code` 等非视觉模型选择图片时没有明确反馈；同时指出 `deepseek-v4-flash` 虽然没有视觉能力，但可以分析 HTML 文件，因此普通文件分析不应和视觉能力混为一谈。

最终确认：

- HTML / PDF / TXT 等普通文件走文件上传、解析、聊天上下文链路，不依赖 `vision` 能力。
- 图片 / 视频才需要当前模型的视觉能力，或已配置视觉理解辅助模型。
- 原问题中的静默体验发生在点击上传菜单的 `beforeUpload` 分支：不支持图片 / 视频时直接 `return false`，没有提示。

## 已完成改动

### 上传菜单提示

点击上传入口在拦截不支持的图片 / 视频前，会显示本地化 warning：

- 纸夹菜单：`src/features/ChatInput/ActionBar/Upload/index.tsx`
- Plus 菜单：`src/features/ChatInput/ActionBar/Plus/index.tsx`

提示文案使用现有 i18n key：

```ts
t('upload.clientMode.visionNotSupported')
```

因此中文环境显示 `locales/zh-CN/chat.json` 中的中文提示，英文环境显示 `locales/en-US/chat.json` / `packages/locales/src/default/chat.ts` 中的英文提示。

### 最小 helper

新增：

- `src/features/ChatInput/ActionBar/visualUploadGuard.ts`
- `src/features/ChatInput/ActionBar/visualUploadGuard.test.ts`

职责：

- 判断当前文件是否是“不支持的视觉上传”。
- 对不支持的图片 / 视频触发传入的 warning。
- 不拦截 HTML / PDF / TXT 等普通文件。

没有改动：

- 模型能力推断。
- Aihub / NewAPI 模型列表。
- 普通文件上传白名单。
- RAG / 文件解析 / 消息发送链路。
- 对象存储配置。

## 验证记录

已运行并通过：

```bash
bunx vitest run --silent='passed-only' \
  src/features/ChatInput/ActionBar/visualUploadGuard.test.ts \
  src/hooks/useVisualMediaUploadAbility.test.ts \
  src/components/DragUpload/useDragUpload.test.tsx
```

结果：3 个测试文件通过，20 个测试通过。

```bash
bunx vitest run --silent='passed-only' src/store/file/slices/chat/action.test.ts
```

结果：1 个测试文件通过，7 个测试通过。

```bash
bun run type-check
```

结果：通过。

```bash
git diff --check
```

结果：通过。

## 当前行为

- 非视觉模型选择图片 / 视频：显示当前语言提示，并阻止上传。
- 非视觉模型选择 HTML / PDF / TXT：不提示视觉错误，继续走普通文件上传。
- 已配置视觉理解辅助模型时，`useVisualMediaUploadAbility` 仍会允许非视觉但支持 tool use 的模型上传图片 / 视频，由后续工具辅助理解。

## 后续待办：多模态辅助纯文本模型理解图片

需要保留并后续完善的方向：

在不切换主模型的情况下，本次对话临时调用一个支持视觉 / 多模态的大模型，把图片内容分析成文本，再交给当前纯文本主模型继续回答。

现有基础：

- 服务端已支持 `VISUAL_UNDERSTANDING_PROVIDER` 和 `VISUAL_UNDERSTANDING_MODEL`。
- 当前逻辑可在检测到非视觉模型遇到图片 / 视频时动态注入 `lobe-agent` 视觉分析工具。
- 相关入口：
  - `src/hooks/useVisualMediaUploadAbility.ts`
  - `src/store/chat/slices/aiChat/actions/streamingExecutor.ts`
  - `apps/server/src/services/toolExecution/serverRuntimes/lobeAgent.ts`
  - `packages/builtin-tool-lobe-agent/src/client/executor/index.ts`

后续建议：

1. 明确默认视觉辅助模型来源，例如 Aihub 中 `vision=true` 的模型。
2. 在设置 / 管理侧提供可配置项，避免写死 `newapi/<model>`。
3. 在运行时明确展示“本轮将使用视觉辅助模型分析图片，主模型不变”的状态或提示。
4. 验证图片被视觉模型分析后的文本结果能进入当前主模型上下文。
5. 增加端到端测试：纯文本模型 + 图片上传 + 视觉辅助模型已配置时，可以完成图片问答。

该待办不是本次最小修复的一部分，避免扩大改动范围。

## 注意事项

- 当前分支只解决“静默失败变为本地化提示”。
- 不要把 `glm-5.1`、`glm-5.2`、`kimi-k2.7-code` 简单标成 `vision=true`，除非确认模型本身支持原生视觉输入。
- 如果后续启用视觉辅助能力，优先使用现有 `VISUAL_UNDERSTANDING_PROVIDER/MODEL` 机制，而不是新增一套临时切主模型逻辑。
