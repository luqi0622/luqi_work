# luqi.work · 个人博客与作品集

基于 **Astro + Tailwind CSS** 的极简个人博客与作品集，部署于 **Vercel**。
内含子站 `/tianyuanFood`（此前完成的田原食品企业官网，React + Vite 单页应用）。

## 快速开始

```bash
npm install            # 安装博客依赖
npm run dev            # 启动开发服务器（首次会自动构建子站产物）
npm run build          # 完整构建：先构建 TianYuanFood 子站，再构建 Astro
npm run preview        # 本地预览构建产物
```

> 首次运行 `dev` 会自动执行 `scripts/build-tianyuan.mjs` 把子站产物同步到
> `public/tianyuanFood/`；该目录为构建产物，已在 `.gitignore` 中忽略。
> 修改 TianYuanFood 源码后运行 `npm run build:tianyuan` 重新同步。

## 目录结构

```text
├── api/send-email.ts          # 子站留言通知（Vercel Serverless）
├── scripts/build-tianyuan.mjs # 子站构建与同步脚本
├── public/                    # 静态资源（含 tianyuanFood 子站产物）
├── src/
│   ├── config.ts              # ★ 个人信息 / 社交链接 / 评论配置
│   ├── content.config.ts      # Content Collections 定义（blog / projects）
│   ├── content/blog/          # 随笔（Markdown / MDX）
│   ├── content/projects/      # 项目数据
│   ├── components/            # Header / Footer / 卡片 / TOC / 评论等
│   ├── layouts/               # BaseLayout（SEO + 主题）
│   ├── pages/                 # 首页 / 随笔 / 项目 / 关于 / RSS / 404
│   └── styles/global.css      # Tailwind v4 配置与文章排版
└── TianYuanFood/              # 子站源码（独立 React 项目，正常修改构建即可）
```

## 写作

在 `src/content/blog/` 新建 `.md` 或 `.mdx` 文件：

```yaml
---
title: 文章标题
description: 一句话摘要
pubDate: 2026-08-30
tags: ['技术思考']
featured: false    # true 时可能进入首页"最新随笔"权重
---
```

支持：Shiki 代码高亮（亮暗双主题）、KaTeX 数学公式（`$...$` / `$$...$$`）、
GitHub 风格提示块（`> [!NOTE]` / `> [!TIP]` / `> [!WARNING]` 等）。

## 启用评论（giscus）

1. 将仓库推送到 GitHub（需公开）
2. 仓库 Settings → 开启 Discussions
3. 安装 [giscus App](https://github.com/apps/giscus)
4. 在 [giscus.app](https://giscus.app/zh-CN) 生成配置，把 `repo` / `repoId` /
   `categoryId` 填入 `src/config.ts` 的 `GISCUS` 字段

## 部署到 Vercel

已有 Vercel 项目（luqi.work 域名已绑定）：

1. **方式一（推荐）**：把本目录推送到 GitHub，Vercel 项目 → Settings →
   Git → 连接该仓库，Root Directory 设为仓库根，Framework Preset 选 Astro，
   Build Command 用默认 `npm run build`（脚本会自动先构建子站）
2. **方式二**：本地 `npx vercel --prod` 直接部署本目录
3. Vercel 项目 → Settings → Environment Variables 添加：

   | 变量名 | 说明 |
   |--------|------|
   | `PUSH_PLUS_TOKEN` | 子站留言的 PushPlus 推送 Token（原硬编码值已迁移至此） |

## 个性化清单

- [ ] `src/config.ts`：GitHub / Email / Google Scholar / X 链接
- [ ] `public/avatar.svg`：换成真实头像
- [ ] `src/pages/about.astro`：替换占位介绍与 FAQ
- [ ] `src/content/blog/`：删掉示例随笔，开始写作
- [ ] giscus 评论配置
