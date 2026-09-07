import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import remarkMath from 'remark-math';
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert';
import rehypeKatex from 'rehype-katex';

// https://astro.build/config
// Astro 5 中 output:'static' 即「静态页预渲染 + prerender=false 的 /blog 与 /api/* 走 Vercel SSR 函数」（hybrid 已移除，static 等同其行为）。
// 注意：线上 /api/* 曾 404，根因在 Vercel 路由配置（见 vercel.json / .vercel/output/config.json），非 output 模式。
export default defineConfig({
  site: 'https://luqi.work',
  output: 'static',
  adapter: vercel({ maxDuration: 60 }),
  integrations: [
    mdx(),
    sitemap(),
    icon({
      include: {
        lucide: ['*'],
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: true,
    },
    remarkPlugins: [remarkMath, remarkGithubBlockquoteAlert],
    rehypePlugins: [rehypeKatex],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
