import { defineMiddleware } from 'astro:middleware';
import { verifySessionToken } from './lib/auth';

/** 保护 /admin（除登录页）与 /app/admin/* */
export const onRequest = defineMiddleware((context, next) => {
  const path = context.url.pathname;
  const isAdminPage = path.startsWith('/admin') && path !== '/admin/login';
  const isAdminApi = path.startsWith('/app/admin');
  if (!isAdminPage && !isAdminApi) return next();

  const token = context.cookies.get('session')?.value ?? '';
  const secret = import.meta.env.SESSION_SECRET ?? '';
  if (token && secret && verifySessionToken(token, secret)) return next();

  if (isAdminApi) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  // 管理已整合进 /blog 前台（登录按钮在 Header），未登录访问 /admin 跳回博客
  return context.redirect('/blog');
});
