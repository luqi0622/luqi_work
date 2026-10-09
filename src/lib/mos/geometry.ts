/**
 * MOS 管级电路图 —— 几何与正交布线（纯函数，零 DOM）
 *
 * ## 核心不变量
 *
 * **任何时刻，每条线的每一段都严格水平或垂直。**
 * 这是正交布线唯一需要守住的性质，由 `orthoFix()` 无条件保证：
 * 连线存的是「两端端口 + 绝对世界坐标拐点」，元件移动后拐点不再构成直角，
 * `orthoFix` 会自动补成 Z 形。所有断言都围绕这条性质。
 *
 * ## 坐标换算
 *
 * 本文件提供**纯函数**版本，供测试基准与导出路径使用。
 * 交互命中测试用 `svg.getScreenCTM().inverse()`（浏览器保证正确），
 * 两者的一致性由 CDP 断言守住（差 < 0.5px）。
 */

import {
  type Dir,
  type Endpoint,
  type MosComp,
  type MosDoc,
  type Pt,
  type Rect,
  type View,
  type Wire,
  GRID,
  STUB,
  SNAP_PORT,
  isMos,
} from './types';
import { compBBox, compLabels, portDirWorld, portNames, portWorld } from './symbols';

// ============================================================================
// 坐标换算
// ============================================================================

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  rect: ViewportRect,
  view: View,
): Pt {
  return {
    x: (clientX - rect.left - view.panX) / view.zoom,
    y: (clientY - rect.top - view.panY) / view.zoom,
  };
}

/** 世界坐标 → 屏幕坐标 */
export function worldToScreen(p: Pt, rect: ViewportRect, view: View): Pt {
  return {
    x: p.x * view.zoom + view.panX + rect.left,
    y: p.y * view.zoom + view.panY + rect.top,
  };
}

// ============================================================================
// 端点解析
// ============================================================================

/** 端点 → 世界坐标。port 走 portWorld（实时算），free 直接取坐标 */
export function endpointPos(doc: MosDoc, e: Endpoint): Pt {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const c = doc.components.find((k) => k.id === e.ref.comp);
  // 元件被删但线还在（normalize 后的兜底状态）：退回原点，不抛错
  return c ? portWorld(c, e.ref.port) : { x: 0, y: 0 };
}

/** 端点的出线方向。free 端点默认向上（无从得知，给个安全的默认值） */
export function endpointDir(doc: MosDoc, e: Endpoint): Dir {
  if (e.kind === 'free') return 'U';
  const c = doc.components.find((k) => k.id === e.ref.comp);
  return c ? portDirWorld(c, e.ref.port) : 'U';
}

// ============================================================================
// 正交布线
// ============================================================================

const EPS = 0.5;

/** 去掉零长段与重复点，并合并共线相邻段 */
export function cleanPts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  // 合并共线：若 b 在 a→c 的连线上，删掉 b
  const res: Pt[] = [];
  for (let i = 0; i < out.length; i++) {
    if (res.length >= 2) {
      const a = res[res.length - 2];
      const b = res[res.length - 1];
      const c = out[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;
      const cross = abx * bcy - aby * bcx;
      const dot = abx * bcx + aby * bcy;
      if (Math.abs(cross) < EPS && dot > 0) {
        res[res.length - 1] = c;
        continue;
      }
    }
    res.push(out[i]);
  }
  return res;
}

/** 沿 dir 走 dist */
function step(p: Pt, dir: Dir, dist: number): Pt {
  switch (dir) {
    case 'L':
      return { x: p.x - dist, y: p.y };
    case 'R':
      return { x: p.x + dist, y: p.y };
    case 'U':
      return { x: p.x, y: p.y - dist };
    default:
      return { x: p.x, y: p.y + dist };
  }
}

function isH(dir: Dir): boolean {
  return dir === 'L' || dir === 'R';
}

