import type { APIRoute } from 'astro';
import { addComment, deleteComment } from '../../../lib/queries';

export const prerender = false;

/** 博主以「博主」身份回复评论（多级楼中楼） */
export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  let body: { postId?: unknown; content?: unknown; parentId?: unknown; replyTo?: unknown };
  try {
    body = (await request.json()) as { postId?: unknown; content?: unknown; parentId?: unknown; replyTo?: unknown };
  } catch {
    body = {};
  }
  const postId = Number(body.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    return new Response(JSON.stringify({ error: '无效的 postId' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return new Response(JSON.stringify({ error: '内容不能为空' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (content.length > 500) {
    return new Response(JSON.stringify({ error: '内容过长（上限 500 字）' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const parentId = typeof body.parentId === 'number' && body.parentId > 0 ? body.parentId : null;
  const replyTo = typeof body.replyTo === 'string' && body.replyTo.trim() ? body.replyTo.trim() : null;
  const ok = await addComment(postId, { name: '博主', content, parentId, role: 'admin', replyTo });
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
};

/** 删除评论及其全部子回复 */
export const DELETE: APIRoute = async ({ request }) => {
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  let body: { postId?: unknown; commentId?: unknown };
  try {
    body = (await request.json()) as { postId?: unknown; commentId?: unknown };
  } catch {
    body = {};
  }
  const postId = Number(body.postId);
  if (!Number.isInteger(postId) || postId <= 0) {
    return new Response(JSON.stringify({ error: '无效的 postId' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const commentId = typeof body.commentId === 'number' ? body.commentId : undefined;
  if (commentId === undefined) {
    return new Response(JSON.stringify({ error: '缺少评论标识' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const ok = await deleteComment(postId, { commentId });
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
};
