# PR157 中企业微信下载代码 review

范围为原 PR158。按用户要求只做代码 review 与定向自动化检查，不把 SDK mock 当作真实企业微信验收。没有修改签名接口鉴权、企业微信配置、集群或正式环境。

| 原线程 | 判断与处理 |
|---|---|
| PRRT_kwDOS_jr-s61i6em：失败只显示 URL | 成立。改为已有 browserFailed 文案、可打开的 manual=1 链接，并显露手动平台选择。|
| PRRT_kwDOS_jr-s61i6eo：功能禁用时静默返回 | 成立。缺少下载版本进入原有失败状态，按钮结束忙碌，可重试。|
| PRRT_kwDOS_jr-s61i6ev：失败回退循环 | 成立。头像菜单回退指向 /download?manual=1；该模式显露安装包选择，不自动下载或自动重试 SDK。公开页本身 SDK 失败后也显露手动选择。|
| PRRT_kwDOS_jr-s61i6e0：重复调用 | 成立。SDK 与安装包共用 requesting ref 和 busy/finally，防止重复调用。|
| PRRT_kwDOS_jr-s61i6e3：未登录头像入口401 | 成立。仅已登录头像菜单优先使用签名 SDK；未登录用户沿用普通下载行为。公共 /download 若在无会话企业微信直接点击 SDK，签名仍会401，这是鉴权约束；现在能立即进入可用手动回退，不放开匿名签名。|
| PRRT_kwDOS_jr-s61i6e7：越南语不可达 | 成立。公开页使用现有 vi-VN common 消息，无需引入主 SPA/i18n 框架。|
| PRRT_kwDOS_jr-s61i6e9：硬编码按钮名称 | 部分成立。Apple Silicon 说明接入已有本地化字符串；Windows x64、macOS、Intel 是平台/品牌名称，不另造译名或翻译键。|
| PRRT_kwDOS_jr-s61i6fC：iPadOS桌面UA | 成立。isWecomDesktop 增加 maxTouchPoints/Mobile 排除，与既有平台识别保持一致，所有业务调用补传触点数。|
| PRRT_kwDOS_jr-s61i6fE：SDK异步回调抛异常 | 成立。使用 invoke 前校验其类型，ready 与 success 回调异常明确转入 finish，不依赖15秒兜底。|
| PRRT_kwDOS_jr-s61i6fJ：首次SSR分支 | 首帧平台按钮确实不确定。使用挂载就绪标志，在 SSR/首次客户端渲染都不显示未识别平台的操作；没有照搬读取 navigator 的 state initializer，以免服务端和客户端首帧不一致。|

修复未登录行为不会改动签名服务的 Origin 校验或 token/secret 边界。外部浏览器成功路径仍打开无凭据的同源 /download，仍沿用已有签名清单与 CDN 下载链路。

定向验证：5 个文件共 27 项通过（DownloadPage 4、wecom SDK 3、platform 14、entry wiring 3、签名 route 3）。覆盖失败恢复、手动URL不自动重试、禁用反馈、越南语、iPadOS UA、缺少SDK方法以及异步SDK异常。SDK成功测试验证仅向默认浏览器发送同源无凭据下载页。真实企微可信域名、原生默认浏览器启动和实际安装包下载仍未测试，不能以这些自动化结果宣称真实企微链路通过。
