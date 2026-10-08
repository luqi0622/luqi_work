/**
 * 时序波形图 —— 纯逻辑层
 *
 * 纪律：这里**不允许出现 document / window / DOM API**。
 * 好处是这些函数能被 esbuild bundle 后交给 node 直接跑断言测试，
 * 出错时读断言比在页面上猜快得多。
 */

/**
 * 注意：`type` 修饰符是**必须**的，不能省。
 *
 * Vite dev 下 esbuild 逐文件转译，`import { AnalogSeg }`（接口）会被原样保留成
 * 运行时的具名导入，浏览器直接抛 "does not provide an export named 'AnalogSeg'"。
 * 而 `tsc` 单文件检查时会把整个文件当整体，压根看不出这个问题 —— 踩过一次。
 */
import {
  type AnalogSeg,
  type BusSeg,
  type ClockSeg,
  type DigitalSeg,
  type Marker,
  MAX_SIGNALS,
  MAX_TICKS,
  SIGNAL_COLORS,
  type Signal,
  type Span,
  type TimingDoc,
  DEFAULT_CLOCK,
  DEFAULT_EDGES,
} from './types';

// ============================================================================
// ID 生成
// ============================================================================

let idSeq = 0;
/** 生成递增 ID。不注入外部计数器是为了让测试可复现。 */
export function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}${idSeq}`;
}

/** 导入外部数据后调用，避免新加的 ID 和已导入的撞号 */
export function bumpIdSeq(doc: TimingDoc): void {
  let max = 0;
  const scan = (id: string) => {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  doc.signals.forEach((s) => scan(s.id));
  doc.markers.forEach((m) => scan(m.id));
  doc.spans.forEach((s) => scan(s.id));
  idSeq = Math.max(idSeq, max);
}

// ============================================================================
// 时间换算
// ============================================================================

/** tick → 真实纳秒数 */
export function tickToNs(doc: TimingDoc, t: number): number {
  return t * doc.tickNs;
}

/** 真实纳秒 → tick（就地取整） */
export function nsToTick(doc: TimingDoc, ns: number): number {
  return Math.round(ns / doc.tickNs);
}

/**
 * 把tick 格式化成带单位的时间字符串
 *
 * 关键处理：避免浮点尾巴。0.1+0.2 类误差在这里统一由 toPrecision 截掉，
 * 否则画布上会出现 "1.7999999999ns" 这种东西。
 */
export function formatTime(doc: TimingDoc, t: number): string {
  const ns = t * doc.tickNs;
  if (ns === 0) return '0';
  const abs = Math.abs(ns);
  if (abs >= 1e6) return `${trimNum(ns / 1e6)} ms`;
  if (abs >= 1000) return `${trimNum(ns / 1000)} μs`;
  if (abs >= 1) return `${trimNum(ns)} ns`;
  return `${trimNum(ns * 1000)} ps`;
}

/** 去掉浮点尾数：1.2000000000000002 → 1.2 */
export function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Number(n.toPrecision(12));
  return String(r);
}

/** tick → 像素 x 坐标（画布左侧留出信号名列） */
export function tickToX(doc: TimingDoc, t: number, nameW: number, pxPerTick: number): number {
  return nameW + t * pxPerTick;
}

/** 像素 x 坐标 → tick（可能为小数，由调用方决定是否取整） */
export function xToTick(x: number, nameW: number, pxPerTick: number): number {
  return (x - nameW) / pxPerTick;
}

// ============================================================================
// 时钟 → 展开成边沿
// ============================================================================

/**
 * 时钟信号展开为实际跳变位置
 *
 * 与数字信号不同，时钟是「参数化」的：改周期会让所有沿一起动，
 * 这正是时钟该有的行为 —— 你改tCK 不应该逐个沿去改。
 *
 * 返回升序边沿数组。占空比决定高低电平的分界点。
 */
export function clockEdges(seg: ClockSeg, lengthTicks: number): number[] {
  const { period, duty, phase, initial } = seg;
  if (period < 2) return [];
  // 占空比钳制在 [0.05, 0.95]：0 或 1 会让波形退化成一条直线，没有边沿
  const d = Math.min(0.95, Math.max(0.05, duty));
  const edges: number[] = [];
  // 反推需要多少个周期才能铺满全长
  const count = Math.ceil((lengthTicks - phase) / period) + 1;
  for (let k = 0; k <= count; k++) {
    const base = phase + k * period;
    // 偶数周期沿是上升沿位置，奇数是下降沿位置；initial 决定谁在前
    if (initial === 1) {
      edges.push(base + Math.round(period * (1 - d)));
      edges.push(base + period);
    } else {
      edges.push(base);
      edges.push(base + Math.round(period * d));
    }
  }
  return edges.filter((t) => t >= 0 && t <= lengthTicks).sort((a, b) => a - b);
}

/**
 * 时钟在任意 tick 的电平
 *
 * 没有它渲染器就得把边沿扫一遍再数奇偶 —— O(n)。直接算周期是 O(1)，
 * 而且拖动游标时每帧都会调这个函数。
 */
export function clockLevelAt(seg: ClockSeg, t: number): 0 | 1 {
  const { period, duty, phase, initial } = seg;
  if (period < 2) return initial;
  const d = Math.min(0.95, Math.max(0.05, duty));
  if (t < phase) return initial;
  const local = (t - phase) % period;
  const highLen = period * d;
  if (initial === 1) {
    // 高电平在后半段：local >= highLen 时为低
    return local >= highLen ? 0 : 1;
  }
  return local < highLen ? 1 : 0;
}

// ============================================================================
// 总线值格式化
// ============================================================================

/** 数值 → 十六进制，按位宽补零，如 5 → "05"（width=8） */
export function toHex(v: number, width: number): string {
  const masked = width >= 32 ? v >>> 0 : v & ((1 << width) - 1);
  const digits = Math.ceil(width / 4);
  return (masked >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

/** 十六进制字符串 → 数值，非法输入返回 null */
export function fromHex(s: string): number | null {
  const t = s.trim().replace(/^0[xX]/, '');
  if (t === '' || !/^[0-9a-fA-F]+$/.test(t)) return null;
  const v = parseInt(t, 16);
  return Number.isFinite(v) ? v : null;
}

/** 总线在 tick 处的值（找不到所在段则取最后一段的值） */
export function busValueAt(seg: BusSeg, t: number): number {
  let v = seg.segments[0]?.v ?? 0;
  for (const s of seg.segments) {
    if (s.t <= t) v = s.v;
    else break;
  }
  return v;
}

/** 两个总线段的 X 交叉半宽：不能超过相邻段长度的一半，否则会盖住上下文的电平 */
export function crossHalfWidth(seg: BusSeg, index: number, maxW: number): number {
  const prev = index > 0 ? seg.segments[index - 1] : null;
  const cur = seg.segments[index];
  if (!cur) return 0;
  const curLen = index < seg.segments.length - 1 ? seg.segments[index + 1].t - cur.t : Infinity;
  const prevLen = prev ? cur.t - prev.t : Infinity;
  return Math.max(0, Math.min(maxW, curLen / 4, prevLen / 4));
}

// ============================================================================
// 数字信号电平求值
// ============================================================================

/** 数字信号在 tick 处的电平：数一下它前面有几个边沿，奇偶决定电平 */
export function digitalLevelAt(seg: DigitalSeg, t: number): 0 | 1 {
  let level = seg.initial;
  for (const e of seg.edges) {
    if (e <= t) level = level === 1 ? 0 : 1;
    else break;
  }
  return level;
}

/** 数字信号在某tick 的所有跳变（边沿本身算一次跳变） */
export function digitalEdgesIn(seg: DigitalSeg, from: number, to: number): number[] {
  return seg.edges.filter((e) => e >= from && e <= to);
}

// ============================================================================
// 编辑操作（全部返回新对象，不改原对象）
// ============================================================================

/** 钳制 tick 到合法范围 */
export function clampTick(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(MAX_TICKS, Math.round(t)));
}

/** 移动一个边沿。返回新的边沿数组 */
export function moveEdge(edges: number[], index: number, to: number): number[] {
  if (index < 0 || index >= edges.length) return edges;
  const next = edges.slice();
  const v = clampTick(to);
  // 边沿不能重合：前一个之后、 后一个之前。若越界则退到邻居位置
  const lo = index > 0 ? next[index - 1] + 1 : 0;
  const hi = index < next.length - 1 ? next[index + 1] - 1 : MAX_TICKS;
  next[index] = Math.max(lo, Math.min(hi, v));
  return next;
}

/** 插入一个边沿（保持升序） */
export function insertEdge(edges: number[], t: number): number[] {
  const next = edges.slice();
  next.push(clampTick(t));
  return next.sort((a, b) => a - b);
}

/** 删除一个边沿 */
export function removeEdge(edges: number[], index: number): number[] {
  if (index < 0 || index >= edges.length) return edges;
  return edges.filter((_, i) => i !== index);
}

/**
 * 找到离给定 tick 最近的一个边沿，返回索引；没有则返回 -1
 *
 * 命中容差按 0.5 格算：半格以内的点击算命中，超了就不容易误拖。
 */
export function nearestEdge(edges: number[], t: number, tolerance: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const d = Math.abs(edges[i] - t);
    if (d < bestD && d <= tolerance) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ============================================================================
// 吸附
// ============================================================================

/**
 * 吸附一个 tick：优先吸附到已有游标 / 时钟沿 / 其他信号的边沿，其次吸附到网格
 *
 * tolerance 以 tick 为单位。返回吸附后的位置和吸附类型的说明（用于状态栏提示）。
 */
export function snapTick(
  doc: TimingDoc,
  t: number,
  opts: { skipSignalId?: string; tolerance?: number } = {},
): { t: number; hint: string } {
  const tol = opts.tolerance ?? 0.5;
  let best = t;
  let bestD = Infinity;
  let hint = '';

  const consider = (cand: number, label: string) => {
    const d = Math.abs(cand - t);
    if (d <= tol && d < bestD) {
      bestD = d;
      best = cand;
      hint = label;
    }
  };

  doc.markers.forEach((m) => consider(m.t, `游标 ${m.label}`));
  doc.signals.forEach((s) => {
    if (s.id === opts.skipSignalId) return;
    if (s.kind === 'digital') s.edges.forEach((e) => consider(e, `对齐 ${s.name}`));
    if (s.kind === 'clock') clockEdges(s, doc.lengthTicks).forEach((e) => consider(e, `对齐 ${s.name} 沿`));
  });
  if (hint) return { t: best, hint };

  // 没吸到标志物就吸网格
  const g = Math.max(1, doc.majorEvery / 5);
  const snapped = Math.round(t / g) * g;
  if (Math.abs(snapped - t) <= tol) return { t: snapped, hint: '吸附网格' };
  return { t, hint: '' };
}

// ============================================================================
// 信号增删改
// ============================================================================

/** 按顺序分配一个不重复的颜色 */
export function pickColor(doc: TimingDoc): string {
  return SIGNAL_COLORS[doc.signals.length % SIGNAL_COLORS.length];
}

export function addDigital(doc: TimingDoc): { doc: TimingDoc; id: string } {
  if (doc.signals.length >= MAX_SIGNALS) return { doc, id: '' };
  const id = nextId('s');
  const color = pickColor(doc);
  const sig: DigitalSeg = {
    kind: 'digital',
    id,
    name: `SIG${doc.signals.length + 1}`,
    initial: 0,
    edges: DEFAULT_EDGES.slice(),
    color,
  };
  return { doc: { ...doc, signals: [...doc.signals, sig] }, id };
}

export function addClock(doc: TimingDoc): { doc: TimingDoc; id: string } {
  if (doc.signals.length >= MAX_SIGNALS) return { doc, id: '' };
  const id = nextId('s');
  const sig: ClockSeg = {
    kind: 'clock',
    id,
    name: `CLK${doc.signals.length + 1}`,
    period: DEFAULT_CLOCK.period,
    duty: DEFAULT_CLOCK.duty,
    initial: DEFAULT_CLOCK.initial,
    phase: DEFAULT_CLOCK.phase,
    color: pickColor(doc),
  };
  return { doc: { ...doc, signals: [...doc.signals, sig] }, id };
}

export function addBus(doc: TimingDoc): { doc: TimingDoc; id: string } {
  if (doc.signals.length >= MAX_SIGNALS) return { doc, id: '' };
  const id = nextId('s');
  const sig: BusSeg = {
    kind: 'bus',
    id,
    name: `BUS${doc.signals.length + 1}`,
    width: 8,
    segments: [
      { t: 0, v: 0 },
      { t: Math.round(doc.lengthTicks / 3), v: 0 },
    ],
    color: pickColor(doc),
  };
  return { doc: { ...doc, signals: [...doc.signals, sig] }, id };
}

export function addAnalog(doc: TimingDoc): { doc: TimingDoc; id: string } {
  if (doc.signals.length >= MAX_SIGNALS) return { doc, id: '' };
  const id = nextId('s');
  const L = doc.lengthTicks;
  const sig: AnalogSeg = {
    kind: 'analog',
    id,
    name: `ANA${doc.signals.length + 1}`,
    points: [
      { t: 0, v: 0.1 },
      { t: Math.round(L / 2), v: 0.85 },
      { t: L, v: 0.2 },
    ],
    color: pickColor(doc),
  };
  return { doc: { ...doc, signals: [...doc.signals, sig] }, id };
}

/** 按 id 替换某条信号 */
export function replaceSignal(doc: TimingDoc, id: string, next: Signal): TimingDoc {
  return { ...doc, signals: doc.signals.map((s) => (s.id === id ? next : s)) };
}

/**
 * 按 id 删除信号。
 *
 * **必须只删一条**。曾经因为新建信号的 id 与既有信号撞车，
 * 一次点击把两条信号一起删掉（界面上表现为「删一条，少了两条」）。
 * 这里的 findIndex + splice 只定位并删第一条，天然免疫 id 撞车；
 * 若要按 id 全删，得先搞清楚 id 为什么撞了。
 */
export function removeSignal(doc: TimingDoc, id: string): TimingDoc {
  const i = doc.signals.findIndex((s) => s.id === id);
  if (i < 0) return doc;
  const sigs = doc.signals.slice();
  sigs.splice(i, 1);
  return { ...doc, signals: sigs };
}

/** 上移/下移一条信号 */
export function reorderSignal(doc: TimingDoc, id: string, delta: number): TimingDoc {
  const i = doc.signals.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.signals.length) return doc;
  const sigs = doc.signals.slice();
  const [s] = sigs.splice(i, 1);
  sigs.splice(j, 0, s);
  return { ...doc, signals: sigs };
}

// ============================================================================
// 标注增删
// ============================================================================

export function addMarker(doc: TimingDoc, t: number): { doc: TimingDoc; id: string } {
  const id = nextId('m');
  const m: Marker = { id, t: clampTick(t), label: `t${doc.markers.length}` };
  return { doc: { ...doc, markers: [...doc.markers, m] }, id };
}

export function removeMarker(doc: TimingDoc, id: string): TimingDoc {
  return { ...doc, markers: doc.markers.filter((m) => m.id !== id) };
}

export function addSpan(doc: TimingDoc, t1: number, t2: number, row: number): { doc: TimingDoc; id: string } {
  if (doc.spans.length >= 16) return { doc, id: '' };
  const id = nextId('p');
  const a = clampTick(Math.min(t1, t2));
  const b = clampTick(Math.max(t1, t2));
  const s: Span = { id, t1: a, t2: b, label: 't', row: Math.max(-1, row) };
  return { doc: { ...doc, spans: [...doc.spans, s] }, id };
}

export function removeSpan(doc: TimingDoc, id: string): TimingDoc {
  return { ...doc, spans: doc.spans.filter((s) => s.id !== id) };
}

// ============================================================================
// 撤销 / 重做
// ============================================================================

/** 用 JSON 深拷贝做快照。时序图文档很小（几十 KB 以内），深拷贝比做结构共享简单可靠 */
export function cloneDoc(doc: TimingDoc): TimingDoc {
  return JSON.parse(JSON.stringify(doc)) as TimingDoc;
}

export interface History {
  past: TimingDoc[];
  future: TimingDoc[];
  limit: number;
}

/** 记录一次变更前���状态 */
export function pushHistory(hist: History, before: TimingDoc): History {
  const past = hist.past.concat([before]);
  // 上限保护：防止连续拖动把内存吃满
  const limit = hist.limit ?? 80;
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
    limit,
  };
}

export function canUndo(hist: History): boolean {
  return hist.past.length > 0;
}

export function canRedo(hist: History): boolean {
  return hist.future.length > 0;
}

// ============================================================================
// 归一化（导入外部 JSON / 修复脏数据）
// ============================================================================

/**
 * 把任意输入规整成合法文档
 *
 * 存在的意义：localStorage 里的东西可能是半年前的老版本、
 * 用户手改过的 JSON、或者另一个时序图工具导出的文件。
 * 渲染器不该处理这些，它只该假设拿到的一定是合法文档。
 */
export function normalize(input: unknown): TimingDoc {
  const o = (input ?? {}) as Partial<TimingDoc>;
  // 注意：不能只写 `o.lengthTicks ?? 200`。若是 'abc' 这种脏数据，
  // ?? 不会兜住（非 null），clampTick 会把它变成 0 → 零长文档 → 画布全空。
  const lengthTicks = normalizeLength(o.lengthTicks);
  const majorEvery = Math.max(1, Math.min(lengthTicks, Math.round(asFinite(o.majorEvery, 20))));
  const signals: Signal[] = (Array.isArray(o.signals) ? o.signals : [])
    .slice(0, MAX_SIGNALS)
    .map((raw, i) => normalizeSignal(raw, i, lengthTicks));
  return {
    title: typeof o.title === 'string' ? o.title : '未命名时序图',
    tickNs: normalizeTickNs(o.tickNs),
    lengthTicks,
    majorEvery,
    signals,
    markers: (Array.isArray(o.markers) ? o.markers : [])
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : nextId('m'),
        t: clampTick(m.t),
        label: typeof m.label === 'string' ? m.label : 't',
      })),
    spans: (Array.isArray(o.spans) ? o.spans : [])
      .slice(0, 16)
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : nextId('p'),
        t1: clampTick(Math.min(s.t1, s.t2)),
        t2: clampTick(Math.max(s.t1, s.t2)),
        label: typeof s.label === 'string' ? s.label : 't',
        row: Number.isFinite(s.row) ? Number(s.row) : -1,
      })),
  };
}

function normalizeTickNs(n: unknown): number {
  return Math.min(1e6, Math.max(0.001, asFinite(n, 1)));
}

/** 只接受有限数字，脏数据（字符串 / NaN / Infinity / 0）一律回落到默认值 */
function asFinite(n: unknown, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) && v !== 0 ? v : fallback;
}

/** 文档总长度：必须是 ≥1 的整数，否则画布没有可用宽度 */
function normalizeLength(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return 200;
  return clampTick(v);
}

function normalizeSignal(raw: unknown, index: number, lengthTicks: number): Signal {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : `s${index + 1}`;
  const name = typeof o.name === 'string' && o.name ? o.name : `SIG${index + 1}`;
  const color =
    typeof o.color === 'string' && o.color ? o.color : SIGNAL_COLORS[index % SIGNAL_COLORS.length];

  const kind = o.kind as Signal['kind'];
  if (kind === 'clock') {
    return {
      kind: 'clock',
      id,
      name,
      color,
      period: Math.max(2, Math.round(Number(o.period) || 10)),
      duty: Math.min(0.95, Math.max(0.05, Number(o.duty) || 0.5)),
      initial: o.initial === 1 ? 1 : 0,
      phase: clampTick(Number(o.phase) || 0),
    };
  }
  if (kind === 'bus') {
    const width = Math.max(1, Math.min(32, Math.round(Number(o.width) || 8)));
    const segs = (Array.isArray(o.segments) ? o.segments : [])
      .map((s) => ({ t: clampTick(s.t), v: Number(s.v) || 0 }))
      .sort((a, b) => a.t - b.t);
    // 第一段必须从 0 开始，否则 t=0 之前没有值可显示
    if (segs.length === 0 || segs[0].t !== 0) segs.unshift({ t: 0, v: 0 });
    return { kind: 'bus', id, name, color, width, segments: segs };
  }
  if (kind === 'analog') {
    const pts = (Array.isArray(o.points) ? o.points : [])
      .map((p) => ({ t: clampTick(p.t), v: Math.min(1, Math.max(0, Number(p.v) || 0)) }))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2) pts.push({ t: lengthTicks, v: 0.5 });
    return { kind: 'analog', id, name, color, points: pts };
  }
  // 默认当数字信号
  const edges = (Array.isArray(o.edges) ? o.edges : [])
    .map((e) => clampTick(e))
    .sort((a, b) => a - b);
  // 去重：重合边沿会让电平计算出现「零宽度段」
  return {
    kind: 'digital',
    id,
    name,
    color,
    initial: o.initial === 1 ? 1 : 0,
    edges: edges.filter((e, i) => i === 0 || e !== edges[i - 1]),
  };
}