/**
 * 从 a 到 b 生成正交路径。
 *
 * **第一步：两端各先沿出线方向直出 STUB。** 这是原理图的标准画法，
 * 也避免线从元件身上穿过去。
 *
 * **第二步：按方向组合选形。**
 * - 水平 + 垂直 → Z 形
 * - 垂直 + 水平 → 镜像 Z 形
 * - 同为水平 / 同为垂直 → 同向走 L 形，反向走 Z 形（加一段反向横移，避免自交）
 * - 任意：若 dx 或 dy 近似为 0 → 退化成单段直线
 *
 * **第三步：cleanPts 清理。**
 */
export function orthoRoute(
  a: Pt,
  aDir: Dir,
  b: Pt,
  bDir: Dir,
  stub = STUB,
): Pt[] {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;

  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);

  // 已经水平或垂直对齐 → 一段直线。
  // 这里**不做 STUB 直出**：两端已经共线，加 STUB 只会多出两个共线点，
  // 视觉上完全看不出区别，却让 cleanPts 之后仍残留 3~4 个顶点。
  if (dx < EPS || dy < EPS) return [a, b];

  const a2 = step(a, aDir, stub);
  const b2 = step(b, bDir, stub);

  const aH = isH(aDir);
  const bH = isH(bDir);

  if (aH && bH) {
    // 都是水平出线 → 用「两折点」的 Z 形，中间竖直段放在两端的中点
    const midX = (a2.x + b2.x) / 2;
    const pts = [a, a2, { x: midX, y: a2.y }, { x: midX, y: b2.y }, b2, b];
    if (aDir === bDir) {
      // 同向：先横到 b2.x 再竖，折点直接落在 b2 上
      return cleanPts([a, a2, { x: b2.x, y: a2.y }, b2, b]);
    }
    return cleanPts(pts);
  }

  if (!aH && !bH) {
    const midY = (a2.y + b2.y) / 2;
    if (aDir === bDir) {
      return cleanPts([a, a2, { x: a2.x, y: b2.y }, b2, b]);
    }
    return cleanPts([a, a2, { x: a2.x, y: midY }, { x: b2.x, y: midY }, b2, b]);
  }

  // 一横一竖 → Z 形
  if (aH) {
    return cleanPts([a, a2, { x: b2.x, y: a2.y }, b2, b]);
  }
  return cleanPts([a, a2, { x: a2.x, y: b2.y }, b2, b]);
}

/**
 * 正交化修正 —— 布线模块的核心守卫。
 *
 * 输入：两端 + 绝对世界坐标拐点数组；输出：保证每段都水平或垂直的拐点数组。
 *
 * 流程：
 * 1. 每个 bend 先 snap 到最近网格倍数
 * 2. bends 为空 → 用 orthoRoute 现生成一组（这样用户能直接拖到那个拐点上）
 * 3. 若首/中/末 bend 与邻居不共线 → 插入拐点补成 Z 形
 */
export function orthoFix(a: Pt, b: Pt, via: Pt[], aDir: Dir = 'U', bDir: Dir = 'U'): Pt[] {
  const mids = via.map((p) => snapToGrid(p.x, p.y));

  // bends 为空：现生成。用两端真实出线方向，否则会绕远一大圈
  if (mids.length === 0) {
    return orthoRoute(a, aDir, b, bDir).slice(1, -1);
  }

  // 首点：与 a 到 mids[0] 之间不共线则补一个拐点
  let pts: Pt[] = [a, ...mids, b];

  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = Math.abs(q.x - p.x);
    const dy = Math.abs(q.y - p.y);
    if (dx < EPS || dy < EPS) continue; // 已正交

    // 不正交：在中点插一个拐点。先横后竖。
    const mx = (p.x + q.x) / 2;
    const insert = Math.abs(dx) >= Math.abs(dy) ? { x: mx, y: p.y } : { x: p.x, y: (p.y + q.y) / 2 };
    const next = [...pts.slice(0, i + 1), insert, ...pts.slice(i + 1)];
    // 递归修正剩余部分
    return orthoFixInternal(next);
  }
  return mids;
}

