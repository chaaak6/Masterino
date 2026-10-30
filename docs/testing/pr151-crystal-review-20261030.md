# PR 151 Crystal Review 处理与验收

基线 aab629db。已读取5条行评论、review正文的10条低置信度提示以及讨论区状态；以下均按代码判定。没有直接套用机器人建议。

| 编号 | 评论 | 判定与处理 |
| --- | --- | --- |
| F1 | manifest/metadata JSON异常 | 修复：在DB和存储调用前解析并验证为对象，非法输入400。 |
| F2 | 非JSON响应遮蔽状态码 | 修复：容忍非JSON/非对象错误正文，409保留CONFLICT，5xx映射BAD_GATEWAY；成功正文校验ID与送审状态，拒绝空204或draft误报成功。 |
| F3 | 所有异常变409/归档清理 | 修复：明确业务冲突409，基础设施503；同内容并发仍200复用。随机key不会删除他人key，但已提交后查询失败会误删自身已提交归档，现保护已提交及提交结果未知情况。未照建议把同内容复用改409。 |
| F4 | undefined导入结果含原始插值 | 修复：用无插值unknownError作为错误详情，外层只渲染一次导入失败。 |
| F5 | skillId变化不更新选择 | 防御性修复并加回归：open时同步明确传入的skillId。当前导入调用方已有key重挂载，不将其描述为已复现线上错选。 |
| L1 | 旧上传finally解除新上传忙碌状态 | 修复：finally及错误提示均校验generation；并发事件回归验证最新上传仍禁用提交/取消。 |
| L2 | 旧组织投稿遗漏文本资源策略 | 修复：统一包内容策略helper，正文和非二进制资源均检查。 |
| L3 | 非Skill发布指针卡住审核 | 误报：submitResource对已有非Skill在创建版本之前拒绝，无法进入所述CASE；新建非Skill未发布状态会正常推进。 |
| L4 | 中文下载正则边界 | 修复：中文分支不依赖ASCII词边界，覆盖下载后空格和URL。 |
| L5 | submitSkill写确认未测试 | 补入manifest写操作断言，实际humanIntervention原本已required。 |
| L6 | 个人投稿解析异常500 | 修复：发布服务统一解析错误400，涵盖个人导出及ZIP来源。真实非法个人manifest回归。 |
| L7 | description变字符串undefined | 误报：schema要求非空description，真实缺描述归档在请求Market之前400。 |
| L8 | 旧已发布Skill指针可能指向待审版 | 修复：增量SQL迁移仅修复已发布Skill的无效指针到既有公开fallback，不放开任意历史版本下架；PGlite执行迁移验证幂等与保留正常指针。未向生产执行迁移。 |
| L9 | 导出资源/解析异常一律400 | 部分采纳：内容解析错误400；资源缺失/存储损坏不是用户输入错误，保留服务器故障分类，不统一降成400。 |
| L10 | prototype spy断言失败时泄漏 | 修复：afterEach仅恢复这两个FileService原型spy，避免全局restore影响此文件mock工厂。 |

正式评论：[F1](https://github.com/chaaak6/Masterino/pull/151#discussion_r4419445425)、[F2](https://github.com/chaaak6/Masterino/pull/151#discussion_r4419445441)、[F3](https://github.com/chaaak6/Masterino/pull/151#discussion_r4419445445)、[F4](https://github.com/chaaak6/Masterino/pull/151#discussion_r4419445451)、[F5](https://github.com/chaaak6/Masterino/pull/151#discussion_r4419445457)。低置信度提示来自同轮review正文。

## 真实computer use

本地Electron独立local-112233aabbcc profile、隔离Next服务连接masterino-test数据库/Redis/桥接；启动本分支当前Market代码的本地候选服务13223。故障开关只在忽略目录的候选启动器内，不加入产品代码。

1. Electron社区上传qa-crystal-review-20261030.zip，包含SKILL.md及references/example.md。
2. 候选服务对投稿返回HTML 502；真实tRPC返回502，表单保留ZIP，内联显示Skill submission failed (HTTP 502)，按钮恢复可重试，无SyntaxError与成功提示。
3. 同一表单重试，候选对象存储put临时抛错；实际Market返回503，应用按BAD_GATEWAY处理，表单显示Skill submission failed并保留文件。查询测试Market无此资源版本，未误报409。
4. 移除故障，同一表单再次提交，无重新上传。弹窗成功关闭，数据库生成唯一submitted版本145，identifier=user-3bc4b7e9ad2c066569359666。
5. 审核预览真实接口200，含CRYSTAL_REVIEW_OK及reference。随后按scan-start→scan-passed→reject退回145，账号权限恢复；扫描是手动状态推进。

错误采用内联展示并保留原toast，避免短暂提示消失后无从了解失败原因。UI prop变化、上传竞态与未返回导入结果等不自然场景由自动测试/代码核对覆盖，不冒充真人已复现。

## 验证

Market app/repository44、Publishing/Policy/SocialProfile27、下载路由44、Importer42、工具manifest2、投稿UI3、迁移SQL1，共163项定向测试通过。Market类型检查通过；根类型检查、ESLint及diff检查通过。测试首次并发冷启动PGlite hook超时，顺序重跑并给冷启动hook30秒后Importer42项通过；未改变业务断言。SQL测试实际执行迁移，覆盖正常/错误指针、未发布、非Skill、无候选以及幂等。

真实HTTP故障与恢复均由Electron发起；非法JSON、并发提交、提交后读失败等以接口/事务回归测试验证。本轮未部署生产或重建Docker。

候选故障服务已停止，本地Next已恢复原测试集群Market转发地址。上线需要按正常Market迁移流程应用0002 SQL；本轮只在隔离PGlite中验证迁移，未修改生产数据。
