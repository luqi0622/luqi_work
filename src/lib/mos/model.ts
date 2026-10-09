/**
 * MOS 管级电路图 —— 文档状态与纯逻辑（零 DOM）
 *
 * 纪律：这里**不允许出现 document / window / DOM API**。
 * 好处是这些函数能被 esbuild bundle 后交给 node 直接跑断言测试。
 *
 * 注意：`type` 修饰符是**必须**的 —— Vite dev 下 esbuild 逐文件转译，
 * `import { MosDoc }`（接口）会原样保留成运行时具名导入，浏览器直接抛
 * "does not provide an export named"。而 `tsc` 单文件检查压根看不出这个问题。
 */

import {
  type CompKind,
  type ColorToken,
  type DiagResult,
  type Endpoint,
  type MosComp,
  type MosDoc,
  type MosFet,
  type Pt,
  type StrokeStyle,
  type TextNote,
  type Wire,
  COLOR_TOKENS,
  DEFAULT_WIRE_STYLE,
  DASH_PATTERNS,
  GRID,
  HISTORY_LIMIT,
  MAX_COMPS,
  MAX_TEXT,
  MAX_VIA,
  MAX_WIRES,
  ROTS,
  emptyDoc,
  emptyDiag,
  isMos,
} from './types';
import { compBBox, portNames, portWorld } from './symbols';
import { wirePts } from './geometry';

// ============================================================================
// ID 生成
// ============================================================================

let idSeq = 0;

