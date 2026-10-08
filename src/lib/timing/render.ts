/**
 * 时序波形图 —— SVG 渲染器
 *
 * 职责：给定文档 + 几何参数，产出 SVG 的 path d 字符串。
 * 不碰 DOM（除了用字符串），所以可以被断言测试直接比对。
 *
 * 核心设计：**每条信号输出一条 path**（总线是两条）。
 * 复杂度 = 跳变次数，而不是时间点数量。50 条沿 × 20 信号 = 20 个 path 元素，
 * 浏览器毫无压力。PNG 导出时也能靠这点少写一堆坐标。
 */

// 同model.ts：接口必须带 type 修饰符，否则 Vite 逐文件转译会留下无效的运行��导入
import {
  type AnalogSeg,
  type BusSeg,
  type ClockSeg,
  type DigitalSeg,
  type Signal,
  type TimingDoc,
} from './types';
import { busValueAt, clockEdges, crossHalfWidth, digitalLevelAt, toHex } from './model';

/** 几何常量（导出用同一份，屏幕与导出结果才能一致） */
export const GEO = {
  /** 左侧信号名列宽 */
  nameW: 132,
  /** 时间轴条高 */
  axisH: 26,
  /** 每条信号行高 */
  rowH: 38,
  /** 信号区上下留白 */
  padTop: 8,
  /** 波形在行内的高度占比（0~1），剩下的是行内留白 */
  ampRatio: 0.62,
  /** 总线 X 交叉的最大半宽（像素） */
  crossMaxW: 9,
} as const;

export interface RenderOpts {
  /** 每个 tick 多少像素 */
  pxPerTick: number;
  /** 是否画刻度数字 */
  showAxis?: boolean;
  /** 选中信号 id（用于高亮） */
  selectedId?: string;
  /**
   * 左侧信号名列宽。屏幕上画波形区时传 0（名字列是独立 DOM，不在 SVG 里）；
   * 导出时传 GEO.nameW。让它可配置是为了保证屏幕和导出走同一套坐标计算 ——
   * 否则「屏上对齐、导出错位」这种问题极难排查。
   */
  nameW?: number;
}

export interface SignalShape {
  id: string;
  /** 主path（数字/时钟/模拟为单条，总线为两条） */
  d: string;
  /** 总线的第二条path（仅 bus 有） */
  d2?: string;
  /** 段内文字（总线的十六进制值） */
  labels: { x: number; y: number; text: string }[];
  /** 边沿的x 坐标，渲染层用它画可拖动的手柄 */
  edgeX: number[];
  color: string;
}

/** 计算文档总高度（信号区+ 时间轴 + 标注预留） */
export function contentHeight(doc: TimingDoc, opts: RenderOpts): number {
  return GEO.axisH + GEO.padTop + doc.signals.length * GEO.rowH + 24;
}

/** 画布总宽 */
export function canvasWidth(doc: TimingDoc, opts: RenderOpts): number {
  return (opts.nameW ?? GEO.nameW) + doc.lengthTicks * opts.pxPerTick;
}

// ============================================================================
// 单信号 path 生成
// ============================================================================

/** 行内的电平 y 坐标：hi=0（靠上），lo=1（靠下） */
function levelY(rowTop: number, level: 0 | 1): number {
  const amp = GEO.rowH * GEO.ampRatio;
  const off = (GEO.rowH - amp) / 2;
  return rowTop + off + (level === 1 ? amp : 0);
}

/** 行顶（不含时间轴） */
export function rowTopOf(row: number): number {
  return GEO.padTop + row * GEO.rowH;
}

/**
 * 数字信号：正交阶梯线
 *
 * 电平不变时沿水平走，变化时在同一个 x 上垂直跳 —— 这是数字波形的标准画法。
 * 一次 H 一次 V 交替，绝不斜线，斜线在时序图里是错的。
 */
