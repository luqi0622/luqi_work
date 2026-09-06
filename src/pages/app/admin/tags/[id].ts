import type { APIRoute } from 'astro';
import { deleteTag } from '../../../../lib/queries';

export const prerender = false;

/** 删除标签及其全部关联 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: '无效的 id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  await deleteTag(id);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
