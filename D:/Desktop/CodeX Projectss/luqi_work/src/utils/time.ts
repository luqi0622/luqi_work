/** 按北京时间（UTC+8）格式化为 YYYY-MM-DD HH:mm，不依赖服务器时区 */
export function formatBeijing(t: number): string {
  const d = new Date((t + 8 * 3600) * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** 当前北京时间的 YYYY-MM-DD HH:mm（新评论时间戳用） */
export function nowBeijing(): string {
  return formatBeijing(Math.floor(Date.now() / 1000));
}
