# Review 修复定向验收

本轮三项真实 Electron UI 验收通过。这是新附件 ID 链路的独立样本，不复用此前5+5的通过结论；本轮没有重新进行5+5统计。

| 定向场景          | 实际结果                                                                                                                                                                             | 证据                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新纸夹 Excel→HTML | 新无项目 topic；inspect/read 均只传 attachmentId、无 path；3条完整工具回执扫描无附件源/受管副本路径；总收入8000、地区/月度分组与占比正确，12行，原件hash不变；4模型轮、3工具、0shell | [汇总](evidence/review-fixes-excel-summary.json)、[原始HTML](evidence/review-fixes-excel-report.html)、[实际请求清单](evidence/review-fixes-excel-manifest.txt) |
| 历史图片视觉门    | Vision Exp正确识别合成四色图；切Flash后“加入输入”提示不支持视觉，输入附件仍为0；普通预览仍显示图片；切回Vision Exp后成功加入1张图片                                                  | [汇总](evidence/review-fixes-image-summary.json)                                                                                                                |
| Skill稳定身份     | 实际激活state.id为 `project:pws_gNKi2pf9k62d:qa-identity`，readReference以同key读取，真实工具内容包含 `QA-project-agents-REFERENCE`；3模型轮、2工具                                  | [汇总](evidence/review-fixes-skill-summary.json)                                                                                                                |

固定客户端 `5d1b2cc3`，服务端 `b3cf909d`，镜像digest `sha256:3c69e3188021b599e007f7c68ea023fdf3fd08c79be4dfa76f2ee61089d5b5d8`。客户端差异仅主进程旧附件path脱敏、测试与说明，服务端相关代码相同。Electron session60107使用test-server profile，仅连接masterino-test，未启动本地后端。

证据界限：在真实DevTools Network中排除标题生成请求，展开首个业务请求的user `local_attachments`，实际看到attachmentId/name/mime/size而无path。AX内容会截断，未导出或扫描完整HTTP请求；因此不声称全请求字节级无路径。另通过仅限本轮合成topic的DB只读查询，对3条工具的完整content/state检查合成源目录与受管`.attachments`路径，均无命中；输出报告的普通scratch绝对路径继续保留。输出字节字段是工具执行指标，不是HTTP传输字节。

图片历史入口拒绝后没有发送额外模型请求：本轮图片topic仅初始user和Vision Exp assistant两条消息。预览与重新加入通过真实UI观察；未读取内部store。原始AX与仅合成图的现场截图保留于 `/tmp/masterino-review-r4-evidence`，不要求PR reviewer依赖这些本机文件。

输入与oracle分离，模型未获oracle。源xlsx hash为 `fd74bb1f87b62d926968778efb8cf35dea2bdadb887e24ec607c16b4da669c15`，报告hash为 `8091ff7678d57c5c491794b1870d3aa88cc72cc32a32201e3a8d737cd81cdf83`。原始HTML未格式化，独立读取核对数字、表格和内联SVG；本轮未另做浏览器全页报告截图。

负Skill key、错误snapshot及旧path兼容变体由定向自动化测试覆盖，未伪造真实UI负例。保护范围是本地附件源/受管副本路径；普通工作区path接口继续保留，不宣称任意shell输出里的全部本机路径保密。旧历史不追溯清理。本轮也未扩测拖拽、跨设备或全来源Skill矩阵。CI和自动化测试状态由根验收汇总，避免重复累计。

## 自动化与部署核对

产品提交 `5d1b2cc3` 的 [Test CI](https://github.com/chaaak6/Masterino/actions/runs/34302841945)、[E2E CI](https://github.com/chaaak6/Masterino/actions/runs/34302841938) 和 [Windows 测试安装包构建](https://github.com/chaaak6/Masterino/actions/runs/34302845138) 均通过。Test CI 包含桌面类型检查，未在本机运行全栈、全量构建或全量类型检查。ACR 构建规则在触发分支构建后恢复并核对；仅更新 masterino-test 主服务和 worker，两个 rollout 均成功。

定向验证：视觉快照/请求入口/历史图片组件94项；服务端RuntimeExecutors 162项（包含缺失key、名称别名、外部key在单调用/批量/恢复三条路径的9项失败例，以及2项合法身份例）；设备附件6项、附件上下文13项、本地执行器12项、桌面边界22项。复跑不累加为新样本。早期CI的两个无用转义lint错误已修正，以上链接对应修正后的产品提交。

验收后只停止本轮QA拥有的Electron进程；未停止其他应用。最终归档提交只改文档和证据，不改变上述产品代码。

## 桌面激活返回校验补齐

后续代码复查发现：桌面虽调用服务端 executeSkillTool RPC，却绕过 Agent RuntimeExecutors 的激活结果校验。本次将已有校验移到共享 skillActivationResult 函数，两入口均按各自已绑定的允许集合核对完整 key。无效成功结果在返回或记录前转为 SKILL_ACTIVATION_IDENTITY_MISMATCH，移除技能正文、身份状态和 deferred 标记；合法结果及原有失败保留。视觉快照实现不变。

本次定向回归：桌面RPC 10/10、服务端RuntimeExecutors 162/162通过，限定ESLint/Prettier检查通过。缺失/空key、名称别名、其他工作区同名key、其他来源key、空注册表、合法key和原失败均覆盖。本次没有重跑真实Electron E2E或重新部署；上文真实E2E证据仍只对应其标注版本。
