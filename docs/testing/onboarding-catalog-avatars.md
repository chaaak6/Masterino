# 初始化模板与头像验收

## 发布边界

只部署 Market 服务。初始化查询在数据库分页前同时限制为固定 8 个 identifier、已发布且没有 `forked_from_id` 的原始模板；接口返回时再次按产品目录过滤和排序。普通列表仍允许用户查看自己的草稿和副本。

头像是 `apps/market/src/agentAvatars.ts` 中的原创固定 SVG，通过 Market 的 `/assets/agent-avatars/v1/{name}.svg` 匿名只读返回。数据库只保存版本化相对路径，Market 按当前环境的 `MARKET_PUBLIC_BASE_URL` 解析为公开 URL；外部头像、emoji 和其他用户自定义值保持原样。路由只查固定映射，不访问文件系统、不读取用户文件。修改图标时新增版本路径，避免一年 immutable 缓存继续显示旧图。

内测 OSS 禁止公开对象，因此不用公开桶或会过期的签名地址。生产发布时使用生产 Market 域名，不能复制内测头像 URL。

## 模板数据

`apps/market/src/onboardingCatalog.ts` 是初始化目录、分类、顺序、头像和 seed 版本的唯一产品契约。Curated seed 会把下列原始模板写成对应值；相同版本下若分类或头像发生漂移，也会自动纠正。不要修改个人 fork、已创建 Agent 或用户自定义头像。

| identifier                        | 图标文件        | category           |
| --------------------------------- | --------------- | ------------------ |
| masterino-meeting-assistant       | meeting.svg     | operations         |
| curated-lobehub-writing-assistant | writing.svg     | content-creation   |
| curated-lobehub-en-cn-translator  | translation.svg | content-creation   |
| masterino-research-assistant      | research.svg    | learning-research  |
| curated-lobehub-mu6pt9gg          | project.svg     | product-management |
| curated-lobehub-7xjj75u8          | code.svg        | engineering        |
| curated-lobehub-34z99to7          | prompt.svg      | learning-research  |
| curated-lobehub-business-guru     | business.svg    | business-strategy  |

内测解析后的 URL 前缀：`https://mlai-test.bielcrystal.com/market/assets/agent-avatars/v1/`。

其余模板不在初始化 allowlist 中；这次只维护上述 8 个精选模板，不变更全市场分类体系。

## 验收步骤

1. 在 `masterino-test` 部署精确 digest，等待 rollout，验证八个图片 URL 的类型、内容和 404 边界。
2. 内测 Web 登录现有账号，直接打开 `/onboarding/classic`，无需删除账号或重置初始化状态。
3. 检查八个图标、分类切换、选择数量、继续按钮，添加一个尚未安装的模板。
4. 重新进入向导，确认个人 fork 不出现在模板列表中。
5. 源码 Electron 使用 `desktop-test` 启动器，后端指向内测，profile 为 `test-server`。通过完整 Electron.app 路径操作，不操作正式安装的 Masterino.app。
6. 检查新增助理同步、头像显示、助理详情；原有助理头像保持原值。

生产部署另行执行；PR 提交不表示已发布生产。回滚时先恢复原模板字段，再恢复原 Market 镜像。

## 2026-09-09 内测结果

- ACR 构建 `01A08564-13FA-5DE3-AFF0-FCABD0F13DCD` 成功，应用代码 commit `b1962bab`。
- 内测 Market 镜像：`boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-market@sha256:70fd2911579785f5d28e867f36eadaa49c2d36443b38b73488710f3be0b521f6`。
- `masterino-test` rollout 成功，8 个头像 HTTP 200，16 项相关测试和 Market 类型检查通过。
- Computer Use：内测 Web 显示 8 个图标，工程分类仅 1 个代码助手；选择写作助手，继续按钮从禁用变为“继续 (1)”，提交成功返回首页。
- 重进向导仍为 8 个模板，新增的个人副本未混入。
- 使用完整路径指定源码开发版 Electron，返回首页即看到 Web 新添加的写作助手；页签、侧栏、欢迎区头像正常。发送无业务数据的验收消息，收到“写作助手测试通过”。
- 保留已有账号、旧助理头像以及新增验收助理/话题；没有操作正式安装包，没有部署生产。
- 验收发现内测模板旧分类不兼容，本次已修正选定的 8 个模板分类；未扩展到其余模板。
- 临时 ACR 构建规则已清理，原有规则保持不变。

## 2026-09-10 稳定目录复验

- PR 分支先 rebase 到 `main@c52a60f4`，验收提交为 `6d1603c3`。
- Market 类型检查和全量单测通过：7 个文件、37 项测试。
- ACR 构建 `01A08991-49CF-5B7A-BFE2-DAD818C28CA1` 成功；内测部署镜像为 `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-market@sha256:6237f90c81aba39eb95b2a9761b5be3630f6eff0b9d35e348c2bff2fe6818142`。
- `masterino-market` rollout 和 seed Job 成功；seed 返回 50 个 Agent、5 个 MCP、5 个 Skill。数据库中的 8 条初始化记录均为相对头像路径及目录要求的版本。8 个 SVG 返回 200 和 `image/svg+xml`，未知文件返回 404。
- Computer Use Web 验收：全部页严格显示 8 张卡；工程 1 张、内容创作 2 张；选择和取消选择状态正确。真实安装“中英文互译助手”后返回首页，再次进入向导仍为 8 张卡且没有个人副本重复项。
- Computer Use Electron 验收：只启动当前 worktree 的源码测试版，环境输出确认 backend、Gateway 均为 `mlai-test.bielcrystal.com`，profile 为 `test-server`。新助理无需重启即跨端同步，侧栏、欢迎区和详情页均显示正确翻译图标；社区页正常加载。
- 未操作正式安装的 Masterino，未改生产环境。临时 ACR 构建规则和临时 ACK kubeconfig 均已清理；测试版 Electron 保持运行，便于继续人工复测。
