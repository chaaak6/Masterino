# PR138 + PR144 + PR146 集成验收（2026-10-15）

## 范围与环境

在 PR138 的独立 worktree、`codex/local-document-processing` 分支合入 PR144 `e87df170` 和 PR146 `04ef64cb`，合并提交分别为 `e2f90a64`、`be1c59b9`。未操作原主 worktree 的未提交修改，未部署服务、发布镜像或合并远端 PR。

本地 Electron 开发 App 使用独立 profile `masterino-desktop-local-138144146015`、独立存储和端口5183/9343/9344，只连接 `https://mlai-test.bielcrystal.com`；关闭自动更新。只测试新建话题和本次生成的合成文件。正式安装的 App 未修改。测试期间未安装新的系统 PDF/Office 工具，使用 worktree 的内置 Python、DuckDB、PDF.js、Canvas 和 PPTX 引擎。

真人链路由 computer use 操作原生输入框、文件选择器、附件菜单、Stop、话题和设置页面。CDP仅旁路读取业务状态、请求状态和进程指标；没有用自动脚本填写聊天或代替这些 UI 步骤。另列脚本 BDD、真实 Electron 集成和完整 App IPC 验收，三类证据不混计。

测试模型为 GLM-5.3-Flash。模型对失败根因的解释不作为工程事实：例如它曾把 PPT 布局错误误归因于 lineSpacing，实际源码及失败测试证明根因是引擎布局常量大小写。

PR144 的记忆抽取、召回、嵌入和向量写入因 TEST 没有记忆实例而跳过；未启用记忆、未更改账号或模型设置。只读检查记忆/服务模型页面，并回归普通聊天。PR146 的故障恢复通过合并后生产模块的40场景验收；本轮真人操作另验证正常完成、Stop、下一条聊天和重启。

## 数据准备与独立预期

运行 `e2e/documents/live-fixtures.py` 生成全新文件；不用真实用户文件，也不把被测引擎的结果当预期。300,000行、13列 XLSX 中：A是唯一ID，B是测量值/缓存公式/缺失/错误，C是12个类别，其余10列是可复现的噪声。只选A/B/C进入数据集。XML仍需流式解析源文件，不宣称未读取任何噪声字节。

| 项目                          | 独立预期/实测文件信息             |
| ----------------------------- | --------------------------------- |
| 压缩文件                      | 137,324,891 bytes，130.963 MiB    |
| 展开内容                      | 380,537,978 bytes，362.909 MiB    |
| 测量规格                      | 9.4 ≤ B ≤ 10.6，含边界；从第2行起 |
| 总记录 / 有效值               | 300,000 / 299,400                 |
| Pass / Fail / Incomplete      | 183,080 / 116,320 / 600           |
| 缺失 / 错误 / 无缓存 / 非数值 | 300 / 300 / 0 / 0，四者互斥       |
| 均值                          | 9.99988496993988，浮点容差比较    |
| 样本标准差                    | 0.5775318479027954，n−1           |
| 最小 / 最大                   | 9 / 11                            |
| A精确唯一数 / C分组           | 300,000 / 12组，每组25,000        |

预期由生成器中的 Python 标准库独立累计，保存在本地 `golden.json`。另准备三行小 Excel（alpha=8、beta=10、gamma=12，均值10）、三页已知标题PPT和固定标记文本。既有 BDD fixture 还生成百万行、展开超过1 GiB的工作簿和101 MiB附件。

## 测试步骤与实际结果

“UI”表示本轮原生 computer use；“BDD”或“IPC”表示另行执行的自动验收。没有覆盖的部分明确列出。

