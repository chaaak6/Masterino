# 智能体文件路径处理调研

调研日期：2026-11-10。针对 Masterino 历史消息 `<localFile ... />` 中的弯引号、空格和跨平台路径；只依据官方源码及文档。不将其他产品的工具入参解析等同于其聊天 UI 的文件链接容错。

## Codex

核对 `openai/codex` 提交 `36e074a2fb365aa788886495c82e6ea612226cd9` 的 [local_links.rs](https://github.com/openai/codex/blob/36e074a2fb365aa788886495c82e6ea612226cd9/codex-rs/tui/src/markdown_render/local_links.rs)。

- 单独识别 POSIX、`~/`、相对路径、Windows 盘符和 UNC；不是按照空格切词。
- `file://` 通过 URL/PathUri 解析，依据 URI 推断目标操作系统；位置后缀另行处理，避免把盘符冒号当行号。
- 该模块明确只负责**显示格式**，不查询文件系统，不推断远程主机文件位置。其反斜杠改写和百分号解码不能直接照搬到真实文件打开操作：POSIX 文件名可以包含反斜杠、百分号和冒号。
- 未在此模块发现为畸形 XML 属性修复中文弯引号的实现；不能宣称 Codex 已经解决相同问题。Masterino 需要针对自己的文本协议补齐。

## Cline

核对 `cline/cline` 提交 `92b9f722a16d2a03c1153e12f9a0e759455f509d` 的 [工具 schema](https://github.com/cline/cline/blob/92b9f722a16d2a03c1153e12f9a0e759455f509d/sdk/packages/core/src/extensions/tools/schemas.ts)、[file-read 执行器](https://github.com/cline/cline/blob/92b9f722a16d2a03c1153e12f9a0e759455f509d/sdk/packages/core/src/extensions/tools/executors/file-read.ts) 和 [path-resolution.ts](https://github.com/cline/cline/blob/92b9f722a16d2a03c1153e12f9a0e759455f509d/sdk/packages/shared/src/storage/path-resolution.ts)。

工具读取结构化 `path` 字段，执行器再做当前操作系统的路径解析。路径恢复辅助函数先保留实际存在的原路径，仅在不存在时尝试 macOS 窄不换行空格、NFD、弯撇号等候选，再检查磁盘。它没有用“全局替换所有引号”来修复路径。

可借鉴原值优先、有限恢复、存在性验证；不照搬最后的目录首个匹配策略：有多个规范化后相同的文件名时，应报歧义，而非打开一个猜测目标。本次是消息属性语法错误，不必扩张成文件系统模糊搜索。

## Claude 工具协议与平台 API

[Claude 官方 text editor 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)将路径放在结构化 `path` 输入中，宿主负责执行。这支持长期改进方向：把展示文字和真实路径分开；它不证明 Claude Code 的聊天界面如何修复弯引号。公开协议之外的私有实现不作推断。

[Node path 文档](https://nodejs.org/api/path.html#windows-vs-posix)明确默认行为随宿主系统变化，跨平台字符串测试必须显式使用 `path.win32` / `path.posix`。不能把 macOS 上 `path.dirname('C:\\...')` 的结果作为 Windows 行为。

[Electron shell 文档](https://www.electronjs.org/docs/latest/api/shell#shellopenpathpath)规定 `openPath()` 失败时可能 resolve 一个非空错误字符串，成功返回空字符串；只写 try/catch 会漏报。`showItemInFolder()` 返回 void，不能虚构其成功回执；若要报告可验证失败，至少先检查输入和文件存在性。

## 本次采用的设计边界

1. 修复**属性语法层**：状态扫描读取完整属性值，不能按空格拆文件路径；支持英文单/双引号、中文弯单/双引号，历史消息经过同一解析器即获益，无需改库重写。
2. 对缺失或错配外层引号，恢复必须有确定边界，例如标签末尾或下一已知属性赋值；无法确定则保留失败状态并提示，不能静默猜截断位置。
3. 外层定界符与文件名内容分离。保留路径内部撇号、弯引号、空格、emoji、Unicode 空格、百分号、井号、反斜杠；不对原始路径 URI 解码，不把 `\\n` 作为换行转义，不做全局 NFC/NFD 或分隔符转换。
4. 原生文件 API 接收路径字符串，不经过 shell 命令拼接。操作失败必须通过界面提示，不能把 `openPath` 非空返回值当成功。
5. 相对路径的解释、执行设备绑定、权限检查继续沿用现有机制，解析容错不应拓宽文件访问权限。

## 建议测试矩阵

| 类别 | 应覆盖的输入和断言 |
| --- | --- |
| 事故回放 | 弯引号包裹 `Library/Application Support/.../品牌之路-合并版.pptx`，结果为完整路径、不含定界符 |
| 正常协议 | 英文单/双引号、无引号无空格、属性换序、`isDirectory` 布尔值、换行属性、HTML/text/inline-code 三种历史渲染入口 |
| 引号错误 | 左引号缺失、右引号缺失、左右弯引号反向、直弯混用；只在边界明确时恢复，不吞掉后续属性 |
| 字面文件名 | `O'Brien.pptx`、`客户“年度”汇报.pptx`、含 `path=` 的合法目录名；合法内部字符不得被当成定界符 |
| macOS | 空格、多空格、中文、emoji、NBSP/U+202F、NFD 字符、字面反斜杠、`#`、`%20`；保持逐字符原样 |
| Windows | `C:\\Users\\张 三\\Desktop\\季度 报告.pptx`、正斜杠盘符、UNC `\\\\server\\share\\部门 文档\\报告.pptx`、扩展长度路径、盘符根目录；不能被 POSIX 规则误解 |
| 不执行 | 空路径、控制字符、畸形标签、协议 URL、明显不完整路径应有可解释结果，不能变成另一个目标 |
| 错误传播 | Electron 返回空字符串、非空错误字符串、Promise rejection，文件消失、目录不存在及 IPC 不可用；验证成功与错误提示互斥 |

调研指导设计边界，不等于测试已经执行；最终执行结果应由本分支验收文档记录。
