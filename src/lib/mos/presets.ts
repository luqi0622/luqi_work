/**
 * MOS 管级电路图 —— 内置电路预设
 *
 * 为什么值得做：用户说「经常需要画」，那么**省掉每次从零摆管子**
 * 就是最大的价值。这些预设给的是合理起点，不是标准单元库。
 *
 * 纪律：预设内部 ID 用 `p` 前缀隔离命名空间，载入后 bumpIdSeq 重置计数器 ——
 * 直接用普通 ID 会和运行时 ID 撞车，症状是「载入预设后删一个元件，少了两个」。
 */

import {
  type CompKind,
  type Dir,
  type Endpoint,
  type MosComp,
  type MosDoc,
  type MosFet,
  type Pt,
  type Wire,
  emptyDoc,
  isMos,
} from './types';
import { bumpIdSeq } from './model';
import { portDirWorld, portNames, portWorld } from './symbols';
import { SYM } from './symbols';

export interface Preset {
  key: string;
  name: string;
  hint: string;
  build: () => MosDoc;
}

// ---------------------------------------------------------------------------
// 构造助手（预设专用，ID 走 p 前缀）
// ---------------------------------------------------------------------------

let pSeq = 0;
function pid(): string {
  pSeq += 1;
  return `p${pSeq}`;
}

type Builder = { comps: MosComp[]; wires: Wire[]; texts: MosDoc['texts'] };

/**
 * 新建一个 Builder 并重置 ID 计数器。
 *
 * 计数器必须每次重置 —— 否则第二次构建同一预设时 ID 会继续往上走，
 * 症状是「载入同一预设两次，两张图的元件 ID 不一样」，数组复制/粘贴全乱。
 */
function mk(): Builder {
  pSeq = 0;
  return { comps: [], wires: [], texts: [] };
}

function put<T extends MosComp>(b: Builder, c: Omit<T, 'id'> & { id?: string }): T {
  const full = { ...c, id: c.id ?? pid() } as T;
  b.comps.push(full);
  return full;
}

function fet(
  b: Builder,
  kind: 'nmos' | 'pmos',
  x: number,
  y: number,
  label: string,
  extra: Partial<MosFet> = {},
): MosFet {
  return put<MosFet>(b, {
    kind,
    x,
    y,
    rot: 0,
    flip: false,
    label,
    color: null,
    bodyTied: false,
    w: '1u',
    l: '65n',
    model: '',
    vth: '',
    ...extra,
  });
}

function generic(b: Builder, kind: CompKind, x: number, y: number, label: string, extra: Record<string, unknown> = {}): MosComp {
  return put<MosComp>(b, {
    kind,
    x,
    y,
    rot: 0,
    flip: false,
    label,
    color: null,
    ...extra,
  } as Omit<MosComp, 'id'>);
}

function port(node: MosComp, p: string): Endpoint {
  return { kind: 'port', ref: { comp: node.id, port: p } };
}

function free(x: number, y: number): Endpoint {
  return { kind: 'free', x, y };
}

/**
 * 连两个端口。
 *
 * **via 由代码自动算，不手工写死。**
 * 手工写 via 几乎必然和端口真实坐标错位 —— 端口在元件旋转/镜像后位置会变，
 * 而预设里的数字是照着某个固定布局抄的。症状是连线看着"接上了"，
 * 实际却连到符号旁边（截图里 VDD 那根线接到了栅极上而不是漏极）。
 *
 * 规则很简单：一条连线只允许一个拐点，落在「起点所在列 or 行」与
 * 「终点所在列 or 行」的交点上 —— 这正是曼哈顿布线要的东西。
 */
function link(b: Builder, a: Endpoint, c: Endpoint): Wire {
  const pa = posOf(b, a);
  const pc = posOf(b, c);
  const via = autoVia(pa, pcDir(b, a), pc, pcDir(b, c));
  const w: Wire = {
    id: pid(),
    a,
    b: c,
    via,
    style: { width: 2, color: 'ink', dash: 'solid' },
  };
  b.wires.push(w);
  return w;
}