export function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}${idSeq}`;
}

/** 导入外部数据 / 载入预设后调用，避免新 ID 撞号 */
export function bumpIdSeq(doc: MosDoc): void {
  let max = 0;
  const scan = (id: string) => {
    const m = /(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  doc.components.forEach((c) => scan(c.id));
  doc.wires.forEach((w) => scan(w.id));
  doc.texts.forEach((t) => scan(t.id));
  idSeq = Math.max(idSeq, max);
}

// ============================================================================
// 深拷贝与历史
// ============================================================================

export function cloneDoc(doc: MosDoc): MosDoc {
  return JSON.parse(JSON.stringify(doc)) as MosDoc;
}

export interface History {
  past: MosDoc[];
  future: MosDoc[];
  limit: number;
}

export function emptyHistory(limit = HISTORY_LIMIT): History {
  return { past: [], future: [], limit };
}

/**
 * 记录一次快照。**必须在改动 doc 之前调用。**
 *
 * 拖拽过程中用 `mutateLive`（改 doc 但不记历史），只在 pointerup 时记一次，
 * 否则一次拖拽会产生几十条历史，撤销一下只退一格。
 */
export function pushHistory(h: History, snapshot: MosDoc): void {
  h.past.push(snapshot);
  if (h.past.length > h.limit) h.past.shift();
  h.future.length = 0;
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}
export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History, doc: MosDoc): MosDoc | null {
  const prev = h.past.pop();
  if (!prev) return null;
  h.future.push(cloneDoc(doc));
  return prev;
}

export function redo(h: History, doc: MosDoc): MosDoc | null {
  const nxt = h.future.pop();
  if (!nxt) return null;
  h.past.push(cloneDoc(doc));
  return nxt;
}

// ============================================================================
// 实例名自动编号
// ============================================================================

const LABEL_PREFIX: Partial<Record<CompKind, string>> = {
  nmos: 'M',
  pmos: 'M',
  resistor: 'R',
  capacitor: 'C',
  capPol: 'C',
  diode: 'D',
  zener: 'D',
  vsrc: 'V',
  isrc: 'I',
};

export function autoLabel(doc: MosDoc, kind: CompKind): string {
  const base = LABEL_PREFIX[kind] ?? 'X';
  // nmos 与 pmos 共用 M 前缀，靠递增序号区分，不冲突
  let n = 1;
  const taken = new Set(doc.components.map((c) => c.label));
  while (taken.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

// ============================================================================
// 增删改
// ============================================================================

export function makeComp(doc: MosDoc, kind: CompKind, x: number, y: number): MosComp {
  const base = {
    id: nextId('c'),
    kind,
    x: Math.round(x),
    y: Math.round(y),
    rot: 0 as const,
    flip: false,
    label: '',
    color: null,
  };
  switch (kind) {
    case 'nmos':
    case 'pmos':
      return { ...base, kind, label: autoLabel(doc, kind), bodyTied: false, w: '', l: '', model: '', vth: '' } as MosFet;
    case 'resistor':
      return { ...base, kind, label: autoLabel(doc, kind), value: '' };
    case 'capacitor':
    case 'capPol':
      return { ...base, kind, label: autoLabel(doc, kind), value: '' };
    case 'diode':
    case 'zener':
      return { ...base, kind, label: autoLabel(doc, kind), value: '' };
    case 'vsrc':
      return { ...base, kind, label: autoLabel(doc, kind), value: '', level: '' };
    case 'isrc':
      return { ...base, kind, label: autoLabel(doc, kind), value: '' };
    case 'vdd':
      return { ...base, kind, label: '', net: 'VDD', level: '' };
    case 'gnd':
      return { ...base, kind, label: '', net: 'VSS', level: '' };
    case 'port':
      return { ...base, kind, label: '', net: '', level: '' };
    default:
      return { ...base, kind, label: '' };
  }
}

export function addComp(doc: MosDoc, c: MosComp): MosDoc {
  return { ...doc, components: [...doc.components, c] };
}

export function makeWire(doc: MosDoc, a: Endpoint, b: Endpoint, style?: Partial<StrokeStyle>): Wire {
  return {
    id: nextId('w'),
    a,
    b,
    via: [],
    style: { ...DEFAULT_WIRE_STYLE, ...style },
  };
}

export function addWire(doc: MosDoc, w: Wire): MosDoc {
  return { ...doc, wires: [...doc.wires, w] };
}

/**
 * 删除元件。**连同挂在它上面的线一起删** —— 保留悬空线会让图越用越乱，
 * 而用户想删线时直接点线就行。
 */
export function removeComps(doc: MosDoc, ids: Set<string>): MosDoc {
  const components = doc.components.filter((c) => !ids.has(c.id));
  const wires = doc.wires.filter(
    (w) => !(w.a.kind === 'port' && ids.has(w.a.ref.comp)) && !(w.b.kind === 'port' && ids.has(w.b.ref.comp)),
  );
  return { ...doc, components, wires };
}

/** 删除线。只删第一条 —— 用 findIndex+splice 而不是 filter，免疫 ID 撞车 */
export function removeWires(doc: MosDoc, id: string): MosDoc {
  const idx = doc.wires.findIndex((w) => w.id === id);
  if (idx < 0) return doc;
  const wires = doc.wires.slice();
  wires.splice(idx, 1);
  return { ...doc, wires };
}

export function removeTexts(doc: MosDoc, ids: Set<string>): MosDoc {
  return { ...doc, texts: doc.texts.filter((t) => !ids.has(t.id)) };
}

/** 旋转。绕锚点，只改 rot 字段 —— 端口坐标实时重算，线自动跟随 */
export function rotateComps(doc: MosDoc, ids: Set<string>, delta: 1 | -1): MosDoc {
  return {
    ...doc,
    components: doc.components.map((c) => {
      if (!ids.has(c.id)) return c;
      const i = ROTS.indexOf(c.rot);
      const n = ((i + delta) % 4 + 4) % 4;
      return { ...c, rot: ROTS[n] };
    }),
  };
}

export function flipComps(doc: MosDoc, ids: Set<string>): MosDoc {
  return {
    ...doc,
    components: doc.components.map((c) => (ids.has(c.id) ? { ...c, flip: !c.flip } : c)),
  };
}

export function moveComps(doc: MosDoc, ids: Set<string>, dx: number, dy: number): MosDoc {
  if (dx === 0 && dy === 0) return doc;
  return {
    ...doc,
    components: doc.components.map((c) => (ids.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
  };
}

export function updateComp(doc: MosDoc, id: string, patch: Partial<MosComp>): MosDoc {
  return {
    ...doc,
    components: doc.components.map((c) => (c.id === id ? ({ ...c, ...patch } as MosComp) : c)),
  };
}

export function updateWire(doc: MosDoc, id: string, patch: Partial<Wire>): MosDoc {
  return { ...doc, wires: doc.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function updateText(doc: MosDoc, id: string, patch: Partial<TextNote>): MosDoc {
  return { ...doc, texts: doc.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

// ============================================================================
// 对齐与分布
// ============================================================================

export type AlignOp =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'hcenter'
  | 'vcenter';

export function alignComps(doc: MosDoc, ids: Set<string>, op: AlignOp): MosDoc {
  const list = doc.components.filter((c) => ids.has(c.id));
  if (list.length < 2) return doc;
  const boxes = list.map((c) => compBBox(c));
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const cxAll = (minX + maxX) / 2;
  const cyAll = (minY + maxY) / 2;

  const idx = new Map(list.map((c, i) => [c.id, boxes[i]]));
  return {
    ...doc,
    components: doc.components.map((c) => {
      if (!ids.has(c.id)) return c;
      const b = idx.get(c.id)!;
      // 只挪锚点。锚点在 bbox 内的相对位置由 rot/flip 决定，
      // 这里按「锚点 = bbox 对应角/边」处理，够用且可预测
      let nx = c.x;
      let ny = c.y;
      switch (op) {
        case 'left':
          nx += minX - b.x;
          break;
        case 'right':
          nx += maxX - (b.x + b.w);
          break;
        case 'hcenter':
          nx += cxAll - (b.x + b.w / 2);
          break;
        case 'top':
          ny += minY - b.y;
          break;
        case 'bottom':
          ny += maxY - (b.y + b.h);
          break;
        case 'vcenter':
          ny += cyAll - (b.y + b.h / 2);
          break;
      }
      return { ...c, x: nx, y: ny };
    }),
  };
}

/** 等距分布。需要 >= 3 个元件，否则没意义 */
export function distributeComps(doc: MosDoc, ids: Set<string>, axis: 'x' | 'y'): MosDoc {
  const list = doc.components.filter((c) => ids.has(c.id));
  if (list.length < 3) return doc;
  const keyed = list
    .map((c) => ({ c, b: compBBox(c) }))
    .sort((a, b) => (axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = keyed[0].b;
  const last = keyed[keyed.length - 1].b;
  const span =
    axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const totalSize = keyed.reduce((s, k) => s + (axis === 'x' ? k.b.w : k.b.h), 0);
  const gap = (span - totalSize) / (keyed.length - 1);

  const pos = new Map<string, number>();
  let cur = axis === 'x' ? first.x : first.y;
  for (const k of keyed) {
    pos.set(k.c.id, cur);
    cur += (axis === 'x' ? k.b.w : k.b.h) + gap;
  }

  return {
    ...doc,
    components: doc.components.map((c) => {
      if (!ids.has(c.id)) return c;
      const b = keyed.find((k) => k.c.id === c.id)!.b;
      const target = pos.get(c.id)!;
      return axis === 'x'
        ? { ...c, x: c.x + (target - b.x) }
        : { ...c, y: c.y + (target - b.y) };
    }),
  };
}

// ============================================================================
// 复制 / 阵列
// ============================================================================

export interface Selection {
  comps: string[];
  wires: string[];
  texts: string[];
}

export function copySelection(doc: MosDoc, sel: Selection): MosDoc {
  const comps = doc.components.filter((c) => sel.comps.includes(c.id));
  const wires = doc.wires.filter((w) => sel.wires.includes(w.id));
  const texts = doc.texts.filter((t) => sel.texts.includes(t.id));
  // 记下被选中元件的端口清单，粘贴时才能重建指向新元件的连线
  return { ...emptyDoc('clip'), components: comps, wires, texts };
}

/**
 * 粘贴剪贴板内容，偏移一个栅格。
 * **内部 ID 全部重新分配** —— 不重分配会和原文撞号，
 * 症状是「复制两个同样的管子，删一个另一个也跟着消失」。
 */
export function pasteFrom(doc: MosDoc, clip: MosDoc, dx = GRID, dy = GRID): { doc: MosDoc; sel: Selection } {
  const idMap = new Map<string, string>();
  const comps = clip.components.map((c) => {
    const nid = nextId('c');
    idMap.set(c.id, nid);
    return { ...c, id: nid, x: c.x + dx, y: c.y + dy };
  });

  const remap = (e: Endpoint): Endpoint =>
    e.kind === 'free'
      ? { kind: 'free', x: e.x + dx, y: e.y + dy }
      : { kind: 'port', ref: { comp: idMap.get(e.ref.comp) ?? e.ref.comp, port: e.ref.port } };

  const wires = clip.wires.map((w) => ({
    ...w,
    id: nextId('w'),
    a: remap(w.a),
    b: remap(w.b),
    via: w.via.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }));

  const texts = clip.texts.map((t) => ({ ...t, id: nextId('t'), x: t.x + dx, y: t.y + dy }));

  return {
    doc: {
      ...doc,
      components: [...doc.components, ...comps],
      wires: [...doc.wires, ...wires],
      texts: [...doc.texts, ...texts],
    },
    sel: { comps: comps.map((c) => c.id), wires: wires.map((w) => w.id), texts: texts.map((t) => t.id) },
  };
}

/**
 * 阵列复制：在每个原件的 (col*stepX, row*stepY) 位置生成副本。
 * 画差分对、电流镜阵列这类重复结构时省掉大量手工操作。
 */
export function arrayCopy(
  doc: MosDoc,
  sel: Selection,
  rows: number,
  cols: number,
  stepX: number,
  stepY: number,
): { doc: MosDoc; sel: Selection } {
  const clip = copySelection(doc, sel);
  let out = doc;
  let acc: Selection = { comps: [], wires: [], texts: [] };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue; // (0,0) 用原件
      const res = pasteFrom(out, clip, c * stepX, r * stepY);
      out = res.doc;
      acc = {
        comps: [...acc.comps, ...res.sel.comps],
        wires: [...acc.wires, ...res.sel.wires],
        texts: [...acc.texts, ...res.sel.texts],
      };
    }
  }
  return { doc: out, sel: { comps: [...sel.comps, ...acc.comps], wires: [...sel.wires, ...acc.wires], texts: [...sel.texts, ...acc.texts] } };
}

// ============================================================================
// 网络分析（union-find）与悬空诊断
// ============================================================================

/**
 * 把线路并查集。
 *
 * **注意：元件节点 `c:id` 故意不和它的端口 union。**
 * 早先图省事把一个元件的所有端口都 union 到 `c:id`，
 * 结果「栅极接上线」会让**同一元件的漏极源极也变成已连接** ——
 * 悬空诊断全部失效（症状：所有管子的 d/s 都不再标红）。
 * 所以连通性只在端口之间计算，元件只是被动记录归属。
 *
 * **T 型汇接靠几何相交判断**：一条线的自由端点落在另一条的线段上时两者合并。
 * 这样用户不需要手动建节点就能做 T 接（也可以显式放 junction 圆点）。
 */
export function buildNets(doc: MosDoc): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = k;
    while (parent.get(cur) !== r) {
      const nx = parent.get(cur)!;
      parent.set(cur, r);
      cur = nx;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };

  // 只有端口节点参与连通性计算
  for (const c of doc.components) {
    for (const name of portNames(c.kind, isMos(c) ? c.bodyTied : false)) {
      add(`p:${c.id}#${name}`);
    }
  }

  // 每条线把两端并起来
  const wireNode = (w: Wire, e: Endpoint): string => {
    if (e.kind === 'port') return `p:${e.ref.comp}#${e.ref.port}`;
    return `w:${w.id}#free`;
  };
  for (const w of doc.wires) {
    add(`w:${w.id}`);
    union(`w:${w.id}`, wireNode(w, w.a));
    union(`w:${w.id}`, wireNode(w, w.b));
  }

  // 几何相交 → T 型汇接合并
  const allPts = new Map<string, Pt[]>();
  for (const w of doc.wires) allPts.set(w.id, wirePts(doc, w));

  for (const w of doc.wires) {
    for (const e of [w.a, w.b]) {
      if (e.kind !== 'free') continue;
      const myKey = `w:${w.id}#free`;
      const myPts = allPts.get(w.id)!;
      // 只拿「我的另一个端点」去和别人的线比，避免自己和自己合并
      const other = e === w.a ? w.b : w.a;
      const probe: Pt | null = other.kind === 'free' ? { x: other.x, y: other.y } : endpointPosOf(doc, other);
      if (!probe) continue;
      for (const [otherId, pts] of allPts) {
        if (otherId === w.id) continue;
        for (let i = 0; i < pts.length - 1; i++) {
          if (pointOnSeg(probe, pts[i], pts[i + 1])) {
            union(myKey, `w:${otherId}`);
            break;
          }
        }
      }
      void myPts;
    }
  }

  // 同名网络标签（VDD / IN / OUT…）互连 —— 这是原理图的通行约定
  const byNet = new Map<string, string[]>();
  for (const c of doc.components) {
    if (c.kind !== 'vdd' && c.kind !== 'gnd' && c.kind !== 'port') continue;
    const name = (c.net ?? '').trim();
    if (!name) continue;
    const list = byNet.get(name) ?? [];
    list.push(`p:${c.id}#p`);
    byNet.set(name, list);
  }
  for (const list of byNet.values()) {
    for (let i = 1; i < list.length; i++) union(list[0], list[i]);
  }

  const out = new Map<string, Set<string>>();
  for (const k of parent.keys()) {
    const r = find(k);
    const set = out.get(r) ?? new Set<string>();
    set.add(k);
    out.set(r, set);
  }
  return out;
}

