# MasterLion `glm-5.1` 运行态模型缺失修复交接

更新时间：2026-06-21

状态：已修复，已热更新验证，已提交 PR。

相关 PR：<https://github.com/biel-cc/MasterLion/pull/5>

## 问题概述

用户反馈：

- `/settings/provider/all` 的 Aihub / NewAPI 模型列表里有 `glm-5.1`。
- 首页模型选项里没有 `glm-5.1`。
- `/settings/service-model` 多处显示 `newapi/glm-5.1`，但 Aihub 对接过来的模型名称不应该带 provider 前缀。
- 聊天框选择相关模型后仍提示“当前模型不支持 Agentic 工具调用”，但 Aihub 模型能力里实际支持工具调用。

最终确认：这是同一个运行态模型列表合并 bug 的多个表现，不是单纯的 UI 文案问题，也不是需要把 `glm5-5.1` 映射成 `glm-5.1`。

## 最终根因

两个页面使用的是不同数据链路：

- `/settings/provider/all` 使用 provider 设置模型列表：
  - `getAiProviderModelList('newapi')`
  - 该路径直接返回 Aihub 同步后的 remote models，因此能看到 `glm-5.1`。
- 首页模型选择、`/settings/service-model` 的公共 `ModelSelect`、Agentic 工具能力判断使用运行态 enabled 模型列表：
  - `getAiProviderRuntimeState()`
  - 内部调用 `getEnabledModels(false)`

问题出在 `packages/database/src/repositories/aiInfra/index.ts` 的 `getEnabledModels()`。

旧逻辑先用所有 builtin models 建立去重 key：

```ts
const builtinModelKeys = new Set(builtinModels.map((item) => `${item.providerId}:${item.id}`));
```

当 Aihub remote models 存在时，旧逻辑又会隐藏 builtin `newapi` fallback models：

```ts
const visibleBuiltinModels = hasBrandingRemoteModels
  ? builtinModels.filter((item) => item.providerId !== BRANDING_PROVIDER)
  : builtinModels;
```

这导致一个顺序错误：

1. builtin fallback 中有 `newapi:glm-5.1`。
2. remote Aihub DB 中也有真实的 `newapi:glm-5.1`。
3. remote `glm-5.1` 先被 `builtinModelKeys` 当作重复项过滤掉。
4. 随后 builtin `newapi` fallback 又因为存在 remote Aihub models 被整体隐藏。
5. 结果：运行态列表里 remote 和 builtin 的 `glm-5.1` 都没有。

首页和 `service-model` 都依赖运行态列表，所以都选不到 `glm-5.1`。

Agentic 工具能力判断依赖：

```ts
aiModelSelectors.isModelSupportToolUse(model, provider)
```

该 selector 从 `enabledAiModels` 按 `{ providerId: 'newapi', id: 'glm-5.1' }` 查找模型。运行态列表里找不到模型时，能力判断自然返回 false，于是出现“不支持 Agentic 工具调用”的误报。

## 为什么 `newapi/glm-5.1` 是关键线索

`/settings/service-model` 使用 `src/features/ModelSelect/index.tsx`。

`ModelSelect` 内部 Select value 使用 `provider/model` 作为唯一 key：

```ts
value: `${provider.id}/${model.id}`
```

但 `onChange` 会拆回业务配置：

```ts
const model = value.split('/').slice(1).join('/');
const provider = option.provider;
onChange?.({ model, provider });
```

当前数据库里的 `user_settings` 没有保存 `newapi/glm-5.1` 这种组合字符串。用户看到 `newapi/glm-5.1`，是因为默认配置为 `{ provider: 'newapi', model: 'glm-5.1' }`，但 Select options 中缺失 `glm-5.1`，组件只能把内部 value 原样回显。

因此这不是“模型名被加了前缀”的落库污染，而是运行态 options 缺失的 UI 症状。这个现象直接指向 `ModelSelect` 的数据源，而不是 provider 设置页的数据源。

## 本次修复

修复文件：

- `packages/database/src/repositories/aiInfra/index.ts`

修复原则：

- 不增加 `glm5-5.1` 到 `glm-5.1` 的命名映射。
- Aihub 远端模型仍按裸模型 ID 处理，例如 `glm-5.1`。
- 当 Aihub remote models 存在时，先计算 visible builtin models，再基于 visible builtin models 去重 appended user / remote models。

修复后的关键逻辑：

```ts
const visibleBuiltinModels = hasBrandingRemoteModels
  ? builtinModels.filter((item) => item.providerId !== BRANDING_PROVIDER)
  : builtinModels;
const visibleBuiltinModelKeys = new Set(
  visibleBuiltinModels.map((item) => `${item.providerId}:${item.id}`),
);
```

这样隐藏掉的 builtin `newapi` fallback 不会再压掉同 ID 的真实 remote Aihub model。

## 测试和验证

新增 / 调整测试：

- `packages/database/src/repositories/aiInfra/__tests__/getEnabledModels.test.ts`
  - 新增回归测试：remote `newapi/glm-5.1` 与 builtin fallback 同 ID 时，运行态必须保留 remote `glm-5.1`，且不能重复。
