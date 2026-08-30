---
title: 用 Astro 重建这个博客
description: 为什么从零开始选了 Astro + Tailwind CSS：静态优先、内容集合、零 JS 默认——以及这套站点的整体架构。
pubDate: 2026-08-28
tags: ['技术思考', '工具折腾']
featured: true
---

这个博客第三次返工了。前两次分别用 Hexo 和 Next.js 搭的，这次换成了 **Astro**，记录一下选型思路。

## 为什么是 Astro

写博客的本质是「内容优先」，而大多数框架都在为「应用优先」设计。Astro 的默认姿态刚好反过来：

- **零 JS 默认**：页面默认输出纯静态 HTML，交互按需注水（Islands）；
- **Content Collections**：Markdown/MDX 内容带 schema 校验，frontmatter 写错直接构建报错；
- **构建快**：同样的页面量，构建时间只有之前方案的零头。

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
```

有了 schema，标题缺失、日期格式错误这类问题会在 `astro build` 时直接失败，而不是渲染出一个残缺的页面。

## 站点架构

> [!NOTE]
> 本站结构：Astro 静态输出 + Vercel 托管，子站 `/tianyuanFood` 是一个独立的 React 项目，构建产物直接放进 `public/` 目录。

文章排版相关的配置集中在 `global.css` 里手写：中文行高 1.85、代码块 Shiki 双主题、KaTeX 数学公式。刻意没上 typography 插件——中文排版的细节（字距、标点悬挂）还是自己控制更顺手。

## 一点感受

工具的意义是让表达更专注。当「写一篇随笔」的心智成本降到「新建一个 md 文件」时，写作这件事才真正可持续。

下一篇打算写写光子计算那边参数扫描自动化的经验。
