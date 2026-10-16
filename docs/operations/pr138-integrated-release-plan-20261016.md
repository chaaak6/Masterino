# PR138 集成版本上线与客户端发布计划

2026 年 10 月 16 日。候选包含 PR138、PR144、PR146、PR147，以及本轮附件和记忆 worker 验收修复。

代码合入 main 与生产部署分开验收。建议最终候选 CI 全绿后合入 main；服务端先升级，客户端随后发布。当前 root、desktop 与公开更新清单均为 1.3.9，下一版暂定 **1.3.10**；合入前重读 main 和 OSS 版本，若有并发发布则顺延，不能复用已发布版本。

## 当前生产实例

以下为 2026 年 10 月 16 日通过短期 kubeconfig 的只读盘点。正式 namespace 是 `masterlion`，主域名 `masterino.bielcrystal.com`。

| 实例                        | 当前 Ready   | 本轮处理                                |
| --------------------------- | ------------ | --------------------------------------- |
| `masterino`                 | 4/4          | 首先升级主应用，滚动保持可用副本        |
| `masterino-memory-worker`   | 1/1          | 主应用验证后升级到相同镜像 digest       |
| `masterino-device-gateway`  | 1/1          | 保持现状，回归设备连接与工具能力协商    |
| `masterino-aihub-db-bridge` | 1/1          | 保持现状，回归只读用户、token、模型授权 |
| `masterino-market`          | 2/2          | 保持现状，回归 MCP manifest 和安装链路  |
| `masterino-admin`           | 1/1          | 保持现状，回归设置入口                  |
| Redis、PostgreSQL、SearxNG  | 沿用现有实例 | 不迁移、不清库、不刷新历史向量          |

主应用和 worker 当前回滚镜像均为 `boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino@sha256:156ac71ddcd55cc7eb5ac48359a08fda38488c8f8340cd00ec5970a2b4197aa3`。实际执行前再次读取 digest 与副本数，以新的只读快照为准。

不要直接 apply `k8s/overlays/production`：它面向另一个 `masterino` namespace。`production-bluegreen` 里也存在旧镜像和副本配置，不能拿整份 overlay 覆盖现有 4 副本生产部署。本轮只对批准的主应用、worker 更新不可变镜像及必要配置。

## 合入 main 的检查

1. PR147 合入 PR138，解决 Overlay 测试隔离冲突，保留 MCP 安装结果及统计异常隔离的回归断言。
2. 纳入已验收修复：普通附件统一 1GiB、接收失败清理、worker 重试终态与进度、分阶段记忆计数、跳过未请求的记忆层。保留 PR138 新文档工具提示和文档进程退出回收。
3. 以最终 PR138 head 运行主项目类型检查、相关客户端/服务端/设备附件测试和完整桌面测试；最终 GitHub CI 再确认 App、Server、Database、Packages、Desktop 与 Windows 测试包。
4. PR138 原有 CI 全绿属于旧 head 的证据，不能替代本轮新增提交的最终 CI。未运行的项目不标通过。
5. 两轴复评不新增代码阻断项后，才执行 main 合并。PR144、PR146、PR147 的功能已在集成分支，避免另行重复 squash；关联 PR 的关闭说明应指向最终集成提交。

## 本轮集成复评记录

- 本地完整桌面测试：90 个文件、1482 项通过；MCP/附件/文件 store/worker/embedding 专项：97 项通过；设备附件包：11 项通过。主项目类型检查通过。
- 并行重负载时曾出现两个 5 秒测试超时；释放资源后按单 worker 复跑全部相关测试通过，未放宽超时或跳过用例。
- 变更代码 ESLint 无错误；PR147 测试已有两项未使用形参 warning。`git diff --check` 通过。
- Standards 与 Spec 两轴增量复核均未发现新增阻塞 main 的问题。企业 managed-token 授权矩阵、Windows 实机安装升级仍作为部署/客户端推广的放行项。
- 以上为本地最终代码的验证，不代表远端最终 head CI 已通过；推送后需检查新 head 的所有必需检查。

## 合并会触发的自动发布

`auto-tag-release.yml` 会因当前 PR138 的 `feat:` 标题，在合 main 后自动 patch root package 版本、更新 changelog、打 tag、创建 GitHub release，并 dispatch `Release CI`（`publish=true`）。后续可能构建、推送 Docker 镜像并同步 canary 分支。**合 main 不是纯代码存档操作。**

该流水线不等于 ACK 生产已部署；现有 unsigned desktop workflow 也仍需手动触发。合并前明确接受版本自动化，核对 release/tag 指向最终 main 提交。若需要延迟创建 release，应先调整发布策略，再合 main，不要临时修改线上。

## 测试环境顺序

