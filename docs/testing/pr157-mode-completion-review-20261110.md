# 引导、桌面策略与输入补全 review 核对

范围：合并后的 PR #157（含 #160）；只核对新增未解决线程，不扩大到任意模型推断或离线框架。

| 原 PR / 线程 | 判定与处理 | 证据 |
|---|---|---|
| #160 PRRT_kwDOS_jr-s61Janb：渠道 Flash 卡片缺能力 | 成立。仅为确切的 `DeepSeek/deepseek-flash` 增加 `deepseek-flash` 元数据候选，保留原始请求 ID；不泛化剥离其他渠道前缀，也不将任意含 flash 的模型视为相同模型。 | 现有模型库真实 deepseek 卡片用于测试夹具。新增一项断言修复前失败（能力均 false），修复后通过；另断言 `other/deepseek-flash` 不继承扩展参数。 |
| #157 PRRT_kwDOS_jr-s61KO6y：vi-VN 缺 finishError | 过时。`3fdd4ab6` 已补齐越南语键，本次合并保留。 | 通过主语言契约检查，未再补重复键。 |
| #157 PRRT_kwDOS_jr-s61KO60：离线必须尽力而为并直接完成 | 不采纳建议的静默完成路径。当前目标是账号完成状态跨客户端一致；上轮 review 修复正是先持久化再导航。失败时已有清晰提示、返回与重试，恢复连接可完成；没有产品需求要求把服务端失败伪装为账号已完成。 | 现有“保存失败保留页面且可重试”回归通过；本次未新建离线队列、未忽略完成错误、未改安装失败流程。 |
| #157 PRRT_kwDOS_jr-s61KO61：退出请求与硬导航竞态 | 成立。先 await 服务端 OIDC/better-auth 登出，且该调用不自行导航；再清理本地远程授权并进入桌面登录引导。普通 Web 的 logout 默认仍导航 `/signin`。 | 在已有 auth 测试内新增一项断言，修复前实际跳到 `/signin` 导致失败；修复后完成退出且留待调用方选择导航。 |

定向验证：
- `packages/model-runtime`: `pnpm exec vitest run --silent=passed-only src/utils/modelParse.test.ts src/providers/newapi/generateObject.test.ts`：2 文件、85 项通过。
- 根目录：`pnpm exec vitest run --silent=passed-only src/store/user/slices/auth/action.test.ts src/helpers/desktopAgentMode.test.ts src/store/agent/selectors/agentByIdSelectors.test.ts src/routes/onboarding/features/AgentPickerStep/index.test.tsx`：4 文件、38 项通过。
- 修改的 5 个 TypeScript 文件 ESLint 通过；主语言契约检查 56,620 项通过；`git diff --check` 通过。
- 初轮只增加两项针对已确认问题的回归，随后按真实退出反馈补充未授权初始化边界，其他复用现有用例。未修改正式服务、Aihub 权限或模型 ID；模型请求沿用测试后端已有的 Aihub 依赖。

真人验收建议：测试 App 使用独立 profile 登出后应只进入桌面登录页，不出现 `/signin` 二次导航；DevTools 可核对 clear-session / sign-out 请求先完成、本地授权后清理。补全实测需加载合并后的服务端路由，不能以旧测试服务的请求成功替代。


## 真实退出反馈后的校准

首次实测仅await登出仍不够：有草稿时InputEditor的beforeunload会阻止完整文档导航；撤销原生配置广播又会触发账号数据重取，并在未标记首次OIDC的profile重新打开授权。发现浏览器已有另一测试会话时立即停止业务操作，没有对该会话发送消息或修改数据。

最终处理保持原有路由/Store框架：显式退出标记首次OIDC已处理、清本次会话完成标记，先通过React Router卸载主路由和编辑器；服务端logout以redirect=false完成后再清原生授权并重载登录页。原生配置未就绪/未激活时不初始化账号数据，不因撤销配置广播全量重取缓存；有效配置激活后仍沿用原有初始化与刷新。

最终源码App用原MTEST10010授权冷启动正常，再保留未发送草稿并实际点击退出，停在桌面登录页，无二次自动授权。磁盘确认原生auth文件删除、active=false。6个定向文件38项通过，完整tsgo与ESLint通过。服务端退出HTTP结果未保存充分日志，证据范围不扩大；Web默认logout导航由既有测试保留。