/** 端点的世界坐标 */
function posOf(b: Builder, e: Endpoint): Pt {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const c = b.comps.find((k) => k.id === e.ref.comp);
  if (!c) return { x: 0, y: 0 };
  const names = portNames(c.kind, isMos(c) ? c.bodyTied : false);
  const name = names.includes(e.ref.port) ? e.ref.port : names[0];
  return portWorld(c, name);
}

/** 端点的出线方向（决定拐点该往哪边让） */
function pcDir(b: Builder, e: Endpoint): Dir {
  if (e.kind === 'free') return 'U';
  const c = b.comps.find((k) => k.id === e.ref.comp);
  if (!c) return 'U';
  const names = portNames(c.kind, isMos(c) ? c.bodyTied : false);
  const name = names.includes(e.ref.port) ? e.ref.port : names[0];
  return portDirWorld(c, name);
}

/**
 * 自动算中间拐点。
 *
 * 核心：**拐点必须同时与起点「共行或共列」、与终点也「共行或共列」**，
 * 否则正交化会插出额外的拐点，走线就绕了。
 */
function autoVia(a: Pt, aDir: Dir, c: Pt, cDir: Dir): Pt[] {
  const g = (v: number) => Math.round(v / 10) * 10;
  const sameX = Math.abs(a.x - c.x) < 1;
  const sameY = Math.abs(a.y - c.y) < 1;
  // 已经共列或共行 → 不需要拐点
  if (sameX || sameY) return [];

  const aH = aDir === 'L' || aDir === 'R';
  const bH = cDir === 'L' || cDir === 'R';

  // 起点横出 + 终点纵入 → 拐点在 (c.x, a.y)
  if (aH && !bH) return [{ x: g(c.x), y: g(a.y) }];
  // 起点纵出 + 终点横入 → 拐点在 (a.x, c.y)
  if (!aH && bH) return [{ x: g(a.x), y: g(c.y) }];

  // 两端都水平：让出中间列
  if (aH && bH) return [{ x: g((a.x + c.x) / 2), y: g(a.y) }, { x: g((a.x + c.x) / 2), y: g(c.y) }];
  // 两端都竖直：让出中间行
  return [{ x: g(a.x), y: g((a.y + c.y) / 2) }, { x: g(c.x), y: g((a.y + c.y) / 2) }];
}

function note(b: Builder, x: number, y: number, text: string, size = 12): void {
  b.texts.push({ id: pid(), x, y, text, size, align: 'left', color: 'muted', bold: false, rot: 0 });
}