function digitalPath(seg: DigitalSeg, row: number, nameW: number, px: number): { d: string; edgeX: number[] } {
  const top = rowTopOf(row);
  const hi = levelY(top, 0);
  const lo = levelY(top, 1);
  let level = seg.initial;
  let d = `M ${nameW} ${level === 1 ? lo : hi}`;
  const edgeX: number[] = [];
  for (const e of seg.edges) {
    const x = nameW + e * px;
    level = level === 1 ? 0 : 1;
    const y = level === 1 ? lo : hi;
    d += ` H ${x} V ${y}`;
    edgeX.push(x);
  }
  // 画到末尾，让线延伸到画布右边缘
  d += ` H ${nameW + 1e7}`;
  return { d, edgeX };
}

/**
 * 时钟：参数化方波
 *
 * 用clockEdges 展开成边沿再画，和数字信号走同一条渲染路径 ——
 * 好处是时钟也自动获得可拖动手柄，同时保持视觉一致。
 */
function clockPath(seg: ClockSeg, doc: TimingDoc, row: number, nameW: number, px: number): { d: string; edgeX: number[] } {
  const asDigital: DigitalSeg = {
    kind: 'digital',
    id: seg.id,
    name: seg.name,
    color: seg.color,
    initial: seg.initial,
    edges: clockEdges(seg, doc.lengthTicks),
  };
  return digitalPath(asDigital, row, nameW, px);
}

/**
 * 总线：两条正交折线 + 段间X 交叉
 *
 * 画法就是标准的总线画法：
 *   上下两条平行线代表位宽包络，值变化时在过渡区画 X。
 *
 * 关键细节：X 的半宽要受**相邻段长度**约束（crossHalfWidth）。
 * 段很短时如果还用固定半宽，X 会盖住左右邻居的电平，总线就读错了。
 */
function busPath(seg: BusSeg, row: number, nameW: number, px: number): SignalShape {
  const top = rowTopOf(row);
  const amp = GEO.rowH * GEO.ampRatio;
  const off = (GEO.rowH - amp) / 2;
  const yTop = top + off;
  const yBot = top + off + amp;
  const x = (t: number) => nameW + t * px;
  const endX = nameW + 1e7;

  let up = `M ${x(seg.segments[0].t)} ${yTop}`;
  let dn = `M ${x(seg.segments[0].t)} ${yBot}`;
  const labels: { x: number; y: number; text: string }[] = [];

  for (let i = 0; i < seg.segments.length; i++) {
    const s = seg.segments[i];
    const hw = crossHalfWidth(seg, i, GEO.crossMaxW);
    const curX = x(s.t);
    const nxt = seg.segments[i + 1];

    if (i > 0) {
      // 从上一段终点画到本段起点，中间是X 交叉
      up += ` L ${curX} ${i % 2 === 0 ? yTop : yBot}`;
      dn += ` L ${curX} ${i % 2 === 0 ? yBot : yTop}`;
    }
    up += ` H ${nxt ? x(nxt.t) : endX}`;
    dn += ` H ${nxt ? x(nxt.t) : endX}`;

    //段内文字放在这一段的中点
    const segEndX = nxt ? x(nxt.t) : endX;
    const midX = (curX + segEndX) / 2;
    if (segEndX - curX > 28) {
      labels.push({
        x: midX,
        y: top + GEO.rowH / 2 + 4,
        text: toHex(s.v, seg.width),
      });
    }
  }

  return { id: seg.id, d: up, d2: dn, labels, edgeX: [], color: seg.color };
}