function orthoFixInternal(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    const q = pts[i];
    const dx = Math.abs(q.x - p.x);
    const dy = Math.abs(q.y - p.y);
    if (dx < EPS || dy < EPS) {
      out.push(q);
      continue;
    }
    const mx = (p.x + q.x) / 2;
    if (Math.abs(dx) >= Math.abs(dy)) {
      out.push({ x: mx, y: p.y });
      out.push({ x: mx, y: q.y });
    } else {
      out.push({ x: p.x, y: (p.y + q.y) / 2 });
      out.push({ x: q.x, y: (p.y + q.y) / 2 });
    }
    out.push(q);
  }
  // 首末是端点，不进 via
  return cleanPts(out).slice(1, -1);
}

/** 拖动单个拐点：移动后强制重正交化 */
export function dragVertex(
  a: Pt,
  b: Pt,
  via: Pt[],
  idx: number,
  to: Pt,
): Pt[] {
  const mids = via.map((p) => ({ x: p.x, y: p.y }));
  if (idx < 0 || idx >= mids.length) return mids;
  mids[idx] = { x: to.x, y: to.y };
  return orthoFix(a, b, mids);
}

/**
 * 拖动**某一段线**，让整段平移。
 *
 * 与 `dragVertex`（拖拐点）的区别：那个移动一个顶点，这个移动一段 —— 拖
 * 中间那段竖线时希望整段竖着平移，而不是把某个拐点拽歪。
 *
 * 实现上把该段两端点**一起**平移，再交给 `orthoFix` 补正相邻段的正交性。
 * 段是横的就不动 y（横线只能上下平移），是竖的反之 —— 不然拖一下就变成
 * 斜线，再被 orthoFix 折成 Z 形，视觉上完全不是用户想要的「整段挪动」。
 *
 * 端点（首尾）不参与平移：它们钉在元件端口上。
 */
export function dragSegment(a: Pt, b: Pt, via: Pt[], segIdx: number, delta: Pt): Pt[] {
  const mids = via.map((p) => ({ x: p.x, y: p.y }));
  const full = cleanPts([a, ...mids, b]);
  // full 的下标 0 与末位是端点，1..n-2 才是 via
  const i0 = segIdx + 1;
  const i1 = segIdx + 2;
  // 下标越界 = 这一段不存在（或已被 cleanPts 合并掉），当作没拖动
  if (i0 < 1 || i1 >= full.length) return mids;

  const p0 = full[i0];
  const p1 = full[i1];
  const horizontal = Math.abs(p1.y - p0.y) < EPS;
  const d = horizontal ? { x: 0, y: delta.y } : { x: delta.x, y: 0 };

  const moved = full.map((p, i) => (i === i0 || i === i1 ? { x: p.x + d.x, y: p.y + d.y } : p));
  // 平移后相邻两段多半不再正交，交给 orthoFix 补成 Z 形
  return orthoFix(a, b, cleanPts(moved).slice(1, -1));
}

/** 落栅格。避免导出 SVG 出现 17.999999 这种浮点尾巴 */
export function snapToGrid(x: number, y: number): Pt {
  return { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID };
}

// ============================================================================
// 连线路径
// ============================================================================

/** 线 → 顶点序列（含两端）。**每段都保证正交** */
export function wirePts(doc: MosDoc, w: Wire): Pt[] {
  const a = endpointPos(doc, w.a);
  const b = endpointPos(doc, w.b);
  // 把两端真实的出线方向传下去 —— 否则 via 为空时生成的默认路线
  // 会绕远一大圈（早先固定用 'U'，视觉上像电路被绕了个大回路）
  const via = orthoFix(a, b, w.via, endpointDir(doc, w.a), endpointDir(doc, w.b));
  return cleanPts([a, ...via, b]);
}

/** 线 → SVG path d（直角折线用 M/L，不画圆角 —— 原理图不该有圆角） */
export function wirePathD(doc: MosDoc, w: Wire): string {
  const pts = wirePts(doc, w);
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('');
}

// ============================================================================
// 包围盒
// ============================================================================

/** 文本宽度估算。中文按全宽、ASCII 按半宽算，比统一 ×0.6 准得多 */
export function estimateTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.56;
  }
  return w;
}