/** 端点世界坐标（model 内部的轻量版，避免整个文件再引 geometry 的导出） */
function endpointPosOf(doc: MosDoc, e: Endpoint): Pt | null {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const c = doc.components.find((k) => k.id === e.ref.comp);
  return c ? portWorld(c, e.ref.port) : null;
}

function pointOnSeg(p: Pt, s: Pt, e: Pt): boolean {
  const cross = (e.x - s.x) * (p.y - s.y) - (e.y - s.y) * (p.x - s.x);
  if (Math.abs(cross) > 1e-6) return false;
  const dot = (p.x - s.x) * (e.x - s.x) + (p.y - s.y) * (e.y - s.y);
  if (dot < -1e-6) return false;
  const len2 = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
  return dot <= len2 + 1e-6;
}

/**
 * 诊断。**必须在渲染之前调用** —— 渲染把结果当输入读，
 * 顺序反了高亮会慢一拍（症状：提示"悬空栅极"但管子上没红圈）。
 *
 * 判定口径：端口「通」= 它所属的并查集里至少含一根线。
 * 这样 T 型汇接、同网络标签、通过几何相交连上的自由端点都算通，
 * 不需要为每种连接方式单独写规则。
 */
export function refreshDiags(doc: MosDoc): DiagResult {
  const diag = emptyDiag();
  const nets = buildNets(doc);

  const portsInNet = new Map<string, Set<string>>();
  const compsInNet = new Map<string, Set<string>>();
  const wiresInNet = new Map<string, Set<string>>();

  for (const [root, set] of nets) {
    const ports = new Set<string>();
    const comps = new Set<string>();
    const wires = new Set<string>();
    for (const k of set) {
      if (k.startsWith('p:')) {
        const portKey = k.slice(2); // "compId#port"
        ports.add(portKey);
        comps.add(portKey.split('#')[0]);
      } else if (k.startsWith('w:')) {
        wires.add(k.split('#')[0]);
      }
    }
    portsInNet.set(root, ports);
    compsInNet.set(root, comps);
    wiresInNet.set(root, wires);
    diag.nets.set(root, [...comps]);
  }

  const rootOfPort = new Map<string, string>();
  for (const [root, ports] of portsInNet) {
    for (const p of ports) rootOfPort.set(p, root);
  }

  for (const c of doc.components) {
    for (const name of portNames(c.kind, isMos(c) ? c.bodyTied : false)) {
      const key = `${c.id}#${name}`;
      const root = rootOfPort.get(key);
      if (root === undefined || wiresInNet.get(root)!.size === 0) {
        diag.floating.add(key);
      }
    }
  }

  // 悬空网络：一个网络里只有一根线，且线的另一端也是悬空端口。
  // 「只挂一根线」在 MOS 电路里几乎总是画漏了一路。
  for (const [root, wires] of wiresInNet) {
    if (wires.size > 1) continue;
    const comps = compsInNet.get(root)!;
    if (comps.size === 0) continue;
    diag.stubNets.set(root, [...wires]);
  }

  return diag;
}

