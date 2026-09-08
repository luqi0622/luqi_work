import type { APIRoute } from 'astro';
import { updatePost, softDeletePost, restorePost, setPostTags, getPostTags } from '../../../../lib/queries';

export const prerender = false;

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

type Body = {
  content?: unknown;
  pinned?: unknown;
  isPrivate?: unknown;
  tagNames?: unknown;
};

async function parseBody(request: Request): Promise<Body> {
  try {
    return (await request.json()) as Body;
  } catch {
    return {};
  }
}

/** 编辑正文 / 置顶切换 / 保存标签 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest('无效的 id');
  if (request.headers.get('x-requested-with') !== 'fetch') return badRequest('缺少 CSRF 头');

  const body = await parseBody(request);
  let updated = false;

  if (body.content !== undefined) {
    if (typeof body.content !== 'string') return badRequest('content 必须为字符串');
    updated = (await updatePost(id, { content: body.content })) || updated;
  }

  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'number' || ![0, 1].includes(body.pinned)) return badRequest('pinned 必须为 0 或 1');
    updated = (await updatePost(id, { pinned: body.pinned })) || updated;
  }

  if (body.isPrivate !== undefined) {
    if (typeof body.isPrivate !== 'number' || ![0, 1].includes(body.isPrivate)) return badRequest('isPrivate 必须为 0 或 1');
    updated = (await updatePost(id, { isPrivate: body.isPrivate })) || updated;
  }

  if (body.tagNames !== undefined) {
    if (!Array.isArray(body.tagNames) || body.tagNames.some((n) => typeof n !== 'string')) {
      return badRequest('tagNames 必须为字符串数组');
    }
    await setPostTags(id, body.tagNames as string[]);
    // 回传保存后的标签，前端可就地更新卡片（避免整页刷新导致丢失滚动位置/已加载内容）
    const tags = await getPostTags(id);
    return new Response(JSON.stringify({ ok: true, tags }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!updated) return badRequest('没有可更新的字段');
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};

/** 软删除 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest('无效的 id');
  if (request.headers.get('x-requested-with') !== 'fetch') return badRequest('缺少 CSRF 头');
  const ok = await softDeletePost(id);
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
};

/** 恢复 */
export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest('无效的 id');
  if (request.headers.get('x-requested-with') !== 'fetch') return badRequest('缺少 CSRF 头');
  const ok = await restorePost(id);
  return new Response(JSON.stringify({ ok }), {
    status: ok ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  });
};