function finish(b: Builder, title: string): MosDoc {
  const doc: MosDoc = { ...emptyDoc(title), components: b.comps, wires: b.wires, texts: b.texts };
  bumpIdSeq(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 预设
// ---------------------------------------------------------------------------

/** CMOS 反相器 —— 最常用，一定要有 */
function cmosInverter(): MosDoc {
  const b = mk();
  // 端口坐标：g=(-34,0) d=(12,-34) s=(12,34) b=(-34,44)
  const p = fet(b, 'pmos', 0, -90, 'M1', { model: 'PMOS', w: '2u', l: '65n' });
  const n = fet(b, 'nmos', 0, 90, 'M2', { model: 'NMOS', w: '1u', l: '65n' });
  const vdd = generic(b, 'vdd', 12, -230, '', { net: 'VDD', level: '3.3V' });
  const vss = generic(b, 'gnd', 12, 230, '', { net: 'VSS' });
  const inp = generic(b, 'port', -200, 0, '', { net: 'IN', level: '1.8V' });
  const out = generic(b, 'port', 200, 0, '', { net: 'OUT' });

  // VDD → M1 漏极：同 x=12，竖直一段
  link(b, port(vdd, 'p'), port(p, 'd'));
  // M1 源 ↔ M2 漏 ↔ OUT：同在 x=12 的竖直干线上
  link(b, port(p, 's'), port(n, 'd'));
  link(b, port(out, 'p'), port(p, 's'));
  link(b, port(n, 's'), port(vss, 'p'));
  // 输入同时驱动两管栅极：走 x=-34 竖直干线
  link(b, port(inp, 'p'), port(p, 'g'));
  link(b, port(inp, 'p'), port(n, 'g'));
  // 衬底：栅极同列，往左绕到电源轨
  link(b, port(p, 'b'), port(vdd, 'p'));
  link(b, port(n, 'b'), port(vss, 'p'));

  note(b, -220, 40, '输入同时驱动两管栅极');
  return finish(b, 'CMOS 反相器');
}

/** NMOS 差分对 + 电流镜尾电流源 —— 模拟 IC 最高频结构 */
function diffPair(): MosDoc {
  const b = mk();
  const m1 = fet(b, 'nmos', -100, 0, 'M1', { w: '10u', l: '0.5u' });
  const m2 = fet(b, 'nmos', 100, 0, 'M2', { w: '10u', l: '0.5u' });
  const tail = fet(b, 'nmos', 0, 220, 'M3', { w: '20u', l: '1u', model: '尾电流管' });
  const iss = generic(b, 'isrc', 0, 380, 'I1', { value: '100u' });
  const vss = generic(b, 'gnd', 0, 520, '', { net: 'VSS' });
  const vbias = generic(b, 'port', -260, 300, '', { net: 'VBIAS', level: '1.3V' });

  const vin1 = generic(b, 'port', -300, -60, '', { net: 'VIN1' });
  const vin2 = generic(b, 'port', -300, 60, '', { net: 'VIN2' });
  const vdd = generic(b, 'vdd', 0, -260, '', { net: 'VDD', level: '3.3V' });
  const rl1 = generic(b, 'resistor', -100, -140, 'RL1', { value: '10k' });
  const rl2 = generic(b, 'resistor', 100, -140, 'RL2', { value: '10k' });
  const out1 = generic(b, 'port', -260, -260, '', { net: 'OUT+' });
  const out2 = generic(b, 'port', 260, -260, '', { net: 'OUT-' });

  link(b, port(vin1, 'p'), port(m1, 'g'));
  link(b, port(vin2, 'p'), port(m2, 'g'));
  link(b, port(m1, 's'), port(tail, 'd'));
  link(b, port(m2, 's'), port(tail, 'd'));
  link(b, port(tail, 's'), port(iss, 'p'));
  link(b, port(iss, 'n'), port(vss, 'p'));
  // 尾管栅极接偏置 —— 缺了这根线尾管就是悬空的
  link(b, port(vbias, 'p'), port(tail, 'g'));

  link(b, port(m1, 'd'), port(rl1, 'n'));
  link(b, port(m2, 'd'), port(rl2, 'n'));
  link(b, port(rl1, 'p'), port(vdd, 'p'));
  link(b, port(rl2, 'p'), port(vdd, 'p'));
  link(b, port(rl1, 'p'), port(out1, 'p'));
  link(b, port(rl2, 'p'), port(out2, 'p'));
  // NMOS 衬底统一接 VSS
  link(b, port(m1, 'b'), port(vss, 'p'));
  link(b, port(m2, 'b'), port(vss, 'p'));
  link(b, port(tail, 'b'), port(vss, 'p'));

  note(b, -320, 400, '两侧对称，栅极差分输入');
  return finish(b, 'NMOS 差分对');
}

/** NMOS 电流镜 —— 模拟设计的三大件之一 */
function currentMirror(): MosDoc {
  const b = mk();
  const ref = fet(b, 'nmos', -80, 60, 'M1', { w: '4u', l: '1u' });
  const out = fet(b, 'nmos', 100, 60, 'M2', { w: '8u', l: '1u' });
  const vdd = generic(b, 'vdd', 0, -220, '', { net: 'VDD', level: '3.3V' });
  const vss = generic(b, 'gnd', 0, 260, '', { net: 'VSS' });
  const iref = generic(b, 'port', -260, -60, '', { net: 'IREF', level: '10u' });
  const iout = generic(b, 'port', 300, -60, '', { net: 'IOUT' });

  // 漏栅短接是电流镜的定义
  link(b, port(ref, 'd'), port(ref, 'g'));
  link(b, port(out, 'd'), port(out, 'g'));
  link(b, port(ref, 'g'), port(out, 'g'));
  link(b, port(iref, 'p'), port(ref, 'g'));
  link(b, port(ref, 'd'), port(vdd, 'p'));
  link(b, port(out, 'd'), port(vdd, 'p'));
  link(b, port(out, 'd'), port(iout, 'p'));
  link(b, port(ref, 's'), port(vss, 'p'));
  link(b, port(out, 's'), port(vss, 'p'));
  // NMOS 衬底接 VSS
  link(b, port(ref, 'b'), port(vss, 'p'));
  link(b, port(out, 'b'), port(vss, 'p'));

  note(b, -280, 200, 'W:L = 1:2 → 镜像比 2:1');
  return finish(b, 'NMOS 电流镜');
}

/** 共源放大器 —— 带偏置的最小模拟级 */
function commonSource(): MosDoc {
  const b = mk();
  const m1 = fet(b, 'nmos', 0, 40, 'M1', { w: '10u', l: '0.5u', vth: '0.45' });
  const m2 = fet(b, 'pmos', 0, -160, 'M2', { w: '20u', l: '0.5u', vth: '0.5' });
  const cin = generic(b, 'capacitor', -200, 40, 'C1', { value: '1p' });
  const cout = generic(b, 'capacitor', 200, -60, 'C2', { value: '1p' });
  const vdd = generic(b, 'vdd', 0, -300, '', { net: 'VDD', level: '3.3V' });
  const vss = generic(b, 'gnd', 0, 220, '', { net: 'VSS' });
  const vin = generic(b, 'port', -360, 100, '', { net: 'VIN' });
  const vbias = generic(b, 'port', -200, 160, '', { net: 'VBIAS' });
  const vout = generic(b, 'port', 380, -60, '', { net: 'VOUT' });

  link(b, port(m1, 'd'), port(m2, 's'));
  link(b, port(m1, 's'), port(vss, 'p'));
  link(b, port(m2, 'd'), port(vdd, 'p'));
  // 负载管的栅极接偏置（与信号管共栅偏置是标准共源级画法）
  link(b, port(vbias, 'p'), port(m1, 'g'));
  link(b, port(vbias, 'p'), port(m2, 'g'));
  link(b, port(vin, 'p'), port(cin, 'p'));
  link(b, port(cin, 'n'), port(m1, 'g'));
  link(b, port(m1, 'd'), port(cout, 'p'));
  link(b, port(cout, 'n'), port(vout, 'p'));
  link(b, port(m1, 'd'), port(vout, 'p'));
  // 衬底：NMOS 接 VSS，PMOS 接 VDD
  link(b, port(m1, 'b'), port(vss, 'p'));
  link(b, port(m2, 'b'), port(vdd, 'p'));

  note(b, -380, -120, '共源级：反相电压放大');
  return finish(b, '共源放大器');
}

/** 栅极 ESD 保护 —— 直接对应「画二极管钳位」的需求 */
function gateProtection(): MosDoc {
  const b = mk();
  const core = fet(b, 'nmos', 60, 0, 'M1', { w: '1u', l: '65n' });
  // 上钳位二极管：阳极接栅极（p），阴极接 VDD（n）→ 栅压高于 VDD+0.7 时导通
  const dTop = generic(b, 'diode', -180, -110, 'D1', {});
  // 下钳位二极管：阴极接栅极（n），阳极接 VSS（p）→ 栅压低于 VSS-0.7 时导通
  const dBot = generic(b, 'diode', -180, 110, 'D2', {});
  const vdd = generic(b, 'vdd', -340, -200, '', { net: 'VDD', level: '3.3V' });
  const vss = generic(b, 'gnd', -340, 200, '', { net: 'VSS' });
  const pad = generic(b, 'port', 260, 0, '', { net: 'IO' });

  // 保护管本体：栅极接 IO，漏极接 VDD，源极接 VSS
  link(b, port(pad, 'p'), port(core, 'g'));
  link(b, port(core, 'd'), port(vdd, 'p'));
  link(b, port(core, 's'), port(vss, 'p'));
  link(b, port(core, 'b'), port(vss, 'p'));

  // 二极管钳位：把栅压限制在 VSS ~ VDD+0.7
  link(b, port(dTop, 'n'), port(vdd, 'p'));
  link(b, port(dTop, 'p'), port(core, 'g'));
  link(b, port(dBot, 'n'), port(core, 'g'));
  link(b, port(dBot, 'p'), port(vss, 'p'));

  note(b, 60, 120, '二极管钳位把栅压限制在 VSS~VDD+0.7V');
  return finish(b, '栅极 ESD 保护');
}

/** 施密特触发器（CMOS 6 管）—— 带正反馈，展示阈值可调 */
function schmittTrigger(): MosDoc {
  const b = mk();
  const mp1 = fet(b, 'pmos', -140, -100, 'M1', {});
  const mp2 = fet(b, 'pmos', 140, -100, 'M2', {});
  const mn1 = fet(b, 'nmos', -140, 100, 'M3', {});
  const mn2 = fet(b, 'nmos', 140, 100, 'M4', {});
  const mp3 = fet(b, 'pmos', 0, -100, 'M5', {});
  const mn3 = fet(b, 'nmos', 0, 100, 'M6', {});
  const vdd = generic(b, 'vdd', 0, -300, '', { net: 'VDD', level: '3.3V' });
  const vss = generic(b, 'gnd', 0, 300, '', { net: 'VSS' });
  const vin = generic(b, 'port', -340, 0, '', { net: 'VIN' });
  const vout = generic(b, 'port', 340, 0, '', { net: 'VOUT' });

  link(b, port(vdd, 'p'), port(mp1, 'd'));
  link(b, port(vdd, 'p'), port(mp2, 'd'));
  link(b, port(mp3, 'd'), port(vdd, 'p'));
  link(b, port(mn1, 'd'), port(mp2, 's'));
  link(b, port(mn2, 'd'), port(mp1, 's'));
  link(b, port(mn3, 'd'), port(vss, 'p'));
  link(b, port(mn1, 's'), port(vss, 'p'));
  link(b, port(mn2, 's'), port(vss, 'p'));

  // 正反馈：M1/M4 交叉耦合
  link(b, port(mp1, 's'), port(mn2, 'd'));
  link(b, port(mp2, 's'), port(mn1, 'd'));
  link(b, port(mp1, 'g'), port(mn2, 'g'));
  link(b, port(mp2, 'g'), port(mn1, 'g'));
  link(b, port(mp3, 's'), port(mp3, 'g'));
  link(b, port(mn3, 's'), port(mn3, 'g'));
  link(b, port(mp3, 'g'), port(vin, 'p'));
  link(b, port(mn3, 'g'), port(vin, 'p'));
  link(b, port(vout, 'p'), port(mp3, 'd'));

  // 衬底：PMOS 接 VDD，NMOS 接 VSS
  link(b, port(mp1, 'b'), port(vdd, 'p'));
  link(b, port(mp2, 'b'), port(vdd, 'p'));
  link(b, port(mp3, 'b'), port(vdd, 'p'));
  link(b, port(mn1, 'b'), port(vss, 'p'));
  link(b, port(mn2, 'b'), port(vss, 'p'));
  link(b, port(mn3, 'b'), port(vss, 'p'));

  note(b, -360, 220, '正反馈抬高迟滞电压，两个阈值不等');
  return finish(b, '施密特触发器');
}

export const PRESETS: Preset[] = [
  { key: 'inv', name: 'CMOS 反相器', hint: 'PMOS 上拉 + NMOS 下拉，最基础的数字单元', build: cmosInverter },
  { key: 'diff', name: 'NMOS 差分对', hint: '模拟 IC 的核心结构，电流镜做尾电流源', build: diffPair },
  { key: 'mirror', name: 'NMOS 电流镜', hint: '漏栅短接，靠 W:L 比设定镜像比', build: currentMirror },
  { key: 'cs', name: '共源放大器', hint: '带耦合电容的最小模拟电压放大级', build: commonSource },
  { key: 'gprotect', name: '栅极 ESD 保护', hint: '二极管钳位把栅压限制在电源轨之间', build: gateProtection },
  { key: 'schmitt', name: '施密特触发器', hint: '6 管交叉耦合，正反馈抬高迟滞', build: schmittTrigger },
];

export function presetByKey(key: string): Preset | undefined {
  return PRESETS.find((p) => p.key === key);
}

/** 空图预设 */
export function blankPreset(): MosDoc {
  pSeq = 0;
  return finish({ comps: [], wires: [], texts: [] }, '未命名电路');
}

export { SYM };
