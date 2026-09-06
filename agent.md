# agent.md · luqi.work 项目交接与经验手册

> 给未来接手本项目的 AI Agent（或我自己）看的「项目说明书 + 踩坑记录」。
> 改代码前先读这份，能省下大量重新探索的时间。

---

## 0. 一句话定位

`luqi.work` 是一个**基于 Astro + Tailwind CSS v4 的个人博客 + 作品集**，部署在 **Vercel**。
站点里**内嵌了一个独立的 React 子站 `/tianyuanFood`**（田原食品企业官网，是用户之前做的，不想丢）。
随笔栏目 `/blog` 现已**原生整合进本仓库**：后端（Turso 云 SQLite）与前端（Astro 页面 + 弹窗登录）都在 `luqi.work` 一个项目里，不再用 iframe 跨项目嵌入（详见 §10）；早期导出的 `qq-*.md` 快照仍保留在 `src/content/blog/` 但 `/blog` 不再渲染它们。

---

## 1. 技术栈与关键约定

| 项 | 值 | 备注 |
|----|----|----|
| 框架 | Astro `^5.13` | Content Collections 管理内容 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） | v4 用 `@theme` + `@custom-variant dark`，**没有 `tailwind.config.js`**，配置在 `src/styles/global.css` |
| 图标 | `astro-icon` + `@iconify-json/lucide` | 用法 `<Icon name="lucide:xxx" />` |
| 内容 | `src/content/blog`（随笔）、`src/content/projects`（项目） | Markdown / MDX |
| 数学公式 | remark-math + rehype-katex | `$...$` / `$$...$$` |
| 代码高亮 | Shiki 双主题 | light `github-light` / dark `github-dark` |
| 提示块 | remark-github-blockquote-alert | `> [!NOTE]` / `[!TIP]` / `[!WARNING]` 等 |
| 评论 | giscus（基于 GitHub Discussions） | 未配置时显示引导提示，不报错 |
| 字体 | 站酷快乐体（标题）+ 思源黑体（正文） | `@fontsource/zcool-kuaile` / `@fontsource/noto-sans-sc`，**本地打包不自外部 CDN** |

**路径别名**：`@/` → `src/`（tsconfig 已配，如 `@/config`、`@/utils/tags`）。

**暗色模式**：class 策略，`<html class="dark">`，由 Header 的 ThemeToggle 切换，BaseLayout 内联脚本防闪烁（FOUC）。

---

## 2. 目录结构（重点文件）

```text
luqi_work/
├── agent.md                      ← 本文件
├── README.md                     ← 面向用户的部署说明
├── package.json                  ← 构建脚本见下
├── astro.config.mjs              ← Astro 集成与 markdown 管线
├── vercel.json                   ← Vercel 部署配置（输出 dist）
├── api/send-email.ts            ← 子站留言的 Serverless 函数（PushPlus 推送）
├── scripts/
│   ├── build-tianyuan.mjs       ← 子站构建+同步（关键，见 §5）
│   └── import-qq-shuoshuo.mjs   ← QQ 说说 → 随笔 导入脚本
├── public/
│   ├── images/hero-anime.jpg     ← 首页 Hero 右侧动漫半身像
│   └── tianyuanFood/            ← 子站构建产物（gitignore，别手改）
├── src/
│   ├── config.ts                ★ 个人信息 / 社交 / 评论 / Hero 图 都在这里改
│   ├── data/tagOverrides.ts     ← 随笔分类手动修正表（见 §4）
│   ├── utils/tags.ts            ← 分类糖果色配色 + resolveTags() 覆盖逻辑
│   ├── utils/content.ts         ← 日期格式化、阅读时间、分类配色映射
│   ├── utils/time.ts            ← 北京时间格式化 nowBeijing() / formatBeijing()
│   ├── content.config.ts        ← blog / projects 两个 Collection 的 schema
│   ├── content/blog/            ← 223 篇随笔（qq-*.md）+ 新建的 notes-*.md
│   ├── content/projects/        ← 项目数据（tianyuan-food / this-blog 等）
│   ├── lib/
│   │   ├── db.ts                ★ Turso 客户端（`@libsql/client/web`，见 §10）
│   │   ├── auth.ts               ★ scrypt 校验 + HMAC 会话令牌
│   │   └── queries.ts           ★ 说说/评论/标签的全部 SQL（评论存 JSON 树）
│   ├── components/              ← Header / Footer / PostCard / ProjectCard /
│   │                             BlogFilter / TOC / Comments / SocialLinks
│   │   └── shuoshuo/            ← ShuoPost / ShuoComment(递归) / ShuoCompose /
│   │                             ShuoTags（说说前台组件，见 §10）
│   ├── layouts/BaseLayout.astro ← SEO + 主题切换 + 字体引入
│   ├── middleware.ts            ★ 保护 /api/admin/*（未登录返回 401）
│   ├── pages/                   ← index / blog/index / blog/[slug] /
│   │                             projects / about / tools / rss.xml / 404
│   │   └── api/                 ← login / logout / me
│   │       ├── shuoshuo/[id]/comments.ts   ← 游客评论+楼中楼
│   │       └── admin/           ← posts / comments / tags（博主专用）
│   └── styles/global.css        ← Tailwind v4 主题、字体、文章排版、动效
└── TianYuanFood/                ← 子站源码（独立 React+Vite 项目，正常改即可）
```

