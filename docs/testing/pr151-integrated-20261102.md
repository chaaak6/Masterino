# PR151 整合验收记录

本轮将 #148（8f994535）和 #152（e53845a8）合入 #151，保留两条分支的提交历史。集成提交为 c1faa711，审查修复为 261546d8。没有合入 main、部署生产或重建 Docker 镜像；原工作目录和 worktree 中无关的未提交文件均保留。

用例先写于 [Gherkin 文件](pr151-integrated-20261102.feature)。本轮记录独立于此前验收，不把历史结果视为本轮复测。

## 审查

规范轴发现 1 项产品行为问题，已修复：新 Skill 版本发布后，商店仍读首次投稿的描述。现在仅在正式发布时，从所选版本 manifest 同步名称、描述；待审期间保持原已发布版本展示。真实 PGlite 回归先失败、修复后通过；测试集群又完整验证了 147 发布 → 界面改描述 → 148 待审 → 148 发布，商店界面显示新描述。

同时修复更换 ZIP 时未清除上一包错误提示的小问题。需求轴未发现新增核心流程阻断。记忆仍严格验证输出，只允许一次纠正并共享原截止信号；没有放宽 schema、吞掉失败或增加网络重试。

说明中引用的仓库 review-checklist、ux 技能文件在本工作区缺失，已检索，审查采用提供的项目规则和 PR 需求。规范轴及需求轴分别复核。另观察到执行边界原有 root.modes 未参与授权匹配，以及旧记录的读取 SCOPE_DENIED；均属既有链路，未据此扩大本轮实现。本轮新建 Word 后回读成功，没有复现该 SCOPE_DENIED。

## 环境与方法

本地 Electron 从整合分支构建，独立 test-server / local-151110200001 profile；原有账号与工作数据不用于测试修改。所有新增文件、技能和合成账号使用 qa-pr151-1102 前缀。集群为 masterino-test。

Skill 服务端由本轮成功完成的 Next.js standalone 构建装入既有测试候选 Pod，Market 使用当前构建。公网入口实际仍命中旧接口；通过进程日志与接口探针辨别后，改为仅监听本机的 kubectl 端口转发。临时 profile 连接该候选服务，APP_URL 对齐 loopback，使签名上传也走相同候选。未关闭 TLS 校验，未改系统网络。准备期间的旧服务 403/404/multipart 错误不算候选回归失败或通过。

交互使用真实原生窗口点击、文件选择、输入和保存。后台状态机、幂等和归档核对辅以真实 API、数据库及对象存储；不会将这些步骤称作后台 UI 点击。开发者工具实际查看 Console/Network，结合 Vite、Electron、候选进程和集群日志。React 19 ref、antd 弃用、Emotion/React Scan 开发告警保留；React Scan 浮层遮住保存按钮时，通过未遮挡的按钮下缘完成点击，没有修改产品代码规避。

## 本轮结果

