# PR 151 本轮验收

基线：远端 `14a574b3`；本地与该提交 tree 一致后开始修复。本轮结果独立记录，不沿用旧清单的通过状态。仅操作 masterino-test 与本地测试 profile，测试数据使用 qa-pr151 前缀。

| 用例 | 操作 | 预期 | 本轮结果 |
| --- | --- | --- | --- |
| T01 | Electron 发现页打开投稿，取消后重开 | 可打开；仅 ZIP 和个人技能；不残留旧文件 | 通过：Electron 打开、切到 ZIP 空态、取消；提交按钮禁用 | |
| T02 | 个人技能编辑正文并保存、关闭重开 | 详情即时显示新正文，reference 保留 | 未执行 |
| T03 | 下载 T02 并解包、重新导入 | SKILL.md 含最新正文，附属资源完整 | 未执行 |
| T04 | 个人稿送审、审核预览、拒绝后修订再投 | 冻结新正文与资源、版本明确，原稿保留 | 未执行 |
| T05 | 同内容重投；已发布 V1 时提交 V2 | 不重复创建；普通安装仍得到已发布版 | 未执行 |
| T06 | 旧安装技能已有本地修改后更新 | 提示冲突，保留原正文与资源 | 未执行 |
| T07 | 项目与个人同名，项目内激活并读取 reference；其他项目再次调用 | 当前项目优先，其他上下文个人技能可用；以工具结果确认 | 部分通过：项目选择接口 200；对话显示激活 Project Skill 并返回 PROJECT_SCOPE_MARKER_OK；无项目上下文补测中 | |
| T08 | ZIP 上传期间切断测试 App 的实际连接，再恢复重试 | 不误报送审；可重新上传，完整校验，不重复创建 | 未执行 |
| T09 | 无 frontmatter、缺 SKILL.md、穿越 ZIP 后改正常包 | 明确错误，正常包能继续提交 | 未执行 |
| T10 | 解除作者发行关联，取消后确认并回装 | 不删原稿，回装复用原 ID | 未执行 |
| T11 | 普通聊天、脚本、MCP 与重启后 Skill | 正常执行，来源/状态持久化 | 未执行 |
| T12 | 定向测试、类型检查、最新 CI | 修复覆盖，检查成功或精确记录外部阻塞 | 未执行 |

环境恢复：原 kubeconfig 返回 Unauthorized；通过本机已有 masterino-test 阿里云 profile 刷新临时凭据后，已读取 masterino-test pods。设备网关 token 从该命名空间既有专用 Secret 装载本地服务，不记录值。

审查发现：个人技能下载仍指向导入时旧归档；历史 market 安装无 installedSkillHash 时更新未保护本地改动。分别修复并复测。

回归证据：`agentSkills.integration.test.ts` 39/39（实际解包最新下载归档并验证 reference、跨用户拒绝）；`importer.test.ts` 42/42（旧安装正文/reference 修改保护、无修改升级、缺旧包保留、URL 来源兼容、删字段与连续更新）；`publishing.test.ts` 3/3（规范化后的实际 FormData File 字节一致及资源修改产生新版本）；数据库 `agentSkill.test.ts` 16/16（普通 patch 合并、发行快照替换）。原 PR 14a574b3 全部 CI 已通过，包括 Test Server、两个 App 分片、Database、Packages、Desktop、Windows 测试客户端。新提交 CI 另行记录。

修复范围：当前正文及资源重建下载；历史安装从原 ZIP 验证基线，无法验证时保留；发行更新替换 manifest 避免删除字段残留；投稿规范化 YAML/正文边缘空白与 ZIP 时间，保持语义版本与归档字节一致。未部署生产、未重建 Docker 镜像。