export function textBBox(x: number, y: number, text: string, size: number, align: 'left' | 'center' | 'right'): Rect {
  const w = estimateTextWidth(text, size);
  const x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w;
  return { x: x0, y: y - size * 0.8, w, h: size * 1.2 };
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** 全图包围盒。fit-to-view 与导出 viewBox 都用它 */
export function boundsOf(doc: MosDoc, pad = 0): Rect {
  let r: Rect | null = null;
  for (const c of doc.components) {
    r = unionRect(r, compBBox(c));
    for (const lb of compLabels(c)) {
      r = unionRect(r, textBBox(lb.x, lb.y, lb.text, lb.size, lb.align));
    }
  }
  for (const w of doc.wires) {
    for (const p of wirePts(doc, w)) r = unionRect(r, { x: p.x, y: p.y, w: 0, h: 0 });
  }
  for (const t of doc.texts) r = unionRect(r, textBBox(t.x, t.y, t.text, t.size, t.align));
  if (!r) r = { x: 0, y: 0, w: 400, h: 300 };
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/** 让包围盒至少有一个最小尺寸，避免空图 fit 出极端缩放 */
export function ensureMinSize(r: Rect, minW = 200, minH = 150): Rect {
  if (r.w >= minW && r.h >= minH) return r;
  return {
    x: r.x - (minW - r.w) / 2,
    y: r.y - (minH - r.h) / 2,
    w: Math.max(r.w, minW),
    h: Math.max(r.h, minH),
  };
}

// ============================================================================
// 命中测试
// ============================================================================

function distToSeg(p: Pt, s: Pt, e: Pt): number {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - s.x, p.y - s.y);
  let t = ((p.x - s.x) * dx + (p.y - s.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (s.x + t * dx), p.y - (s.y + t * dy));
}

/** 找到的端口：坐标 + 出线方向（连线预览要用方向决定第一段走向） */
export interface PortHit {
  comp: string;
  port: string;
  pos: Pt;
  dir: Dir;
}

/** 找最近的空闲端口。用于连线起点与端口吸附 */
export function nearestPort(doc: MosDoc, p: Pt, tol = SNAP_PORT): PortHit | null {
  let best: PortHit | null = null;
  let bestD = tol;
  for (const c of doc.components) {
    for (const name of portNames(c.kind)) {
      const pos = portWorld(c, name);
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { comp: c.id, port: name, pos, dir: portDirWorld(c, name) };
      }
    }
  }
  return best;
}

/** 找最近的线或拐点 */
export function nearestWirePoint(
  doc: MosDoc,
  p: Pt,
  tol: number,
): { wireId: string; kind: 'seg' | 'vertex'; idx: number } | null {
  let best: { wireId: string; kind: 'seg' | 'vertex'; idx: number } | null = null;
  let bestD = tol;
  for (const w of doc.wires) {
    const pts = wirePts(doc, w);
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - p.x, pts[i].y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { wireId: w.id, kind: 'vertex', idx: i === 0 || i === pts.length - 1 ? -1 : i - 1 };
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSeg(p, pts[i], pts[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = { wireId: w.id, kind: 'seg', idx: i };
      }
    }
  }
  return best;
}

/** 找元件。命中判定用包围盒（比逐段 path 判定简单且够用） */
export function compAt(doc: MosDoc, p: Pt): MosComp | null {
  for (let i = doc.components.length - 1; i >= 0; i--) {
    const b = compBBox(doc.components[i]);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return doc.components[i];
  }
  return null;
}

/** 线是否命中点（含一定容差，让细线也好点中） */
export function wireAt(doc: MosDoc, p: Pt, tol = 6): Wire | null {
  for (let i = doc.wires.length - 1; i >= 0; i--) {
    const pts = wirePts(doc, doc.wires[i]);
    for (let k = 0; k < pts.length - 1; k++) {
      if (distToSeg(p, pts[k], pts[k + 1]) <= tol) return doc.wires[i];
    }
  }
  return null;
}

export function textAt(doc: MosDoc, p: Pt): string | null {
  for (let i = doc.texts.length - 1; i >= 0; i--) {
    const t = doc.texts[i];
    const b = textBBox(t.x, t.y, t.text, t.size, t.align);
    if (p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y && p.y <= b.y + b.h + 2) return t.id;
  }
  return null;
}

// ============================================================================
// 吸附
// ============================================================================

export interface SnapResult {
  x: number;
  y: number;
  /** 'port' | 'gate' | 'rail' | 'grid' —— 用于状态栏提示与参考线绘制 */
  hint: 'port' | 'gate' | 'rail' | 'grid';
  /** 吸附到栅极列/电源轨时的参考线位置 */
  refLine?: { axis: 'x' | 'y'; v: number };
}

export interface SnapOptions {
  snapGrid: boolean;
  snapTrack: boolean;
}

/**
 * 吸附优先级（严格顺序，不可调换）：
 *   1. 端口（另一元件的端口）
 *   2. 栅极列（所有 MOS 的 g 端口 x）—— 让一排管子栅极落在同一垂线
 *   3. 电源轨（所有 vdd/gnd 的连接线 y）—— 让所有 VDD 在同一水平
 *   4. 网格
 *
 * 栅极列和电源轨是画 MOS 电路最花时间的两件事，
 * 手动拖拽让一堆管子对齐是折磨，所以这两档必须排在网格前面。
 */
export function snapPoint(
  doc: MosDoc,
  p: Pt,
  opts: SnapOptions,
  tol = SNAP_PORT,
): SnapResult {
  // 1. 端口
  const port = nearestPort(doc, p, tol);
  if (port) return { x: port.pos.x, y: port.pos.y, hint: 'port' };

  // 2. 栅极列
  if (opts.snapTrack) {
    let bestX: number | null = null;
    let bestD = SNAP_TRACK_TOL;
    for (const c of doc.components) {
      if (!isMos(c)) continue;
      const gx = portWorld(c, 'g').x;
      const d = Math.abs(gx - p.x);
      if (d < bestD) {
        bestD = d;
        bestX = gx;
      }
    }
    if (bestX !== null) {
      const y = opts.snapGrid ? Math.round(p.y / GRID) * GRID : p.y;
      return { x: bestX, y, hint: 'gate', refLine: { axis: 'x', v: bestX } };
    }

    // 3. 电源轨：所有 vdd / gnd 端口的 y
    let bestY: number | null = null;
    let bestDY = SNAP_TRACK_TOL;
    for (const c of doc.components) {
      if (c.kind !== 'vdd' && c.kind !== 'gnd') continue;
      const ry = portWorld(c, 'p').y;
      const d = Math.abs(ry - p.y);
      if (d < bestDY) {
        bestDY = d;
        bestY = ry;
      }
    }
    if (bestY !== null) {
      const x = opts.snapGrid ? Math.round(p.x / GRID) * GRID : p.x;
      return { x, y: bestY, hint: 'rail', refLine: { axis: 'y', v: bestY } };
    }
  }

  // 4. 网格
  if (opts.snapGrid) {
    const g = snapToGrid(p.x, p.y);
    return { x: g.x, y: g.y, hint: 'grid' };
  }
  return { x: p.x, y: p.y, hint: 'grid' };
}

const SNAP_TRACK_TOL = 9;

// ============================================================================
// 路径段相交（T 型汇接检测）
// ============================================================================

export function segsIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return null; // 平行
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/**
 * 找出 `pts` 这条折线与 `others` 中某条线的第一个交点。
 * T 型汇接 = 一条线的端点落在另一条线的段上。
 */
export function findTJunction(
  doc: MosDoc,
  pts: Pt[],
  excludeWireId: string,
): { wireId: string; pt: Pt } | null {
  for (const w of doc.wires) {
    if (w.id === excludeWireId) continue;
    const o = wirePts(doc, w);
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < o.length - 1; k++) {
        const hit = segsIntersect(pts[i], pts[i + 1], o[k], o[k + 1]);
        if (hit) return { wireId: w.id, pt: hit };
      }
    }
  }
  return null;
}