| 用例 | 实际执行与结果 |
| --- | --- |
| 个人 Skill 导入、编辑、保存 | Electron 选 ZIP 导入，创建 skl_3rGMGkcpGnpT；修改正文及描述、点击更新；详情立即显示新正文，reference 保留。 |
| 当前快照导出 | Electron 商店菜单点击下载、系统保存到 Downloads；独立解包确认当前描述、INTEGRATED_SKILL_EDITED_OK 和 INTEGRATED_REFERENCE_OK。真实导出 API 也返回 200、内容匹配。 |
| 非法 ZIP 后恢复 | 当前候选 Electron 选择缺 SKILL.md 包，提交显示明确错误；同一表单换 recovery.zip 后旧错误立即清除，提交成功生成 149。 |
| ZIP 和个人稿送审 | Electron ZIP 送审生成 146；编辑后的个人稿通过“我的技能”送审生成 147。实际对象存储 ZIP 正文/reference 匹配。 |
| 幂等与版本 | 真实作者 API 同内容重投仍为 147，无重复版本；界面只改描述后再投生成 148。 |
| 审核与发布元数据 | 测试 reviewer 经真实 API 手动 scan-start、scan-passed、approve、publish，均 200；148 待审时资源仍指向 147 和旧描述，发布后指向 148 并显示 INTEGRATED_PUBLISHED_V2_DESCRIPTION；Electron 商店显示一致。扫描为手动推进。 |
| 新建外部 Word | Electron 请求 createOfficeDocument，卡片显示真实父目录、新文件及写权限，点击“仅本次”后落盘；readOfficeDocument 回读匹配，独立解包 Word XML 为 INTEGRATED_PR151_WORD_OK。 |
| 缺失直接父目录 | 当前候选真实聊天调用 createOfficeDocument；点击“仅本次”后显示路径不存在、未授予权限，随后拒绝。没有创建父目录或目标文件，也未恢复工具。 |
| 单次授权与拒绝 | 同一话题下一操作再次要求授权；点击拒绝，明确拒绝反馈，rejected.docx 不存在。 |
| 记忆后台 | 整合源码 worker + 测试集群 PostgreSQL/Redis + 真实 Aihub；合成偏好任务 success，3 条 2048 维向量落库并检索，跨用户命中 0；context、experience 各 1 条；关闭记忆后新模型请求 0。16 个模型 HTTP 请求均 200。此项是后台集成验证，不是记忆 UI 点击。 |

记忆合成账号使用独立用户 API key 和独立 Redis 队列前缀；仅此测试进程关闭 managed catalog refresh，未修改集群配置。首次尝试的提取已成功，但合成账号没有企业目录绑定，检索授权失败；修正合成测试环境后完整通过。模型无效 JSON 的日志仍可出现；测试成功不表示一次纠正保证所有模型输出都能恢复。

证据：[Skill](evidence/pr151-skill-20261102.json)、[Word](evidence/pr151-word-20261102.json)、[记忆](evidence/pr151-memory-20261102.json)。文件只含合成数据、必要状态和关联 ID，不含凭据或签名下载链接。

## 自动检查与边界

定向测试共 291 项：记忆包 41、文件执行边界 48、前端投稿/审批 20、服务端导入/投稿/路由 110、Market 44、数据库真实 SQL 2、桌面控制器 26，全部通过；同一文件重复复测不重复计数。另有真实 Aihub/队列集成测试 1 项通过。Market 构建及类型检查、变更文件 ESLint、git diff --check 通过；根完整类型检查在整合后通过；收尾重复运行的检查因与 Electron 启动争用资源而主动终止，不另计作通过，261546d8 的类型/测试 CI 成功。本轮当前后端 production build 成功。261546d8 的 CI 为 11 success、8 skipped、1 neutral，无失败；后续纯证据提交以最新 CI 为准。

追加真实点击：候选进程原引用的 integ-pr150-bridge 拒绝连接，改为测试命名空间现有 masterino-aihub-db-bridge 后同一模型请求成功进入 createOfficeDocument 路径审批；同一请求随后进入路径审批，点击“仅本次”显示路径不存在且未授予权限，点击拒绝后正常结束；父目录和文件均不存在。额外临时请求探针只记连接 origin 与错误码，收尾已移除。未将 Windows 联接、物理断网、跨设备断线及整套后台 UI 审核记为本轮通过。它们不作为本轮核心 macOS 流程的通过依据。审核路由更新及原 PR 的 Market 0002 迁移仍需按正常发布流程上线。

测试发布资源 146、148 按状态机 deprecate，恢复测试版本 149 按 scan-start/scan-passed/reject 退回；147 保留为历史版本，个人原稿保留。测试 reviewer 原权限在每轮 finally 恢复。临时公网测试 Ingress 已移除，临时 profile 的 token 副本清理；测试 App 和临时进程/端口转发在收尾退出。无生产变更。