/** 某个元件所属网络的根 key。用于悬停高亮整网 */
export function netOfComp(doc: MosDoc, compId: string): string | null {
  const nets = buildNets(doc);
  for (const [root, set] of nets) {
    for (const k of set) {
      if (k.startsWith('p:') && k.split('#')[0] === compId) return root;
    }
  }
  return null;
}

// ============================================================================
// normalize —— 外部 / 脏数据兜底
// ============================================================================

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function color(v: unknown): ColorToken | null {
  return typeof v === 'string' && (COLOR_TOKENS as readonly string[]).includes(v)
    ? (v as ColorToken)
    : null;
}

function style(v: unknown): StrokeStyle {
  const o = (v ?? {}) as Record<string, unknown>;
  const dashRaw = str(o.dash, 'solid');
  return {
    width: Math.max(0.5, Math.min(8, num(o.width, DEFAULT_WIRE_STYLE.width))),
    color: color(o.color) ?? DEFAULT_WIRE_STYLE.color,
    dash: (dashRaw === 'dashed' || dashRaw === 'dotted' || dashRaw === 'solid'
      ? dashRaw
      : DEFAULT_WIRE_STYLE.dash) as StrokeStyle['dash'],
  };
}

const VALID_KINDS: CompKind[] = [
  'nmos', 'pmos', 'resistor', 'capacitor', 'capPol', 'diode', 'zener',
  'vsrc', 'isrc', 'vdd', 'gnd', 'port', 'junction', 'jump',
];

