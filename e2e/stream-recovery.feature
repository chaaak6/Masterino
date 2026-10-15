# language: zh-CN
@stream-recovery @P0
功能: 断流后的消息与发送按钮保持一致
  场景大纲: 不同网络结果都有明确终态
    假如打开使用生产运行状态的隔离测试 App
    当运行 "<case>" 网络场景
    那么运行结果为 "<result>" 且请求次数为 <attempts>
    并且消息加载与发送按钮同时结束
    例子:
      | case           | result    | attempts |
      | success        | completed | 1        |
      | eof-recovery   | completed | 2        |
      | reset-recovery | completed | 2        |
      | always-eof     | failed    | 3        |
      | transient      | completed | 3        |
      | rate-limit     | completed | 2        |
      | unauthorized   | failed    | 1        |
      | too-large      | failed    | 1        |
      | provider-error | failed    | 1        |
      | malformed      | failed    | 1        |
      | nonstream      | completed | 1        |
      | legacy-eof     | completed | 1        |
      | length                  | completed | 1 |
      | MAX_TOKENS              | completed | 1 |
      | ECONNREFUSED            | completed | 2 |
      | UND_ERR_CONNECT_TIMEOUT | completed | 2 |
      | UND_ERR_HEADERS_TIMEOUT | completed | 2 |
      | socket-hang-up          | completed | 2 |
      | nested-503              | completed | 2 |
      | server-retryable        | completed | 2 |
      | wrapped-rate-limit      | completed | 2 |
      | quota                   | failed    | 1 |

  场景: 输出尚未结束时保持加载和停止按钮
    假如打开使用生产运行状态的隔离测试 App
    当运行 "slow" 网络场景
    那么消息与停止按钮同时保持运行
    并且运行结果为 "completed" 且请求次数为 1
    并且消息加载与发送按钮同时结束

  场景: 用户停止后不再接收迟到内容或重试
    假如打开使用生产运行状态的隔离测试 App
    当运行 "stop" 网络场景
    那么消息与停止按钮同时保持运行
    当用户停止当前运行
    那么运行结果为 "stopped" 且请求次数为 1
    并且消息加载与发送按钮同时结束
    并且后续流内容不会进入消息

  场景: 重试期间不能提前显示停止
    假如打开使用生产运行状态的隔离测试 App
    当运行 "always-eof" 网络场景
    那么自动恢复期间消息与停止按钮同时保持运行
    并且运行结果为 "failed" 且请求次数为 3
    并且消息加载与发送按钮同时结束

  场景: 离线恢复后继续当前模型调用
    假如打开使用生产运行状态的隔离测试 App
    当网络暂时离线
    当运行 "success" 网络场景
    那么自动恢复期间消息与停止按钮同时保持运行
    当网络恢复在线
    那么运行结果为 "completed" 且请求次数为 2
    并且消息加载与发送按钮同时结束

  场景: 已恢复的订阅安静执行工具后仍能再次恢复
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-quiet" 网络场景
    那么网关运行最终为 "completed"
    并且消息加载与发送按钮同时结束
    并且订阅共请求 3 次

  场景: 订阅反复立即断开仍有恢复上限
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-immediate" 网络场景
    那么网关运行最终为 "failed"
    并且消息加载与发送按钮同时结束
    并且订阅共请求 3 次

  场景: 已完成运行的结果刷新失败可以单独恢复
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-sync-fail" 网络场景
    那么网关运行最终为 "completed"
    并且消息加载与发送按钮同时结束
    并且结果同步失败但保留正文
    当点击刷新已保存的结果
    那么结果已同步且没有重新生成

  场景: 取消后的迟到错误不能覆盖取消或正文
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-late-error" 网络场景
    那么消息与停止按钮同时保持运行
    当用户停止当前运行
    那么迟到错误后仍保持取消
    并且消息加载与发送按钮同时结束

  场景: 自动重试期间可以立即停止
    假如打开使用生产运行状态的隔离测试 App
    当运行 "always-eof" 网络场景
    那么自动恢复期间消息与停止按钮同时保持运行
    当用户停止当前运行
    那么运行结果为 "stopped" 且请求次数为 1
    并且消息加载与发送按钮同时结束
    并且后续流内容不会进入消息

  场景: 离线等待期间停止后恢复网络不会重发
    假如打开使用生产运行状态的隔离测试 App
    当网络暂时离线
    当运行 "success" 网络场景
    那么自动恢复期间消息与停止按钮同时保持运行
    当用户停止当前运行
    当网络恢复在线
    那么运行结果为 "stopped" 且请求次数为 1
    并且后续流内容不会进入消息

  场景: 失败后可以手动重新生成
    假如打开使用生产运行状态的隔离测试 App
    当运行 "unauthorized" 网络场景
    那么运行结果为 "failed" 且请求次数为 1
    当点击重试生成并恢复服务
    那么运行结果为 "completed" 且请求次数为 1
    并且消息加载与发送按钮同时结束

  场景: 刷新结果期间停止不会被迟到快照覆盖
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-snapshot-cancel" 网络场景
    那么结果刷新请求已发出
    当用户停止当前运行
    那么迟到错误后仍保持取消
    并且消息加载与发送按钮同时结束

  场景: 服务端明确失败后立即结束加载并允许继续使用
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-error" 网络场景
    那么网关运行最终为 "failed"
    并且消息加载与发送按钮同时结束
    并且订阅共请求 1 次

  场景: 结果补拉超时不阻止继续使用
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-snapshot-timeout" 网络场景
    那么补拉超时后发送区已释放
    并且结果同步失败但保留正文
    并且消息加载与发送按钮同时结束

  场景: 重试恢复后立即恢复生成提示并保持停止可用
    假如打开使用生产运行状态的隔离测试 App
    当运行 "recovery-long" 网络场景
    那么自动恢复期间消息与停止按钮同时保持运行
    并且恢复数据后重试提示清除但运行仍未结束
    并且运行结果为 "completed" 且请求次数为 2
    并且消息加载与发送按钮同时结束

  场景: 不同服务端和本地操作 ID 的网关恢复提示可见
    假如打开使用生产运行状态的隔离测试 App
    当运行 "gateway-immediate" 网络场景
    那么网关本地操作显示恢复中
    并且网关运行最终为 "failed"
    并且消息加载与发送按钮同时结束

  场景: 已成功运行收到迟到清理错误仍保持成功
    假如打开使用生产运行状态的隔离测试 App
    当运行 "success" 网络场景
    那么运行结果为 "completed" 且请求次数为 1
    当收到迟到的清理错误
    那么运行结果为 "completed" 且请求次数为 1
    并且消息加载与发送按钮同时结束

  场景: 恢复数据后仍可停止且没有残留重试提示
    假如打开使用生产运行状态的隔离测试 App
    当运行 "recovery-long" 网络场景
    那么恢复数据后重试提示清除但运行仍未结束
    当用户停止当前运行
    那么运行结果为 "stopped" 且请求次数为 2
    并且消息加载与发送按钮同时结束
