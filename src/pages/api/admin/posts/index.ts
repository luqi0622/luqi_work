import type { APIRoute } from 'astro';
import { createPost } from '../../../../lib/queries';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    body = {};
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400, headers: { 'content-type': 'application/json' } });
  if (content.length > 2000) return new Response(JSON.stringify({ error: '内容过长（上限 2000 字）' }), { status: 400, headers: { 'content-type': 'application/json' } });

  const id = await createPost(content);
  return new Response(JSON.stringify({ ok: true, id }), {
    headers: { 'content-type': 'application/json' },
  });
};
