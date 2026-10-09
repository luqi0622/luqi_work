/**
 * MOS 管级电路图 —— SVG 渲染与导出
 *
 * ## 屏幕与导出共用同一个渲染器
 *
 * 两条路径调用**同一批** `compSegs` / `wirePts` / `compLabels`，
 * 只差最外层 transform 和「样式写 presentation attribute 还是 CSS 变量」。
 * 这样「屏上对齐、导出错位」这类问题从结构上就不可能发生。
 *
 * ## 坐标系显式分离
 *
 * 屏幕：包在 `<g transform="translate(panX,panY) scale(zoom)">` 里
 * 导出：不包 transform，`viewBox` = `boundsOf(doc)`，坐标直接是世界坐标
 *
 * ## 导出自包含（硬性要求）
 *
 * 产物里**不得出现 `<style>` / `class=` / 外部引用**。
 * 所有颜色 token 在导出时解析为实际 hex，线型写成 `stroke-dasharray`。
 * 这样 .svg 拖进 PowerPoint / Word / Illustrator 不会变成一团黑。
 */

import {
  type ColorToken,
  type CompKind,
  type DiagResult,
  type MosComp,
  type MosDoc,
  type PaletteKind,
  type Rect,
  type StrokeStyle,
  type TextNote,
  type View,
  type Wire,
  DASH_PATTERNS,
  GRID,
  isMos,
} from './types';
import { compBBox, compLabels, compSegs, compTransform, portNames, portWorld, SYM } from './symbols';
import { boundsOf, estimateTextWidth, wirePts } from './geometry';
import { dashArray } from './model';

// ============================================================================
// 颜色解析
// ============================================================================

/** 颜色 token → 实际色值。亮色主题 */
export const LIGHT_COLORS: Record<ColorToken, string> = {
  ink: '#18181b',
  muted: '#71717a',
  accent: '#185fa5',
  red: '#c0362c',
  green: '#15803d',
  blue: '#1d4ed8',
  orange: '#c2620a',
};

/** 暗色主题 */
export const DARK_COLORS: Record<ColorToken, string> = {
  ink: '#e4e4e7',
  muted: '#a1a1aa',
  accent: '#7cc0f0',
  red: '#f87171',
  green: '#4ade80',
  blue: '#93b4fd',
  orange: '#fbbf5c',
};

export interface Palette {
  bg: string;
  grid: string;
  gridMajor: string;
  ink: string;
  muted: string;
  accent: string;
  danger: string;
  select: string;
  guide: string;
}

export const LIGHT_PALETTE: Palette = {
  bg: '#fafafa',
  grid: '#e4e4e7',
  gridMajor: '#cbd5e1',
  ink: '#18181b',
  muted: '#71717a',
  accent: '#185fa5',
  danger: '#c0362c',
  select: '#2563eb',
  guide: '#0891b2',
};

export const DARK_PALETTE: Palette = {
  bg: '#18181b',
  grid: '#27272a',
  gridMajor: '#3f3f46',
  ink: '#e4e4e7',
  muted: '#a1a1aa',
  accent: '#7cc0f0',
  danger: '#f87171',
  select: '#60a5fa',
  guide: '#22d3ee',
};

export function paletteOf(dark: boolean): Palette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE;
}

// ============================================================================
// 渲染选项
// ============================================================================

