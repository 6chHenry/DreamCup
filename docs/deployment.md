# Vercel 部署与本地 H3 接入

## 部署范围

Vercel 线上版本提供梦境文字记录、Kimi 整理与结构化、日志列表和文字详情。线上数据保存到 Neon Postgres。本机 `data/` 中的私人梦境、录音、人物参考图与视频不会上传，也不会自动同步到线上。

本地版本保留完整流程，包括记忆核对、MiniMax H3 Image 场景生图、MiniMax H3 分镜视频和 FFmpeg 合成。

## 1. 创建数据库

在 Vercel 项目的 Storage 中创建 Neon Postgres，并将数据库连接到项目。连接后确认 Production 环境存在 `DATABASE_URL`。

首次读写时应用自动创建 `dreams` 表，无需手动执行迁移。日志中的“隐藏”是软删除，记录仍保存在数据库中。

## 2. 配置 Kimi

在 Vercel 项目的 Settings → Environment Variables 中为 Production 添加：

```dotenv
KIMI_API_URL=https://api.kimi.com/coding/v1
KIMI_API_KEY=你的服务端密钥
```

不要将密钥写进 `NEXT_PUBLIC_*`，也不要提交 `.env.local`。修改环境变量后重新部署。

## 3. 部署

在 GitHub 已连接 Vercel 的情况下，导入 `6chHenry/DreamCup`，Framework Preset 选择 Next.js，Build Command 使用：

```bash
npm run build -- --webpack
```

也可以在项目目录使用 CLI：

```powershell
npx vercel link
npx vercel env pull .env.vercel
npx vercel --prod
```

`.env.vercel` 包含环境配置，不要提交。应用通过 `VERCEL=1` 自动启用线上精简界面与 Postgres 存储。

## 4. 本地连接单张 A100

在 PowerShell 中运行：

```powershell
ssh -o BindAddress=0.0.0.0 -t -L 8190:127.0.0.1:8189 kwliu-modelarts 'bash /home/ma-user/ai-drama-h3-single/start_comfy.sh'
```

启动脚本会复用已经健康运行的 ComfyUI。看到远端 8189 已占用时，不要启动第二个进程，直接使用现有服务。

本地 `.env.local`：

```dotenv
COMFYUI_LOCAL_URL=http://127.0.0.1:8190
COMFYUI_H3_IMAGE_MODEL=minimax_h3_image_pruned_int8_convrot.safetensors
COMFYUI_H3_VIDEO_MODEL=MiniMax-H3-FL2VA-Q8_0.gguf
COMFYUI_H3_TEXT_ENCODER=qwen3vl_32b_minimax_h3-Q4_K_M.gguf
```

然后运行 `npm run dev`，打开 `http://127.0.0.1:3000`。保持 SSH 窗口开启，本地页面即可调用 A100。

## Vercel 与 A100 的边界

`127.0.0.1:8190` 只对运行 SSH 命令的电脑有效，Vercel 服务器无法访问这个地址。因此线上版本暂不显示生图和视频入口。

后续如需从线上直接调用 A100，需要为 ComfyUI 后面的受控任务服务配置公网 HTTPS 地址和身份认证，再把 `COMFYUI_LOCAL_URL` 指向该 HTTPS 服务。不要把无认证的 ComfyUI 直接暴露到公网。SSH 本地转发和 Vercel 公网环境是两条独立连接路径。
