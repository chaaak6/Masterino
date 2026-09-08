# 独立验收执行记录

状态：进行中。首个真实模型 Excel→HTML 诊断通过；混版附件诊断发现问题并修复复测中。最终一致版本五次重复尚未执行完毕，不宣称最终验收通过。

## 已完成准备

- 独立合成夹具：12 / 10000 / 100000 行 Excel、公式表达式与故意过期缓存、实际顺序不同于文件名的 PPT、四象限 PNG、同名不同来源 Skill、非法编辑。
- 独立回读与哈希验证通过。oracle 不给模型。
- 新本地实例 `c52204665dda`，Web3510、Next3511、Vite10576、Gateway9088。新数据库与凭据独立，仅复用获授权的专用开发模型配置。
- `LOCAL DEVELOPMENT READY`；doctor 的 postgres/redis/proxy/backend/qstash/gateway/storage 均 ready。
- 新 0122 附件 migration 已应用：调用现有 migrateLocal，先断言 instance ID / PG19432，再由其检查数据库容器归属。未复制旧实例密钥，未访问生产业务库。

## 当前启动障碍

Electron 桌面目录不在根 workspace 的安装集合，根 pnpm 安装后仍缺少 apps/desktop/node_modules 和 apps/cli/node_modules。桌面有独立 workspace；其 `.npmrc` 设置 lockfile=false，冻结安装返回 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH（overrides 与历史 lock 不符）。因此按已有配置执行桌面 non-frozen / ignore-scripts 安装，仅构建依赖，不修改产品代码。npm registry 出现 ECONNRESET 重试，最终安装成功，Electron 41.3.0 二进制引导成功。

## 结果记录格式

每次业务运行记录 fixture hash、模型/provider、提示、UI 证据、operation/tool ID、工具调用顺序、模型轮数、环境、文件产物哈希与数字回读、耗时/请求字节及授权等待。五次重复的成功率以实际完成数计算，未执行不得记通过。任何工具/模型/环境阻塞保留具体错误，交给实现者修复；独立 QA 不修产品代码。

首轮 Electron 启动：主进程/preload 编译成功，实际 profile/backend/gateway 符合本地实例。真实窗口停在启动图标，AX 指向 app://renderer/desktop-onboarding；日志约 32 个 localhost:5173 模块 fetch ECONNRESET，涉及路由、useEnabledChatModels、ipc 等。通过真实视图菜单重新加载未恢复。随后仅关闭本次 desktop 启动进程并重启，复用优化缓存；没有把首屏加载记为业务通过。

第二次启动仍阻塞在 onboarding Loading，日志未再报 ECONNRESET。真实截图与 AX 保存于 `/tmp/masterino-office-e2e-evidence/startup-loading.png` 和同目录 startup-loading-ax.txt。只读代码线索：onboarding isLoading 等待 electronSystemService.getAppState() 完成，无超时；待实现端检查 IPC。此为定位假设，尚未验证根因。

## 验收环境变更：停止本地全栈，改用测试部署

用户因本机内存压力要求停止本次本地全栈；机器已重启，后续不得重启 dev:local。本次后续验收采用远端分支镜像部署到 masterino-test + 本地源码 Electron test-server profile；必须同时记录分支 SHA、ACR 实际构建 commit/digest 和本地 Electron SHA，先前本地环境结果不能替代测试环境结果。

只读实查：测试 App 与 memory worker 均 ready 1，镜像 `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino@sha256:aff52824c622030b8d22416ad54729f89b45b74e554d6b1be8981aaf08d0257b`，ACR tag `test-main-20260908-e1d3cd4603a5`。Gateway ready 1，digest `21ecc0cebad570b8728f5c1e8f4bd8919652d38efe69bd762cf7af78383e1c09`。这只是新部署前盘点，尚无新业务验收通过。ACK 只读访问使用 15 分钟临时 kubeconfig，0600 临时文件查询后销毁，没有修改默认 context 或读取 Secret。

远端构建现成路径：ACR `cri-8velxg2aueo822e4` / repo `crr-vrxmxr0vf4jkxd59`，已有多个按分支的 test tag 规则。已核对模板为 Dockerfile `/`、linux/amd64、`BASE_REGISTRY=boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client`、`USE_CN_MIRROR=true`。本轮新规则只使用本分支专用 tag，默认 FINAL_STAGE=production；不触发 main/latest，不使用 FINAL_STAGE=dev。根任务负责创建规则、触发远端 build 与部署，QA 未执行这些写操作。

