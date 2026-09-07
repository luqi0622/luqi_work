/** 随笔与项目共用的工具函数 */

/** 计算阅读时间：中文按 ~400 字/分钟，英文按 ~200 词/分钟 */
export function readingTime(text: string): number {
  // 去掉代码块，避免代码膨胀统计
  const plain = text.replace(/```[\s\S]*?```/g, ' ');
  const cjkChars = (plain.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
  const words = (plain.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g, ' ').match(/[a-zA-Z0-9]+/g) ?? []).length;
  const minutes = cjkChars / 400 + words / 200;
  return Math.max(1, Math.round(minutes));
}

/** 日期格式化：2026年8月30日 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 日期格式化（短格式）：2026-08-30 */
export function formatDateShort(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 项目状态标签映射 */
export const PROJECT_STATUS: Record<string, { label: string; class: string }> = {
  live: { label: '已上线', class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900' },
  opensource: { label: '开源', class: 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400 border-brand-200 dark:border-brand-900' },
  experimental: { label: '实验性', class: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-900' },
  wip: { label: '开发中', class: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700' },
};