- `src/features/ModelSelect/index.test.tsx`
  - 校正测试模型名为真实的 `glm-5.1`。
  - 验证 Select 内部 value 是 `newapi/glm-5.1`，但 `onChange` 输出裸 `glm-5.1`。
- `src/store/aiInfra/slices/aiModel/selectors.test.ts`
  - 校正能力判断测试，验证裸 `glm-5.1` 支持 tool use。
  - 保留 `glm5-5.1` 不应被隐式匹配的约束。

已运行验证：

```bash
cd packages/database && bunx vitest run --silent='passed-only' src/repositories/aiInfra/__tests__/getEnabledModels.test.ts src/repositories/aiInfra/__tests__/getAiProviderRuntimeState.test.ts
bunx vitest run --silent='passed-only' src/features/ModelSelect/index.test.tsx src/store/aiInfra/slices/aiModel/selectors.test.ts
bun run type-check
git diff --check
```

结果：

- 数据库运行态测试：2 个测试文件通过，32 个测试通过。
- 前端模型选择 / 能力 selector 测试：2 个测试文件通过，28 个测试通过。
- TypeScript type-check 通过。
- `git diff --check` 通过。

热更新验证：

```bash
docker restart masterlion
```

容器内直接调用 `AiInfraRepos` 验证当前用户：

```json
{
  "settingsHasGlm51": true,
  "settingsGlm51": {
    "id": "glm-5.1",
    "enabled": true,
    "type": "chat",
    "source": "remote"
  },
  "runtimeHasGlm51": true,
  "runtimeGlm51": {
    "id": "glm-5.1",
    "enabled": true,
    "type": "chat",
    "source": "remote",
    "functionCall": true,
    "reasoning": true,
    "search": true
  }
}
```

用户随后确认页面问题已修复。

## 反思：本次为什么反复改错

这次处理过程存在明显失误：

1. 过早把问题归因到模型名差异。
   - 我先围绕 `glm5-5.1` / `glm-5.1` 做命名映射和运行时兼容，而不是先证明“首页选项为什么没有 `glm-5.1`”。
   - 这违反了排障中先定位数据链路、再改代码的基本顺序。

2. 没有第一时间对比两个页面的数据源。
   - 用户一开始已经给出关键对照：`/settings/provider/all` 有，首页没有。
   - 正确做法应该马上追踪两者分别调用的 store / service / repository，而不是只改前端选择器或模型名。

3. 对热更新是否生效验证不足。
   - 前几次只凭代码改动和局部测试判断，用户测试后没有变化，说明没有用运行实例做端到端确认。
   - 最终修复时通过容器内调用 `getAiProviderModelList()` 和 `getAiProviderRuntimeState()` 对比，才真正验证了线上运行态数据。

4. 没有重视 `service-model` 的 `newapi/glm-5.1` 线索。
   - 用户指出 `service-model` 中出现 provider 前缀后，才促使我检查 `ModelSelect` 的内部 value 与业务 model 的拆分逻辑。
   - 这个线索说明问题不是单个首页组件，而是公共运行态模型列表缺少 option。

5. 测试一度强化了错误名称。
   - 之前测试里出现 `glm5-5.1`，这会把错误模型名变成“被测试保护”的行为。
   - 最终已调整测试，只保护裸 `glm-5.1` 的真实 Aihub 模型 ID，并明确不做 `glm5-5.1` 隐式匹配。

## 后续排查准则

遇到“设置页有模型，但首页 / 聊天 / service-model 选不到”的问题时，先按这个顺序查：

1. 先确认两个页面的数据源是否一致。
   - 设置页 provider 模型列表：`getAiProviderModelList(providerId)`。
   - 首页 / `ModelSelect` / 能力判断：`getAiProviderRuntimeState()` -> `getEnabledModels(false)` -> `enabledAiModels` / `enabledChatModelList`。

2. 直接在运行容器内验证 repository 输出。
   - 不要只看数据库表，也不要只看前端 store。
   - 必须同时查 settings list 与 runtime list 是否都包含目标模型。

3. 不要用命名映射掩盖数据链路问题。
   - Aihub 同步过来的模型 ID 应按原始裸 ID 使用。
   - 除非上游明确存在 alias 规范，否则不要新增硬编码 alias。

4. 对 Select 中的 `provider/model` 保持边界清晰。
   - `provider/model` 可以作为 UI option key。
   - 业务配置和 Aihub model id 必须保持 `{ provider, model }` 分离。

5. 如果 UI 出现 `provider/model` 原样回显，优先怀疑 options 缺失。
   - 这通常说明当前 value 找不到对应 option，而不是一定说明数据库保存了错误字符串。

## 当前分支状态

分支：`codex-small-bugfixes`

已提交：

- `b06ebda Fix Aihub remote model runtime list`

PR：

- <https://github.com/biel-cc/MasterLion/pull/5>

本 handoff 文档用于补充该 PR 的排障复盘和后续交接。