增量部署入口为 `ACK_TEST_ACTION=app-update CONFIRM_ACK_TEST_DEPLOY=masterino-test MASTERINO_IMAGE_DIGEST=sha256:<新实际digest> bash scripts/operations/deployAckTestWithAliyunCli.sh`。此入口只更新 App 与 memory worker 并逐一等待 rollout；不会进入全量 bootstrap/create-secret。App 启动时在 DATABASE_DRIVER 配置下执行 docker.cjs 迁移，须验证新镜像 migration 成功再开始业务用例。

后续 Electron 命令：在当前 worktree 执行 `corepack pnpm dev:desktop:test`，不需要本地后端。应打印 backend `https://mlai-test.bielcrystal.com`、gateway 同域 `/device-gateway`、profile `test-server`，实际 userData 为 `masterino-desktop-test-server`；renderer 使用 5173。正常真实 OIDC/企业登录，不能复制本地 dev 会话或生产凭据。新镜像就绪前暂不启动 Electron。

构建模板核对更正：历史 test 规则仅两个 buildargs 不足以保证当前测试前端正确。Dockerfile 第102行 NEXT_PUBLIC_MARKET_BASE_URL 默认生产地址；本轮必须额外传入 `NEXT_PUBLIC_MARKET_BASE_URL=https://mlai-test.bielcrystal.com/market`，并在产物检查静态配置。此前仅复核历史规则的建议遗漏了该构建时变量，已告知根任务修正。

测试 Electron 预热：源码 `599e071335937d1d482caad189b1d3d7d3c4b082`，启动时另有41个 tracked dirty 文件（v2实施进行中）；仅用于登录/环境UI准备。正式业务验收需冻结最新SHA并重启，不能把本次dirty预热当最终版本通过。

内测 Electron 预热实际结果：使用 `corepack pnpm dev:desktop:test` 成功进入既有测试 profile 首页，正常登录状态已存在，无需新的企业微信授权。启动日志 backend 为 `https://mlai-test.bielcrystal.com`，Gateway 为同域 `/device-gateway`，profile 为 `test-server`。从普通小宗狮AI的项目新增按钮打开系统目录选择器，选择 `/tmp/masterino-office-e2e-input`；UI realpath 为 `/private/tmp/masterino-office-e2e-input`，显示本机执行、项目已锁定，文件面板列出全部6个合成文件。未发送模型请求，未测试新Office业务或宣称Gateway执行成功。证据：`/tmp/masterino-office-e2e-evidence/test-profile-workspace-ready.png` 与同名 AX 文本。正式验收等待新镜像及最终freeze版本后重启。

## 真实模型诊断（不是最终五次重复）

1. 项目内 Excel→HTML：服务端599e0713，桌面599e0713加进行中的修改。真实Electron输入自然请求，DeepSeek V4 Flash Vision Exp依次inspect Sales、read Sales、inspect Notes、writeFile。独立回读12条数据：总额8000，East3300/West2400/North2300，2026-01为2800、2026-02为5200。原表哈希不变，HTML无外部资源，实际Chrome打开图表和表格正常。[真实生成报告](evidence/diagnostic1-sales-report.html)已提交候选证据。4个模型轮次累计input96953（cached73344，miss23609）、output5731；用户消息落库到最终回复更新54.814秒。Office工具输出分别1612/3395/429字符，read返回13行含表头、hasMore=false。首版无单工具纯执行耗时字段。
2. 粘贴附件混版诊断：桌面e0f4ff28、服务端599e0713。Finder复制合成xlsx再真实CmdV接收成功；DB保留local附件元数据，但消息回读不显示附件且模型未拿到本机路径。模型寻找文件，QA拒绝绕路读取后停止，未生成报告。11个工具请求含1次拒绝，9个有usage轮次累计input211166（cached167040，miss44126）、output2438。[脱敏汇总](evidence/diagnostic2-summary.json)。这是失败重试累积，不能当正文体积或当前上下文。实现端随后修复messages查询遗漏attachments。
3. 桌面59eaba45重启后真实上传菜单能弹出原生系统文件选择器；取消返回正常。服务端部署59eaba45后，回形针复测的消息回读保留附件，模型第一步直接inspect本机附件路径，无需搜索/tmp。完整报告结果继续记录。

上述输入均为独立生成的合成数据，oracle未传给模型。完整截图、AX现场、脱敏逐消息metrics保留于本机 `/tmp/masterino-office-e2e-evidence/`，未提交；本目录evidence提供可移植的摘要和真实HTML。源Excel不入Git。模型UI累计tokens不能解释为当前上下文或网络请求字节；实际HTTP字节和完整工具目录数量尚未测得。

