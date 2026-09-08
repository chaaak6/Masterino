# 本机 Skill / Office 独立验收计划

2026-09-08，基线 e1d3cd46，实施前固定。本文是验收要求，不是通过报告。范围 A–E；P 的 AST 平台不作为本次关门条件。参考 ../skills-office-audit/technical-plan.md（独立调查 worktree）及 ../local-environment.md。

当前执行环境已按用户后续指令改为：ACR 远端构建分支镜像 → 仅部署 `masterino-test` → 本机 Electron `test-server` profile 连接测试服务。不得启动本地全栈开发服务或本地镜像构建。下文最初的本地实例盘点仅为历史记录，不再作为启动步骤。

## 证据规则

真正验收必须从当前源码 Electron UI 选择工作区、附件、模型并发送提示，使用真实模型响应和实际文件产物；不得注入模型答复或用 mock 工具冒充成功。底层定向测试、文件回读及性能探针只作为补充证据。每个关键场景重复 5 次，同模型、提示和输入哈希，单列模型波动与人工授权等待。

记录源码 SHA + dirty diff、运行实例/backend/gateway/profile、模型/provider、operation/topic/tool call ID、UI 截图、执行工具与环境、资源版本、工具输出量、每轮实际 HTTP 请求字节数（仅数值）、模型轮数、工具/端到端耗时和结果文件哈希。日志不得包含凭据、Base64 或完整文档。记录通过、失败、未执行三种状态，失败分为资源/能力/权限/引擎/模型调度。

## 预先固定用例

| ID       | 真实 UI 操作 / 输入                                                                                             | 独立判定                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ENV-01   | 源码 Electron local profile 建立本地会话，在 synthetic 工作区执行                                               | UI 环境、工具清单、IPC/Gateway 执行目录一致，后端日志证明命中新 worktree；不连生产业务服务                                                      |
| XLS-01   | 工作区选择 sales-12.xlsx，提示“分析 Sales 的总收入、地区和月份收入，生成独立 HTML 报告，收入单位 CNY，保留原表” | 与 oracle.json 数字逐项精确相等；报告可实际打开，无 NaN/空图；原件 SHA 不变；标准分析不现场探依赖或编写解析器                                   |
| XLS-02   | 回形针发送同一表，用相同提示                                                                                    | 答案和产物与 XLS-01 同等正确；本机附件不上传原文件；上下文为有界摘要/按需范围，不能默认全文注入                                                 |
| XLS-03   | sales-10000.xlsx / sales-100000.xlsx 先 inspect，再读末尾 3 行，再汇总                                          | 范围/最后订单/汇总与 oracle 相符；hasMore、继续参数准确；未知总量允许 unknown；不因 inspect 强制全文扫描                                        |
| PERF-01  | 逐级规模、冷查询、重复查询、取消读取                                                                            | 分开记录选定 ZIP 部件、实际展开/读取字节、模型注入字节、RSS 峰值、首批/重复耗时、取消延迟；短输出本身不算流式证据。数值门槛在同机基线测量后固定 |
| PPT-01   | 回形针添加 reordered.pptx，问“列出实际第 1–3 页文字”                                                            | 必须是 QA-SLIDE-3、QA-SLIDE-1、QA-SLIDE-2；不能按 slide 文件名排序                                                                              |
| FORM-01  | 打开 formula-cache.xlsx，问表达式、缓存和是否重算                                                               | =1+2 / 缓存 999 / 未重算明确区分，不能把缓存 999 称为最新计算结果                                                                               |
| WRITE-01 | 对受支持子集创建 xlsx/docx/pptx、批改副本、占位符模板合并、校验                                                 | 使用独立解析器回读产物；失败原件 SHA 不变；结构验证与视觉验收分别报告；安装包离线引擎可用才能宣称支持                                           |
| IMG-01   | 回形针/粘贴/拖入 quadrants.png，问四象限颜色                                                                    | 红/蓝/绿/黄按位置正确；出站为真正多模态 data image，不传 localhost/file/blob URL；原图不上对象存储；数据库和日志无 Base64                       |
| IMG-02   | 加图后切无 vision 模型、历史重试、超量图、连续 ReAct                                                            | 明确提示切模型或超限，保留附件；不隐式转视觉 Agent；当前图片优先、历史占位不冒充看过；每轮 provider 序列化后实际发送前预算生效                  |
| SKILL-01 | 同名 qa-identity 放于项目 .agents/.claude、个人及 Agent 来源；激活、读引用、执行脚本                            | 按项目 > 个人 > Agent > 内置及 .agents > .claude；BODY/REFERENCE/SCRIPT marker 必须同一来源、同一版本和 key；activateTools 不按同名激活 Skill   |
| SKILL-02 | 激活后修改原技能，继续运行；新运行再激活；旧历史/歧义脚本调用                                                   | 本轮快照不混版；新运行获取新版本；非法/歧义身份不执行；成功激活状态跨步去重可见，失败无激活记录                                                 |
| SKILL-03 | 合法编辑、invalid-update.md、超限内容、改名冲突、校验中断、外部修改                                             | 非法/中断不改变原件；成功下轮发现；报告未提交 vs 已提交刷新失败；保留可恢复备份；取消 UI 删除需按 computer-use 规则处理                         |
| ATT-01   | 单文件外部附件、同名异路径、scratch 草稿后发消息、重试/导出/删除/跨设备                                         | 精确文件授权不能读取兄弟文件；资源 ID 与版本匹配，不按同名替代；无假 fileId；本地路径不进服务端 JSON；跨设备不可用有提示                        |
| CLOUD-01 | 内测单独验证已交付读取子集/旧附件兼容                                                                           | 必须单列已部署服务端版本，不把源码客户端连内测当作本地后端已通过                                                                                |

