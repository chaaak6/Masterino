# 独立验收执行记录

状态：进行中。尚未通过任何真实模型 Electron 业务用例；夹具/健康检查不算产品通过。

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
