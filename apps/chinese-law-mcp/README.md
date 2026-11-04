# Masterino 内网法条 MCP

独立 Node 服务，提供 Streamable HTTP `/mcp` 和就绪检查 `/healthz`，复用社区的公司共享 MCP 连接。员工无需 Node/npx、公网 GitHub 或 jsDelivr。运行时仅从本地快照读法条，不访问外网。

三个工具为 `search_laws`、`get_article`、`search_in_law`。这是法规名称、条号和关键词查询，不包含全国案例、企业实时信息、语义检索或历史时点适用判断。条文附快照版本、非官方语料链接及官方核验入口，外部引用链接是否能打开取决于员工网络，但不影响工具返回原文。

这里实现的是独立 HTTP 适配服务，沿用上游三个工具的用途；不在服务器启动时运行上游 npx 包。关键词结果是摘录，引用全文需再调用 `get_article`。法规名称支持简称；名称不明确时先用 `search_laws` 选择精确 id，避免模糊名称命中其他法规。

## 本地与验证

使用 Node 24 和 pnpm 10.33.0。在本目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm prepare-data
pnpm start
```

本目录使用独立 pnpm workspace 和锁文件，不改动主应用依赖树。准备数据时访问 GitHub，核对 snapshot.json 中的固定 commit 和归档 SHA-256，校验全部索引文件。运行阶段不下载代码、依赖或数据。

已有归档可通过 `LAW_ARCHIVE_PATH=/absolute/archive.tgz pnpm prepare-data` 复用，仍验证 checksum。数据在本地 ignored 的 `data/`；镜像构建执行准备脚本后将其完整复制进运行镜像，包含上游 CC0 LICENSE。

## 发布与部署

`Dockerfile.chinese-law-mcp` 只构建本服务。在阿里云远程构建固定分支，推送独立测试 tag，部署时固定镜像 digest。不要更新现有 Masterino/Market 的生产 tag 或部署。

测试专用 overlay：`k8s/overlays/test-chinese-law-mcp`。不纳入生产／测试主应用的 kustomization，单独 apply；只新增本服务的 Deployment、ClusterIP Service 和禁止出站的 NetworkPolicy。单副本初始 request 100m/128Mi，limit 500m/512Mi；最终容量以压测为准。

后台使用 `http://masterino-chinese-law-mcp.masterino-test.svc.cluster.local:3230/mcp` 验证连接、提交审批并发布为公司共享资源。勿让员工手动把内网 URL 添加为自定义本地 MCP。主服务调用共享资源；没有公网 Ingress，不创建每个员工的 Key。

测试资源 identifier 为 `masterino-chinese-law`，分类填既有 `web-search`（信息检索），认证留空。此次 ACR 新仓库未能取得已有 GitHub 源绑定，实际远程构建使用已授权的 `biel_client/masterino-market` 仓库、独立 `chinese-law-test` tag；overlay 固定新法条服务的 digest，不改原 Market 部署。测试后台既有路由／版本问题及独立验收实例见验收文档。

正式发布需单独批准并创建生产环境 overlay。本 PR 不修改生产环境。

## 更新与回滚

修改 snapshot.json 中的 commit 与 SHA-256，运行准备脚本，检查变更清单和民法典／劳动合同法等代表条文，构建并验收后发布新 digest。原镜像含完整旧快照，可直接回滚。不要自动跟随 master 或在 Pod 启动时更新语料。

验收与回归用例见 `docs/testing/chinese-law-mcp-bdd.md`。
