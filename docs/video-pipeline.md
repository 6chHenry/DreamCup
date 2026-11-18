# 梦境视频生产管线

## 当前实现

- `data/render-jobs.json` 持久化任务、镜头状态、供应商任务 ID、重试次数、素材地址与错误。
- 离线样片：现有场景图 + 运镜 + 转场 + 可选旁白/背景音，FFmpeg 输出 MP4。
- 模型成片：本地 MiniMax H3、即梦/方舟 Seedance 或 Grok 逐镜头任务，成功后缓存本地，再进入同一合成器。
- TTS 适配：火山引擎、OpenAI 兼容 `/audio/speech`、Azure Speech。
- 即梦使用新方舟异步接口 `POST /contents/generations/tasks` 与 `GET /contents/generations/tasks/{id}`，按分镜首帧图提交，并保存任务 ID 和模型名。
- 服务重启或继续任务时，已有供应商任务 ID 只恢复查询，不重复提交；镜头素材缓存后才进入 FFmpeg。
- 缺少视频或配音密钥时分别回退为场景图运镜和字幕/无声；鉴权、限流、审核、网络等非配置错误保留失败状态供重试，不伪装为离线成功。
- `/api/render-providers` 仅暴露供应商标识、配置布尔状态和说明，不返回密钥或完整服务地址。
- 重试跳过已完成镜头；线上任务失败保留现场。
- 转场支持叠化、淡黑、直接切换任意混合；画面、旁白、字幕共用重叠时间轴。
- 可配置旁白/音乐音量、烧录字幕，导出 SRT、VTT、旁白与音乐独立音轨。
- 任务支持暂停、断点继续、历史版本与服务启动恢复；异步更新写入 `data/render-jobs.json`。
- 工程 ZIP 包含 `project.json`、分镜 JSON、字幕、镜头素材、已有音频 stems 与成片。
- 分镜采用 1.2 秒防抖自动保存和顺序保存队列；合成前强制等待当前版本保存，历史任务保留当时的分镜快照。
- 生成前检查缺图、空描述、空旁白和旁白/时长匹配；只有缺图阻断，其余问题可跳回对应镜头处理。
- 视频、配音与背景音乐设置按梦境保存在浏览器本地；背景音乐可上传，也可通过 `/api/render-jobs/ambience` 在本地生成、试听与移除，无需外部 API。
- 创作页按「场景与画面 → 分镜与放映 → 合成与导出」组织；成片只保留一个主播放器，逐镜头供应商与回退详情按需展开。

## 生产部署提醒

当前任务在 Next.js Node 进程内执行，适合本地单进程预览。部署到 Vercel 等 serverless 环境时，长视频生成和 FFmpeg 合成应迁移到持久 worker / 容器任务，数据库保存任务，对象存储保存媒体；`/tmp` 不是持久存储。

原子任务锁和恢复机制仅覆盖当前 Node 进程，不能用于多实例部署。即梦、Grok 和外部 TTS 仍须有效凭据联调；自定义供应商是明确标识的预留选项。本轮只通过本地模拟服务验证即梦协议、缓存、恢复和合成，没有调用真实供应商。

## 配音环境变量（可选，不改动现有 API）

- `OPENAI_TTS_API_URL`、`OPENAI_TTS_API_KEY`、`OPENAI_TTS_MODEL`、`OPENAI_TTS_VOICE`
- `VOLCENGINE_TTS_APP_ID`、`VOLCENGINE_TTS_ACCESS_TOKEN`、`VOLCENGINE_TTS_CLUSTER`、`VOLCENGINE_TTS_VOICE`
- `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_VOICE`

## 即梦接入原则

即梦/火山视频模型通过独立 provider adapter 接入，不与 Grok 路径混用。默认模型为 `doubao-seedance-1-0-pro-250528`，可通过 `JIMENG_VIDEO_MODEL` 替换为账号可用的模型 ID；模型可用时长、画幅和下载 URL 有效期仍以账号和官方文档为准。

官方协议：

- https://docs.volcengine.com/docs/ark/create-video-generation-task-api
- https://docs.volcengine.com/docs/ark/get-video-generation-task-api

适配器只负责提交与轮询，任务恢复、缓存和 FFmpeg 合成复用现有管线。`JIMENG_API_KEY` 或 `ARK_API_KEY` 均可提供方舟凭据，本地无密钥预览不需要填写。

