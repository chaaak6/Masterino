# Masterion UI / Disabled / Branding 完成交接

更新时间：2026-06-21

状态：已完成。本文总结本轮已落地并热更新验证过的 Masterion 品牌、未开放功能、用户菜单、关于页和启动加载体验改动。历史 handoff 文件保留，不删除。

## 完成范围

### 启动加载与品牌露出

- 修复首屏加载阶段残留 `LOBEHUB` 字样的问题。
- `index.html` 和桌面 splash 入口改为小宗狮加载动画。
- 小宗狮 / Masterion 手写动画速度加快，避免加载时动画经常播不完。
- hot compose 增加 `index.html` / `index.auth.html` bind mount，便于热更新验证 SPA 启动 HTML。

### 未开放功能统一提示

- 新增/使用 `PRODUCT_FEATURES` 统一管理未开放功能状态。
- `desktopApp` 当前为 `disabled`，相关入口保留但阻断。
- 未开放功能统一显示中文“敬请期待”。
- 首页左侧/用户菜单中的“获取桌面应用”保留菜单项，禁用置灰；主文字保持“获取桌面应用”，右侧小号状态显示“敬请期待”。
- 聊天输入执行目标、创建平台 Agent 的桌面客户端下载入口已阻断，不再跳下载地址。

### 设置与关于页收口

- 应用设置中隐藏“设备”分类，底层路由和能力暂未删除，便于后续客户端完成后恢复。
- 系统 - 关于保留品牌、版本、官网、支持邮箱、Blog、GitHub。
- 系统 - 关于隐藏更新日志、升级、检测更新、商务合作、Discord、X/Twitter、YouTube、法律声明内容。
- 用户面板和设置菜单隐藏“有可用更新”/`new` 提醒。

### 用户信息与支持邮箱

- 默认用户头像改为名称首字母：
  - 英文名取首字母大写。
  - 中文名当前支持“陈灿 -> C”的姓氏映射。
- 支持邮箱改为 `ai@bielcrystal.com`，通过 `BRANDING_EMAIL.support` 统一生效。

### 账号维护

- 已按用户要求处理 `10193226` 密码重置为 `Cc.123654`。

## 关键文件

- `packages/app-config/src/productFeatures.ts`
- `src/features/User/UserPanel/useMenu.tsx`
- `src/features/User/UserPanel/index.tsx`
- `src/features/User/UserAvatar.tsx`
- `src/features/ChatInput/ControlBar/HeteroDeviceSwitcher.tsx`
- `src/features/CreatePlatformAgent/index.tsx`
- `src/routes/(main)/settings/hooks/useCategory.tsx`
- `src/routes/(main)/settings/about/features/About.tsx`
- `src/routes/(main)/settings/about/features/Version.tsx`
- `packages/business/const/src/branding.ts`
- `index.html`
- `apps/desktop/resources/splash.html`
- `public/brand/masterlion/loading-masterlion-zh.svg`
- `public/brand/masterlion/loading-masterlion-en.svg`
- `docker-compose/deploy/docker-compose.hot.yml`

## 已跑验证

本轮相关定向测试已通过：

```bash
docker run --rm -v /root/MasterLion:/app -w /app masterlion:test-builder pnpm exec vitest run --silent='passed-only' \
  src/features/User/__tests__/UserAvatar.test.tsx \
  src/features/User/__tests__/UserPanel.test.tsx \
  src/features/User/__tests__/useMenu.test.tsx
```

结果：3 个测试文件通过，10 个测试通过。

```bash
docker run --rm -v /root/MasterLion:/app -w /app masterlion:test-builder pnpm exec vitest run --silent='passed-only' \
  src/features/User/__tests__/brandingEmail.test.ts \
  src/routes/(main)/settings/about/features/aboutConvergence.test.ts \
  src/features/desktopAppDisabled.test.ts \
  src/routes/(main)/settings/hooks/useCategory.test.tsx
```

结果：相关收敛测试通过。

```bash
bun run type-check
```

结果：通过。

## 热更新状态

- `masterlion` 容器已多次重启验证。
- `http://127.0.0.1:3210/` 返回 `302` 到登录页，服务响应正常。
- 容器内源码已确认同步到当前工作区挂载内容。

## 后续恢复点

客户端开发完成后建议恢复这些入口：

- 将 `desktopApp` 从 `disabled` 改回可用状态。
- 恢复桌面应用下载链接和相关引导。
- 恢复应用设置中的“设备”分类。
- 恢复关于页里的检测更新 / 升级能力。
- 如需覆盖更多中文用户名首字母，扩展 `UserAvatar` 中的中文姓氏首字母映射。

## 注意事项

- 当前工作区仍包含多轮联调、品牌替换、hot deploy 和 UI 收口改动；提交前需要按实际发布范围分组检查 staged changes。
- 不要删除旧 handoff 文件，它们记录了历史任务状态。
- 发布镜像前再做一次完整定向测试和生产 compose 环境变量检查。
