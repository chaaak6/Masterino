# 手动更新的本地验收

当前更新器使用 Ed25519 签名 JSON 清单及已校验的 DMG / NSIS 安装包。
本目录旧的 YAML / Squirrel `.sh` 工具仅保留作历史参考，不适用于当前更新器；不要用它们验收本次功能。
完整操作与预期见 `docs/testing/desktop-update-lifecycle-acceptance.md`。

## 准备两个隔离测试包

从仓库根目录执行：

```bash
node apps/desktop/scripts/update-test/signed-fixture.mjs --init
```

默认目录为系统临时目录下的 `masterino-update-fixture`。`session.json` 只有公钥、keyId、回源地址；
`keys.json` 含本次测试私钥，权限 0600，不提交、上传或用于正式发布。
在构建 A、B 两个包前，将 session 中三个值设置为：

```bash
export DESKTOP_BUILD_FLAVOR=test
export DESKTOP_TEST_PROFILE=manual-update-acceptance
export DESKTOP_TEST_UPDATE_ORIGIN=http://127.0.0.1:19381
export DESKTOP_TEST_UPDATE_KEY_ID='<session.keyId>'
export DESKTOP_TEST_UPDATE_PUBLIC_KEY='<session.publicKey>'
export UPDATE_CHANNEL=canary
export NEXT_PUBLIC_DESKTOP_CLOUD_SERVER=https://mlai-test.bielcrystal.com
export NEXT_PUBLIC_MARKET_BASE_URL=https://mlai-test.bielcrystal.com/market
export APP_URL=https://mlai-test.bielcrystal.com
export DEVICE_GATEWAY_URL=https://mlai-test.bielcrystal.com/device-gateway
```

在专门测试分支中设置两个递增版本（例如 A=1.3.11、B=1.3.12），分别按桌面打包流程生成目标平台安装包。
同一轮 A/B 必须具有相同测试应用 ID、测试 profile 和公钥，不能更改 Electron 可执行文件及 Helper 名称。
保留 A 的安装路径，B 只作为待下载安装包。不要覆盖 `/Applications/Masterino.app` 或正式 Windows 安装路径。
测试构建使用独立用户目录、`Masterino Test` 产品名和 `masterino-test` 协议。
上述公钥注入和 HTTP 本地更新源只在 test 构建生效，正式构建不会接受。

## 启动本地下载服务

```bash
node apps/desktop/scripts/update-test/signed-fixture.mjs \
  --installer /absolute/path/to/B.dmg --version 1.3.12 --platform darwin-arm64
```

Windows 使用 `--platform win32-x64 --installer /absolute/path/to/B.exe`；Intel Mac 使用 `darwin-x64`。
此服务仅监听 127.0.0.1，其他平台包返回 404。每个请求及传输字节数记录在 `requests.ndjson`，不记录认证信息。
清单在 `/desktop/releases/canary/canary.json`。

打开已安装的 A，点击“检查更新”。此时日志应只有清单 GET，没有安装包 GET。
点击“下载新版本”才开始下载；核对应用进度、Dock / 任务栏进度及取消操作。
下载后选择“稍后”，普通退出不会安装；重新打开并检查应复用已校验缓存。
点击“退出并安装”，核对受管子进程退出，再观察独立安装窗口和新版本启动。

## 注入故障

另一个终端执行以下命令切换模式；下一次请求生效，不需要重启服务：

```bash
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode invalid-signature
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode 503
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode cut
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode stall
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode corrupt
node apps/desktop/scripts/update-test/signed-fixture.mjs --mode normal
```

签名错误：重新检查更新，必须不能下载或安装。503：点击下载后反馈网络错误。
cut：传输 2 MiB 后断开。stall：连接建立后无数据，约 60 秒无活动应超时。
corrupt：重新检查清单后手动下载，2 MiB 内容的 SHA-512 故意不匹配，应报完整性错误并清理临时文件。
恢复 normal 后需要用户再次点击重试，不能自动循环下载。
缓存命中会跳过下载；故障测试请用新 B 版本或备份并移走本次隔离 profile 的对应缓存，不能操作正式用户目录。

macOS 安装回退：另做版本更高、身份相同、签名有效但主进程启动后退出的隔离 B；
确认独立安装窗口等待启动回执，超时后还原 A 并提示失败。不要故意制造系统崩溃或修改正式应用。
测试后退出本地服务及隔离 App。此流程不发布 OSS、不改 CDN、不操作生产服务。