export interface RenderOpts {
  mode: 'screen' | 'export';
  /** 屏幕模式：视口变换。导出模式忽略 */
  view?: View;
  /** 视口像素尺寸（画布背景网格用） */
  vw?: number;
  vh?: number;
  /** 选中的元件 / 线 / 文本 id */
  selected?: Set<string>;
  /** 悬停高亮的网络根 key */
  hoverNet?: string | null;
  /** 诊断结果。必须先算好再传进来 */
  diag?: DiagResult;
  dark?: boolean;
  /** 导出模式的裁剪范围。缺省用 boundsOf(doc) */
  bounds?: Rect;
  /** 屏幕模式：正在拖拽的连线预览 */
  pending?: { a: { x: number; y: number }; aDir: string; b: { x: number; y: number }; bDir: string } | null;
  /** 屏幕模式：正在拖动的拐点高亮 */
  activeBend?: { wireId: string; idx: number } | null;
  /** 屏幕模式：吸附参考线 */
  guide?: { axis: 'x' | 'y'; v: number } | null;
  /** 屏幕模式：框选矩形 */
  marquee?: Rect | null;
  /**
   * 屏幕模式：从元件库拖出、跟随光标的待放置项（半透明 ghost）。
   * 导出模式忽略 —— ghost 是交互反馈，不该进最终产物。
   */
  placeGhost?: { kind: PaletteKind; x: number; y: number } | null;
  /** 导出模式的像素缩放（PNG 2× 时用） */
  pxScale?: number;
  /** 导出模式的背景色，null = 透明 */
  background?: string | null;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function n(v: number): string {
  // 去掉浮点尾巴，且不制造 -0
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

// ============================================================================
// 单个元件的 SVG 片段
// ============================================================================

interface SegStyle {
  ink: string;
  sw: number;
}

/**
 * 元件 → SVG 片段。
 *
 * 结构：`<g transform="translate/rotate/scale">` 里只放图形，
 * `<text>` 放在组**外面**用世界坐标定位 —— 标注永远水平，绝不跟着转。
 *
 * `screenMode` 为 false（导出）时**不输出** class / data-* / 选中框 / 端口命中圆，
 * 这些只有交互才需要，留在导出产物里既没用又破坏自包含性。
 */
function compSvg(
  c: MosComp,
  s: SegStyleFull,
  selected: boolean,
  floating: boolean,
  screenMode: boolean,
): string {
  const parts: string[] = [];
  const gAttrs = screenMode ? ` class="mc-comp" data-comp="${esc(c.id)}"` : '';
  parts.push(`<g${gAttrs} transform="${compTransform(c)}">`);
  for (const seg of compSegs(c)) {
    if (seg.fill) {
      parts.push(`<path d="${seg.d}" fill="${s.ink}" stroke="none"/>`);
    } else {
      parts.push(
        `<path d="${seg.d}" fill="none" stroke="${s.ink}" stroke-width="${n(sw(seg.sw))}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }
  parts.push('</g>');

  // 透明命中区。
  //
  // **只用描边 path 是不够的** —— MOS 符号是稀疏线条，元件中心（沟道断开处）
  // 根本不落在任何一条笔画上，点中间会穿透到底下，点不中。
  // 加一层覆盖局部 bbox 的透明矩形，指哪是哪。
  if (screenMode) {
    const b = compBBox(c);
    parts.push(
      `<rect class="mc-comp-hit" data-comp="${esc(c.id)}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="transparent" pointer-events="all"/>`,
    );
  }

  // 选中框（世界坐标，不随旋转变形）
  if (selected && screenMode) {
    const b = compBBox(c);
    parts.push(
      `<rect x="${n(b.x - 4)}" y="${n(b.y - 4)}" width="${n(b.w + 8)}" height="${n(b.h + 8)}" fill="none" stroke="${s.sel}" stroke-width="1.5" stroke-dasharray="4 3" rx="2" pointer-events="none"/>`,
    );
  }

  // 悬空端口红圈（导出也保留：这是有价值的自检信息）
  if (floating) {
    for (const name of portNames(c.kind)) {
      if (!s.floatingKeys.has(`${c.id}#${name}`)) continue;
      const p = portWorld(c, name);
      parts.push(
        `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="5" fill="none" stroke="${s.danger}" stroke-width="2"/>`,
      );
    }
  }

  return parts.join('');
}

function sw(mult?: number): number {
  return 2 * (mult ?? 1);
}

// ============================================================================
// 渲染主体
// ============================================================================

interface SegStyleFull extends SegStyle {
  sel: string;
  danger: string;
  muted: string;
  floatingKeys: Set<string>;
}

/**
 * 把整份文档渲染成 SVG **字符串**。
 * 屏幕与导出都用它 —— 屏幕时把结果塞进 innerHTML，导出时直接下载。
 * 这保证两条路径的几何完全一致。
 */
export function renderSvg(doc: MosDoc, opts: RenderOpts): string {
  const dark = opts.dark ?? false;
  const pal = paletteOf(dark);
  const colors = dark ? DARK_COLORS : LIGHT_COLORS;
  const exportMode = opts.mode === 'export';
  const px = opts.pxScale ?? 1;
  const diag = opts.diag;

  // 导出模式：颜色写实际 hex；屏幕模式：CSS 变量（自动跟主题）
  const cInk = exportMode ? colors.ink : 'var(--mc-ink)';
  const cMuted = exportMode ? colors.muted : 'var(--mc-muted)';
  const cSel = exportMode ? pal.select : 'var(--mc-select)';
  const cDanger = exportMode ? pal.danger : 'var(--mc-danger)';
  const cGuide = exportMode ? pal.guide : 'var(--mc-guide)';

  const segStyle: SegStyleFull = {
    ink: cInk,
    sw: 2 * px,
    sel: cSel,
    danger: cDanger,
    muted: cMuted,
    floatingKeys: diag?.floating ?? new Set(),
  };

  const selected = opts.selected ?? new Set<string>();
  const bendHot = opts.activeBend ?? null;
  const parts: string[] = [];

  // ---- 连线（画在元件之下） ----
  for (const w of doc.wires) {
    const pts = wirePts(doc, w);
    if (pts.length < 2) continue;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join('');
    const isSel = selected.has(w.id);
    const col = exportMode ? colors[w.style.color] : `var(--mc-${w.style.color})`;
    const wpx = w.style.width * px;
    const dashing = dashArray(w.style.dash);
    const attrs = [
      'd="' + d + '"',
      'fill="none"',
      `stroke="${isSel ? cSel : col}"`,
      `stroke-width="${n(isSel ? wpx + 1.5 : wpx)}"`,
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    ];
    if (dashing) attrs.push(`stroke-dasharray="${dashing}"`);
    parts.push(
      `<path${exportMode ? '' : ` class="mc-wire" data-wire="${esc(w.id)}"`} ${attrs.join(' ')}/>`,
    );

    if (!exportMode) {
      // 透明粗 hit path：细线太难点中
      parts.push(
        `<path class="mc-wire-hit" data-wire="${esc(w.id)}" d="${d}" fill="none" stroke="transparent" stroke-width="${n(Math.max(14, wpx * 4))}" pointer-events="stroke"/>`,
      );
      // 选中时显示拐点手柄
      if (isSel) {
        wireViaPoints(doc, w).forEach((p, i) => {
          const hot = bendHot && bendHot.wireId === w.id && bendHot.idx === i;
          parts.push(
            `<rect class="mc-bend" data-wire="${esc(w.id)}" data-idx="${i}" x="${n(p.x - 4)}" y="${n(p.y - 4)}" width="8" height="8" rx="1.5" fill="${hot ? cSel : 'var(--mc-bg)'}" stroke="${cSel}" stroke-width="1.5" style="cursor:move"/>`,
          );
        });
      }
    }

    if (w.label) {
      const mid = pts[Math.floor(pts.length / 2)];
      parts.push(
        `<text x="${n(mid.x + 6)}" y="${n(mid.y - 6)}" font-size="${n(10 * px)}" fill="${cMuted}" font-family="ui-sans-serif, system-ui, sans-serif">${esc(w.label)}</text>`,
      );
    }
  }

  // ---- 元件 ----
  for (const c of doc.components) {
    const isSel = selected.has(c.id);
    const floating = [...segStyle.floatingKeys].some((k) => k.startsWith(`${c.id}#`));
    parts.push(compSvg(c, segStyle, isSel, floating, !exportMode));

    // 端口命中点：透明圆，方便点选连线起点
    if (!exportMode) {
      for (const name of portNames(c.kind)) {
        const p = portWorld(c, name);
        parts.push(
          `<circle class="mc-port" data-comp="${esc(c.id)}" data-port="${esc(name)}" cx="${n(p.x)}" cy="${n(p.y)}" r="7" fill="transparent" pointer-events="all"/>`,
        );
      }
    }
  }

  // ---- 文本 ----
  for (const t of doc.texts) {
    parts.push(textSvg(t, cInk, cMuted, cSel, px, selected.has(t.id), !exportMode));
  }

  // ---- 交互覆盖层（导出时一律不画） ----
  if (!exportMode) {
    if (opts.pending) {
      const { a, b } = opts.pending;
      const d = `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`;
      parts.push(`<path d="${d}" fill="none" stroke="${cGuide}" stroke-width="2" stroke-dasharray="5 4" pointer-events="none"/>`);
    }
    if (opts.guide) {
      const g = opts.guide;
      const vb = viewBoxOf(doc, opts);
      parts.push(
        g.axis === 'x'
          ? `<line x1="${n(g.v)}" y1="${n(vb.y)}" x2="${n(g.v)}" y2="${n(vb.y + vb.h)}" stroke="${cGuide}" stroke-width="1" stroke-dasharray="6 4" pointer-events="none" opacity="0.8"/>`
          : `<line x1="${n(vb.x)}" y1="${n(g.v)}" x2="${n(vb.x + vb.w)}" y2="${n(g.v)}" stroke="${cGuide}" stroke-width="1" stroke-dasharray="6 4" pointer-events="none" opacity="0.8"/>`,
      );
    }
    if (opts.marquee) {
      const m = opts.marquee;
      parts.push(
        `<rect x="${n(m.x)}" y="${n(m.y)}" width="${n(m.w)}" height="${n(m.h)}" fill="${cSel}" fill-opacity="0.08" stroke="${cSel}" stroke-width="1" stroke-dasharray="4 3" pointer-events="none"/>`,
      );
    }
    if (opts.placeGhost) {
      // 用真实符号几何画 ghost，而不是缩略图：缩略图不带端口，
      // 用户判断「落点会不会压到现有连线」时需要看到端口位置。
      const g = opts.placeGhost;
      if (g.kind === 'note') {
        parts.push(
          `<text x="${n(g.x)}" y="${n(g.y)}" font-size="13" fill="${cGuide}" font-family="ui-sans-serif, system-ui, sans-serif" opacity="0.75" pointer-events="none">文本</text>`,
        );
      } else {
        const fake = { kind: g.kind, x: g.x, y: g.y, rot: 0, flip: false, label: '', color: null } as unknown as MosComp;
        const gb = compBBox(fake);
        parts.push(
          `<g opacity="0.55" pointer-events="none">${compSvg(fake, segStyle, false, false, false)}</g>`,
        );
        parts.push(
          `<rect x="${n(gb.x)}" y="${n(gb.y)}" width="${n(gb.w)}" height="${n(gb.h)}" fill="none" stroke="${cGuide}" stroke-width="1.5" stroke-dasharray="5 4" pointer-events="none"/>`,
        );
      }
    }
  }

  // ---- 装配 ----
  if (exportMode) {
    const b = opts.bounds ?? boundsOf(doc, 20);
    const w = b.w * px;
    const h = b.h * px;
    const bg = opts.background === null ? '' : rectBg(opts.background ?? pal.bg, b);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}">`,
      bg,
      parts.join(''),
      `</svg>`,
    ].join('');
  }

  const view = opts.view ?? { zoom: 1, panX: 0, panY: 0 };
  const vw = opts.vw ?? 800;
  const vh = opts.vh ?? 600;
  return [
    `<svg class="mc-svg" xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">`,
    `<g class="mc-world" transform="translate(${n(view.panX)} ${n(view.panY)}) scale(${n(view.zoom)})">`,
    parts.join(''),
    `</g>`,
    `</svg>`,
  ].join('');
}

function rectBg(bg: string, b: Rect): string {
  return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${bg}"/>`;
}

/**
 * 独立文本。
 *
 * 注意：**独立文本允许旋转**（让竖排标注贴住竖线），所以这里用 transform 属性；
 * 而元件标注在 `compSvg` 里是逐个算世界坐标的，两者刻意用不同方式，别混。
 */
function textSvg(
  t: TextNote,
  cInk: string,
  cMuted: string,
  cSel: string,
  px: number,
  selected: boolean,
  screenMode: boolean,
): string {
  const col = t.color === 'muted' ? cMuted : cInk;
  const rot = t.rot ? ` rotate(${t.rot} ${n(t.x)} ${n(t.y)})` : '';
  const selBox =
    selected && screenMode
      ? `<rect x="${n(t.x - textBoxPad(t))}" y="${n(t.y - t.size)}" width="${n(textBoxPad(t) * 2)}" height="${n(t.size * 1.4)}" fill="none" stroke="${cSel}" stroke-width="1" stroke-dasharray="3 2" rx="2" pointer-events="none"/>`
      : '';
  const cls = screenMode ? ` class="mc-text" data-text="${esc(t.id)}"` : '';
  const cursor = screenMode ? ' style="cursor:move"' : '';
  return (
    selBox +
    `<text${cls} x="${n(t.x)}" y="${n(t.y)}" font-size="${n(t.size * px)}" fill="${col}" font-weight="${t.bold ? 600 : 400}" text-anchor="${t.align}" font-family="ui-sans-serif, system-ui, sans-serif"${rot}${cursor}>${esc(t.text)}</text>`
  );
}

/** 选中框的半宽：按文本估算宽度 */
function textBoxPad(t: TextNote): number {
  return Math.max(8, estimateTextWidth(t.text, t.size) / 2 + 4);
}

function viewBoxOf(doc: MosDoc, opts: RenderOpts): Rect {
  return opts.bounds ?? boundsOf(doc, 20);
}

/** 连线的中间拐点世界坐标（渲染手柄用） */
function wireViaPoints(doc: MosDoc, w: Wire): Array<{ x: number; y: number }> {
  const pts = wirePts(doc, w);
  return pts.slice(1, -1);
}

// ============================================================================
// 导出
// ============================================================================

export interface ExportOpts {
  dark?: boolean;
  /** 背景色，null = 透明 */
  background?: string | null;
  /** 线宽/字号缩放（PNG 2× 时传 2） */
  pxScale?: number;
  /** 额外留白 */
  pad?: number;
  bounds?: Rect;
}

export function exportSVG(doc: MosDoc, opts: ExportOpts = {}): string {
  // 背景色在 renderSvg 内部直接插入到 <svg> 之后，不需要事后正则改写 ——
  // 正则替换 SVG 字符串是个隐患（万一 path data 里出现 '<svg' 就改错地方）
  return renderSvg(doc, {
    mode: 'export',
    dark: opts.dark ?? false,
    diag: undefined,
    bounds: opts.bounds ?? boundsOf(doc, opts.pad ?? 20),
    pxScale: opts.pxScale ?? 1,
    background: opts.background === undefined ? undefined : opts.background,
  });
}

/**
 * 导出 PNG。走 SVG → Blob → Image → canvas 2× 栅格化。
 * 与 timing 工具同套路：矢量在中间层不损失，栅格化只发生在最后一步。
 */
export async function exportPNG(doc: MosDoc, opts: ExportOpts = {}): Promise<Blob> {
  const scale = opts.pxScale ?? 2;
  const b = opts.bounds ?? boundsOf(doc, opts.pad ?? 20);
  const dark = opts.dark ?? false;
  const pal = paletteOf(dark);
  const bg = opts.background === undefined ? pal.bg : opts.background;

  const svg = exportSVG(doc, { ...opts, pxScale: scale, background: bg });  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(b.w * scale));
    canvas.height = Math.max(1, Math.round(b.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文');
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b2) => (b2 ? resolve(b2) : reject(new Error('PNG 编码失败'))), 'image/png');
    });
  } finally {
    // 立刻 revoke 会让部分浏览器来不及读取，延迟一拍
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG 光栅化失败'));
    img.src = url;
  });
}

// ============================================================================
// 调色板预览（左侧符号面板的小图标用）
// ============================================================================

/** 单个符号的独立小 SVG，供符号面板预览 */
export function symbolThumb(kind: string, dark: boolean): string {
  const c = dark ? DARK_COLORS.ink : LIGHT_COLORS.ink;

  // 文本不是元件，没有符号 path —— 画一个「T字 + 下划线」的排版字形占位，
  // 和真正的文本元素一眼能对上
  if (kind === 'note') {
    const d = 'M-9 -8L9 -8M0 -8L0 9M-9 9L9 9';
    return `<svg class="mc-thumb" viewBox="-16 -14 32 30" width="34" height="34" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  const fake = { kind, x: 0, y: 0, rot: 0, flip: false, label: '', color: null } as unknown as MosComp;
  const segs = compSegs(fake);
  const b = compBBox(fake);
  const pad = 6;
  const body = segs
    .map((s) =>
      s.fill
        ? `<path d="${s.d}" fill="${c}"/>`
        : `<path d="${s.d}" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  return `<svg class="mc-thumb" viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}" width="34" height="34" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export { GRID, SYM };
