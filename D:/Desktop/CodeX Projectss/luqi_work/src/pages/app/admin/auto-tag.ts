import type { APIRoute } from 'astro';
import { autoTagAllPosts } from '../../../lib/queries';
import { checkAuth } from '../../../lib/auth';

export const prerender = false;

/**
 * 一键给全部说说自动归类（博主专用）。
 * 仅打「主分类」标签，归完类后可在每条说说的「标签」菜单里微调或追加。
 * 幂等：重复调用会先清空旧标签再重打，不会重复累积。
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const secret = import.meta.env.SESSION_SECRET ?? '';
  if (!checkAuth(cookies.get('session')?.value, secret)) {
    return new Response(JSON.stringify({ error: '未登录' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  try {
    const result = await autoTagAllPosts();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