function normEndpoint(v: unknown): Endpoint | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  if (o.kind === 'free') {
    return { kind: 'free', x: num(o.x, 0), y: num(o.y, 0) };
  }
  const ref = o.ref as Record<string, unknown> | undefined;
  if (!ref || typeof ref !== 'object') return null;
  const comp = str(ref.comp);
  if (!comp) return null;
  return { kind: 'port', ref: { comp, port: str(ref.port, 'p') } };
}

function normComp(v: unknown, i: number): MosComp | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const kind = str(o.kind) as CompKind;
  if (!VALID_KINDS.includes(kind)) return null;

  const rotNum = Math.round(num(o.rot, 0));
  const rot = (ROTS.includes(rotNum as never) ? rotNum : 0) as MosComp['rot'];
  const base = {
    id: str(o.id, `c${i + 1}`),
    kind,
    x: num(o.x, 0),
    y: num(o.y, 0),
    rot,
    flip: bool(o.flip, false),
    label: str(o.label),
    color: color(o.color),
  };

  switch (kind) {
    case 'nmos':
    case 'pmos':
      return {
        ...base,
        kind,
        bodyTied: bool(o.bodyTied, false),
        model: str(o.model),
        w: str(o.w),
        l: str(o.l),
        vth: str(o.vth),
      } as MosFet;
    case 'vdd':
      return { ...base, kind, net: str(o.net, 'VDD'), level: str(o.level) };
    case 'gnd':
      return { ...base, kind, net: str(o.net, 'VSS'), level: str(o.level) };
    case 'port':
      return { ...base, kind, net: str(o.net), level: str(o.level) };
    case 'vsrc':
      return { ...base, kind, value: str(o.value), level: str(o.level) };
    case 'isrc':
    case 'resistor':
    case 'capacitor':
    case 'capPol':
    case 'diode':
    case 'zener':
      return { ...base, kind, value: str(o.value) };
    default:
      return { ...base, kind } as MosComp;
  }
}

