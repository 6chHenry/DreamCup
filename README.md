**掬梦（DreamCup）** — 多模态 AI 梦境记录与可视化

![DreamCup](figures/DreamCup_banner.png)

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 线上与本地

- Vercel 线上版：文字记录、Kimi 整理与结构化、Neon 持久化日志和文字详情。
- 本地完整版：在此基础上支持记忆核对、单卡 A100 的 MiniMax H3 Image 生图、H3 视频和 FFmpeg 合成。
- 本地 `data/` 与线上数据库相互独立，不上传或同步私人梦境与媒体。
- 部署、环境变量和 A100 转发步骤见 [docs/deployment.md](docs/deployment.md)。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 当前功能与离线记录

- 快速文字记录无需模型 API，支持标题、日期、标签、清醒梦和浏览器草稿恢复。
- 日志支持全文搜索、类型筛选、ZIP 导入和 JSON 数据备份。
- AI 语音转写、润色、结构化、记忆追问、场景生图与视频流程保留，需配置可用的外部服务。
- 梦境详情提供放映室：可编辑分镜、旁白、运镜、时长、转场和画幅，并无需 API 连续预览。
- 完整成片工作台支持逐镜头任务、失败重试、FFmpeg 转场、可选 TTS/背景音与 MP4 下载；离线样片无需外部 API。
- 视频管线与后续模型/配音路线见 `docs/video-pipeline.md`、`docs/product-ambitions.md`。
- 详细进度与后续计划见 `next_stage_plan.md`。

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
