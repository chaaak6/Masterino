# PR #127 + #128 + #129 内测基础 BDD 验收

环境：`masterino-test`；本地源码 Electron 使用 `test-server` 独立 profile，连接 `https://mlai-test.bielcrystal.com`。使用专用测试账号 `MTEST10020`，不记录密码或 Token 值。验收前记下主服务、Bridge、Admin 镜像 digest 与 Electron 启动日志中的 Backend/Gateway/Profile。

## 场景 1：普通新话题聊天

**Given** 测试账号已登录，打开小宗狮 AI。  
**When** 点击“开启新话题”，用默认模型发送一条简短问候。  
**Then** 用户消息进入新话题，助手正常回复，没有 Readiness、Token 或服务内部错误；刷新后该话题仍可打开。

## 场景 2：切换模型后继续聊天

**Given** 场景 1 的话题已经收到回复。  
**When** 在输入区选一个不同且可用的聊天模型，再发送明确要求回复的短消息。  
**Then** 消息与回复仍在同一话题；模型选择显示新模型，服务端记录的该轮模型与所选一致，没有空回复或错误。

## 场景 3：新建第二个话题与历史恢复

**Given** 场景 2 已完成。  
**When** 点击“开启新话题”，发出另一条短消息；再从侧边栏切回第一个话题。  
**Then** 两个话题分别出现并可往返打开，第一话题的消息与模型设置保持可见，第二话题有独立回复。

## 场景 4：管理员按需检查用户可用性

**Given** 内测管理后台用户页可搜索专用测试账号。  
**When** 搜索该账号，点击“检查可用”，再打开“更多诊断”。  
**Then** 列表只展示已存的绑定摘要，单人检查给出 Aihub 账号和绑定 Token 的当前状态；诊断抽屉完整加载。列表加载本身不逐人调用 Bridge。

## 场景 5：内网对象存储配置检查

**Given** #128 的内网地址配置已部署在内测集群。  
**When** 只读检查主服务与 Market 生效的对象存储 endpoint，并从页面打开一个既有头像或静态资源。  
**Then** 服务端 endpoint 是深圳内网地址，浏览器资源仍使用公网可访问 URL，页面无加载失败。

每个场景记录实际点击、可见结果与必要的只读日志/配置证据；任何失败先定位，再在同一环境重测。新增聊天仅使用测试账号和无敏感内容。

## 2026-09-15 实际验收结果

测试镜像：主服务与 memory-worker 均为 `sha256:fc6d59dbd001a3e867ea4dd1c3b612a585ab9a4bcd58da2c61d10dfc47454d1e`，Admin 为 `sha256:b5f941259ed399dc8c031ef531202db7922873ec4594abc7dddfc5ed665d7091`，Bridge 为 `sha256:6cb96da941571928f54076337b3224b36f0df4c521f718c0405649dd4a9601e3`。`masterino-test` 的主服务、memory-worker、Admin、Bridge 和其余 Pod 均为 `1/1 Running`，对应 Deployment `1/1 Ready`。本地源码 Electron 用 `dev:desktop:test` 启动，走独立 `test-server` profile；已安装的正式版 App 没有参与点击验收。

| 场景 | 真实操作与观测 | 结果 |
| --- | --- | --- |
| 1 普通聊天 | 在源码 Electron 点击“开启新话题”，明确选 DeepSeek V4 Flash，发送无工具测试消息，得到 `CHAT-OK-A`；话题 `tpc_6eFAI2YsW7sw` 在最近列表出现。 | 通过 |
| 2 切模继续聊 | 同一话题改选 DeepSeek V4 Pro，第二条消息得到 `CHAT-OK-B`。只读查询该话题的消息记录：两轮助手模型依次为 `deepseek-v4-flash`、`deepseek-v4-pro`，provider 均为 `newapi`。 | 通过 |
| 3 第二话题与恢复 | 再点“开启新话题”，第二话题 `tpc_dulet4FQ3SxV` 得到 `CHAT-OK-C`；侧栏切回首话题，A/B 消息可见；刷新 Electron 页面后两个话题仍在列表，首话题历史仍可读取。 | 通过 |
| 4 管理员按需检查 | 在内测 Admin Chrome 用户页点 MTEST10020 的“检查可用”，单人抽屉显示 Masterino `active/v2`、Aihub 用户 `2699` 已启用、绑定 Token `#4956` 可用、9 个聊天模型；再点“更多诊断”，身份、用量、自动任务等区域正常加载。列表本身仅展示存储的绑定摘要，服务定向测试确认 100 人列表 Bridge 调用为 0。 | 通过 |
| 5 内网 OSS 与浏览器资源 | 只读检查内测 ConfigMap：主服务 `S3_ENDPOINT=https://oss-cn-shenzhen-internal.aliyuncs.com`，Market `MARKET_OBJECT_STORAGE_ENDPOINT=https://s3.oss-cn-shenzhen-internal.aliyuncs.com`；在 Chrome 打开测试站的 Market 写作头像资源，图片实际渲染。 | 通过 |

最终主服务镜像部署完成后，再用同一测试 Electron 在首话题真实发送 `Reply only FINAL-OK. Do not use tools.`，收到 `FINAL-OK`，确认最终 digest 下聊天仍通。此轮没有保存 Token 配置、没有操作正式集群。

静态验证：合并后与默认模型配置补丁后的 `bun run type-check` 通过；`tests/config/internal-service-endpoints.test.ts` 7 项通过；`git diff --check` 通过。`useWorkspaceTopicNavigation.test.tsx` 在当前 worktree 的测试 mock 初始化时因 `z.object` 为 undefined 而中断，尚未运行断言；该问题未作为真实点击结果的替代。专用账号没有自动任务记录，因此“更多诊断”虽可打开，不能直接以此账号覆盖任务状态列的 `Tag` 渲染分支；Admin 的 `Tag` import 已恢复并通过 Vite build。

验收范围是三个 PR 的合并代码在 `masterino-test` 上的基础路径。GLM-5.2 的 AIHub 映射按现状保留，没有对客户端模型列表做进一步迁移。等待人工复测前，本 PR 保持打开；不合入 main、不部署生产。
