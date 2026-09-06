import type { APIRoute } from 'astro';
import { addComment } from '../../../../lib/queries';

export const prerender = false;

// 轻量频率限制（serverless 多实例下为软限制，仅作基础威慑）
const WINDOW_MS = 60_000;
const LIMIT = 10;
const hits = new Map<string, number[]>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export const POST: APIRoute = async ({ params, request }) => {
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return new Response(JSON.stringify({ error: '缺少 CSRF 头' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ error: '无效的 id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body: { name?: unknown; content?: unknown; parentId?: unknown; replyTo?: unknown; hp?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; content?: unknown; parentId?: unknown; replyTo?: unknown; hp?: unknown };
  } catch {
    body = {};
  }

  // 蜜罐：机器人才会填的隐藏字段，命中则假装成功但直接丢弃
  if (body.hp) {
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  }

  // 游客评论一律匿名展示（前端已移除昵称输入），后端不再校验昵称
  const name = '匿名';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (content.length < 1 || content.length > 500) {
    return new Response(JSON.stringify({ error: '评论需 1–500 字' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  // 楼中楼：parentId 为被回复评论 id，replyTo 为被回复者昵称
  const parentId = typeof body.parentId === 'number' && body.parentId > 0 ? body.parentId : null;
  const replyTo = typeof body.replyTo === 'string' && body.replyTo.trim() ? body.replyTo.trim() : null;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!rateOk(ip)) {
    return new Response(JSON.stringify({ error: '评论太频繁，请稍后再试' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 游客评论统一以「游客」角色写入
  const ok = await addComment(id, { name, content, parentId, role: 'guest', replyTo });
  if (!ok) {
    return new Response(JSON.stringify({ error: '说说不存在' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
