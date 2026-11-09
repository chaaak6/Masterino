# 企微桌面应用下载验收

开发前测试用例。使用测试站 mlai-test.bielcrystal.com 与 masterino-test 集群。

1. 电脑企微应用内点击头像菜单“获取桌面应用”，系统默认浏览器打开同源 /download 页面，不传递登录 Token。企微内不直接请求安装包。
2. Windows 默认浏览器打开后，从现有签名清单接口获取最新版 Windows x64 CDN 链接并自动下载。
3. Apple Silicon 的 Chrome/Edge 返回 ARM 架构提示时自动下载 arm64。Intel 返回 x86/64 时自动下载 x64。
4. Safari/Firefox 或受限浏览器无法可靠区分 Mac 芯片时，显示 Apple 芯片/Intel 选择，不凭 MacIntel UA 猜测。
5. 下载页无需登录。新版本清单变化后使用新版链接，不固定版本号。
6. 企业微信 SDK 失败、签名失败、调用超时，显示可复制/可打开的下载页链接和错误提示，不能静默在企微内下载。
7. 清单请求失败显示重试，连续操作不并发下载。非企微网站原下载入口保持原行为。
8. iPhone/iPad/Android 不自动下载桌面安装包。
9. 服务端签名仅允许当前应用页面地址，拒绝外站 URL，不向浏览器返回企微 secret、access_token 或 ticket。
10. 通过 computer use 核对测试网页的自动推荐、失败重试和 Mac 选择布局。真实企微的系统浏览器跳转需企微会话实测，无法取得会话时交给用户验收。