function normWire(v: unknown, i: number): Wire | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const a = normEndpoint(o.a);
  const b = normEndpoint(o.b);
  if (!a || !b) return null;
  const viaRaw = Array.isArray(o.via) ? o.via : [];
  // 非法项兜底为 {0,0}（不丢数据），与端点重合的剔除交给调用方 ——
  // 因为只有那边才知道端点解析后的世界坐标
  const via = viaRaw.slice(0, MAX_VIA).map((p) => {
    const q = (p ?? {}) as Record<string, unknown>;
    return { x: num(q.x, 0), y: num(q.y, 0) };
  });
  return {
    id: str(o.id, `w${i + 1}`),
    a,
    b,
    via,
    style: style(o.style),
    label: str(o.label) || undefined,
  };
}

function normText(v: unknown, i: number): TextNote | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const rotNum = Math.round(num(o.rot, 0));
  const alignRaw = str(o.align, 'left');
  return {
    id: str(o.id, `t${i + 1}`),
    x: num(o.x, 0),
    y: num(o.y, 0),
    text: str(o.text),
    size: Math.max(6, Math.min(72, num(o.size, 12))),
    align: (alignRaw === 'center' || alignRaw === 'right' ? alignRaw : 'left') as TextNote['align'],
    color: color(o.color) ?? 'ink',
    bold: bool(o.bold, false),
    rot: (ROTS.includes(rotNum as never) ? rotNum : 0) as TextNote['rot'],
  };
}

