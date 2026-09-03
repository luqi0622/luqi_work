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
// Astro 5：默认 output:'static' + vercel adapter 即「静态页预渲染，prerender=false 的 /blog 与 /api/* 走 Vercel 函数」
export default defineConfig({
  site: 'https://luqi.work',
  output: 'static',
  adapter: vercel(),
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