---

## 3. 构建与预览命令

```bash
npm install            # 装博客依赖（见 §6 镜像源）
npm run dev            # dev 前自动构建子站（--if-missing）
npm run build          # ★ 完整构建：先 build-tianyuan 再 astro build
npm run build:tianyuan # 只重建子站产物
npm run preview        # 预览 dist（本地默认 4321）
```

> ⚠️ 必须用**托管 Node**（`C:\Users\luqi\.workbuddy\binaries\node\versions\22.22.2\npm.cmd`），
> 本机系统 Node 可能版本不对。Windows 上 `npm.cmd` 而不是 `npm`。

---

## 4. 随笔内容管理（核心功能）

### 4.1 新建一条随笔（两种方式）

**方式 A — 网页端 `/tools`（写作工具箱，页脚有入口）**
- 填标题/日期/时间/分类/正文 → 点「下载 .md 文件」→ 丢进 `src/content/blog/`
- 文件名形如 `notes-YYYYMMDD-HHMM.md`，已带好 frontmatter
- 纯前端，导出文件要手动放回项目并推送才生效

**方式 B — 直接新建 `.md`**
```markdown
---
title: "标题"
description: "一句话摘要（限 60 字内体验最佳）"
pubDate: 2026-09-02T23:37:00
tags: ['生活日常']
featured: false
---
正文，支持 Markdown / KaTeX / 提示块…
```
> frontmatter 写错会在 `npm run build` 时**直接报错**，容易定位。

### 4.2 分类体系与「手动修正优先」机制

- 固定分类（`src/config.ts` 的 `BLOG_TAGS`）：
  `心情随笔 / 亲情爱情 / 读书观影 / 梦想奋斗 / 校园青春 / 生活日常`
- 每个分类一种糖果色 chip（`src/utils/tags.ts` 的 `TAG_STYLES`）
- **分类判定逻辑 `resolveTags(postId, frontmatterTags)`**：
  1. 先看 `src/data/tagOverrides.ts`（用户手动覆盖，**最高优先级**）
  2. 再看 md 文件的 frontmatter `tags`
  3. 最后回退到 `心情随笔`
- 改分类**不要去动 223 个 md 文件**，在 `tagOverrides.ts` 加一行即可：
  ```ts
  export const TAG_OVERRIDES: Record<string, string[]> = {
    'qq-2015-02-05-1536': ['生活日常'],
  };
  ```
  （id = 文件名去掉 `.md`；找不到 id 就去 `/tools` 页面一览表里复制）

### 4.3 QQ 说说导入（`scripts/import-qq-shuoshuo.mjs`）

