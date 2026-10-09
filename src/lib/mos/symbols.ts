/**
 * MOS 管级电路图 —— 符号几何（纯函数，零 DOM）
 *
 * ## 旋转为什么这样设计
 *
 * **只写 1 份 path（rot=0 的局部坐标），旋转靠 SVG `transform`。**
 * 不预渲染 4 个朝向 —— 那会让每种符号体积 ×4，改尺寸要同步改 4 处；
 * 旋转+镜像组合再乘 2 就是 16 处。
 *
 * 关键收益：端口世界坐标由 `portWorld()` 用**同一个变换函数**算出，
 * 所以图形与端口**结构上不可能失配**（不是靠两处维护偏移量来对齐）。
 *
 * MOS 语义（PMOS 栅极气泡、衬底箭头方向）也天然正确：
 * 箭头和气泡都在被旋转的 `<g>` 里，跟着图形一起转。
 *
 * 只有**文本标注**（型号 / W / L / 实例名）不旋转 —— 工程师最在意的就是
 * 这几个字，绝不能倒过来。文本在旋转组**之外**，按世界坐标定位。
 */

import {
  type CompKind,
  type ColorToken,
  type Dir,
  type MosComp,
  type MosFet,
  type Pt,
  type Rect,
  type Rot,
  isMos,
} from './types';

// ============================================================================
// 符号尺寸常量（世界 px，全部为整数或 .5，导出 SVG 不会有浮点尾巴）
// ============================================================================

export const SYM = {
  // ---- MOS ----
  /** 栅极板到沟道的水平距离（氧化层厚度观感） */
  gateGap: 12,
  /** 栅极板长度 */
  gatePlate: 28,
  /** 沟道三段的单段长度 */
  chSeg: 7,
  /** 沟道三段之间的间隙 */
  chSegGap: 3.5,
  /** 漏/源引线的竖直段 x */
  leadX: 12,
  /** 漏/源端口的 y 偏移 */
  portDY: 34,
  /** 栅极端口的 x 偏移 */
  gateX: -34,
  /** PMOS 栅极气泡半径 —— 三端符号下，**气泡是区分 N/P 管的唯一依据** */
  bubbleR: 4,
  /** 气泡圆心到栅极板的距离 */
  bubbleOff: 4,

  // ---- 两端元件 ----
  /** 端口到图形的引线长度 */
  lead: 14,
  /** 电阻矩形半宽 / 半高 */
  resHalfW: 7,
  resHalfH: 16,
  /** 电容极板半长 / 板间距 */
  capHalfW: 14,
  capHalfH: 2,
  /** 二极管三角半宽 */
  dioHalfW: 9,

  // ---- 电源 ----
  /** 电源圆半径 */
  srcR: 16,

  // ---- 电源轨 ----
  /** 电源轨横条半长 */
  railHalfW: 18,
  /** 电源轨端口到横条的距离 */
  railPort: 24,
  railBar: 10,

  // ---- 接点 / 跨线 ----
  junctionR: 3.5,
  jumpHalf: 16,
  jumpArc: 8,
} as const;

/** 沟道三段的 y 区间（局部坐标，共 3 段，居中） */
const CH_SEGS: Array<[number, number]> = (() => {
  const span = SYM.chSeg * 3 + SYM.chSegGap * 2; // 28
  const first = -span / 2;
  return [0, 1, 2].map((i) => {
    const y0 = first + i * (SYM.chSeg + SYM.chSegGap);
    return [y0, y0 + SYM.chSeg] as [number, number];
  });
})();

// ============================================================================
// 端口表
// ============================================================================

/** rot=0、未镜像时的端口局部坐标与出线方向 */
/** MOS 端口表。**只有栅/漏/源三端** —— 不提供 body 引脚 */
const PORTS_NMOS3: Record<string, { p: Pt; dir: Dir }> = {
  g: { p: { x: SYM.gateX, y: 0 }, dir: 'L' },
  d: { p: { x: SYM.leadX, y: -SYM.portDY }, dir: 'U' },
  s: { p: { x: SYM.leadX, y: SYM.portDY }, dir: 'D' },
};

const V: Record<string, { p: Pt; dir: Dir }> = {
  p: { p: { x: 0, y: -30 }, dir: 'U' },
  n: { p: { x: 0, y: 30 }, dir: 'D' },
};

