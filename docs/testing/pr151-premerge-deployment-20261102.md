# PR151 合入与部署清单

本轮整合 #148、#151、#152；API、Market、Admin、Electron 和记忆 worker 应来自同一审核提交，记录各自构建 SHA 和镜像 digest，不要求不同组件的 package version 字符串相同。本轮没有 package.json、锁文件或依赖变更。

1. 合入前确认当前提交的 CI 和 [本轮 BDD 验收](pr151-premerge-20261102.md) 结果；保留未执行项的真实状态。发布确认后再构建镜像和客户端，不用开发验证替代正式发布构建。本轮按 AGENTS.md 未构建 Docker 镜像。
2. 准备同一提交的 Market、API/worker、Admin 镜像及 Electron 安装包。`Dockerfile.market` 在 TypeScript 构建后执行 `cp apps/market/src/migrations/*.sql apps/market/dist/migrations/`，然后部署到运行镜像；新增 `0002_restore_published_skill_pointer.sql` 在此打包范围内。正式构建后仍需核对镜像内实际文件与 SHA。
3. 在迁移到 Market 更新完成的短暂窗口暂停投稿及审核写入，避免旧实例再次产生异常指针。先对目标 Market 数据库执行该 Market 构建的 `node dist/migrate.js`，确认 `market_schema_migrations` 中存在 `0002_restore_published_skill_pointer.sql`。迁移只修复 published Skill 的异常版本指针，保留待审版本与正常指针；无新增表结构。本轮已在测试集群实际执行迁移两次，第二次由迁移记录跳过；这不代表生产已执行。
4. 再更新 Market 并检查健康状态、投稿/版本审核/默认下载接口，然后更新 API 与同镜像的记忆 worker。随后更新 Admin，最后分发 Electron。新 API 的投稿端点、Admin 的 versionId 审核和 Electron 新建文件授权需配套验证；旧 Admin 对新版 Market 的 Skill 审核请求可能因缺 versionId 返回 400，不应安排长期混用。
5. 在目标环境使用合成数据完成投稿、归档预览、批准发布、V2 待审仍下载 V1、回滚后的名称/正文/reference/归档 SHA 验证；确认个人原稿保留。再验证 Electron 新建文件授权及 worker 的记忆提取和关闭开关行为，核对对应日志，最后恢复临时测试设置。

已核实的自动化边界：

- Market 的默认启动命令是 `node dist/index.js`，启动入口不自动调用迁移。Kubernetes 有 `masterino-market-migrate` Job，执行 `node dist/migrate.js`，具备发布入口。
- `deploy.sh --env test deploy` 会重建精确命名的 Market bootstrap/migrate/seed Job，等待迁移完成后检查 Market rollout；但 Market Deployment 与迁移 Job 在同一批 apply 中提交，并非以 initContainer 严格阻止新实例先启动。发布操作应按上面的顺序先确认迁移，再开放新版本流量。
- 该 Market 部署分支明确限定 test，不能据此宣称生产已具备相同自动化。`scripts/operations/deployAckTestWithAliyunCli.sh` 的 `app-update` 仅更新主 API 和 memory worker，不负责 Market、Admin 或 Electron。
- `.github/workflows/release-docker.yml` 与 `pr-build-docker.yml` 指向根 `Dockerfile`；不能将其成功视作 `Dockerfile.market`、`Dockerfile.admin` 镜像已构建或 Market 迁移已运行。桌面测试包由独立 `build-desktop-test.yml` 生成。正式发布应显式核对各组件产物及迁移 Job 的镜像 digest。

未发现迁移缺少执行入口或新增依赖导致的合入阻断；上述构建、迁移及组件切换是发布步骤，不能由本轮源码热部署和测试集群验收推断已经完成。
