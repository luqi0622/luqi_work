import type { APIRoute } from 'astro';
import { checkAuth } from '../../lib/auth';

export const prerender = false;

/** 返回当前登录态，供前端判断显示游客 / 博主界面 */
export const GET: APIRoute = async ({ cookies }) => {
  const secret = import.meta.env.SESSION_SECRET ?? '';
  const authed = checkAuth(cookies.get('session')?.value, secret);
  return new Response(JSON.stringify({ authed }), {
    headers: { 'content-type': 'application/json' },
  });
};
