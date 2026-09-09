# 初始化模板与头像验收

## 发布边界

只部署 Market 服务。本次初始化查询在数据库分页前限制为已发布且没有 `forked_from_id` 的原始模板，普通列表仍允许用户查看自己的草稿和副本。

头像是 `apps/market/src/agentAvatars.ts` 中的原创固定 SVG，通过 Market 的 `/assets/agent-avatars/v1/{name}.svg` 匿名只读返回。路由只查固定映射，不访问文件系统、不读取用户文件、不接受外部 URL。修改图标时新增版本路径，避免一年 immutable 缓存继续显示旧图。

内测 OSS 禁止公开对象，因此不用公开桶或会过期的签名地址。生产发布时使用生产 Market 域名，不能复制内测头像 URL。

## 模板数据

仅修改下列已发布原始模板的 `avatar` 与 `category`，经 `/api/v1/agents/modify` 以资源所有者身份更新并写审计。提前备份旧字段。不要修改个人 fork、已创建 Agent 或用户自定义头像。

| identifier | 图标文件 | category |
| --- | --- | --- |
| masterino-meeting-assistant | meeting.svg | operations |
| curated-lobehub-writing-assistant | writing.svg | content-creation |
| curated-lobehub-en-cn-translator | translation.svg | content-creation |
| masterino-research-assistant | research.svg | learning-research |
| curated-lobehub-mu6pt9gg | project.svg | product-management |
| curated-lobehub-7xjj75u8 | code.svg | engineering |
| curated-lobehub-34z99to7 | prompt.svg | learning-research |
| curated-lobehub-business-guru | business.svg | business-strategy |

内测 URL 前缀：`https://mlai-test.bielcrystal.com/market/assets/agent-avatars/v1/`。

其余内测旧分类仍由原有前端过滤；这次只维护上述 8 个精选模板，不变更全市场分类体系。

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