## MiniMax H3 单卡本地流程

选择场景生图模型 `MiniMax H3 Image · 本地 ComfyUI`，再把「画面来源」设为 `MiniMax H3 · 本地 A100`，即可按以下顺序生成：

1. 使用已有的分镜文字与可编辑提示词，H3 Image 输出 1344×768 的 16:9 首帧。人物库匹配到参考图时会上传给本地 ComfyUI，并用 `<Picture 1>` 明确人物身份参考。所有上传图片先旋转并转成真实 PNG，再交给 ComfyUI。
2. H3 FL2VA 使用这张场景图作为首帧，按分镜提示词、画幅和时长逐镜头生成。24fps 的帧数对齐至 `17k+5`，当前支持约 5 至 15 秒。
3. 视频缓存到现有任务目录，继续复用单镜头重试、任务 ID 恢复、字幕、转场、混音和 FFmpeg MP4 合成。

本地 H3 生图可开启「前一镜头参考」。后续镜头把上一张场景图作为 `<Picture 2>`（有人物参考时），只参考画风、色调、光线与共同场景元素；明确切换空间时仍以当前文字为准。它用于降低漂移，不保证严格空间一致性。单镜头重绘不会自动把变化传给后续镜头。

生图与视频都使用由任务、镜头和提示词确定的稳定种子。相同任务重试可以复现同一构图；改变提示词或生成档位会产生新种子。首帧独立保存到 `data/scene-images/`，不再依赖 ComfyUI 临时输出地址。

合成设置里的 H3 档位包括「精细 · 25 步」和「草稿 · 12 步」。精细仍是默认值；草稿适合先检查构图、动作和镜头衔接。任务记录 `generationQuality`，镜头详情显示每镜头实际耗时。模型视频在 FFmpeg 中只做一次缩放、转场和字幕编码，静态分镜仍使用独立的运镜预览路径。

本机实测 1344×768、124 帧的草稿镜头执行约 4分25秒，同规格精细档此前约 8分30秒。不同提示词、机器负载与 ComfyUI 缓存状态会影响耗时。草稿完成过场景与运动抽帧检查，尚未对同一随机种子做 12/25 步的严格配对画质实验。

服务端设置 `COMFYUI_LOCAL_URL=http://127.0.0.1:8190`。A100 上的 ComfyUI 只监听远端回环地址时，先建立 `ssh -o BindAddress=0.0.0.0 -N -L 8190:127.0.0.1:8189 kwliu-modelarts`，再启动 CatchDream。此入口不需要生成 API 密钥。

默认模型为官方 ComfyUI 的 H3 Image INT8、H3 FL2VA Q8、Qwen3-VL Q4 GGUF 和各自 VAE。图片采用 1344×768、6 步、Euler/simple、CFG 1；视频采用 1344×768、25 步、res_multistep/simple。使用同一 A100 串行运行，避免生图与视频并发争用显存。应用进程不应使用会代理本机回环请求的代理设置。

文字分镜仍沿用现有 AI 提示词生成或手工编辑。当前本地流程没有部署额外的提示词扩写模型，也没有把尚未接入的本地 LLM 描述为可用。

模型来源：https://huggingface.co/Comfy-Org/MiniMax-H3-Image 和 https://huggingface.co/Comfy-Org/MiniMax-H3 。H3 Image 使用其单独的社区许可，对外提供托管服务或商业使用前需自行核对许可条款。

Windows 可在项目根目录执行 `pwsh -File scripts/start-local-h3.ps1`，它会设置本次进程所需的本地地址和 30 分钟轮询上限，并禁用会截获回环地址的代理变量。无需手工修改 `.env.local`。

## Kimi K3 文本处理

首页默认文本模型为 `kimi-k3`，用于润色、结构化解析、记忆追问、分镜提示词和梦境解读等 OpenAI 兼容文本入口。在 `.env.local` 填以下两项后重启应用：

```dotenv
KIMI_API_URL=https://api.kimi.com/coding/v1
KIMI_API_KEY=由你填写
```

Kimi 密钥只走服务端，不通过 `NEXT_PUBLIC_*` 暴露到浏览器。旧模型和既有浏览器选择仍保留；已有选择不会被默认配置覆盖。没有密钥时相关文本请求会明确报未配置，不会调用其他模型冒充 Kimi 成功。
