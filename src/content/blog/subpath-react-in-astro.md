---
title: 把企业官网塞进博客子路径的折腾记录
description: 一个 React 单页应用如何无痛挂到 Astro 站点的 /tianyuanFood 子路径下：base 配置、产物同步与 Serverless 函数的归位。
pubDate: 2026-08-15
tags: ['工具折腾']
featured: false
---

之前给朋友做过一个企业官网（React + Vite 单页应用），部署在 luqi.work 上。这次博客返工，不想丢掉它，于是把它挪到了 `/tianyuanFood` 子路径下。

## 核心问题只有一个：base

Vite 单页应用默认假设自己部署在域名根路径，所有资源引用都从 `/assets/...` 开始。挂到子路径只需要：

```bash
vite build --base=/tianyuanFood/
```

产物里的引用会全部变成 `/tianyuanFood/assets/...`，一行代码都不用改。

## 产物同步

构建产物直接复制进 Astro 的 `public/tianyuanFood/`：

```text
TianYuanFood/dist/*  →  public/tianyuanFood/*
```

Astro 对 `public/` 下的文件原样输出，不做任何处理——正好符合「子站完全独立、零耦合」的诉求。

> [!IMPORTANT]
> `public/tianyuanFood` 是构建生成的目录，已加入 .gitignore。CI 上先跑子站构建脚本再跑 `astro build` 即可。

## Serverless 函数归位

子站原有一个留言通知函数 `api/send-email.ts`（Vercel Serverless）。Vercel 只认部署根目录的 `api/`，所以它被复制到了仓库根部，路由保持 `/api/send-email` 不变，子站前端代码零修改。

## 小结

- `base` 决定资源前缀，SPA 无路由时这是唯一要动的东西
- `public/` 是静态子站的完美容器
- 函数跟着部署根走，不跟子站走