/** 垂直两端元件的端口表（默认朝向：上正下负） */
const TWO_TERM: Record<string, { p: Pt; dir: Dir }> = V;

const RAIL_VDD: Record<string, { p: Pt; dir: Dir }> = {
  p: { p: { x: 0, y: -SYM.railPort }, dir: 'U' },
};

const RAIL_GND: Record<string, { p: Pt; dir: Dir }> = {
  p: { p: { x: 0, y: SYM.railPort }, dir: 'D' },
};

/**
 * 接点：四个端口全在圆心，只有出线方向不同。
 * 这样「四条线汇到一个点」可以直接连线，不必依赖隐式的 T 型推断。
 */
const JUNCTION: Record<string, { p: Pt; dir: Dir }> = {
  p: { p: { x: 0, y: 0 }, dir: 'U' },
  r: { p: { x: 0, y: 0 }, dir: 'R' },
  b: { p: { x: 0, y: 0 }, dir: 'D' },
  l: { p: { x: 0, y: 0 }, dir: 'L' },
};

const JUMP: Record<string, { p: Pt; dir: Dir }> = {
  p: { p: { x: -SYM.jumpHalf, y: 0 }, dir: 'L' },
  n: { p: { x: SYM.jumpHalf, y: 0 }, dir: 'R' },
};

/** 每种元件的端口表。端口名全小写 */
/**
 * 端口表。
 *
 * **MOS 只有 g/d/s 三端，没有 body 引脚。**
 *
 * 曾经提供过四端（带独立衬底）与三端体短接两个变体，符号上还要画衬底
 * 箭头。现在一律三端：画电路时衬底几乎总是接全局 VDD/VSS，不是逐管画法
 * 的信息 —— 让每个符号都挂一个用不上的引脚，只会让布线多出一堆必接的
 * 虚线。沟道类型靠**栅极气泡**区分（N 管无气泡、P 管有），这本身就是
 * 标准画法，语义不会丢。
 */
export function portTable(kind: CompKind): Record<string, { p: Pt; dir: Dir }> {
  switch (kind) {
    case 'nmos':
    case 'pmos':
      return PORTS_NMOS3;
    case 'resistor':
    case 'capacitor':
    case 'capPol':
    case 'diode':
    case 'zener':
    case 'vsrc':
    case 'isrc':
      return TWO_TERM;
    case 'vdd':
      return RAIL_VDD;
    case 'gnd':
      return RAIL_GND;
    case 'port':
      return RAIL_VDD;
    case 'junction':
      return JUNCTION;
    case 'jump':
      return JUMP;
    default:
      return {};
  }
}

export function portNames(kind: CompKind): string[] {
  return Object.keys(portTable(kind));
}

// ============================================================================
// 变换：镜像 → 旋转 → 平移（顺序固定，与 SVG transform 属性一致）
// ============================================================================

/**
 * SVG 的 rotate(θ) 矩阵：x' = x·cosθ − y·sinθ, y' = x·sinθ + y·cosθ
 * θ=90 时即 (x, y) → (−y, x)。注意 SVG 的 y 轴向下，所以这在屏幕上是顺时针。
 */
