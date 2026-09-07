import type { APIRoute } from 'astro';
import { toggleReaction } from '../../../lib/queries';

export const prerender = false;

// 轻量频率限制（serverless 多实例下为软限制）
const WINDOW_MS = 60_000;
const LIMIT = 30;
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

const VID_COOKIE = 'vid';
const VID_MAX_AGE = 365 * 24 * 3600;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * POST /app/reactions
 * body: { postId: number, kind: string }  —— kind 为任意表情字符（如 '❤️'、'☕'）
 * 匿名访客身份用 vid cookie（随机串，非个人信息），首次表态时自动下发。
 * 同一访客重复提交同一表情 = 取消。
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (request.headers.get('x-requested-with') !== 'fetch') {
    return json({ error: '缺少 CSRF 头' }, 400);
  }

  let body: { postId?: unknown; kind?: unknown };
  try {
    body = (await request.json()) as { postId?: unknown; kind?: unknown };
  } catch {
    body = {};
  }

  const postId = Number(body.postId);
  if (!Number.isInteger(postId) || postId <= 0) return json({ error: '无效的 postId' }, 400);
  // emoji 作为 kind：非空、长度 <= 8（一个 emoji 通常 1–2 个码元，留足余量），且不含空白/控制字符
  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  if (kind.length === 0 || kind.length > 8 || /\s/.test(kind)) {
    return json({ error: '无效的表情' }, 400);
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
  if (!rateOk(`r:${ip}`)) return json({ error: '操作太频繁，请稍后再试' }, 429);

  // 匿名访客标识：优先复用现有 cookie，没有则生成
  let vid = cookies.get(VID_COOKIE)?.value;
  if (!vid || vid.length < 8) {
    vid = `v_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  try {
    const result = await toggleReaction(postId, kind, vid);
    cookies.set(VID_COOKIE, vid, {
      httpOnly: false, // 客户端无需读取；但便于调试与迁移
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      path: '/',
      maxAge: VID_MAX_AGE,
    });
    return json({ ok: true, active: result.active, counts: result.counts });
  } catch (e) {
    console.error('[reactions] 失败：', e);
    return json({ error: '表态失败，请稍后再试' }, 500);
  }
};
