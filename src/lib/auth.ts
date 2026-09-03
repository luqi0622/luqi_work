import crypto from 'node:crypto';

/** 校验登录密码（哈希格式：scrypt:<saltHex>:<hashHex>） */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** 生成无状态 session token：base64url(payload).base64url(HMAC-SHA256) */
export function createSessionToken(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + WEEK_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** 判断一个 session cookie 值是否有效（供页面判断登录态用） */
export function checkAuth(token: string | undefined | null, secret: string): boolean {
  if (!token || !secret) return false;
  return verifySessionToken(token, secret);
}

export function verifySessionToken(token: string, secret: string): boolean {
  const idx = token.indexOf('.');
  if (idx <= 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let expected: Buffer;
  try {
    expected = crypto.createHmac('sha256', secret).update(payload).digest();
  } catch {
    return false;
  }
  const actual = Buffer.from(sig, 'base64url');
  if (expected.length !== actual.length) return false;
  if (!crypto.timingSafeEqual(expected, actual)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}