export function rotatePt(p: Pt, rot: Rot): Pt {
  switch (rot) {
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/** 方向向量同样按旋转矩阵变换（x 向右为 R，左为 L，y 向下为 D，上为 U） */
export function rotateDir(d: Dir, rot: Rot): Dir {
  switch (rot) {
    case 90:
      return d === 'R' ? 'D' : d === 'L' ? 'U' : d === 'D' ? 'L' : 'R';
    case 180:
      return d === 'R' ? 'L' : d === 'L' ? 'R' : d === 'D' ? 'U' : 'D';
    case 270:
      return d === 'R' ? 'U' : d === 'L' ? 'D' : d === 'D' ? 'R' : 'L';
    default:
      return d;
  }
}

/** 局部坐标 → 世界坐标 */
export function localToWorld(c: MosComp, p: Pt): Pt {
  const m = c.flip ? { x: -p.x, y: p.y } : p;
  const r = rotatePt(m, c.rot);
  return { x: r.x + c.x, y: r.y + c.y };
}

/** 端口的世界坐标。** 每次实时算，绝不缓存** —— 旋转/移动后自动跟随 */
export function portWorld(c: MosComp, port: string): Pt {
  const tbl = portTable(c.kind);
  const e = tbl[port] ?? tbl[Object.keys(tbl)[0]];
  return e ? localToWorld(c, e.p) : { x: c.x, y: c.y };
}

/** 端口的世界出线方向 */
export function portDirWorld(c: MosComp, port: string): Dir {
  const tbl = portTable(c.kind);
  const e = tbl[port] ?? tbl[Object.keys(tbl)[0]];
  const d = e ? e.dir : 'U';
  // 镜像把 L/R 对调，U/D 不变
  const m = c.flip ? (d === 'L' ? 'R' : d === 'R' ? 'L' : d) : d;
  return rotateDir(m, c.rot);
}

/** 供 SVG `transform` 属性用。导出与屏幕共用，保证两边完全一致 */
export function compTransform(c: MosComp): string {
  const parts = [`translate(${c.x} ${c.y})`, `rotate(${c.rot})`];
  if (c.flip) parts.push('scale(-1 1)');
  return parts.join(' ');
}

/** 世界坐标 → 局部坐标（命中测试、拖动落点归一化用） */
export function worldToLocal(c: MosComp, p: Pt): Pt {
  const d = { x: p.x - c.x, y: p.y - c.y };
  const un = rotatePt(d, c.rot === 0 ? 0 : ((360 - c.rot) % 360) as Rot);
  return c.flip ? { x: -un.x, y: un.y } : un;
}

// ============================================================================
// path 片段构造
// ============================================================================

/** 一条描边线段（不填充） */
function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M${x1} ${y1}L${x2} ${y2}`;
}

function poly(pts: Pt[], close = false): string {
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('');
  return close ? `${d}Z` : d;
}

function circle(cx: number, cy: number, r: number): string {
  // r 为整数或 .5，用两段半圆可完全避免浮点尾巴
  return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${r} ${r} 0 0 1 ${cx} ${cy - r}Z`;
}

// ============================================================================
// 各符号的 path 生成（rot=0 局部坐标）
// ============================================================================

/** 符号的一个绘制片段 */
export interface SymSeg {
  d: string;
  /** true = 用墨色实心填充（接点、信号旗），false = 只描边 */
  fill?: boolean;
  /** 线宽相对倍数，缺省 1 */
  sw?: number;
}

/** 栅极部分。PMOS 末端加气泡 */
function gateSegs(pmos: boolean): SymSeg[] {
  const gx = -SYM.gateGap;
  const plate = line(gx, -SYM.gatePlate / 2, gx, SYM.gatePlate / 2);
  if (!pmos) {
    return [{ d: `${line(SYM.gateX, 0, gx, 0)}` }, { d: plate }];
  }
  // 气泡与栅极板相切，引线在气泡处断开
  const bx = gx - SYM.bubbleOff;
  return [
    { d: line(SYM.gateX, 0, bx - SYM.bubbleR, 0) },
    { d: circle(bx, 0, SYM.bubbleR) },
    { d: plate },
  ];
}

/** 沟道三段（增强型 MOS 的标志性画法） */
function channelSegs(): SymSeg {
  return { d: CH_SEGS.map(([y0, y1]) => line(0, y0, 0, y1)).join('') };
}

/** 栅极板 + 沟道 + 漏源引线。**三端符号，不含衬底** */
function mosSegs(c: MosFet): SymSeg[] {
  const pmos = c.kind === 'pmos';
  const lx = SYM.leadX;
  const top = CH_SEGS[0][0];
  const bot = CH_SEGS[2][1];
  return [
    ...gateSegs(pmos),
    channelSegs(),
    // 漏：从沟道上端水平引到 leadX，再竖直上引到端口
    { d: `${line(0, top, lx, top)}${line(lx, top, lx, -SYM.portDY)}` },
    // 源
    { d: `${line(0, bot, lx, bot)}${line(lx, bot, lx, SYM.portDY)}` },
  ];
}

function resistorSegs(): SymSeg[] {
  const { resHalfW: w, resHalfH: h } = SYM;
  return [
    { d: line(0, -30, 0, -h) },
    // IEC 矩形电阻（GB 制图惯例）
    { d: `M${-w} ${-h}L${w} ${-h}L${w} ${h}L${-w} ${h}Z` },
    { d: line(0, h, 0, 30) },
  ];
}

function capacitorSegs(pol: boolean): SymSeg[] {
  const { capHalfW: w, capHalfH: h } = SYM;
  const segs: SymSeg[] = [
    { d: line(0, -30, 0, -h) },
    { d: line(0, h, 0, 30) },
  ];
  if (!pol) {
    segs.push({ d: line(-w, -h, w, -h) }, { d: line(-w, h, w, h) });
  } else {
    // 极性电容：上板直、下板弧（弧凸向上），左侧加 +
    segs.push({ d: line(-w, -h, w, -h) });
    segs.push({ d: `M${-w} ${h}A${w} ${w} 0 0 1 ${w} ${h}` });
    segs.push({ d: `${line(-w - 13, -h - 4, -w - 13, -h + 4)}${line(-w - 17, -h, -w - 9, -h)}` });
  }
  return segs;
}

function diodeSegs(zener: boolean): SymSeg[] {
  const w = SYM.dioHalfW;
  const segs: SymSeg[] = [
    { d: line(0, -30, 0, -6) },
    { d: poly([{ x: -w, y: -6 }, { x: w, y: -6 }, { x: 0, y: 10 }], true) },
    { d: line(0, 12, 0, 30) },
  ];
  if (!zener) {
    segs.push({ d: line(-w, 12, w, 12) });
  } else {
    // 稳压管：阴极线折成 Z 形
    segs.push({
      d: `M${-w} 14L${w} 14L${w - 5} 9L${-w + 5} 9`,
    });
  }
  return segs;
}

function vsrcSegs(): SymSeg[] {
  const r = SYM.srcR;
  return [
    { d: line(0, -30, 0, -r) },
    { d: line(0, r, 0, 30) },
    { d: circle(0, 0, r) },
    { d: `${line(-6, -7, 6, -7)}${line(0, -13, 0, -1)}` },
    { d: line(-6, 8, 6, 8) },
  ];
}

function isrcSegs(): SymSeg[] {
  const r = SYM.srcR;
  return [
    { d: line(0, -30, 0, -r) },
    { d: line(0, r, 0, 30) },
    { d: circle(0, 0, r) },
    { d: line(0, -3, 0, 10) },
    // 箭头朝上（电流正方向从 n 端流向 p 端）
    { d: poly([{ x: 0, y: -12 }, { x: -5, y: -3 }, { x: 5, y: -3 }], true), fill: true },
  ];
}

function vddSegs(): SymSeg[] {
  return [
    { d: line(0, -SYM.railPort, 0, -SYM.railBar) },
    { d: line(-SYM.railHalfW, -SYM.railBar, SYM.railHalfW, -SYM.railBar) },
  ];
}

function gndSegs(): SymSeg[] {
  const w = SYM.railHalfW;
  return [
    { d: line(0, SYM.railPort, 0, SYM.railBar) },
    { d: line(-w, SYM.railBar, w, SYM.railBar) },
    { d: line(-w / 2 - 2, SYM.railBar - 5, w / 2 + 2, SYM.railBar - 5) },
    { d: line(-w / 5 - 1, SYM.railBar - 10, w / 5 + 1, SYM.railBar - 10) },
  ];
}

function portSegs(): SymSeg[] {
  // 信号旗：引线 + 朝上的实心三角
  return [
    { d: line(0, -SYM.railPort, 0, -13) },
    { d: poly([{ x: 0, y: -13 }, { x: -7, y: -4 }, { x: 7, y: -4 }], true), fill: true },
  ];
}

function junctionSegs(): SymSeg[] {
  return [{ d: circle(0, 0, SYM.junctionR), fill: true }];
}

function jumpSegs(): SymSeg[] {
  const h = SYM.jumpHalf;
  const a = SYM.jumpArc;
  return [
    { d: `${line(-h, 0, -a, 0)}M${-a} 0A${a} ${a} 0 0 1 ${a} 0${line(a, 0, h, 0)}` },
  ];
}

/** 生成某元件的全部绘制片段（局部坐标，未变换） */
export function compSegs(c: MosComp): SymSeg[] {
  if (isMos(c)) return mosSegs(c);
  switch (c.kind) {
    case 'resistor':
      return resistorSegs();
    case 'capacitor':
      return capacitorSegs(false);
    case 'capPol':
      return capacitorSegs(true);
    case 'diode':
      return diodeSegs(false);
    case 'zener':
      return diodeSegs(true);
    case 'vsrc':
      return vsrcSegs();
    case 'isrc':
      return isrcSegs();
    case 'vdd':
    case 'port':
      return vddSegs();
    case 'gnd':
      return gndSegs();
    case 'junction':
      return junctionSegs();
    case 'jump':
      return jumpSegs();
    default:
      return [];
  }
}

// ============================================================================
// 包围盒（局部坐标）—— 用于 fit-to-view、标注定位、文本估算
// ============================================================================

const LOCAL_BBOX: Record<CompKind, Rect> = {
  nmos: { x: SYM.gateX, y: -SYM.portDY, w: SYM.leadX + 22 - SYM.gateX, h: SYM.portDY * 2 },
  pmos: { x: SYM.gateX, y: -SYM.portDY, w: SYM.leadX + 22 - SYM.gateX, h: SYM.portDY * 2 },
  resistor: { x: -SYM.resHalfW, y: -30, w: SYM.resHalfW * 2, h: 60 },
  capacitor: { x: -SYM.capHalfW - 16, y: -30, w: (SYM.capHalfW + 16) * 2, h: 60 },
  capPol: { x: -SYM.capHalfW - 16, y: -30, w: (SYM.capHalfW + 16) * 2, h: 60 },
  diode: { x: -SYM.dioHalfW, y: -30, w: SYM.dioHalfW * 2, h: 60 },
  zener: { x: -SYM.dioHalfW, y: -30, w: SYM.dioHalfW * 2, h: 60 },
  vsrc: { x: -SYM.srcR, y: -30, w: SYM.srcR * 2, h: 60 },
  isrc: { x: -SYM.srcR, y: -30, w: SYM.srcR * 2, h: 60 },
  vdd: { x: -SYM.railHalfW, y: -SYM.railPort, w: SYM.railHalfW * 2, h: 20 },
  gnd: { x: -SYM.railHalfW, y: SYM.railPort - 34, w: SYM.railHalfW * 2, h: 34 },
  port: { x: -SYM.railHalfW, y: -SYM.railPort, w: SYM.railHalfW * 2, h: 24 },
  junction: { x: -SYM.junctionR, y: -SYM.junctionR, w: SYM.junctionR * 2, h: SYM.junctionR * 2 },
  jump: { x: -SYM.jumpHalf, y: -SYM.jumpArc, w: SYM.jumpHalf * 2, h: SYM.jumpArc * 2 },
};

/** 世界坐标包围盒。旋转 90/270 时宽高互换 —— 这是可被断言的不变量 */
export function compBBox(c: MosComp): Rect {
  const b = LOCAL_BBOX[c.kind] ?? { x: -20, y: -20, w: 40, h: 40 };
  const corners: Pt[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ].map((p) => localToWorld(c, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ============================================================================
// 标注文本（永不旋转）
// ============================================================================

export interface LabelItem {
  x: number;
  y: number;
  text: string;
  size: number;
  align: 'left' | 'center' | 'right';
  color: ColorToken;
  bold: boolean;
}

/**
 * 元件的自动标注 —— **恒为空**。
 *
 * 曾经在这里自动生成「实例名 + W/L + Vt」两行文字，结果画完一堆管子
 * 满屏都是 M1/2u/65n，压住连线、糊住栅极。
 *
 * 现在**元件一律不带标注**：要写字就放一个「文本」元件。附带好处是
 * 实例名退回「属性面板里的一个字段」，不再干扰读图，导出 SVG 也不会
 * 莫名多出一堆 M1。
 *
 * 函数保留（而非删掉三处调用点）是因为渲染、包围盒、命中测试都按
 * 「元件可能带标注」的形状写的；留一个恒空实现省掉一轮无谓的分支改动，
 * 将来若要做「批量显示实例名」，改这一处即可。
 */
export function compLabels(_c: MosComp): LabelItem[] {
  return [];
}
