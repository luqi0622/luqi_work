import { TAG_OVERRIDES } from '@/data/tagOverrides';

/**
 * 随笔分类标签的配色方案 —— 青春糖果色系
 * 每个分类一种颜色，用于 PostCard / 文章页 / 筛选栏的 tag chips
 */
export const TAG_STYLES: Record<string, string> = {
  心情随笔:
    'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-300',
  亲情爱情:
    'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300',
  读书观影:
    'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  梦想奋斗:
    'border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300',
  校园青春:
    'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300',
  生活日常:
    'border-teal-200 bg-teal-50 text-teal-600 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-300',
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
