# Web 附件 10MiB 截断核查

2026-11-05 核查结论：用户记忆中的“10MB 截断”有明确代码依据。普通 Web 附件上传经过 Next.js Proxy，仓库使用的 Next.js 16.2.9 默认只缓冲 10 × 1024 × 1024 = 10,485,760 字节请求体，超出后截断并继续处理。它不是上传业务代码里显式的文件大小拒绝规则，也不保证返回 HTTP 413。

本文记录 10MiB 截断的原始核查证据。结论已合并进[完整改进方案](attachment-ui-improvement-plan-2026-11-05.md)与[测试用例](attachment-ui-qa-cases-2026-11-05.md)，后续执行以这两份合并文档为准。未修改应用代码、配置或服务。

## 代码基线与链路

- 工作区 HEAD 为 `55eb6a02`，与此前实测 App 的 1.3.12 发布基线不同。主要分析使用独立只读工作树的 `d1226ecf`；与此前核对的主线 `be3e7172` 比较，下面的 Proxy、Next 配置和上传路由无差异。
- [pnpm-lock.yaml](https://github.com/chaaak6/Masterino/blob/d1226ecf/pnpm-lock.yaml#L673) 锁定 Next.js 16.2.9；本机安装版本也是 16.2.9。
- 普通附件以 [XHR PUT 原始 ArrayBuffer](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/services/upload.ts#L223) 上传，不是把所有附件组合成一个 multipart 请求。因此本层按单次请求体计量，不是整条消息的附件总大小。
- [Proxy matcher](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/proxy.ts#L7) 对普通 `/api/upload/s3-proxy` 请求仍然生效。只有 `source=skill` 的技能包上传被专门排除；不能把技能包例外推广到对话附件。旧工作区的 matcher 则匹配全部 API，同样覆盖普通附件。
- [public route 声明](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/libs/next/proxy/define-config.ts#L189) 仅跳过这一层的登录校验，不等于从 Next Proxy matcher 排除。
- [Next 配置](https://github.com/chaaak6/Masterino/blob/d1226ecf/next.config.ts) 与 [配置封装](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/libs/next/config/define-config.ts#L139) 均未设置 `experimental.proxyClientMaxBodySize`，使用框架默认值。

本机实际框架代码：

- `node_modules/next/dist/server/config-shared.js:260`：默认 `proxyClientMaxBodySize: 10485760`。
- `node_modules/next/dist/server/body-streams.js:30,85–109`：超过上限后结束两个克隆流，剩余输入不再进入缓冲；会输出 `Request body exceeded 10MB...` 警告。
- `node_modules/next/dist/server/body-streams.js:67–74`：`finalize()` 用已缓冲流替换原请求体，后续路由也只能读取截断内容。
- `node_modules/next/dist/server/next-server.js:1196–1202,1274–1275`：Proxy 执行使用上述克隆与 finalize，并传入配置上限。

[Next.js 官方说明](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize) 同样明确：使用 Proxy 时默认缓冲 10MB；超限记录警告，继续处理部分请求体，框架本身不自动向客户端报错。官方当前页面版本高于本仓库，以上结论另以本机 16.2.9 实际源码和复现核实。

## 本地边界复现

直接调用仓库安装的 Next.js 16.2.9 `getCloneableBody`，使用合成 Readable 字节流，依次消费 `cloneBodyStream()`、调用 `finalize()`、再从原始请求流读取路由可见内容。没有启动或更改服务，也没有把这些测试数据上传到线上。

| 原始字节数 | 分块字节数 | Proxy 可读字节 | 路由可读字节 | 超限警告 |
| ---: | ---: | ---: | ---: | --- |
| 10,485,759 | 65,536 | 10,485,759 | 10,485,759 | 无 |
| 10,485,760 | 65,536 | 10,485,760 | 10,485,760 | 无 |
| 10,485,761 | 65,536 | 10,485,760 | 10,485,760 | 有 |
| 11,534,336 | 65,536 | 10,485,760 | 10,485,760 | 有 |
| 10,485,761 | 70,000 | 10,430,000 | 10,430,000 | 有 |

最后一行说明实现会舍弃整个跨界 chunk，实际保留量可能略小于 10MiB；不能假设每次精确保留前 10,485,760 字节。边界等于上限时，在本复现中不会截断。脚本位于 `/tmp/masterino-next-body-boundary.cjs`，运行命令为 `/Users/a10507479/.nvm/versions/node/v24.19.0/bin/node /tmp/masterino-next-body-boundary.cjs`。

## 为什么 UI 可能只看到上传或分析失败

发布基线的 [上传路由](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/app/%28backend%29/api/upload/s3-proxy/route.ts#L58) 在读取请求体后比较 `Content-Length` 与实际 body 长度。两者不符返回 **400**：`Upload is incomplete or its checksum does not match. Please retry.`。所以截断可能被完整性校验拦住，而非以 413“文件过大”呈现。客户端 [上传错误对象](https://github.com/chaaak6/Masterino/blob/d1226ecf/src/services/upload.ts#L27) 已保留 status、details、stage，可供后续 UI 分类。

旧工作区 `55eb6a02` 的上传路由没有这段长度校验，存在部分内容继续传给存储的代码风险；尚未证明线上发生过损坏文件落库。不能把旧工作区行为直接当作当前发布版行为。即便新路由存在校验，也应另测没有 Content-Length 的情况，不能仅凭一次 400 认定端到端完整性已覆盖。

[生产 Ingress 清单](https://github.com/chaaak6/Masterino/blob/d1226ecf/k8s/overlays/production/ingress.yaml#L9) 配置的是 `100m`，不是 10MiB。该入口配置不会解除后续 Next 层的较小限制。线上实际生效配置和对应日志尚未独立核实；只读集群查询返回 Unauthorized，未继续尝试其他身份。

此前 Computer Use 的 10MiB+1 TXT 选择流程未取得可审计的真实 PUT 结果，仍不能记为线上边界验收通过。现在确认的是仓库上传链路会经过的框架限制及其本地复现，不冒充生产端到端实测。

## 对后续方案与 QA 的补充

1. 若保留当前 Web 容量，应把它作为明确的产品能力边界展示，并在上传前校验；提示使用更小文件或下载客户端本地分析。数值需与实际部署保持一致，UI 应标清 10MiB，或使用用户可理解且不误导的大小说明。
2. 不能只识别 413；必须覆盖请求体截断后出现的 400 完整性失败。但不能把所有 400 都当作超限，应结合当前文件字节数、上传阶段及明确原因分类。网络中断和校验失败仍需独立处理。
3. 扩容或调整 Proxy matcher 属于服务端策略变更，另行评估；当前仅调研。无论是否保留 10MiB 产品限制，都不应依赖“静默截断”表达拒绝。
4. 在原 QA 的 WEB05、WEB06 基础上补测：10,000,000、10,485,759、10,485,760、10,485,761 和 11,534,336 字节；核对请求原始长度、路由实收长度、状态码、框架警告，以及存储对象大小和哈希。至少覆盖有效 TXT 和有效二进制文件，避免把格式错误误判为大小错误。
5. 新增 400 截断、400 非超限、无 Content-Length、上传进度 100% 但完整性失败的场景；确认失败不会被当作可发送附件，不丢草稿且能恢复。多文件分别上传与单个文件边界要分开测。
6. App 本地附件不会经过这条上传链路，但本地图片另有单图 10MiB 限制，不能宣传客户端图片无限制；App 云端执行、Web、企微 WebView 按真实执行链路分别回归。
