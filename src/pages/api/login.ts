import type { APIRoute } from 'astro';
import { verifyPassword, createSessionToken } from '../../lib/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  // 运行时读取：改密码只需在 Vercel 后台更新 ADMIN_PASSWORD_HASH 并重新部署，无需重新构建代码
  const hash = process.env.ADMIN_PASSWORD_HASH ?? import.meta.env.ADMIN_PASSWORD_HASH ?? '';
  const secret = import.meta.env.SESSION_SECRET ?? '';
  if (!hash || !secret) {
    return new Response(JSON.stringify({ error: '服务端未配置管理密码' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  let password = '';
  try {
    const body = await request.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    /* ignore */
  }

  if (!password || !verifyPassword(password, hash)) {
    return new Response(JSON.stringify({ error: '密码错误' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  cookies.set('session', createSessionToken(secret), {
    httpOnly: true,
    // 同源（luqi.work 内嵌，已无跨域 iframe），lax 即可保留登录态
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 7 * 24 * 3600,
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
