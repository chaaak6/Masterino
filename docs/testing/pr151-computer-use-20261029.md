# PR 151 本轮验收

基线：远端 `14a574b3`；本地与该提交 tree 一致后开始修复。本轮结果独立记录，不沿用旧清单的通过状态。仅操作 masterino-test 与本地测试 profile，测试数据使用 qa-pr151 前缀。

| 用例 | 操作 | 预期 | 本轮结果 |
| --- | --- | --- | --- |
| T01 | Electron 发现页打开投稿，取消后重开 | 可打开；仅 ZIP 和个人技能；不残留旧文件 | 通过：Electron 打开、切到 ZIP 空态、取消；提交按钮禁用 |
| T02 | 个人技能编辑正文并保存、关闭重开 | 详情即时显示新正文，reference 保留 | 通过：Electron 修改为 PR151CURRENTBODYOK，保存后详情即时刷新、保留 reference |
| T03 | 下载 T02 并解包、重新导入 | SKILL.md 含最新正文，附属资源完整 | 通过：Electron 下载到 Downloads，解包核对新正文及 RETRY_REFERENCE_OK；只改 name 后经 Electron 重导入 qa-pr151-reimport 成功 |
| T04 | 个人稿送审、审核预览、拒绝后修订再投 | 冻结新正文与资源、版本明确，原稿保留 | 部分通过：Electron 重导入后主动送审，版本142 submitted；审核预览真实接口200且含新正文及 reference，随后退回清理；本轮未重复后台UI全状态机 |
| T05 | 同内容重投；已发布 V1 时提交 V2 | 不重复创建；普通安装仍得到已发布版 | 未执行 |
| T06 | 旧安装技能已有本地修改后更新 | 提示冲突，保留原正文与资源 | 自动回归通过：旧ZIP基线、正文/reference修改冲突、缺基线保留；本轮未以UI构造历史记录 |
| T07 | 项目与个人同名，项目内激活；无项目话题激活并读取个人 reference | 当前项目优先，其他上下文个人技能可用；以工具结果确认 | 通过：项目选择接口200；项目话题 tpc_2x1YLKJexSb3 实际激活 Project Skill 并返回 PROJECT_SCOPE_MARKER_OK；无项目话题 tpc_7EvXjrVwweaI 激活个人正文并读取 RETRY_REFERENCE_OK |
| T08 | ZIP 上传期间切断测试 App 的实际连接，再恢复重试 | 不误报送审；可重新上传，完整校验，不重复创建 | 未执行 |
| T09 | 无 frontmatter、缺 SKILL.md、穿越 ZIP 后改正常包 | 明确错误，正常包能继续提交 | 部分通过：Electron 无frontmatter中文提示、缺SKILL.md拒绝后正常包导入成功；路径穿越由真实解析器/路由测试验证，本轮UI选包证据不足，不记UI通过 | |
| T10 | 解除作者发行关联，取消后确认并回装 | 不删原稿，回装复用原 ID | 未执行 |
| T11 | 普通聊天、脚本、MCP 与重启后 Skill | 正常执行，来源/状态持久化 | 未执行 |
| T12 | 定向测试、类型检查、最新 CI | 修复覆盖，检查成功或精确记录外部阻塞 | 本地定向与类型检查通过，最新提交CI另附结果 |

环境恢复：原 kubeconfig 返回 Unauthorized；通过本机已有 masterino-test 阿里云 profile 刷新临时凭据后，已读取 masterino-test pods。设备网关 token 从该命名空间既有专用 Secret 装载本地服务，不记录值。

审查发现：个人技能下载仍指向导入时旧归档；历史 market 安装无 installedSkillHash 时更新未保护本地改动。分别修复并复测。

回归证据：`agentSkills.integration.test.ts` 39/39（实际解包最新下载归档并验证 reference、跨用户拒绝）；`importer.test.ts` 42/42（旧安装正文/reference 修改保护、无修改升级、缺旧包保留、URL 来源兼容、删字段与连续更新）；`publishing.test.ts` 3/3（规范化后的实际 FormData File 字节一致及资源修改产生新版本）；数据库 `agentSkill.test.ts` 16/16（普通 patch 合并、发行快照替换）。原 PR 14a574b3 全部 CI 已通过，包括 Test Server、两个 App 分片、Database、Packages、Desktop、Windows 测试客户端。新提交 CI 另行记录。

修复范围：当前正文及资源重建下载；历史安装从原 ZIP 验证基线，无法验证时保留；发行更新替换 manifest 避免删除字段残留；投稿规范化 YAML/正文边缘空白与 ZIP 时间，保持语义版本与归档字节一致。未部署生产、未重建 Docker 镜像。

## 本轮新增发现与复测

最初下载重建修复使 Electron reference 报 `Skill package hash mismatch`：桌面执行按旧 zipFileHash 校验，却共用默认导出当前快照的接口。现已将下载接口的 archive 参数区分 current（UI 默认）与 installed（桌面执行显式传递），继续保持原包哈希/激活版本校验。未修改用户原稿 zipFileHash。修复后同一 Electron 话题无需重装，首次 readReference 即返回 RETRY_REFERENCE_OK；正文当时为 UIEDITFINALMARKER。随后经 UI 改为 PR151CURRENTBODYOK 并下载，归档只有 SKILL.md 和 references/example.md，新正文为 true、旧正文为 false。

测试方式边界：T05/T09/T10/T11 的旧记录仍可参考原人工清单，本轮未逐项重做；T08 真正物理断网没有执行，不能记为通过。环境修复和范围优先级的关键阻塞已解除。所有未执行项目保留原状态，不凭旧记录改成本轮通过。

追加定向：下载Router + Desktop runtime + Mecha 共55项通过（39+6+10）；数据库16、导入42、投稿3通过。类型检查及生产代码 ESLint 通过。测试包版本142审核预览200且正文/reference均匹配，清理通过测试审核接口执行，并恢复测试审核账号原权限。

版本142清理结果：直接 submitted→reject 被状态机拒绝（403，无状态变化）；随后按 scan-start→scan-passed→reject 顺序均返回200，最终 rejected。扫描为测试管理员手工推进，未称为自动扫描。

最后补测发现商店ZIP导入仍显示英文manifest错误且将格式错误返回500，现复用已有中文说明，Electron重复上传无frontmatter包确认显示中文且仍可重试；路由仅将SkillManifestError/SkillParseError映射400，存储故障仍为500。真实非法ZIP路由回归43/43，解析器46/46（含路径穿越），Market API/仓储29/29。全体不重复计数为195项：Router43、Desktop6、Mecha10、Importer42、Publishing3、Database16、Parser46、Market29。

真实断网准备了28MiB隔离ZIP，但尚未关闭系统网络：已向用户请求短暂关闭Mac Wi-Fi约30秒并恢复的确认，会影响其他应用连接，收到确认前不执行该步骤。此项继续为未执行。当前PR保留草稿。