1. 从最终集成提交构建候选服务端镜像，记录 commit、版本和 digest；这一步在计划获准执行发布后进行，不沿用旧测试镜像。
2. 在隔离测试环境先升级主应用，再升级同 digest 的 memory worker；保留原镜像用于回退。测试 Gateway/Bridge/Market 只有兼容失败且明确需要改动时才另开发布项。
3. 用合成用户和合成文件验证短聊天、停止/恢复、话题切换、MCP 安装和调用、131MiB Excel、1GiB 附件及超限、PDF 页图、PPT、运行中退出。
4. 使用真实测试账号权限接入 Aihub，补验企业 managed-token/readiness 链路及代表用户组。前轮独立 PostgreSQL/Redis 的真实 Aihub 抽取、2048维落库/查询、用户隔离和关开关验收已通过，但不替代企业账号同步矩阵。
5. 运行 `build-desktop-test.yml`，确认包中 cloudServer、Gateway 都指向测试域名，关闭正式自动更新；Windows 实机安装、升级保留数据、卸载重装另验。

## 生产上线顺序

| 阶段          | 动作                                                                                                      | 放行条件与停止条件                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 预检        | 记录部署、镜像、配置版本、数据库备份恢复点与队列 active/waiting/failed；核对固定 embedding 模型及用户授权 | 当前 schema 不新增迁移；不重建或清空旧向量。发现历史模型/维度不一致，单独制定数据方案            |
| 2 worker 排空 | 暂停新的周期投递，等待 active 任务结束，再暂停旧 worker；保留 Redis 队列及任务                            | 不强杀活跃提取，不同时运行两套周期调度；停止窗口内新任务可以留在队列                             |
| 3 主应用先上  | `masterino` 4 副本滚动至新 digest，保持健康旧副本直到新副本 Ready；不切域名或 Ingress                     | 合成账号登录、聊天、旧客户端兼容、设备连接、MCP 安装正常。出现明显 5xx、鉴权失败、恢复卡死即停止 |
| 4 worker 后上 | `masterino-memory-worker` 1 副本更新为主应用同 digest，先关闭周期调度，只放入单个授权合成任务             | 抽取/embedding/落库/查询正确；任务状态、计数、重试与取消正常；再恢复原调度与并发，不同步扩大吞吐 |
| 5 观察        | 观察主应用、worker 日志、Ready/restart、延迟和队列；初次建议至少 30 分钟并完成一个真实任务周期            | 无新增持续异常、积压持续增长或错误重试风暴，才进入客户端推广                                     |

固定 embedding 仍为 `newapi/text-embedding-3-large`、2048维。只验证有授权用户的访问，不能通过服务端全局 key 绕过个人 managed token。测试通过不授权修改线上模型映射或历史向量。

## 客户端版本与打包

**需要新客户端。** 分块 IPC、DuckDB 运行时、新文档 API、PDF 页图、macOS 退出和 MCP renderer 修复都含桌面代码，仅部署服务端不能让旧安装包获得这些修复。旧客户端通过能力门控继续保留原能力，避免强制全员即时升级。

- 版本暂定 `1.3.10`；服务器 tag、root version、构建输入与包内 desktop version 应一致。自动 patch 只直接改 root package；unsigned workflow 的 Set desktop package version 会按输入改包内版本，发布前必须核对，不能只看仓库 desktop package 仍写 1.3.9。
- Windows x64：安装 EXE；macOS arm64/x64：DMG 与自动更新所需 ZIP、校验及 blockmap/manifest。先构建并检查 bundled Python/DuckDB、PDF worker、包资源与配置。
- 测试构建使用 `build-desktop-test.yml`。正式内部发布使用 `build-desktop-unsigned.yml`，其默认 Gateway、OSS bucket 和更新清单均是生产，不能当测试包流程。
- 现有 macOS 包为内部 unsigned/ad-hoc 包，沿用可信内部分发及安装说明；不能描述为 Apple Developer ID 已签名或已公证的正式对外包。外部分发需单独完成签名、公证。
- 现有正式工作流把构建、上传与 canary 清单更新串在一起。推广前应把“产物上传并校验”与“更新清单切换”分开或设人工放行点，让少量内部用户先手动安装同一正式候选产物。不能把 workflow 启动当作只打包不发布。
- 固定版本目录上传完整安装包、ZIP/blockmap 后核对 SHA256、大小和来源 commit；验证安装/升级及三平台核心功能，再更新 canary 清单。不要先更新清单再补文件，不覆盖已经发布的同版本产物。

## 回滚

服务端异常时先停止恢复周期调度，保留队列与日志，将主应用和 worker 一起回到发布前记录的 digest，恢复原副本数和配置。只回退本次修改资源，保持 Gateway、Bridge、Market、Admin 和主站路由不变。

客户端异常时暂停清单推广、保留不可变旧产物和下载入口。自动更新通常不做 SemVer 降级；不要承诺把清单改回 1.3.9 就会让所有新客户端自动退回。按兼容边界回退服务端，或发布更高补丁版本；必要时提供受控的旧版手工安装指引并保护本地数据。

本计划不执行部署、镜像构建、版本 bump、tag、GitHub release 或 OSS 清单发布；实际操作前以最终 CI、版本占用及当前生产只读快照重新确认。
