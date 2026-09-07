/**
 * 极简 Markdown 渲染（说说正文用）
 * 设计原则：先整体 HTML 转义，再做 Markdown 语法替换 —— 因此不会引入 XSS。
 * 支持：标题、粗体、斜体、删除线、行内代码、代码块、链接、图片、引用、无序/有序列表、分割线、换行。
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/** 只放行安全协议，挡掉 javascript: / data: 等 */
function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  if (/^(https?:\/\/|\/|mailto:|tel:|#)/i.test(u)) return u;
  return null;
}

/** 行内语法：代码 → 图片 → 链接 → 粗体/斜体/删除线 → 裸链接自动识别 */
function renderInline(raw: string): string {
  const stash: string[] = [];
  const keep = (html: string) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  // 先转义，再做语法替换 —— 保证输出安全
  let s = escapeHtml(raw);

  // 行内代码
  s = s.replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`));

  // 图片 ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    return keep(`<img src="${safe}" alt="${alt}" loading="lazy" decoding="async" />`);
  });

  // 链接 [text](url)
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    const external = /^https?:\/\//i.test(safe);
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return keep(`<a href="${safe}"${rel}>${text || safe}</a>`);
  });

  // 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 裸链接自动识别（此时 stash 里的真实标签还未回填，不会互相污染）
  s = s.replace(/(https?:\/\/[^\s<>，。）】"']+)/g, (m) =>
    keep(`<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`)
  );

  // 回填占位
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => stash[Number(i)] ?? '');
}

/** 块级语法 + 段落 */
export function renderMarkdown(src: string): string {
  if (!src) return '';
  // 注意：块级判定必须在「未转义」的原文上做（否则 > 会变成 &gt; 而识别不到引用）
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length) {
      out.push(`<p>${buf.join('<br />')}</p>`);
      buf.length = 0;
    }
  };

  const para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (/^\s*```/.test(line)) {
      flushParagraph(para);
      const lang = line.replace(/^\s*```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // 跳过收尾 ```
      const cls = lang ? ` class="language-${lang.replace(/[^\w-]/g, '')}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 空行 → 段落分隔
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const level = Math.min(h[1].length + 2, 6); // # → h3，避免抢页面 h1/h2
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr />');
      i++;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderInline(buf.join('<br />'))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(renderInline(lines[i++].replace(/^\s*[-*+]\s+/, '')));
      }
      out.push(`<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(renderInline(lines[i++].replace(/^\s*\d+[.)]\s+/, '')));
      }
      out.push(`<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`);
      continue;
    }

    para.push(renderInline(line));
    i++;
  }
  flushParagraph(para);

  return out.join('\n');
}

/** 去掉 Markdown 标记，用于摘要 / 页面描述 */
export function stripMarkdown(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