/**
 * 把任意来源的数据（localStorage 旧版 / 导入的 JSON / 预设）修成合法文档。
 *
 * 纪律：**永远返回合法文档，绝不抛错**。脏数据不该让页面白屏。
 * 调用方只需 `normalize(JSON.parse(raw))` 就完成了一次校验。
 */
export function normalize(input: unknown): MosDoc {
  const base = emptyDoc();
  if (!input || typeof input !== 'object') return base;
  const o = input as Record<string, unknown>;

  const compsRaw = Array.isArray(o.components) ? o.components.slice(0, MAX_COMPS) : [];
  const seen = new Set<string>();
  const components: MosComp[] = [];
  for (const raw of compsRaw) {
    const c = normComp(raw, components.length);
    if (!c) continue;
    // ID 撞车：重复的直接跳过，避免「删一个另一个也消失」
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    components.push(c);
  }

  const compIds = new Set(components.map((c) => c.id));
  const wiresRaw = Array.isArray(o.wires) ? o.wires.slice(0, MAX_WIRES) : [];
  const seenW = new Set<string>();
  const wires: Wire[] = [];
  const posOf = (e: Endpoint): Pt | null => {
    if (e.kind === 'free') return { x: e.x, y: e.y };
    const c = components.find((k) => k.id === e.ref.comp);
    return c ? portWorld(c, e.ref.port) : null;
  };
  for (const raw of wiresRaw) {
    const w = normWire(raw, wires.length);
    if (!w || seenW.has(w.id)) continue;
    // 端点指向不存在的元件 → 降级为自由端点，不丢线
    const fix = (e: Endpoint): Endpoint =>
      e.kind === 'port' && !compIds.has(e.ref.comp)
        ? { kind: 'free', x: 0, y: 0 }
        : e;
    const a = fix(w.a);
    const b = fix(w.b);
    const aPos = posOf(a);
    const bPos = posOf(b);
    // 落在端点上的拐点等于没有，剔掉
    const via = w.via.filter((p) => {
      if (aPos && Math.abs(p.x - aPos.x) < 0.5 && Math.abs(p.y - aPos.y) < 0.5) return false;
      if (bPos && Math.abs(p.x - bPos.x) < 0.5 && Math.abs(p.y - bPos.y) < 0.5) return false;
      return true;
    });
    seenW.add(w.id);
    wires.push({ ...w, a, b, via });
  }

  const textsRaw = Array.isArray(o.texts) ? o.texts.slice(0, MAX_TEXT) : [];
  const seenT = new Set<string>();
  const texts: TextNote[] = [];
  for (const raw of textsRaw) {
    const t = normText(raw, texts.length);
    if (!t || seenT.has(t.id)) continue;
    seenT.add(t.id);
    texts.push(t);
  }

  bumpIdSeq({ ...base, components, wires, texts });

  return {
    version: 1,
    title: str(o.title, base.title),
    showGrid: bool(o.showGrid, true),
    snapGrid: bool(o.snapGrid, true),
    snapTrack: bool(o.snapTrack, true),
    components,
    wires,
    texts,
  };
}

// ============================================================================
// 小工具
// ============================================================================

/** 线型 token → stroke-dasharray（导出 SVG 用，不依赖 CSS） */
export function dashArray(d: StrokeStyle['dash']): string {
  return DASH_PATTERNS[d];
}

/** 端口名（供属性面板与 UI 用） */
export { portNames };
