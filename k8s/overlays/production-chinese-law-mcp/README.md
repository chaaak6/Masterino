# 正式环境法条 MCP

单独 apply 本 overlay，只新增法条 Deployment、内部 Service 和服务自身 NetworkPolicy，不更新主服务、Market、管理后台或客户端。复用已验收镜像 digest，不重新构建镜像。

发布前核对现有共享 MCP、创建和审批接口，执行 `kubectl diff -k k8s/overlays/production-chinese-law-mcp`，确认只有本服务三个资源。apply 后检查 rollout、healthz、三个工具，再从正式后台创建公司共享资源，地址为 `http://masterino-chinese-law-mcp.masterlion.svc.cluster.local:3230/mcp`，认证留空，分类为 web-search。批准发布后使用现有正式客户端真实验收并回归普通对话和现有 MCP。

网络策略是否执行取决于集群网络插件，不因 YAML 声明就认定隔离生效。首次上线异常时先下架本次社区资源，再删除本 overlay；后续更新通过恢复上一镜像 digest 回滚。不要删除或覆盖已有元典资源。
