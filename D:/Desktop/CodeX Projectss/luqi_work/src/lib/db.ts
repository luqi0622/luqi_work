// 使用 /web 纯 JS 客户端（hrana over fetch，无原生模块）。
// 这样 Vercel 构建时 nft 不会追踪 @libsql/win32-x64-msvc 原生依赖（会卡死 Windows 构建）。
// 生产环境 url 为 Turso 的 https 地址，/web 客户端完全支持。
import { createClient } from '@libsql/client/web';

const dbUrl = import.meta.env.TURSO_DATABASE_URL;
const dbToken = import.meta.env.TURSO_AUTH_TOKEN;

if (!dbUrl) {
  console.warn('[db] 未设置 TURSO_DATABASE_URL，说说后端将无法连接数据库。生产/本地开发请配置 Turso 环境变量。');
}

export const db = createClient({
  url: dbUrl || 'https://placeholder.libsql.turso.io',
  authToken: dbToken || undefined,
});
