/**
 * 站点全局配置 —— 个人信息、社交链接、评论系统等都在这里改
 * 目前为占位内容，请替换为你自己的真实信息
 */
export const SITE = {
  title: 'Luqi',
  name: 'Luqi',
  domain: 'luqi.work',
  url: 'https://luqi.work',
  description: 'Researcher & Engineer · 专注于光子计算与自动化工具开发',
  author: 'Luqi',
  // 首页 Hero 一句话介绍
  tagline: 'Researcher & Engineer',
  taglineSub: '专注于光子计算与自动化工具开发',
};

export const SOCIAL = {
  github: 'https://github.com/yourname', // TODO: 替换为你的 GitHub 主页
  email: 'mailto:hi@luqi.work', // TODO: 替换为你的邮箱
  scholar: 'https://scholar.google.com/citations?user=YOUR_ID', // TODO: Google Scholar 主页
  x: 'https://x.com/yourname', // TODO: X / Twitter 主页（不需要可删除引用）
};

/**
 * 评论系统（giscus · 基于 GitHub Discussions）
 * 前往 https://giscus.app/zh-CN 生成你的配置后填入以下字段即可启用评论。
 * repo 需为公开仓库，并在仓库 Settings 中开启 Discussions，
 * 并安装 giscus App：https://github.com/apps/giscus
 */
export const GISCUS = {
  repo: '', // 例如 'yourname/luqi.work'（留空则评论区块显示配置提示）
  repoId: '',
  category: 'Announcements',
  categoryId: '',
};

export const NAV = [
  { label: '首页', href: '/' },
  { label: '随笔', href: '/blog' },
  { label: '项目', href: '/projects' },
  { label: '关于', href: '/about' },
];

/** 随笔分类（用于首页/筛选栏展示的固定顺序） */
export const BLOG_TAGS = ['心情随笔', '亲情爱情', '读书观影', '梦想奋斗', '校园青春', '生活日常'];

/**
 * 首页 Hero 右侧的动漫半身像
 * 把你的图片命名为 hero-anime.png（或 jpg）放到 public/images/ 下，
 * 然后把下面的路径改成 '/images/hero-anime.png' 即可。
 */
export const HERO_IMAGE = '/images/hero-anime.svg';