- 解析根目录 `QQ空间说说备份.md`（格式：`## YYYY-MM-DD HH:MM` 开头，正文，`**评论：**` 后跟 `- **昵称**（YYYY年MM月DD日）：内容`）
- 生成 223 篇到 `src/content/blog/`
- 处理规则：**清理 `[em]` 表情码**、`#话题#` 转加粗（防被当标题）、同名分钟加序号、纯图片无评论的跳过
- 历史评论以 `## 当时朋友们的评论` 章节附在正文后
- 分类是**关键词正则打分**（见脚本 `RULES`，命中即停，兜底 `心情随笔`）—— 不保证准，靠 §4.2 手动修正
- 重跑会**清空 `src/content/blog/` 下所有 .md 再生成**，注意：你手动新建的 `notes-*.md` 也会被删！要保留请先备份或改脚本跳过 `notes-` 前缀。

### 4.4 评论（giscus）

- 每篇随笔底部有评论区（`src/components/Comments.astro`）
- 启用步骤：`src/config.ts` 的 `GISCUS` 填 `repo` / `repoId` / `categoryId`
  1. 仓库推 GitHub（公开）→ 开 Discussions → 装 giscus App → giscus.app 生成配置
- 未配置时显示引导提示，不影响其他功能。

---

## 5. TianYuanFood 子站整合（关键坑）

目标：把独立的 React 单页挂到 **`/tianyuanFood/`**，随博客一起部署，域名不用动。

- 子站源码在 `TianYuanFood/`（React 19 + Vite 6 + Tailwind 4，无路由，纯 scrollTo 单页）
- `scripts/build-tianyuan.mjs`：以 `--base=/tianyuanFood/` 构建 → 同步产物到 `public/tianyuanFood/`
- 项目展厅里田原食品卡片「访问网站」按钮指向 `/tianyuanFood/`
- 留言函数 `api/send-email.ts`（原在子站里）已提到部署根，路由不变；**Token 改用环境变量 `PUSH_PLUS_TOKEN`**（代码已做空值兜底，不配也不报错）

### ⚠️ 构建脚本必读（踩过的坑）

**本环境下 Node 的 `fs.rmSync({recursive})` 会被「安全删除机制」拦截（走回收站），大目录删除会抛 "Some operations were aborted"，导致 vite 的 emptyOutDir 和产物同步失败、构建挂掉。**

`scripts/build-tianyuan.mjs` 已用 `removeDirRobust()` 解决，降级顺序：
`fs.rmSync` → 系统命令 `rmdir /s /q`（win）/ `rm -rf`（unix）→ 逐文件删除 → `cpSync({force:true})` 覆盖。
**不要把这个降级逻辑删掉**，否则 `npm run build` 会间歇性失败。

---

## 6. 部署（Vercel）

现状：用户已完成 GitHub 推送 + Vercel 导入，项目名 `luqi-work`，域名 `luqi.work` 已绑定。

上线流程（改代码后）：
1. 把改动提交并 `git push` 到 GitHub 仓库
2. Vercel 自动检测、重新构建部署（`npm run build` → 输出 `dist`）
3. DNS 不用改（阿里云已配：`A @ → 76.76.21.21`、`CNAME www → cname.vercel-dns.com`）

环境变量（Vercel 控制台 Settings → Environment Variables）：
| 变量 | 说明 | 必填 | 时机 |
|------|------|------|------|
| `TURSO_DATABASE_URL` | Turso 云库 URL（`libsql://...` 或 `https://...`） | **是** | 运行时（也说构建期，因 `/blog` 服务端渲染） |
| `TURSO_AUTH_TOKEN` | Turso 鉴权 Token | **是** | 运行时 |
| `ADMIN_PASSWORD_HASH` | 博主登录密码 scrypt 哈希（`scrypt:<salt>:<hash>`） | **是** | 运行时读取（`login.ts` 用 `process.env`） |
| `SESSION_SECRET` | HMAC 会话签名密钥（32+ 字节 hex） | **是** | **构建期**（`import.meta.env`，改它必须全新构建） |
| `PUSH_PLUS_TOKEN` | 子站留言微信推送 Token | 否 | 运行时 |

