# 本地 CLI 投稿社区 MCP / Skill

`community import` 复用 #139 的提交接口，只进入待审核状态。扫描、审批、发布仍在后台操作，原 `skill` / `plugin` 命令保持个人资源行为。

## 使用

复用现有 CLI 登录，或提供管理员的 Masterino API Key。它沿用该账号权限，是 Masterino 访问凭证，区别于元典等第三方 MCP 的 Key。

```bash
export LOBEHUB_SERVER=https://admin-mlai-test.bielcrystal.com
export LOBEHUB_CLI_API_KEY='<Masterino API Key>'
lh community import mcp ./mcp.json --json
lh community import skill ./my-skill.zip --json
lh community import skill ./my-skill/ --json
lh community import batch ./community-import.json --json
lh community import batch ./community-import.json --dry-run --json
```

在 `apps/cli` 中执行 `bun run build` 后，从仓库根目录用 `node apps/cli/dist/index.js` 代替 `lh`，无需改变现有全局 CLI。

单个导入支持 `--identifier`、`--name`、`--description`、`--category`、`--version`。MCP 默认标识符为服务名；Skill 默认标识符为目录名或 ZIP 去掉扩展名的文件名。

## MCP 和第三方 Key

```json
{
  "mcpServers": {
    "yuandian-open-platform": {
      "type": "http",
      "url": "https://open.chineselaw.com/mcp",
      "headers": {
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer ${YUANDIAN_API_KEY}"
      }
    }
  }
}
```

CLI 替换 headers 中的 `${环境变量名}`；变量缺失则该项失败。支持一个 JSON 中多个 Streamable HTTP 服务；不支持 stdio / SSE 投稿。成功结果不含凭证，服务端错误中的已知凭证会脱敏。

## 批量清单

```json
{
  "resources": [
    { "type": "mcp", "path": "./mcp.json", "category": "information-retrieval" },
    { "type": "skill", "path": "./my-skill/", "name": "我的技能", "version": "1.0.0" },
    { "type": "skill", "path": "./another-skill.zip", "identifier": "another-skill" }
  ]
}
```

相对路径以清单文件所在目录为基准。Skill ZIP / 目录须包含非空根目录 SKILL.md；目录连同资源文件打包，忽略 `.git`、`node_modules` 和符号链接。ZIP 上限沿用后台 16 MiB，安装格式与 frontmatter 由后台现有解析器验证。

`--dry-run` 只准备本地文件、打包并替换变量，不请求服务端，不验证远程连接或安装格式，状态为 `prepared`。实际提交成功状态为 `submitted`。每项输出文件、标识符、状态及错误；汇总失败/提交数量。有失败时退出码为 1，其余有效项继续提交。不回滚、不自动重试、不覆盖同名资源，不自动更新版本或发布。

## BDD 验收（2026-10-12）

- 命令测试通过真实本地 HTTP 接口观察请求，覆盖 headers / 环境变量、Skill 目录及资源打包、ZIP、预检、混合失败继续、缺失变量、错误凭证脱敏。
- 与原 Skill / Plugin / completion / man / 登录解析一起，64 项针对性测试通过。
- 构建后的 CLI 在测试后台执行真实 BDD：4 个场景、12 个步骤通过。覆盖预检无记录、Microsoft Learn MCP 和 Skill 批量待审提交、重复/非法 ZIP 后继续提交、无效 Key 拒绝提交。清理钩子通过；测试投稿进入拒绝历史，未发布到社区。
- CLI 构建及帮助命令正常。CLI type-check 仍有未修改的 Router 路径、task / hetero 和文档依赖诊断，本次新增命令无诊断。

重跑：先构建 CLI，在 `e2e/` 执行 `pnpm exec cucumber-js --config community-cli.config.cjs`。`COMMUNITY_CLI_CREDENTIALS` 指向仓库外私有 env 文件，包含 `export LOBEHUB_SERVER=...` 和 `export LOBEHUB_CLI_API_KEY=...`。此测试会创建及清理测试投稿，不能指向生产环境。凭证不提交 GitHub。

目录打包在读取文件前检查现有服务端上限：最多 2,000 个文件、单个 25 MiB、原始总量 100 MiB。已有 ZIP 读取前检查 16 MiB，根目录 SKILL.md 解压前检查 25 MiB；压缩后的 ZIP 同样不得超过 16 MiB。目录原始大小与压缩包大小是不同限制。