/** 模拟信号：折线（线性插值），每个关键点一个小圆点 */
function analogPath(seg: AnalogSeg, row: number, nameW: number, px: number): SignalShape {
  const top = rowTopOf(row);
  const amp = GEO.rowH * GEO.ampRatio;
  const off = (GEO.rowH - amp) / 2;
  const y = (v: number) => top + off + amp * (1 - Math.min(1, Math.max(0, v)));
  const x = (t: number) => nameW + t * px;

  let d = '';
  seg.points.forEach((p, i) => {
    d += `${i === 0 ? 'M' : ' L'} ${x(p.t)} ${y(p.v)}`;
  });
  d += ` L ${x(1e7)} ${y(seg.points[seg.points.length - 1].v)}`;

  return {
    id: seg.id,
    d,
    labels: seg.points.map((p) => ({ x: x(p.t), y: y(p.v), text: p.v.toFixed(2) })),
    edgeX: [],
    color: seg.color,
  };
}

/** 分发到具体类型的渲染 */
export function renderSignal(
  doc: TimingDoc,
  seg: Signal,
  row: number,
  opts: RenderOpts,
): SignalShape {
  const nameW = opts.nameW ?? GEO.nameW;
  const px = opts.pxPerTick;
  switch (seg.kind) {
    case 'clock': {
      const r = clockPath(seg, doc, row, nameW, px);
      return { id: seg.id, d: r.d, labels: [], edgeX: r.edgeX, color: seg.color };
    }
    case 'bus':
      return busPath(seg, row, nameW, px);
    case 'analog':
      return analogPath(seg, row, nameW, px);
    default: {
      const r = digitalPath(seg, row, nameW, px);
      return { id: seg.id, d: r.d, labels: [], edgeX: r.edgeX, color: seg.color };
    }
  }
}

/** 一次渲染全部信号 */
export function renderAll(doc: TimingDoc, opts: RenderOpts): SignalShape[] {
  return doc.signals.map((seg, i) => renderSignal(doc, seg, i, opts));
}

// ============================================================================
// 时间轴刻度
// ============================================================================

export interface TickMark {
  x: number;
  label: string;
  major: boolean;
}

/** 生成刻度：主网格线带数字，次网格线不带 */
export function axisTicks(doc: TimingDoc, opts: RenderOpts): TickMark[] {
  const out: TickMark[] = [];
  const nameW = opts.nameW ?? GEO.nameW;
  const minor = Math.max(1, doc.majorEvery / 5);
  for (let t = 0; t <= doc.lengthTicks; t += minor) {
    const major = t % doc.majorEvery === 0;
    if (!major && opts.showAxis === false) continue;
    out.push({ x: nameW + t * opts.pxPerTick, label: major ? String(t) : '', major });
  }
  return out;
}

// ============================================================================
// 导出：生成独立 SVG 字符串
// ============================================================================

export interface ExportOpts {
  pxPerTick: number;
  /** 背景色，null = 透明 */
  background: string | null;
  /** 是否包含信号名列 */
  withNames: boolean;
  /** 主题色（文字与网格） */
  dark?: boolean;
}

/**
 * 生成自包含的 SVG 字符串
 *
 * 刻意**不引用外部 CSS**：所有样式写成presentation attribute。
 * 这样导出的 .svg 文件拖进 PPT、Figma、Illustrator 都不会因为找不到样式而变成一团黑。
 * 这是本工具最重要的输出质量点。
 */