| ID       | 操作与判定标准                                         | 实际结果                                                                                                                                                                 |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ISO-01   | 检查服务、profile、存储、端口和更新设置后启动          | 通过。主进程/renderer各自核对profile，backend和token issuer均为TEST；实际短聊天成功                                                                                      |
| CHAT-01  | 新建话题，只要求固定短回复，不调工具                   | UI通过：`INTEGRATION_CHAT_OK`，正文/话题/发送区均结束；话题 `tpc_eNDCNhb8f571`                                                                                           |
| CHAT-02  | 生成100段长回复，已有正文后点击Stop，再发送短问题      | UI通过：部分正文保留，出现“已中断”，随后正常得到`LIVE_STOP_RECOVERED`；话题 `tpc_Pg4C7WPyAKlv`                                                                           |
| CHAT-03  | 切换话题、返回，关闭并重启隔离App                      | UI通过：先前统计与PPT结果可重开，无永久生成状态；重启后继续创建PPT成功                                                                                                   |
| FILE-01  | 请求新建文本并读回，独立检查磁盘内容                   | UI通过：`integration-check.txt`精确包含`PR138_LOCAL_FILE_OK`。本轮未另外创建HTML                                                                                         |
| XLS-01   | 原生上传小Excel，读全部三行，计算均值                  | UI通过：Data表8/10/12、均值10；保留既有`readOfficeDocument`路径                                                                                                          |
| XLS-02   | 原生文件选择器上传131 MiB Excel                        | UI通过：两轮独立上传成功，附件显示131.0 MB，managed copy实际存在；分块IPC另由BDD/完整App验证                                                                             |
| XLS-03   | 自然语言要求预检、表头、完整B列统计，并说明后续按C追问 | UI通过（修复后重跑同一请求）：inspect→有界表头→A/B/C单次建库→job轮询完成；未把30万行塞入模型                                                                             |
| XLS-04   | 对照独立golden核对分类、质量和统计量                   | UI与独立基准通过：183080/116320/600，有效299400，缺失300、错误300；均值/样本标准差一致                                                                                   |
| XLS-05   | 追问按C分组、A精确去重及3条源行，不重扫                | UI通过：复用原datasetId，`sourceScans=0`，12组各25000、唯一数300000，源Excel行号可追溯                                                                                   |
| XLS-06   | 同一数据集导出XLSX+PDF，再读回                         | UI及独立OOXML读回通过：最后一行恰为`Pass,183080,Fail,116320,Incomplete,600`；PDF文本分类相同                                                                             |
| XLS-07   | 再次导出到已有路径                                     | UI通过：job明确失败`Report output already exists`；既有文件保留，随后PDF工具和聊天正常；无半份发布由Electron集成验证                                                     |
| XLS-08   | 扫描开始后cancel，再读小文件                           | 自动真实Electron通过：已开始扫描后取消，进程回收；后续普通读取在5秒约束内完成。未把聊天Stop等同于cancelDocumentJob                                                       |
| XLS-09   | 扫描开始后退出App，检查Python先回收                    | 自动真实Electron、完整App直接退出、修复后的原生菜单退出均通过。包含忽略TERM的Python副本；手工模式在扫描进度/PID就绪后由computer use点击菜单，旁路断言主进程/Python均结束 |
| PDF-01   | 指定页读取、搜索Pass、渲染第一页并在聊天显示           | UI通过（修复后重跑）：页码/命中正确；实际看到596×843页图。令牌过期后的重新获取也已测试                                                                                   |
| PPT-01   | 原生上传三页PPT，读标题和第二页数值                    | UI通过：三个标题及8/10/12/mean10正确，与小Excel一致                                                                                                                      |
| PPT-02   | 创建新三页PPT、校验、渲染本地预览、读回                | UI通过：3页、1图表、0错误/警告；独立解析chart1.xml得到8/10/12，输入未覆盖。SVG预览为工具布局预览，不冒称PowerPoint截图                                                   |
| PPT-03   | 显式`page.layout=standard`创建新PPT                    | 初次UI失败`UNKNOWN-LAYOUT`；源码修复后、重启App再测通过。OOXML为9144000×6858000 EMU，精确4:3；文本含`STANDARD_LAYOUT_OK`                                                 |
| DEP-01   | 只损坏临时Python副本的DuckDB导入/元数据，再恢复        | 自动真实Electron通过：既有Python/PPT、Office、PDF保持可用；仅表格引擎报错，修复副本后表格恢复                                                                            |
| CAP-01   | 旧/部分/完整桌面声明能力                               | BDD通过：旧与部分桌面隐藏不支持的新文档接口；既有Office/PPT能力保留                                                                                                      |
| RETRY-01 | 普通聊天、工具后续回复正常结束                         | UI通过：统计、导出、建文本和PPT完成，无假EOF导致的重复本地写入                                                                                                           |
| RETRY-02 | 模拟EOF/reset/断网/恢复中Stop/耗尽/迟到事件            | 合并后生产模块真实Electron BDD：40场景195步骤通过。本轮未对登录App额外注入TCP断流；PR146原真人断流记录单独保留，不算本轮新增实测                                         |
| MEM-01   | 只读打开记忆/服务模型页，再继续聊天                    | UI通过：页面正常、开关仍关闭、服务模型可见；不验证缺失实例的记忆读写                                                                                                     |
| PERF-01  | 同一大文件对照旧聚合、冷建库、复用查询                 | 通过，详见下表；旧/新分组均值和有效数逐组一致                                                                                                                            |
| CI-01    | 更新138，核对当前head的全部实际执行CI                  | 以PR当前head的Checks为最终门槛；结果及运行链接写入PR说明，不以先前提交绿灯替代                                                                                           |

