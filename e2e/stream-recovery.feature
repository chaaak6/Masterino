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