第三版诊断细化：回形针完整报告已完成，真实Chrome渲染、数字回读与原表/附件副本哈希一致。首次writeFile受旧cwd提示影响，向不存在的legacy测试目录写入被DENIED_SCOPE；模型随后pwd确认实际topic scratch目录并成功生成报告。7轮、7工具请求，104.053秒；Office执行耗时11.94/4.25/6.68ms，输出1749/3395/429字节。writeFile实际写入1.46ms。参见[脱敏汇总](evidence/diagnostic3-summary.json)与[真实报告](evidence/diagnostic3-paperclip-report.html)。此轮包含目录恢复，不能作为稳定一次成功样本。

合成图片诊断：真实Finder复制/粘贴quadrants.png后，模型直接回答左上红、右上蓝、左下绿、右下黄，与独立oracle相符；0个工具、2.151秒。参见[图片汇总](evidence/diagnostic4-image-summary.json)。trace隐私边界仍由实现端核查，暂不宣称图片整项通过。

十万行诊断：精确汇总与独立oracle一致，但模型inspect后runCommand探测openpyxl/pandas，再写Python汇总脚本，未使用Office原生summary，违反预定标准分析无现场依赖探测/解析脚本门槛。记录为数字通过、调度失败；[脱敏汇总](evidence/diagnostic5-large-summary.json)。实现端正在修正本机工具说明，正式版本仍未冻结。

PPT页序诊断返回QA-SLIDE-3、QA-SLIDE-1、QA-SLIDE-2，匹配独立OOXML关系顺序；4个Office工具、11.757秒，[汇总](evidence/diagnostic6-ppt-summary.json)。公式诊断明确原公式文本1+2（Excel公式写法=1+2）、保存缓存999、未重算；但inspect后额外shell解包XML，22.436秒，[汇总](evidence/diagnostic7-formula-summary.json)。

项目Skill诊断：真实UI选取只有合成技能的独立目录，.agents与.claude提供同名qa-identity。模型activateSkill、readReference两次、execScript得到全部project-agents标记，脚本退出0，未修改技能。[汇总](evidence/diagnostic8-skill-summary.json)。这是项目双来源优先级的单次诊断；个人/Agent重名、跨轮变更、非法编辑仍未测试，不能据此宣称全身份矩阵通过。

补充解析器探针由实现端运行、QA归档：[10000行](evidence/parser-probe-10000.json)、[100000行](evidence/parser-probe-100000.json)。它们是直接引擎测量，不是真实Electron模型验收；RSS含Node/tsx，短输出不替代实际扫描量证据。取消最初仅阻止回写的缺陷正在补接线，旧探针不能证明已取消底层扫描。

技能非法编辑真实UI：聊天请求技能管理工具更新合成qa-identity；输入编辑器将原始YAML分隔符转成Markdown，因此实际发送的是缺frontmatter内容。updateProjectSkill返回SKILL_FRONTMATTER_REQUIRED，随后validateProjectSkill仍valid:true，独立原件SHA256前后均70218609fbd59abd80ec5b0e00d45f21bda41e6cb100c288eb3fcbc789865172。[拒绝证据](evidence/diagnostic9-invalid-edit-summary.json)。不宣称此轮精确覆盖缺description情形。

合法创建合成qa-created-check通过createProjectSkill与validateProjectSkill，独立回读129字节文件名称/description/正文正确，原qa-identity未改变。[创建证据](evidence/diagnostic10-create-skill-summary.json)。下一operation发现尚待后续运行；当前未把创建成功等同于发现成功。

下一operation已发现并激活新建qa-created-check，真实activateSkill后返回精确QA-CREATED-CHECK-READY，UI项目技能数更新为2。[发现证据](evidence/diagnostic11-skill-discovery-summary.json)。

有限Office写入诊断：3次createOfficeDocument+3次readOfficeDocument，新建xlsx/docx/pptx分别独立以openpyxl及标准OOXML解析回读，单元格/段落/页序全部匹配；15.933秒。[写入证据](evidence/diagnostic12-office-write-summary.json)。这只证明受支持简易结构/内容，未证明复杂格式视觉保真。

图片后切模型边界待核查：真实选择无图像标记的DeepSeek V4 Flash，图片发送未被阻止，DB实际model为deepseek-v4-flash，仍同一Agent，回复正确识图。[切换证据](evidence/diagnostic13-model-switch-summary.json)。限定本次用户/模型的DB只读进一步确认provider=newapi、abilities.vision=false、catalog inputModalities.image=unsupported，用户附件MIME=image/png且图片数1；因此DB两能力源一致。未读发送时renderer enabledAiModels/imageList内存，guard根因仍待实现端定位，不记保护通过。没有修改模型能力配置。

补充parser-probe JSON已更新为带reader取消测量的新版；其中取消延迟只代表reader，不代表Electron停止按钮E2E。