## 由真实测试发现并修复的问题

1. **合并后入口无法编译。** 自动合并保留了Overlay ChatPanel的重复同名import。实际启动Vite时报错，删除重复import；对应回归和完整App启动通过。
2. **agent规划列不足、质量语义含混。** 首轮自然请求只建B列，且模型把incomplete与error当成可能相加的类别，进行了多次多余查询，最终人工Stop。引擎数值本身正确。修复为互斥的missing/cacheMissing/error/nonNumeric四项及明确公式，返回实际建库列；桌面与网关共用文档提示，要求按已知后续问题选择列的并集。相同请求重测选A/B/C，质量解释正确；后续分组/去重不重扫。
3. **每个新接口都带整份20字段schema。** 按API拆分字段及必填项：inspect只有来源，job查询/取消只有jobId；分析需要columns+metrics。9接口序列化schema由16,935降到7,328 bytes（约56.7%），减少无关字段与模型参数混用机会。质量/schema合同先红后绿，纳入BDD。
4. **PDF渲染完成但用户看不到页图。** Markdown默认过滤`localfile:`。只为桌面img/src保留带UUID令牌的PNG capability URL，并接入UI组件实际的`reactMarkdownProps.urlTransform`；主进程继续验证令牌、精确真实路径与时效。普通链接、无令牌地址、file/javascript/data、SVG和web端仍走原过滤。先复现红测，修复后真实聊天页图可见；安全边界和既有本地文件标签6项测试通过。
5. **既有PPT 4:3布局失效。** 声明支持standard，但PptxGenJS实际常量为`LAYOUT_4x3`，源码误写`LAYOUT_4X3`。一处常量修复，新增真实文件创建/读回回归从UNKNOWN-LAYOUT失败变绿；完整13项PPT回归通过。重启后的真人请求也成功，不能只靠改成宽屏绕过。

6. **macOS原生退出重入。** 等CI期间补测原生菜单退出，稳定复现窗口关闭但主进程仍活着；旁路确认cleanupStarted/Complete均为true，已无活动任务。清理Promise的microtask中再次调用app.quit发生在原生terminate回调尚未离开时。改为setImmediate在下一轮请求退出，保留所有进程等待。修复后空闲App原生菜单一次退出成功；再以真实百万行扫描就绪为前提，由computer use点击菜单，完整App的9项检查及主进程/Python消失断言通过。旧的直接app.quit自动路径没有暴露此问题，不能替代原生菜单验收。手工观察器初版30秒操作窗口超时属于验收调度失败，改为120秒并在ready后立即操作，最终复测通过。

此前review要求的四项修复继续受回归保护：报告分类行、退出等待进程树、DuckDB与既有Python探测隔离、新文档API的桌面版本门控。

## 效率数据与收益边界

同机、同一131 MiB合成文件、无并行UI分析的独立对照：

| 操作                                  |   耗时 |    返回JSON | Python进程峰值RSS |     源扫描 |
| ------------------------------------- | -----: | ----------: | ----------------: | ---------: |
| 既有Office接口，按C聚合B              | 6.011s | 1,077 bytes |        未单独测量 | 读取源文件 |
| 新接口，A/B/C冷建库+完整规格/质量统计 | 7.797s | 1,002 bytes |        125.61 MiB |          1 |
| 复用：C分组+A精确去重+3行证据         | 0.214s | 2,277 bytes |         77.83 MiB |          0 |

**结论：** 本轮没有证明“所有首次分析都更快”；新冷操作比旧单项聚合计算更多内容，不能直接宣称冷启动提速。明确收益是一次扫描后的多轮查询与导出复用、有限返回体、完整质量统计，以及用户无需安装完整Office/PDF套件。新增数据集也有建库和磁盘成本。RSS是Python子进程高水位，不是整份App内存；host maxRSS为累计值，不能拿来直接比较总内存。真人请求耗时还包括模型思考和服务延迟，不将两轮UI时长当严格性能基准。

复用查询214ms不是纯SQL耗时，包含本机工作进程/结果返回。与旧聚合逐组比较了有效数和均值，与独立golden比较了整体分类、去重和类别数量。可复现脚本为`e2e/documents/live-benchmark.mts`，脱敏数值见同目录`pr138-integrated-results.json`。

