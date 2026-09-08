# 本机 Skills / Office 真实验收结果

固定5+5已完成：核心收入汇总10/10正确，源文件10/10不变，首次保存10/10成功，无依赖探测或Excel解析脚本10/10。**不等同于整份报告全部正确**：纸夹1自加平均单价266.67错误，简单均值应250、加权均值242.42；原始错误报告保留。纸夹4用Python校验已读12行，属于计算回退，不是Excel解析器。

客户端HEAD `0db77b3e`，产品基线与服务端均 `f0a049ff`；HEAD只多测试类型修正。镜像digest `sha256:16dae8f6403ba7bcb467d95d4266604f6d45ef631a4d4ae004ed94a6298b7a46`。真实Electron连接masterino-test，模型DeepSeek V4 Flash Vision Exp，新目录/topic、同提示、同输入hash；oracle未提供给模型。完整版本、逐轮工具输出长度/耗时、usage和报告hash见[脱敏JSON](evidence/final-repetitions.json)。

| 场景      | 核心数字 | 原件 | 解析器回退 | 首次保存 | 模型轮/工具数 | Shell | 秒     | 附注         |
| --------- | -------- | ---- | ---------- | -------- | ------------- | ----- | ------ | ------------ |
| 工作区 01 | 通过     | 不变 | 0          | 成功     | 7/8           | 1     | 70.013 | —            |
| 工作区 02 | 通过     | 不变 | 0          | 成功     | 8/9           | 2     | 94.131 | —            |
| 工作区 03 | 通过     | 不变 | 0          | 成功     | 7/9           | 2     | 67.114 | —            |
| 工作区 04 | 通过     | 不变 | 0          | 成功     | 4/4           | 0     | 52.423 | —            |
| 工作区 05 | 通过     | 不变 | 0          | 成功     | 6/6           | 0     | 57.837 | —            |
| 纸夹 01   | 通过     | 不变 | 0          | 成功     | 4/4           | 0     | 58.318 | 附加均价错误 |
| 纸夹 02   | 通过     | 不变 | 0          | 成功     | 4/4           | 0     | 52.664 | —            |
| 纸夹 03   | 通过     | 不变 | 0          | 成功     | 4/4           | 0     | 59.943 | —            |
| 纸夹 04   | 通过     | 不变 | 0          | 成功     | 5/4           | 1     | 61.777 | 计算回退1次  |
| 纸夹 05   | 通过     | 不变 | 0          | 成功     | 5/4           | 0     | 50.709 | —            |

工作区耗时中位67.114秒（52.423–94.131），纸夹58.318秒（50.709–61.777）。这是落库至最终回复的实测时间，不承诺通用提速比例。累计input/cache token不是单轮上下文或HTTP字节。人工选文件/目录在发送前，不计其中；已有自动批准配置，本组无审批等待。

## 可审阅产物

- [真实工作区HTML](evidence/final-workspace-report.html) / [纯报告整页截图](evidence/final-workspace-report.png)。
- [真实纸夹HTML（保留附加均价错误）](evidence/final-paperclip-report.html) / [纯报告整页截图](evidence/final-paperclip-report.png)。产物未格式化或人工修正。
- [修复前7次固定样本](evidence/fixed-group-before-scratch-fix.json)，两次纸夹首写拒绝及两次工作区解析绕路均保留；[工作区旧原件](evidence/before-scratch-fix-workspace-report.html)、[纸夹旧原件](evidence/before-scratch-fix-paperclip-report.html)。
- [部署与18次诊断历史](diagnostic-history.md)保留全部相关证据；[定向首次绝对写回归](evidence/diagnostic18-absolute-scratch-write.json)不是自然重复样本。

## 补充真实链路

| 场景                         | 结果                                                                                                                                            | 证据                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 十万行自然聚合               | 3模型轮/4原生Office工具、0shell、22.007秒；核心总额/分组全正确，首次无版本错误，原件不变。额外“2,000,000个数据单位”错误，实际units300000        | [汇总](evidence/final-large-native-summary.json)      |
| batch副本与模板merge         | 6轮/8工具、27.547秒；真实工具完成，独立openpyxl回读G2=777及模板替换正确，两原件hash不变                                                         | [汇总](evidence/final-batch-merge-summary.json)       |
| 项目Skill跨operation版本变化 | 产品update修改description后，旧激活exec真实返回SKILL_RESOURCE_VERSION_CHANGED；重新激活后脚本恢复。初次激活阶段有相对脚本路径失败后恢复，未隐藏 | [工具证据](evidence/final-skill-version-summary.json) |

上述补测客户端6f3c5bb6、服务端f0a049ff；该版本差异仅个人Skill提示，Office相关代码相同。Skill拒绝有实际tool消息证据，但没有独立adapter调用计数，不能以缺字段证明完全未调用。

最终部署客户端/服务端均6f3c5bb6，镜像digest `sha256:62dcaedc077db486feeede841180efbf3434c796710d31259e7fb7bd451f40a9`。该版本[Skill读取烟测](evidence/final-skill-smoke-summary.json)已通过：完整project key激活后，readReference使用同一完整id，返回预期标记，3模型轮/2工具、8.467秒。

## 限制与待补测

- 十万行、batch/merge及Skill资源变更拒绝已补测；UI禁用策略尚未覆盖；最新同版本项目Skill读取烟测已通过，不等同于个人非ZIP预选UI路径通过。错误均价报告已另存[修正版](evidence/report-corrected.html)，[跟进证据](evidence/report-correction-summary.json)显示3模型轮/2工具、83.579秒，通过Python try-import/openpyxl重读后得到简单均值250、加权均值242.42；原报告与Excel hash不变。这是额外诊断，不覆盖首次错误、不算原生调度通过。修正版称原错误来自8000÷30，属于模型未证实推断。
- 部分JS报告把North28.75%显示28.7%，另有纸夹1额外均价错误；核心收入要求与完整报告质量分别评价。
- 拖入自动化未触发，未验收；纸夹/粘贴可读取、图像历史重新加入发送、项目Skill优先级/非法编辑原件不变/创建下轮发现已有诊断实证，不能扩成全来源矩阵或全图片边界通过。
- 跨设备附件、兄弟文件UI越权、导出/删除、复杂Office格式保真、Electron停止按钮中止扫描未真实UI覆盖。直接reader取消探针仅补充。
- 实际HTTP字节、完整工具目录数量未测得；不存在用token或缓存命中代替这些指标的结论。原始截图/AX/逐消息细节仅本机/tmp保存，未提交；源Excel为合成夹具、不入Git。