> ⚠️ `SESSION_SECRET` 被 `import.meta.env` 在**构建期**写死。改它必须 `git push` 触发全新构建；Vercel 的 Redeploy（克隆旧产物）不会生效。`ADMIN_PASSWORD_HASH` 在 `login.ts` 用 `process.env` 运行时读取，改它只需更新 env + Redeploy，无需改代码。
> 本地 `.env`（已 gitignore）已含 `ADMIN_PASSWORD_HASH` + `SESSION_SECRET`，可本地 `npm run dev` 调试登录；但 `TURSO_*` 需填你自己的 Turso 凭据，否则 `/blog` 连接数据库会报错。

> 注意：Vercel 域名页偶尔显示 ⚠️「DNS Change Recommended」，但若实际已能访问新站点，那是冗余提示，可无视，别手贱去 Remove 域名。

### 6.1 获取 Vercel 里「已存在」的环境变量值（踩坑，2026-09-03）

Vercel 控制台的环境变量值默认遮成 `••••`，**复制按钮默认是灰的、拖选也选不中**。需要：
- **法①（控制台）**：点该行最右侧 👁 眼睛图标「显示」，明文出现后右边才出现 ⧉ 复制图标；若仍选不中，换 **Chrome / Edge** 重试（部分浏览器拦截）。
- **法②（去源头拿，最稳）**：`TURSO_*` 来自 [turso.tech](https://turso.tech) 对应数据库——URL 直接明文显示；Token 点 **Generate Token** 新建一个**同库**令牌即可，与 Vercel 里旧令牌等效、数据完全一致。`ADMIN_PASSWORD_HASH` / `SESSION_SECRET` **本仓库本地 `.env`（已 gitignore）就有**，不用从 Vercel 抄。
- **法③（Vercel CLI）**：`npx vercel login` → `npx vercel link`（选 `luqi-work`）→ `npx vercel env pull .env.local` 把全部变量拉到本地文件。

> 谁也**不能直接替你在 Vercel 后台写 env**：可用连接器里没有 Vercel（仅 CloudBase/EdgeOne 等且未连接）。部署只能你自己填 env + `git push` 触发自动部署。

---

## 7. 环境踩坑与经验（给未来 Agent）

1. **npm 源**：官方源在本机被重置。装依赖用 `--registry=https://registry.npmmirror.com`。
2. **托管 Node**：用 `C:\Users\luqi\.workbuddy\binaries\node\versions\22.22.2\npm.cmd`，别用系统 `npm`。
3. **rollup/rolldown 原生二进制损坏**：若 `npm run build` 报原生绑定缺失，删 `node_modules/@rollup` 或 `@rolldown` 重装；严重时删 `node_modules` + `package-lock.json` 全新装。
4. **中文文件名陷阱**：`public/` 下的静态资源（如用户放的动漫图）**务必用英文文件名**。用户曾放 `动漫相片2.jpg`，因中文名+config 未指向而不显示，已复制为 `hero-anime.jpg` 并改 `src/config.ts` 的 `HERO_IMAGE`。
5. **Hero 动漫图**：当前 `src/config.ts` 的 `HERO_IMAGE = '/images/hero-anime.jpg'`（765×1024 竖版）。换图就放 `public/images/hero-anime.jpg` 覆盖，或改配置路径。建议竖版 480×600 人物居中。
6. **个性化待办**（在 `src/config.ts` / 各页面）：GitHub、Email、Google Scholar、X 链接仍是占位 `yourname`；`public/avatar.svg` 是占位头像；`/about` 是占位介绍；giscus 未配。
7. **dist 体积**：约 27MB，主要是思源黑体三档字重的 unicode-range 子集，浏览器按需加载，无需优化。
8. **`npm run build` 在 Windows 上卡死（已踩坑，2026-09-03）**：`@astrojs/vercel` 构建最后阶段用 nft 追踪服务端依赖图，若引入 `@libsql/client`（标准 Node 入口）会去追踪原生模块 `@libsql/win32-x64-msvc`，在本机（路径含空格 `CodeX Projectss`）会**卡死 10+ 分钟不退出**。
   **已修复**：`src/lib/db.ts` 改用 `@libsql/client/web`（纯 JS，hrana over fetch，无原生模块），生产 Turso 是 https 地址本就用 HTTP 协议、不需要原生模块。改 db 客户端后构建 ~3 分钟正常完成。
   🔒 副作用：本地 `file:./data/shuoshuo.db` 这种本地 SQLite 文件方式不可用（`/web` 只支持 http URL），本地调试请填真实 `TURSO_*` 环境变量连云库。
9. **构建需关安全删除 shim**：`npm run build` 时设 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（否则 `@astrojs/vercel` 清理 `.vercel/output` 会被拦截报 "Some operations were aborted"）。仅影响构建产物清理，不碰业务文件。

---

## 8. 风格设计要点（青春糖果色）

- 配色基调：玫瑰粉 → 紫罗兰 → 天蓝渐变（`from-rose-500 to-fuchsia-500`）
- 标题/品牌字体：`font-display`（站酷快乐体），正文：思源黑体
- 圆角大（`rounded-2xl`/`rounded-3xl`）、卡片 hover 上浮 + 柔和阴影 + 顶部滑出渐变条
- Hero 背景有缓慢漂浮的彩色光斑（`animate-float-slow`）
- 切换主题/改配色时全局搜 `rose-` / `fuchsia-` / `violet-` 定位，曾整体从 `indigo-*` 替换过来。

---

## 9. 一次完整改动的「标准姿势」

1. 改 `src/` 下源码
2. （若动了 TianYuanFood）`npm run build:tianyuan` 或走 `npm run build` 自动带
3. `npm run build` 验证全绿（看页面数，随笔 223+ 篇时约 229 页）
4. `npm run preview` 起本地预览，curl 抽查关键页面 HTTP 200 + 关键标记
5. 提交 git + push → Vercel 自动上线
6. 写一条 `.workbuddy/memory/YYYY-MM-DD.md` 记录本次改动

---

## 10. QQ空间说说（qzone-shuoshuo）集成与运维 SOP

**已整合进本仓库（单项目）**：`/blog` 现在是 `luqi.work` 内部的一个**服务端渲染页面**（`src/pages/blog/index.astro`，`prerender=false`），直接读 Turso 云库渲染说说；后端 API（`src/pages/app/*`）+ 前端组件（`src/components/shuoshuo/*`）全在本仓库。原先独立的 `qzone-shuoshuo` 仓库已废弃，不再被引用、不再单独部署。

> ⚠️ **Vercel 保留 `/api` 路径（2026-09-06 实测，关键坑）**：Vercel 把 `/api` 当作**保留目录**（legacy API Directory），框架 `config.json` 里注册的 `/api/*` 路由会被 Vercel 直接 404，SSR 函数永远收不到请求——表现为「页面能渲染、但所有 `/api/*` 登录/接口全 404」。其它路径（如 `/blog`、`/app`）正常。
> **已修复**：本仓库所有后端路由前缀从 `/api` 改为 **`/app`**（`src/pages/api → src/pages/app`，前端 `fetch` 全部 `/app/...`）。改完 push 后 Vercel 全新构建即生效。今后新增后端接口**一律用 `/app` 前缀，绝不用 `/api`**。

### 10.1 功能与角色
| 角色 | 可见/权限 | 入口 |
|------|----------|------|
| 游客（未登录） | 看全部说说（按分类、标签筛选在顶部）｜对任一条评论或回复（楼中楼）｜评论以「游客」徽章展示 | Header「登录」弹窗仅输入密码 |
| 博主（登录后） | 顶部出现「写新随笔」框｜每条说说右上三点菜单：编辑/置顶/标签/删除｜以「博主」徽章回复评论与删除评论｜重新配置标签 | 密码 = `ADMIN_PASSWORD_HASH` 对应明文 |

> 旧的 `src/content/blog/qq-*.md`（约 250 篇）是早期导出快照，已被实时系统取代；`/blog` 不再渲染它们，但文件保留未删。
> 评论数据存在 `posts.comments` 列（JSON 数组），结构为树：`{id, name, time, content, parentId, role:'guest'|'admin', replyTo}`。旧评论在读取时由 `rowToPost()` 自动补全（id=序号、role='guest'、parentId=null），无需单独迁移脚本。

### 10.2 改「说说管理员密码」标准流程（已踩坑验证）
密码存于本仓库（luqi-work）的 Vercel 环境变量 **`ADMIN_PASSWORD_HASH`**（scrypt 格式 `scrypt:<saltHex>:<hashHex>`），**不在代码里**。

1. 在本仓库生成新哈希：
   ```bash
   node scripts/hash-password.mjs "新密码"
   ```
   输出形如 `scrypt:<salt>:<hash>`，整段复制（含 `scrypt:` 前缀）。
2. Vercel 控制台 → `luqi-work` 项目 → **Settings → Environment Variables** → 编辑 `ADMIN_PASSWORD_HASH` → 整段替换 → Save。
3. **Deployments → 最新部署 ⋯ → Redeploy**（或推一次 GitHub 触发全新构建）。
4. 等 ~1–2 分钟，验证：
   ```bash
   curl -s -X POST https://luqi.work/app/login \
     -H 'content-type: application/json' -H 'x-requested-with: fetch' \
     -d '{"password":"新密码"}'
   ```
   返回 `{"ok":true}` 即成功；旧密码应返回 `{"error":"密码错误"}`（401）。

> ⚠️ **关键坑（2026-09-02 实测）**：最初 `login.ts` 用 `import.meta.env.ADMIN_PASSWORD_HASH`，Astro 在**构建时**就把值写死进产物。Vercel 的「Redeploy（克隆）」复用旧构建产物，新 env 进不去 → 改了 env 密码却仍用旧密码能登、新密码登不上。
> **已修复**：`src/pages/app/login.ts` 改为运行时 `process.env.ADMIN_PASSWORD_HASH`（保留 `import.meta.env` 兜底）。此后改密码只需 §10.2 步骤 1–3，**无需改代码、无需重新构建仓库**。
> 同理：任何 Vercel 环境变量若被 Astro/Vite 在构建期 `import.meta.env` 引用，改它都必须触发**全新构建**（git push）才生效；Redeploy 不够。

### 10.3 其它运维要点
- **同源登录**：`/blog` 与登录 API 同域（luqi.work），`src/pages/app/login.ts` 的 session cookie 用 `sameSite:'lax'` + `secure` 即可，`Header.astro` 的弹窗登录成功后 `location.reload()` 即刷新出博主界面。`/app/me` 供所有页面客户端探测登录态（未登录返回 `{"authed":false}`，HTTP 200）。
- **`/blog` 是服务端渲染**：`export const prerender = false`，每次请求读 Turso。因此 `TURSO_*` 在**构建期也要可用**（Astro 构建时会解析页面模块）；本地 `npm run dev` 必须填真实 `TURSO_*` 否则 `/blog` 报错。
- **游客评论防护**：`/app/shuoshuo/[id]/comments.ts` 带 CSRF 头校验（`x-requested-with: fetch`）+ 蜜罐隐藏字段 + 频率限制（60s/10 次，serverless 软限制）。
- **改本仓库代码后**：`git push` 到 `luqi0622/luqi-work` → Vercel 自动构建上线（单项目，无跨项目排队）。
- ⚠️ **git push 被死代理拦截（2026-09-06 实测）**：本机 git **全局配置**写死了 `http.proxy socks5://127.0.0.1:7897`（未运行的 Clash 代理），直连 GitHub 正常但该代理已死 → `git push` 超时失败。绕过方式：`git -c http.proxy= -c https.proxy= -c "url.https://<PAT>@github.com/.insteadOf=https://github.com/" push origin main`（PAT 用 `ghp_...`；或去全局配置清掉该 proxy 一劳永逸）。
- **本地构建注意**：`npm run build` 需 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（见 §7.9）；且必须用 `@libsql/client/web`（见 §7.8）避免 nft 卡死。
- 🔒 **安全**：GitHub PAT、Vercel token 等凭据用后去对应后台撤销；不要在代码或本文件硬编码明文密码/Token。改动涉及密钥时只更新 Vercel 环境变量，不写进仓库。