## 自动回归与复现

本次已通过：文档BDD **15场景49步骤**；真实Electron文档集成 **4项**；完整登录测试App IPC **8项**，另一次含真实退出共 **9项**，最后新增原生菜单退出模式亦 **9项通过**；流式恢复 **40场景195步骤**；桌面 **90文件1482项测试**；聊天/网关/后端流处理 **8文件319项测试**；PPT **13项**；Markdown URL/本地文件标签 **6项**。完整TypeScript检查通过（Node heap设12GiB）；未运行禁止的全量`bun run test`。CI仍检查完整App分片、Packages、Server、Database和Desktop。

本地desktop正式`tsgo`命令在root workspace链接依赖的安装方式下仍有100项类型诊断；用同一依赖与本修复父提交逐项比较，前后100项完全一致、新增0项。根项目完整类型检查已通过，desktop以隔离安装的CI类型检查为最终验收。对照记录为`desktop-type-baseline-comparison.json`。

```sh
# 从仓库根目录，使用该worktree已经构建好的Python运行时
export APP_URL=https://mlai-test.bielcrystal.com
export MASTERINO_DOCUMENT_TEST_PYTHON="$PWD/apps/desktop/resources/python-runtime/bin/python3"
NODE_OPTIONS='--import tsx' e2e/node_modules/.bin/cucumber-js --config e2e/documents/cucumber.mjs
e2e/node_modules/.bin/playwright test --config e2e/documents/playwright.config.mjs
NODE_OPTIONS='--import tsx' node e2e/documents/live-benchmark.mts .local-dev/acceptance-20261015/fixtures

# 真实App IPC：仅连接已经验证过的独立TEST profile
export MASTERINO_DOCUMENT_TEST_PROFILE=masterino-desktop-local-138144146015
export MASTERINO_DOCUMENT_TEST_RENDERER_PORT=9343
export MASTERINO_DOCUMENT_TEST_INSPECTOR_PORT=9344
node e2e/documents/full-app.mjs
# 会退出这份隔离App，切勿连接其他实例
MASTERINO_DOCUMENT_TEST_QUIT=1 node e2e/documents/full-app.mjs
# 原生菜单模式：出现nativeQuitReady后，120秒内由操作者点击App菜单退出
MASTERINO_DOCUMENT_TEST_QUIT=1 MASTERINO_DOCUMENT_TEST_MANUAL_QUIT=1 node e2e/documents/full-app.mjs

# 流式BDD：先单独构建，避免Cucumber的CommonJS hook干扰ESM依赖
node --input-type=module -e 'import {buildProductionLifecycle} from "./e2e/electron/support/buildProductionLifecycle.mjs"; await buildProductionLifecycle();'
node e2e/stream-recovery/faultServer.cjs
# 在另一个终端：
cd e2e
STREAM_BDD_PREBUILT=1 node_modules/.bin/cucumber-js --config stream-recovery.config.cjs
```

本地原始证据在本worktree `.local-dev/acceptance-20261015/logs/`：`state.jsonl`、`network.jsonl`、`resources.jsonl`；`documents-bdd-final.log`、`documents-electron-final.log`、`full-app-quit-final.log`、`stream-bdd-final.log`、`desktop-tests.log`、`chat-regression-final.log`、`presentation-layout-{red,green}.log`、`contracts-{red,green}.log`、`preview-url-{red,green}.log`、`independent-output-verification.json`、`live-benchmark.json`、`idle-native-quit-red.log`、`full-app-native-quit-verified.log`及截图。日志/截图不随PR上传。网络旁路仅记录路径、状态和时间；不采集认证头。原始工具输出含短期预览令牌，不公开上传，已提交结果文件只含无敏感的合成指标。

## 未覆盖和已接受限制

- 无记忆实例：不声称记忆抽取/召回线上链路已验收。
- 本轮无登录App新增TCP注入；恢复边界用本机故障端点和生产模块BDD覆盖。故障端点只用于合成流量。
- PDF数字在窄单元格中会换行，数值没有改变；本次未重设计报告版式。
- 不重算Excel公式、不做OCR；Windows仅由CI构建，未在Windows机器做真人验收。
- PDF全盘搜索仍依赖10分钟/4GiB约束；dataset源身份依赖大小/时间戳而非内容哈希，保留时间戳的原位修改仍可能复用旧快照。
- 不以一次合成测试保证所有超大文件、复杂共享字符串或所有模型均有相同耗时和内存表现。
