import { TAG_OVERRIDES } from '@/data/tagOverrides';

/**
 * 随笔分类标签的配色方案
 * 统一收束在「科技蓝」色族（brand / sky / indigo / cyan）+ 中性灰，
 * 避免出现第 4 种主色：全站主色 = 蓝（#2563EB）+ 中性灰 + 琥珀（仅状态标记）。
 */
export const TAG_STYLES: Record<string, string> = {
  心情随笔:
    'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-300',
  亲情爱情:
    'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300',
  读书观影:
    'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300',
  梦想奋斗:
    'border-brand-300 bg-brand-100/70 text-brand-800 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-300',
  校园青春:
    'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300',
  生活日常:
    'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-600/40 dark:bg-zinc-700/20 dark:text-zinc-300',
};

const FALLBACK =
  'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400';

export function tagStyle(tag: string): string {
  return TAG_STYLES[tag] ?? FALLBACK;
}

/**
 * 取得文章最终分类：优先用 src/data/tagOverrides.ts 里的手动修正，
 * 没有手动修正时用 md frontmatter 里的自动分类。
 */
export function resolveTags(postId: string, frontmatterTags: string[]): string[] {
  const override = TAG_OVERRIDES[postId];
  if (override && override.length > 0) return override;
  return frontmatterTags ?? [];
}