固定分析提示：`请读取 Sales 工作表，计算总收入、按 region 和 month 分组的收入（单位 CNY），生成可独立打开的 HTML 报告，包含摘要、两个分组表和图表，注明数据行数。保留原始文件不变。使用当前本机环境。`

## 合成夹具与标准答案

运行 `python3 scripts/e2e-local-office/generate-fixtures.py /tmp/masterino-office-qa`（只需 openpyxl）。生成器与产品代码完全独立，直接以整数算术生成标准答案，不从产品返回反推期望。oracle.json 不发送给模型，结果验收者独立持有。文件哈希随生成器生成。PPT 是读取页序的最小 OOXML 夹具，不能单独证明复杂排版或完整 PowerPoint 兼容。图片是纯色四象限数据夹具。大文件不入 Git。

12 行标准答案：总收入 8000；East 3300、West 2400、North 2300；2026-01 2800、2026-02 5200。已在产品实施前核对生成器的整数算术结果并修正草稿手算数字；后续实现不能改写期望来迎合产品输出。

## 初始环境盘点（尚未启动）

新 worktree 初始无 node_modules、无 .local-dev。Docker 可访问；已有两个独立开发实例运行，不得停止或删卷。默认 QStash 18080 已占用，新的实例必须选择全套独立端口并保留独立 instance.json。已有专用开发配置可在不输出值的前提下复制模型设置；不复制实例密钥、Cookie 或生产 Token。启动顺序为固定 pnpm 10.33.0 安装依赖 → 新配置/独立 setup → dev:local → READY 与 doctor → 协调后 dev:desktop:local。两个 Electron 模式固定使用 5173，先检查占用且不能自动杀进程。

详细 E2E 结果在实施完成后另写 acceptance-results.md；本计划和夹具生成成功均不等于产品验收通过。

## 环境准备进展

独立 setup 已完成，保留所有已有实例与卷；新 Web 3510、Next 3511、Vite 10576、Gateway 9088、PostgreSQL 19432、Redis 19379、RustFS 19400/19401、QStash 19481。dev:local 已启动，已达到 LOCAL DEVELOPMENT READY，尚未进行 Electron 验收。只复制专用开发模型配置，新 instance.json 由官方启动器生成。预检曾发现 3211 和 IPv6 9976 占用，已换端口；一次默认配置 setup 提前执行后失败，随后新实例以独立端口重新 setup 成功，未删除或停止其他实例。

夹具独立验证命令：`python3 scripts/e2e-local-office/verify-fixtures.py /tmp/masterino-office-qa`。2026-09-08 已通过哈希、三档工作簿聚合、公式缓存与实际 PPT 页序回读。当前本地 profile：`masterino-desktop-local-c52204665dda`。
