# Agent 图片预处理一手资料核查

核查日期：2026-11-05。结论是 **Codex 的公开实现确实会在请求准备阶段做图片解码、按尺寸和 patch 预算缩放及必要的重新编码；这与自动 OCR、自动生成语义摘要是不同的能力**。本轮仅调研；没有修改 Masterino 的图片处理行为。

## 证据范围

Codex 依据官方 `openai/codex` 仓库，固定提交为 `388aee4b26226778701a7fa749354c44f74b4394`，是本次查询时的 HEAD。下文的数字属于这个公开提交的实现，不等于所有已发布 CLI 版本，更不能直接当作闭源 Codex 桌面 UI 的内部行为。桌面 UI 没有完成 Computer Use 实测；本机工具拒绝访问该应用。

## Codex 的实际处理

| 环节 | 源码事实 | 设计含义 |
| --- | --- | --- |
| 图片准备 | `DetailBased` 模式下，未指定、`auto`、`high` 使用 `HIGH_DETAIL`；显式 `original` 使用 `ORIGINAL_DETAIL`。受 feature 与模型支持共同门控的 `UnifiedBudget` 模式使用 original 策略。[S1] | 必须按模式和模型能力解释，不能概括为所有图片都统一压成某一分辨率。 |
| 尺寸限制 | high 最大边 2048 px，32×32 patch 数不超过 2500；original 最大边 6000 px，patch 数不超过 10000。超过限制按比例缩小。[S2] | 原图保留和模型输入图可以分离；图片数量之外还需要尺寸预算。 |
| 编码 | 无需缩小的 PNG、JPEG、WebP 可以保留原字节；需要重编码时，JPEG 使用质量 85，WebP 使用无损编码，PNG 使用 PNG 编码。其他输入可能转换格式。[S2] | 不是所有图片都转为有损 JPEG；截图、透明图和照片应分别处理。 |
| 缓存 | 编码结果使用文件内容摘要及处理模式构成缓存键，并设置缓存容量约束。[S2] | 同一张图反复预览、发送不应反复解码和处理。 |
| 模型说明 | 可启用 resize notice，向模型说明图片序号及缩放前后尺寸。[S3] | 坐标和局部细节任务需要知道缩放关系；这不是 OCR 结果。 |
| 草稿恢复 | TUI 在线程外准备图片；准备失败会显示错误并恢复原消息到输入框，取消也恢复草稿。[S4] | 超限、解码失败、取消时不应让用户丢失文字及附件。 |
| 总传输限制 | TUI 准备阶段使用 32 MiB 的累计图片表示预算，为 64 MiB WebSocket 消息限制预留空间；不是“单张 32 MiB”，也不是模型视觉 token 上限。[S4] | 必须分别检查单图、总请求体及上下文限制。 |
| 图片 token 估算 | original inline 图按解码后的尺寸计算 32px patch，并将估算限制在 10000；original file 引用使用上限估算。其他模式仍有粗略固定估算，源码明确其为近似值。[S5] | Codex 的估算也有近似，不能把本地估计展示为真实模型用量。 |

在已核查的共享图片准备通路中，没有发现每次附件进入请求前都先运行 OCR 或视觉摘要模型的步骤；该通路主要是图像预处理与请求准备。`view_image` 等工具可以按任务把图片交给模型看，但不等同于所有图片会自动转为文本。[S1][S6] 这一结论限定于已核查通路，不宣称整个产品绝不存在其他提取功能。

## 模型 API 的约束

OpenAI 官方视觉文档将 `detail`、模型、尺寸及 patch/tile 规则共同作为图片处理和 token 计算依据；图片 tokens 需要和其余 prompt 一起满足上下文限制。不同模型的 `low` 也不保证总比 `high` 省 tokens，因此不应在 Masterino 中写死通用的“低清等于固定低成本”规则。[S7]

Anthropic 官方文档同样按模型分辨率等级处理视觉 patch。其建议区分缩放与有损压缩：压缩可降低请求字节及延迟，但可能损伤小字，尤其不宜反复有损压缩。原文件大小不是视觉 token 数的直接替代指标。[S8]

## 对 Masterino 本轮方案的约束

1. 用户确定的每条消息最多十张图片，应在添加时及发送前统一校验，覆盖分批追加、粘贴、拖拽和历史“加入输入”。十张是 Masterino 产品上限，不应伪装成所有模型 API 的官方上限。
2. 本轮 UI 改进可以展示“已选 N/10”、稳定编号、图片网格、单一预览器、失败原因和恢复操作；必须避免为了显示缩略图而改变模型输入内容。
3. 图片缩放、OCR、语义摘要和历史重读属于独立的数据或上下文行为变更。本轮若只改 UI，应保留现有行为，在方案中记录后续可选项，不能顺手引入有损处理或额外模型调用。
4. 后续若实施图片预算，应保存原图，按模型生成请求用派生图，记录处理后尺寸和 detail，基于实际派生图估算；总字节限制和视觉 tokens 分开校验。OCR 与摘要仅在任务需要时使用，不能静默替代原图中的视觉证据。
5. 不直接照搬 Codex 的 2048/6000、2500/10000、JPEG 85 和 32 MiB 到 Aihub：它们是特定实现和模型族的策略，需用 Masterino 实际可用模型及网关限制验证。

## 一手来源

- [S1 图片请求准备与模式选择](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/core/src/image_preparation.rs#L392)
- [S2 图片处理限制与编码实现](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/utils/image/src/lib.rs#L73)
- [S3 缩放通知](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/core/src/context/image_resize_notice.rs#L59)
- [S4 TUI 图片提交与草稿恢复](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/tui/src/chatwidget/image_submission.rs#L86)
- [S5 历史图片用量估算](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/core/src/context_manager/history.rs#L1291)
- [S6 查看图片工具](https://github.com/openai/codex/blob/388aee4b26226778701a7fa749354c44f74b4394/codex-rs/core/src/tools/handlers/view_image.rs#L175)
- [S7 OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [S8 Anthropic Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