图像保护热更新后复测仍发送成功：[诊断14](evidence/diagnostic14-model-switch-summary.json)。该轮只有HMR，不能排除旧store动作残留；随后安排CmdR硬重载复测，遇到实现端临时观测日志HMR，尚未发送。两个topic均无agent_operations记录、message metadata无executionMode/operationId，未获取可靠client/gateway路径证据。

完整Electron重启、测试服务d0cd5d22后的[诊断15](evidence/diagnostic15-model-runtime-summary.json)定位到模型选择与执行分叉：UI选择及DB assistant.model均为deepseek-v4-flash，但真实DevTools安全日志中的创建运行、上下文构造、最终发送三处均为deepseek-v4-flash-vision-exp，guard看到1个本机图片、catalog支持。此次不能归因为guard放行不支持的实际模型；此前诊断13/14只读到的DB标签同样不能证明真实出站模型。源码修复与复测待完成。

模型绑定修复后完整重启的[诊断16](evidence/diagnostic16-guard-recovery-summary.json)通过保护及恢复：Flash initial guard记录unsupported、本机图片1，无Flash最终发送；UI明确不支持图片。附件保留在用户消息（输入框已清空），切回VisionExp后点击历史图片“加入输入”再发送，实际出站VisionExp并正确识四色。此轮覆盖历史图片重新加入新消息，不等同于原assistant retry按钮。仍属混合版本诊断。

大表自然复测[诊断17](evidence/diagnostic17-large-native-summary.json)：十万行核心汇总精确，6次Office工具、0shell、5模型轮次、31.304秒。首次inspect传附件内容SHA256遭OFFICE_VERSION_CHANGED，模型validate获取Office版本后恢复；因此不能记无错误首试。另补充文案把收入min/max称为单价，核心要求数字均正确。原文件hash不变。拖入自动化未成功触发附件，源文件不变，明确未验收；不以纸夹/粘贴替代。

## 固定版本重复（修复前样本，已暂停）

客户端289a5990、服务端0fd3a18c固定进行workspace与纸夹各5次，提示、模型及输入SHA一致。工作区5次已完成：核心数值5/5正确，原文件5/5不变；预先登记的无依赖探测/无现场Excel解析脚本门槛3/5通过。第2轮只对Office已读12行用Python求和，单列计算回退；第3、4轮已有原生结构化结果仍探测openpyxl并重读Excel，因此记调度失败。并非事后要求绝对0shell。纸夹完成2次后因确定性scratch权限缺陷暂停，不凑满样本。两次首次write均失败、pwd后写入恢复，数字及原文件hash均正确；7份旧样本完整保留，修复后须新冻结版本重新完整5+5。所有计量见[逐轮汇总](evidence/final-repetitions.json)。

真实生成的[工作区报告](evidence/final-workspace-report.html)、[工作区完整页面截图](evidence/final-workspace-report.png)、[纸夹报告](evidence/final-paperclip-report.html)及[纸夹完整页面截图](evidence/final-paperclip-report.png)可离线审阅。纸夹第1轮首次向实际topic scratch绝对路径writeFile仍SCOPE_DENIED，确认pwd后相对路径成功；记恢复后数字正确，不算无错误首试。累计input/cache token是各模型轮次之和，不代表当前上下文或HTTP字节；耗时为用户消息落库至最后消息更新，人工选择文件/目录不计入。各轮已有自动批准配置，未出现人为审批等待。

## 当前未覆盖项（正式验收前更新）

- 修复前固定版本完成workspace5次、纸夹2次，发现确定性scratch授权缺陷后暂停；新版本完整5+5仍未执行。每次独立目录/topic，避免复用旧报告。最终版十万行自然聚合尚待版本契约修复后复测。
- 拖入入口未成功由Computer Use触发，不能记通过。纸夹/粘贴已实测可读取；历史图片“加入输入”后发送已实测，原assistant重试按钮、超量图片和连续ReAct图片边界尚未真实UI覆盖。
- 项目.agents/.claude重名优先级已实测；个人/Agent/内置完整重名矩阵、跨operation修改后的拒绝与重新激活尚未真实UI覆盖。底层隔离测试仅是补充。
- Skill缺frontmatter非法编辑原件不变、合法创建下轮发现已实测；超限、重命名冲突、校验中断、外部同时修改未真实UI覆盖。
- xlsx/docx/pptx简单创建与独立结构回读已实测；批改副本、模板合并、失败写入原件保全、复杂格式视觉保真未真实UI覆盖。
- 跨设备附件不可用、同名异路径、兄弟文件越权、导出/删除场景未真实UI覆盖。补充parser取消探针不能证明Electron停止按钮中止扫描。
- 每轮实际HTTP字节、完整工具目录数量尚未获取，不以累计token或缓存命中数替代。Web Skill入口由另一独立验收执行，结果单列；不拓宽到全平台或CLI。