export function exportSVG(doc: TimingDoc, opts: ExportOpts): string {
  const px = opts.pxPerTick;
  const nameW = opts.withNames ? GEO.nameW : 0;
  const width = nameW + doc.lengthTicks * px + 16;
  const height = contentHeight(doc, opts) + 8;

  const ink = opts.dark ? '#e4e4e7' : '#18181b';
  const faint = opts.dark ? '#52525b' : '#d4d4d8';
  const text = opts.dark ? '#a1a1aa' : '#52525b';

  // 如果不画信号名列，所有坐标要左移 nameW
  const shift = -nameW;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">`,
  );
  if (opts.background) {
    parts.push(`<rect width="100%" height="100%" fill="${opts.background}"/>`);
  }
  parts.push(`<g transform="translate(${shift} 0)">`);

  // 网格
  const minor = Math.max(1, doc.majorEvery / 5);
  for (let t = 0; t <= doc.lengthTicks; t += minor) {
    const x = (GEO.nameW + t * px).toFixed(1);
    const major = t % doc.majorEvery === 0;
    parts.push(
      `<line x1="${x}" y1="${GEO.axisH}" x2="${x}" y2="${height - 8}" stroke="${faint}" stroke-width="${major ? 0.8 : 0.4}" ${major ? '' : 'opacity="0.5"'}/>`,
    );
  }

  // 时间轴
  parts.push(`<line x1="${GEO.nameW}" y1="${GEO.axisH}" x2="${width}" y2="${GEO.axisH}" stroke="${faint}" stroke-width="1"/>`);
  for (let t = 0; t <= doc.lengthTicks; t += doc.majorEvery) {
    const x = GEO.nameW + t * px;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${GEO.axisH - 8}" font-size="10" fill="${text}" text-anchor="middle">${t}</text>`,
    );
  }

  // 信号
  doc.signals.forEach((seg, i) => {
    const top = rowTopOf(i);
    const amp = GEO.rowH * GEO.ampRatio;
    const off = (GEO.rowH - amp) / 2;

    // 行分隔线
    parts.push(
      `<line x1="${GEO.nameW}" y1="${top + GEO.rowH}" x2="${width}" y2="${top + GEO.rowH}" stroke="${faint}" stroke-width="0.4" opacity="0.6"/>`,
    );

    // 信号名
    if (opts.withNames) {
      parts.push(
        `<text x="10" y="${(top + GEO.rowH / 2 + 4).toFixed(1)}" font-size="12" fill="${ink}" font-weight="500">${escapeXML(seg.name)}</text>`,
      );
      parts.push(
        `<rect x="0" y="${(top + off + amp / 2 - 2).toFixed(1)}" width="3" height="4" fill="${seg.color}"/>`,
      );
    }

    // 波形
    const shape = renderSignal(doc, seg, i, { pxPerTick: px });
    parts.push(`<path d="${shape.d}" fill="none" stroke="${shape.color}" stroke-width="1.6" stroke-linejoin="miter"/>`);
    if (shape.d2) parts.push(`<path d="${shape.d2}" fill="none" stroke="${shape.color}" stroke-width="1.6"/>`);
    shape.labels.forEach((l) => {
      parts.push(`<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" font-size="11" fill="${shape.color}" text-anchor="middle">${escapeXML(l.text)}</text>`);
    });
    if (seg.kind === 'analog') {
      shape.labels.forEach((l) => {
        parts.push(`<circle cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="2" fill="${shape.color}"/>`);
      });
    }
  });

  // 游标
  doc.markers.forEach((m) => {
    const x = (GEO.nameW + m.t * px).toFixed(1);
    parts.push(
      `<line x1="${x}" y1="${GEO.axisH}" x2="${x}" y2="${height - 8}" stroke="#a32d2d" stroke-width="1" stroke-dasharray="4 3"/>`,
    );
    parts.push(
      `<text x="${(Number(x) + 3).toFixed(1)}" y="${GEO.axisH + 11}" font-size="10" fill="#a32d2d">${escapeXML(m.label)}</text>`,
    );
  });

  // 区间标注
  doc.spans.forEach((s) => {
    const y = s.row >= 0 ? rowTopOf(s.row) + GEO.rowH - 5 : GEO.axisH + 14;
    const x1 = GEO.nameW + s.t1 * px;
    const x2 = GEO.nameW + s.t2 * px;
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="#a32d2d" stroke-width="1" marker-start="url(#tmA)" marker-end="url(#tmA)"/>`,
    );
    parts.push(
      `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="10" fill="#a32d2d" text-anchor="middle">${escapeXML(s.label)}</text>`,
    );
  });

  parts.push(
    `<defs><marker id="tmA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#a32d2d" stroke-width="1.5"/></marker></defs>`,
  );
  parts.push('</g></svg>');
  return parts.join('\n');
}

function escapeXML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}