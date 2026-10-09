/**
 * MOS 管级电路图 —— 断言测试
 *
 * 运行（项目无 devDependencies，用传递依赖的 esbuild）：
 *   npx esbuild src/lib/mos/__tests__/core.test.ts --bundle --format=esm \
 *     --platform=node --outfile=.tmp-test.mjs --log-level=warning
 *   node .tmp-test.mjs
 */

import {
  type MosComp,
  type MosDoc,
  type MosFet,
  type Pt,
  type Wire,
  DASH_PATTERNS,
  GRID,
  ROTS,
  emptyDoc,
  isMos,
} from '../types';
import {
  compBBox,
  compLabels,
  compSegs,
  localToWorld,
  portDirWorld,
  portNames,
  portWorld,
  rotateDir,
} from '../symbols';
import {
  boundsOf,
  cleanPts,
  dragVertex,
  ensureMinSize,
  labelAt,
  orthoFix,
  orthoRoute,
  screenToWorld,
  snapPoint,
  wirePathD,
  wirePts,
  worldToScreen,
} from '../geometry';
import {
  alignComps,
  arrayCopy,
  bumpIdSeq,
  buildNets,
  canRedo,
  canUndo,
  cloneDoc,
  distributeComps,
  emptyHistory,
  makeComp,
  makeWire,
  moveLabels,
  normalize,
  pushHistory,
  redo,
  refreshDiags,
  removeComps,
  removeWires,
  rotateComps,
  undo,
} from '../model';

// ============================================================================
// 迷你断言器
// ============================================================================

let pass = 0;
const fails: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) {
    pass += 1;
  } else {
    fails.push(msg);
  }
}

function eq<T>(a: T, b: T, msg: string): void {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) pass += 1;
  else fails.push(`${msg} | 期望 ${JSON.stringify(b)} | 实际 ${JSON.stringify(a)}`);
}

/** 断言一段折线的每一段都严格水平或垂直 —— 布线模块的核心不变量 */
function assertOrtho(pts: Pt[], label: string): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = Math.abs(pts[i + 1].x - pts[i].x);
    const dy = Math.abs(pts[i + 1].y - pts[i].y);
    ok(
      dx < 0.5 || dy < 0.5,
      `${label}: 第 ${i} 段不垂直 dx=${dx} dy=${dy} | 全段 ${JSON.stringify(pts)}`,
    );
  }
}

// ============================================================================
// 构造测试用元件
// ============================================================================

function fet(id: string, x: number, y: number, kind: 'nmos' | 'pmos' = 'nmos', bodyTied = false): MosFet {
  return {
    id,
    kind,
    x,
    y,
    rot: 0,
    flip: false,
    label: id.toUpperCase(),
    color: null,
    bodyTied,
    model: 'NMOS_0P18',
    w: '1u',
    l: '65n',
    vth: '0.45',
  };
}

function res(id: string, x: number, y: number): MosComp {
  return {
    id,
    kind: 'resistor',
    x,
    y,
    rot: 0,
    flip: false,
    label: id.toUpperCase(),
    color: null,
    value: '10k',
  };
}

function wire(id: string, comp: string, port: string, comp2: string, port2: string): Wire {
  return {
    id,
    a: { kind: 'port', ref: { comp, port } },
    b: { kind: 'port', ref: { comp: comp2, port: port2 } },
    via: [],
    style: { width: 2, color: 'ink', dash: 'solid' },
  };
}

function docOf(...parts: Array<MosComp | Wire>): MosDoc {
  const components = parts.filter((p): p is MosComp => 'kind' in p);
  const wires = parts.filter((p): p is Wire => !('kind' in p));
  return { ...emptyDoc('t'), components, wires, texts: [] };
}

import { exportSVG, renderSvg } from '../render';
import { PRESETS, blankPreset } from '../presets';

// ============================================================================
// 1. 端口与旋转
// ============================================================================

{
  // 1.1 端口表：三端 MOS 没有 b 端口
  eq(portNames('nmos', false), ['g', 'd', 's', 'b'], '1.1 四端 NMOS 端口名');
  eq(portNames('nmos', true), ['g', 'd', 's'], '1.1 三端 NMOS 端口名（无 b）');
  eq(portNames('pmos', false), ['g', 'd', 's', 'b'], '1.1 四端 PMOS 端口名');
  eq(portNames('resistor'), ['p', 'n'], '1.1 电阻端口名');
}

{
  // 1.2 旋转矩阵可逆：世界坐标先减锚点回局部，再反向旋转，应回到原始局部坐标
  const m = fet('m', 100, 100);
  const local = { x: 12, y: -34 }; // d 端口局部坐标
  for (const r of [90, 180, 270] as const) {
    const world = portWorld({ ...m, rot: r }, 'd');
    const rel = { x: world.x - m.x, y: world.y - m.y };
    const back = rotatePtForTest(rel, r);
    ok(
      Math.abs(back.x - local.x) < 0.001 && Math.abs(back.y - local.y) < 0.001,
      `1.2 rot=${r} 反向旋转应回到原始局部坐标 | 期望 ${JSON.stringify(local)} 实际 ${JSON.stringify(back)}`,
    );
  }
}

/** 反向旋转（SVG rotate(θ) 的逆变换） */
function rotatePtForTest(p: Pt, rot: number): Pt {
  switch (rot) {
    case 90:
      return { x: p.y, y: -p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: -p.y, y: p.x };
    default:
      return p;
  }
}

{
  // 1.3 旋转矩阵：d 端口（局部 (12,-34)）rot=90 应变为 (34,12)
  const m = fet('m', 0, 0);
  const d90 = portWorld({ ...m, rot: 90 }, 'd');
  eq({ x: d90.x, y: d90.y }, { x: 34, y: 12 }, '1.3 rot=90 端口坐标 (x,y)→(-y,x)');
  const d180 = portWorld({ ...m, rot: 180 }, 'd');
  eq({ x: d180.x, y: d180.y }, { x: -12, y: 34 }, '1.3 rot=180 端口坐标取反');
}

{
  // 1.4 出线方向跟着旋转
  const m = fet('m', 0, 0);
  eq(portDirWorld(m, 'g'), 'L', '1.4 rot=0 栅极朝左');
  eq(portDirWorld({ ...m, rot: 90 }, 'g'), 'U', '1.4 rot=90 栅极朝上');
  eq(portDirWorld({ ...m, rot: 180 }, 'g'), 'R', '1.4 rot=180 栅极朝右');
  eq(portDirWorld({ ...m, rot: 270 }, 'g'), 'D', '1.4 rot=270 栅极朝下');
}

{
  // 1.5 镜像把 L/R 对调，U/D 不变
  const m = fet('m', 0, 0);
  eq(portDirWorld({ ...m, flip: true }, 'g'), 'R', '1.5 镜像后栅极朝右');
  eq(portDirWorld({ ...m, flip: true }, 'd'), 'U', '1.5 镜像后漏极仍朝上');
  const gx = portWorld({ ...m, flip: true }, 'g').x;
  eq(gx, 34, '1.5 镜像后栅极 x 取反');
}

{
  // 1.6 局部→世界 与 端口→世界 一致（图形与端口不可能失配）
  const m = fet('m', 200, 150);
  const local = { x: 12, y: -34 };
  const viaLocal = localToWorld(m, local);
  const viaPort = portWorld(m, 'd');
  eq(viaPort, viaLocal, '1.6 localToWorld 与 portWorld 结果一致');
}

// ============================================================================
// 2. 符号尺寸不变式
// ============================================================================

{
  // 2.1 旋转 90/270 时包围盒宽高互换 —— 可被断言的不变量
  const m = fet('m', 0, 0);
  const b0 = compBBox(m);
  for (const r of [90, 270] as const) {
    const b = compBBox({ ...m, rot: r });
    ok(Math.abs(b.w - b0.h) < 0.001, `2.1 rot=${r} 包围盒宽应等于原高 | ${JSON.stringify(b)} vs ${JSON.stringify(b0)}`);
    ok(Math.abs(b.h - b0.w) < 0.001, `2.1 rot=${r} 包围盒高应等于原宽`);
  }
  const b180 = compBBox({ ...m, rot: 180 });
  ok(Math.abs(b180.w - b0.w) < 0.001 && Math.abs(b180.h - b0.h) < 0.001, '2.1 rot=180 宽高不变');
}

{
  // 2.2 PMOS 含气泡（圆），NMOS 不含 —— 圆用 A 弧命令
  const n = compSegs(fet('m', 0, 0, 'nmos')).map((s) => s.d).join('');
  const p = compSegs(fet('m', 0, 0, 'pmos')).map((s) => s.d).join('');
  ok(!n.includes('A'), '2.2 NMOS 符号不应含圆弧（无栅极气泡）');
  ok(p.includes('A'), '2.2 PMOS 符号应含栅极气泡圆弧');
}

{
  // 2.3 衬底箭头方向：NMOS 指向沟道，PMOS 背离沟道。
  // 不写死坐标（体端口已从右侧移到栅极同侧，坐标会随设计变），
  // 而是断言两者箭头片段**恰好互为镜像** —— 这才是"方向相反"的本质。
  const nSegs = compSegs(fet('m', 0, 0, 'nmos'));
  const pSegs = compSegs(fet('m', 0, 0, 'pmos'));
  const nArrow = nSegs.map((k) => k.d).join('|');
  const pArrow = pSegs.map((k) => k.d).join('|');
  ok(nArrow !== pArrow, '2.3 NMOS 与 PMOS 的衬底画法应不同（箭头方向相反）');
  // 箭头是多边形（以 Z 结尾），两条支路都要有
  const nHasHead = /Z/.test(nArrow);
  const pHasHead = /Z/.test(pArrow);
  ok(nHasHead && pHasHead, '2.3 两者都应画出衬底箭头');
}

{
  // 2.4 符号 path 里不应出现浮点尾巴
  for (const kind of ['nmos', 'pmos', 'resistor', 'capacitor', 'diode', 'vsrc', 'isrc', 'vdd', 'gnd', 'jump', 'junction'] as const) {
    const c = makeComp(emptyDoc(), kind, 0, 0);
    const d = compSegs(c).map((s) => s.d).join('');
    const bad = d.match(/\d\.\d{3,}/g);
    ok(!bad, `2.4 ${kind} 符号含浮点尾巴 ${bad ? bad.join(',') : ''} | ${d}`);
  }
}

{
  // 2.5 三端 MOS 的 path 数少于四端（少了体极引线与箭头）
  const n4 = compSegs(fet('m', 0, 0, 'nmos', false)).length;
  const n3 = compSegs(fet('m', 0, 0, 'nmos', true)).length;
  ok(n3 < n4, `2.5 三端符号片段数应少于四端 | n3=${n3} n4=${n4}`);
}

// ============================================================================
// 3. 正交布线（核心不变量）
// ============================================================================

{
  // 3.1 随机 500 组：每一段都严格水平或垂直
  const dirs = ['L', 'R', 'U', 'D'] as const;
  let bad = 0;
  let firstBad = '';
  for (let i = 0; i < 500; i++) {
    const a = { x: (i * 37) % 900, y: (i * 53) % 700 };
    const b = { x: (i * 71 + 13) % 900, y: (i * 29 + 7) % 700 };
    const pts = orthoRoute(a, dirs[i % 4], b, dirs[(i + 1) % 4]);
    for (let k = 0; k < pts.length - 1; k++) {
      const dx = Math.abs(pts[k + 1].x - pts[k].x);
      const dy = Math.abs(pts[k + 1].y - pts[k].y);
      if (!(dx < 0.5 || dy < 0.5)) {
        bad += 1;
        if (!firstBad) firstBad = `a=${JSON.stringify(a)} b=${JSON.stringify(b)} pts=${JSON.stringify(pts)}`;
      }
    }
  }
  ok(bad === 0, `3.1 orthoRoute 有 ${bad} 段不垂直 | 首例 ${firstBad}`);
}

{
  // 3.2 首点等于 a、末点等于 b
  const a = { x: 100, y: 100 };
  const b = { x: 400, y: 300 };
  for (const da of ['L', 'R', 'U', 'D'] as const) {
    for (const db of ['L', 'R', 'U', 'D'] as const) {
      const pts = orthoRoute(a, da, b, db);
      eq(pts[0], a, `3.2 首点 da=${da} db=${db}`);
      eq(pts[pts.length - 1], b, `3.2 末点 da=${da} db=${db}`);
    }
  }
}

{
  // 3.3 输出无重复点、无零长段、无该合并的共线点
  const pts = orthoRoute({ x: 0, y: 0 }, 'R', { x: 300, y: 200 }, 'L');
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x);
    const dy = Math.abs(pts[i].y - pts[i - 1].y);
    ok(!(dx < 0.5 && dy < 0.5), `3.3 第 ${i} 点与前一点重合 ${JSON.stringify(pts)}`);
  }
  for (let i = 0; i < pts.length - 2; i++) {
    const a1 = pts[i];
    const b1 = pts[i + 1];
    const c1 = pts[i + 2];
    const cross = (b1.x - a1.x) * (c1.y - b1.y) - (b1.y - a1.y) * (c1.x - b1.x);
    const dot = (b1.x - a1.x) * (c1.x - b1.x) + (b1.y - a1.y) * (c1.y - b1.y);
    ok(!(Math.abs(cross) < 0.5 && dot > 0), `3.3 第 ${i + 1} 点共线未合并 ${JSON.stringify(pts)}`);
  }
}

{
  // 3.4 端点本身水平/垂直对齐时退化成单段
  const pts = orthoRoute({ x: 100, y: 100 }, 'U', { x: 100, y: 400 }, 'U');
  eq(pts.length, 2, '3.4 同 x 竖直对齐应只有 2 个点');
  const pts2 = orthoRoute({ x: 0, y: 50 }, 'L', { x: 400, y: 50 }, 'R');
  eq(pts2.length, 2, '3.4 同 y 水平对齐应只有 2 个点');
}

{
  // 3.5 orthoFix 幂等
  const a = { x: 100, y: 100 };
  const b = { x: 500, y: 400 };
  const via = [{ x: 300, y: 137 }, { x: 42, y: 260 }];
  const once = orthoFix(a, b, via);
  const twice = orthoFix(a, b, once);
  eq(twice, once, '3.5 orthoFix 幂等');
}

{
  // 3.6 orthoFix 把非网格坐标 snap 到网格
  const a = { x: 0, y: 0 };
  const b = { x: 400, y: 400 };
  const out = orthoFix(a, b, [{ x: 137, y: 243 }]);
  for (const p of out) {
    ok(p.x % GRID === 0, `3.6 拐点 x=${p.x} 未落栅格`);
    ok(p.y % GRID === 0, `3.6 拐点 y=${p.y} 未落栅格`);
  }
}

{
  // 3.7 orthoFix 在端点移动后仍保持正交（硬不变量）
  const a = { x: 100, y: 100 };
  const b = { x: 300, y: 300 };
  const via = [{ x: 200, y: 100 }];
  const fixed = orthoFix(a, b, via);
  assertOrtho([a, ...fixed, b], '3.7 orthoFix 后');

  // 元件被拖到很远，拐点还在原处 —— 也必须正交
  const a2 = { x: 1000, y: 1000 };
  const fixed2 = orthoFix(a2, b, via);
  assertOrtho([a2, ...fixed2, b], '3.7 端点远距离移动后');
}

{
  // 3.8 拖动拐点后仍正交
  const a = { x: 0, y: 0 };
  const b = { x: 400, y: 400 };
  let cur = orthoFix(a, b, [{ x: 200, y: 0 }]);
  for (let i = 0; i < 20; i++) {
    const to = { x: Math.random() * 600 - 100, y: Math.random() * 600 - 100 };
    cur = dragVertex(a, b, cur, 0, to);
    assertOrtho([a, ...cur, b], `3.8 第 ${i} 次拖动后`);
  }
}

// ============================================================================
// 4. 连线路径
// ============================================================================

{
  // 4.1 连线端点跟随元件移动
  const doc = docOf(fet('m1', 100, 100), fet('m2', 400, 100), wire('w1', 'm1', 'd', 'm2', 'd'));
  const before = wirePts(doc, doc.wires[0]);
  const moved = { ...doc, components: doc.components.map((c) => (c.id === 'm2' ? { ...c, x: 700 } : c)) };
  const after = wirePts(moved, moved.wires[0]);
  eq(after[after.length - 1], { x: 700 + 12, y: 100 - 34 }, '4.1 移动元件后连线末点跟随');
  ok(
    Math.abs(after[0].x - before[0].x) < 0.001 && Math.abs(after[0].y - before[0].y) < 0.001,
    '4.1 未移动的端点不应变化',
  );
  assertOrtho(after, '4.1 移动后连线');
}

{
  // 4.2 旋转元件后连线端点跟随旋转
  // d 局部 (12,-34)，rot=90 → (34,12)，加锚点 (200,200) → (234,212)
  const doc = docOf(fet('m1', 200, 200), fet('m2', 200, 600), wire('w1', 'm1', 'd', 'm2', 'd'));
  const rot = rotateComps(doc, new Set(['m1']), 1);
  const pts = wirePts(rot, rot.wires[0]);
  eq(pts[0], { x: 234, y: 212 }, '4.2 rot=90 后漏极端口世界坐标 (x,y)→(-y,x) 再加锚点');
  assertOrtho(pts, '4.2 旋转后连线');
}

{
  // 4.3 连线 path 是直角折线（M/L，不含曲线命令）
  const doc = docOf(fet('m1', 0, 0), fet('m2', 300, 200), wire('w1', 'm1', 's', 'm2', 'g'));
  const d = wirePathD(doc, doc.wires[0]);
  ok(!/[CQAZcqaz]/.test(d), `4.3 连线不应含曲线命令 | ${d}`);
  ok(d.startsWith('M'), '4.3 连线应以 M 开头');
}

{
  // 4.4 三端 MOS 的 b 端口不存在，连线引用 b 时端点退回原点但不崩
  const doc = docOf(fet('m1', 0, 0, 'nmos', true), wire('w1', 'm1', 'b', 'm1', 'd'));
  const pts = wirePts(doc, doc.wires[0]);
  ok(Array.isArray(pts) && pts.length >= 2, '4.4 引用不存在端口不应崩溃');
}

// ============================================================================
// 5. 撤销重做不变量
// ============================================================================

{
  const h = emptyHistory();
  const d0 = emptyDoc('t');
  ok(!canUndo(h), '5.1 初始无撤销');
  ok(!canRedo(h), '5.1 初始无重做');

  let d = d0;
  pushHistory(h, cloneDoc(d));
  d = { ...d, components: [fet('m1', 0, 0)] };
  pushHistory(h, cloneDoc(d));
  d = { ...d, components: [...d.components, fet('m2', 200, 0)] };
  eq(h.past.length, 2, '5.2 两条历史');

  const u1 = undo(h, d);
  eq(u1!.components.length, 1, '5.2 撤销一步后剩 1 个元件');
  ok(canRedo(h), '5.2 撤销后可重做');

  const r1 = redo(h, u1!);
  eq(r1!.components.length, 2, '5.3 重做恢复 2 个元件');

  // undo 到底 == 空文档
  let cur = r1!;
  while (canUndo(h)) {
    const n = undo(h, cur);
    if (!n) break;
    cur = n;
  }
  eq(cur.components.length, 0, '5.4 撤销到底为空文档');
}

{
  // 5.5 cloneDoc 深拷贝：改副本不影响原
  const a = docOf(fet('m1', 0, 0));
  const b = cloneDoc(a);
  b.components[0].x = 999;
  ok(a.components[0].x !== 999, '5.5 cloneDoc 应深拷贝');
}

{
  // 5.6 新操作清空 future（撤销后再编辑，redo 应失效）
  const h = emptyHistory();
  let d = emptyDoc('t');
  pushHistory(h, cloneDoc(d));
  d = { ...d, components: [fet('m1', 0, 0)] };
  undo(h, d);
  ok(canRedo(h), '5.6 撤销后 future 非空');
  pushHistory(h, cloneDoc(d));
  ok(!canRedo(h), '5.6 新操作应清空 future');
}

{
  // 5.7 历史栈上限
  const h = emptyHistory(10);
  let d = emptyDoc('t');
  for (let i = 0; i < 30; i++) {
    pushHistory(h, cloneDoc(d));
    d = { ...d, components: [...d.components, fet(`m${i}`, i * 10, 0)] };
  }
  ok(h.past.length <= 10, `5.7 历史栈应 <=10，实际 ${h.past.length}`);
}

// ============================================================================
// 6. 网络分析与诊断
// ============================================================================

{
  // 6.1 两管栅极相连 → 同一网络
  // 注意查的是端口节点 `p:compId#port`（buildNets 故意不把元件节点并进网络，
  // 否则一个端口接上线会让同元件所有端口都算已连接，悬空诊断全部失效）
  const doc = docOf(
    fet('m1', 0, 0),
    fet('m2', 0, 300),
    wire('w1', 'm1', 'g', 'm2', 'g'),
  );
  const nets = buildNets(doc);
  let found = false;
  for (const set of nets.values()) {
    if (set.has('p:m1#g') && set.has('p:m2#g')) found = true;
  }
  ok(found, '6.1 栅极相连的两管应在同一网络');
  // 同元件的漏极不应因为栅极接上线而算连接
  let leak = false;
  for (const set of nets.values()) if (set.has('p:m1#d') && set.has('p:m2#d')) leak = true;
  ok(!leak, '6.1 同元件的漏极不应被并入栅极所在网络');
}

{
  // 6.2 同名网络标签互连（VDD 惯例）
  const vdd1 = makeComp(emptyDoc(), 'vdd', 0, 0);
  vdd1.id = 'v1';
  vdd1.net = 'VDD';
  const vdd2 = makeComp(emptyDoc(), 'vdd', 300, 0);
  vdd2.id = 'v2';
  vdd2.net = 'VDD';
  const nets = buildNets(docOf(vdd1, vdd2));
  let found = false;
  for (const set of nets.values()) if (set.has('p:v1#p') && set.has('p:v2#p')) found = true;
  ok(found, '6.2 同名 VDD 标签应互连');
}

{
  // 6.3 悬空栅极被诊断出
  const doc = docOf(fet('m1', 0, 0));
  const diag = refreshDiags(doc);
  ok(diag.floating.has('m1#g'), `6.3 悬空栅极应被标记 | floating=${[...diag.floating].join(',')}`);
  ok(diag.floating.has('m1#d'), '6.3 悬空漏极应被标记');
}

{
  // 6.4 接上栅极后不再悬空
  const doc = docOf(fet('m1', 0, 0), fet('m2', 0, 300), wire('w1', 'm1', 'g', 'm2', 'g'));
  const diag = refreshDiags(doc);
  ok(!diag.floating.has('m1#g'), `6.4 已连接的栅极不应悬空 | floating=${[...diag.floating].join(',')}`);
  ok(diag.floating.has('m1#d'), '6.4 未接的漏极仍应悬空');
}

{
  // 6.5 诊断不修改文档（纯函数）
  const doc = docOf(fet('m1', 0, 0));
  const before = JSON.stringify(doc);
  refreshDiags(doc);
  ok(JSON.stringify(doc) === before, '6.5 refreshDiags 不应修改文档');
}

// ============================================================================
// 7. normalize 容错
// ============================================================================

{
  // 7.1 非对象 / null
  for (const bad of [null, undefined, 123, 'x', []]) {
    const d = normalize(bad);
    ok(Array.isArray(d.components) && Array.isArray(d.wires), `7.1 ${JSON.stringify(bad)} 应归一化为合法文档`);
  }
}

{
  // 7.2 字段类型全错
  const d = normalize({
    components: 'not-an-array',
    wires: [{ a: null, b: undefined }],
    texts: 42,
    title: 123,
  });
  eq(d.components.length, 0, '7.2 components 非数组应为空');
  eq(d.wires.length, 0, '7.2 端点为 null 的线应被丢弃');
  eq(d.texts.length, 0, '7.2 texts 非数组应为空');
  eq(typeof d.title, 'string', '7.2 title 应为字符串');
}

{
  // 7.3 rot 越界回落、坐标非法回落
  const d = normalize({
    components: [{ kind: 'nmos', id: 'c1', x: 'abc', y: NaN, rot: 45, bodyTied: 'yes' }],
  });
  eq(d.components[0].rot, 0, '7.3 rot=45 应回落到 0');
  ok(Number.isFinite(d.components[0].x), '7.3 x 非数字应回落为有限值');
  ok(Number.isFinite(d.components[0].y), '7.3 y=NaN 应回落为有限值');
  eq(d.components[0].bodyTied, false, '7.3 bodyTied 非布尔应回落为 false');
}

{
  // 7.4 未知 kind 被丢弃
  const d = normalize({ components: [{ kind: 'quantum_flux', id: 'c1' }, { kind: 'nmos', id: 'c2' }] });
  eq(d.components.length, 1, '7.4 未知 kind 应被丢弃');
  eq(d.components[0].id, 'c2', '7.4 保留合法元件');
}

{
  // 7.5 重复 ID 只保留第一条（否则「删一个另一个也消失」）
  const d = normalize({
    components: [
      { kind: 'nmos', id: 'dup', x: 0, y: 0 },
      { kind: 'nmos', id: 'dup', x: 200, y: 0 },
    ],
  });
  eq(d.components.length, 1, '7.5 重复 ID 只保留一条');
  eq(d.components[0].x, 0, '7.5 保留的是第一条');
}

{
  // 7.6 端点指向不存在的元件 → 降级为 free，不丢线
  const d = normalize({
    components: [{ kind: 'nmos', id: 'c1', x: 0, y: 0 }],
    wires: [{ id: 'w1', a: { kind: 'port', ref: { comp: 'ghost', port: 'd' } }, b: { kind: 'port', ref: { comp: 'c1', port: 'd' } } }],
  });
  eq(d.wires.length, 1, '7.6 线不应被丢弃');
  eq(d.wires[0].a.kind, 'free', '7.6 孤儿端点应降级为 free');
}

{
  // 7.7 via 非法项兜底为 0，与端点重合的拐点剔除
  // c1 在 (0,0)，d 端口 = (12,-34)
  const d = normalize({
    components: [{ kind: 'nmos', id: 'c1', x: 0, y: 0 }],
    wires: [
      {
        id: 'w1',
        a: { kind: 'port', ref: { comp: 'c1', port: 'd' } },
        b: { kind: 'free', x: 400, y: 400 },
        via: [{ x: 12, y: -34 }, null, { x: 'x', y: 100 }],
      },
    ],
  });
  eq(
    d.wires[0].via.length,
    2,
    `7.7 落在端点上的拐点应剔除，null/非法项应兜底为有限值 | ${JSON.stringify(d.wires[0].via)}`,
  );
  ok(
    d.wires[0].via.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    '7.7 拐点坐标应全为有限值',
  );
  ok(
    !d.wires[0].via.some((p) => p.x === 12 && p.y === -34),
    '7.7 与 a 端点重合的拐点应被剔除',
  );
}

{
  // 7.8 颜色 token 非法回落
  const d = normalize({
    components: [],
    wires: [{ id: 'w1', a: { kind: 'free', x: 0, y: 0 }, b: { kind: 'free', x: 100, y: 0 }, style: { color: '#ff0000', width: -5, dash: 'wavy' } }],
  });
  eq(d.wires[0].style.color, 'ink', '7.8 非法颜色 token 应回落 ink');
  ok(d.wires[0].style.width > 0, '7.8 负线宽应被夹到正数');
  eq(d.wires[0].style.dash, 'solid', '7.8 非法线型应回落 solid');
}

{
  // 7.9 bumpIdSeq 后新 ID 不撞号
  const d = normalize({
    components: [{ kind: 'nmos', id: 'c99', x: 0, y: 0 }],
    wires: [{ id: 'w50', a: { kind: 'free', x: 0, y: 0 }, b: { kind: 'free', x: 50, y: 0 } }],
  });
  bumpIdSeq(d);
  const nc = makeComp(d, 'nmos', 0, 0);
  ok(nc.id !== 'c99' && nc.id !== 'c50', `7.9 新 ID 应大于已用最大序号 | ${nc.id}`);
}

{
  // 7.10 数组超长被截断
  const many = Array.from({ length: 1000 }, (_, i) => ({ kind: 'nmos', id: `c${i}`, x: 0, y: 0 }));
  const d = normalize({ components: many });
  ok(d.components.length <= 400, `7.10 元件数应被截断到 400，实际 ${d.components.length}`);
}

// ============================================================================
// 8. 删除
// ============================================================================

{
  // 8.1 删元件连带删线
  const doc = docOf(fet('m1', 0, 0), fet('m2', 0, 300), wire('w1', 'm1', 'g', 'm2', 'g'));
  const after = removeComps(doc, new Set(['m1']));
  eq(after.components.length, 1, '8.1 元件被删');
  eq(after.wires.length, 0, '8.1 挂在它上面的线应一并删除');
}

{
  // 8.2 删线只删第一条（免疫 ID 撞车）
  const doc = docOf(fet('m1', 0, 0));
  const withDup: MosDoc = {
    ...doc,
    wires: [
      { id: 'same', a: { kind: 'free', x: 0, y: 0 }, b: { kind: 'free', x: 50, y: 0 }, via: [], style: { width: 2, color: 'ink', dash: 'solid' } },
      { id: 'same', a: { kind: 'free', x: 0, y: 100 }, b: { kind: 'free', x: 50, y: 100 }, via: [], style: { width: 2, color: 'ink', dash: 'solid' } },
    ],
  };
  const after = removeWires(withDup, 'same');
  eq(after.wires.length, 1, '8.2 只删第一条');
}

// ============================================================================
// 9. 对齐 / 分布 / 阵列
// ============================================================================

{
  const doc = docOf(fet('m1', 0, 0), fet('m2', 300, 500), fet('m3', 700, 200));
  const aligned = alignComps(doc, new Set(['m1', 'm2', 'm3']), 'left');
  const xs = aligned.components.map((c) => compBBox(c).x).sort((a, b) => a - b);
  ok(Math.abs(xs[0] - xs[1]) < 0.001 && Math.abs(xs[1] - xs[2]) < 0.001, `9.1 左对齐后左边界应一致 | ${xs}`);

  const tops = alignComps(doc, new Set(['m1', 'm2', 'm3']), 'top').components.map((c) => compBBox(c).y);
  ok(Math.abs(tops[0] - tops[1]) < 0.001 && Math.abs(tops[1] - tops[2]) < 0.001, `9.2 顶对齐后上边界应一致 | ${tops}`);
}

{
  // 9.3 分布：等间距
  const doc = docOf(fet('m1', 0, 0), fet('m2', 100, 0), fet('m3', 800, 0));
  const dist = distributeComps(doc, new Set(['m1', 'm2', 'm3']), 'x');
  const xs = dist.components.map((c) => c.x);
  const gaps = [xs[1] - xs[0], xs[2] - xs[1]];
  ok(Math.abs(gaps[0] - gaps[1]) < 0.001, `9.3 水平分布间距应相等 | ${gaps}`);
}

{
  // 9.4 阵列复制 2 行 3 列 = 6 份
  const doc = docOf(fet('m1', 0, 0));
  const res = arrayCopy(doc, { comps: ['m1'], wires: [], texts: [] }, 2, 3, 200, 100);
  eq(res.doc.components.length, 6, '9.4 阵列复制 2×3 应得 6 个元件');
  const ids = new Set(res.doc.components.map((c) => c.id));
  eq(ids.size, 6, '9.4 阵列副本 ID 应各不相同');
}

{
  // 9.5 阵列复制时线也跟随重映射
  const doc = docOf(fet('m1', 0, 0), fet('m2', 0, 300), wire('w1', 'm1', 'g', 'm2', 'g'));
  const res = arrayCopy(doc, { comps: ['m1', 'm2'], wires: ['w1'], texts: [] }, 2, 1, 0, 400);
  eq(res.doc.components.length, 4, '9.5 阵列后 4 个元件');
  eq(res.doc.wires.length, 2, '9.5 阵列后 2 根线');
  // 第二组的两根线应互相连接（指向新 ID），不指向原件
  const w2 = res.doc.wires[1];
  const ids = new Set(res.doc.components.map((c) => c.id));
  ok(
    (w2.a.kind === 'port' && ids.has(w2.a.ref.comp)) && (w2.b.kind === 'port' && ids.has(w2.b.ref.comp)),
    `9.5 复制的线应指向新元件 | ${JSON.stringify(w2)}`,
  );
}

// ============================================================================
// 10. 坐标换算与吸附
// ============================================================================

{
  // 10.2 screenToWorld ∘ worldToScreen ≈ 恒等
  const rect = { left: 30, top: 70, width: 1200, height: 800 };
  const view = { zoom: 1.75, panX: -120, panY: 45 };
  let maxErr = 0;
  for (const p of [{ x: 0, y: 0 }, { x: 137, y: 259 }, { x: -400, y: 900 }]) {
    const s = worldToScreen(p, rect, view);
    const back = screenToWorld(s.x, s.y, rect, view);
    maxErr = Math.max(maxErr, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
  }
  ok(maxErr < 1e-6, `10.2 坐标往返误差应 < 1e-6，实际 ${maxErr}`);
}

{
  // 10.3 zoom > 1 时必须先除 zoom —— 这是命中测试最容易错的一处
  //
  // 踩过的坑：交互命中用 `outerSvg.getScreenCTM()` 取矩阵，
  // 但外层 svg 的 viewBox 与像素尺寸 1:1，它的 CTM **只有平移没有缩放**，
  // 真正的 zoom/pan 在内层 `<g class="mc-world">` 上。
  // 于是世界坐标差了一个 zoom 倍数（实测 2.1 倍），
  // 症状是「点元件没反应、拖端口连不上」，控制台一条错都不报。
  const rect = { left: 208, top: 44, width: 968, height: 830 };
  const view = { zoom: 2.1, panX: 63.13, panY: 99.35 };
  const world = { x: 200, y: 150 };
  const s = worldToScreen(world, rect, view);
  const back = screenToWorld(s.x, s.y, rect, view);
  ok(
    Math.abs(back.x - world.x) < 0.01 && Math.abs(back.y - world.y) < 0.01,
    `10.3 缩放态下坐标往返应还原 | 期望 ${JSON.stringify(world)} 实际 ${JSON.stringify(back)}`,
  );
  // 反证：若漏除 zoom，误差正好是 zoom 倍
  const naive = { x: (s.x - rect.left - view.panX), y: (s.y - rect.top - view.panY) };
  ok(
    Math.abs(naive.x - world.x) > 1,
    `10.3 反证：漏除 zoom 时应产生显著偏差，实际偏差仅 ${Math.abs(naive.x - world.x)}`,
  );
}

{
  // 10.2 端口吸附优先级最高
  const doc = docOf(fet('m1', 100, 100));
  const g = portWorld(doc.components[0], 'g');
  const r = snapPoint(doc, { x: g.x + 4, y: g.y + 3 }, { snapGrid: true, snapTrack: true }, 12);
  eq(r.hint, 'port', '10.4 端口附近应优先吸附到端口');
  eq({ x: r.x, y: r.y }, { x: g.x, y: g.y }, '10.4 端口吸附应精确落在端口上');
}

{
  // 10.5 栅极列吸附（无端口可吸时）
  const doc = docOf(fet('m1', 100, 100), fet('m2', 400, 400));
  const g1 = portWorld(doc.components[0], 'g');
  const r = snapPoint(doc, { x: g1.x + 5, y: 999 }, { snapGrid: false, snapTrack: true }, 6);
  eq(r.hint, 'gate', `10.3 应吸附到栅极列 | hint=${r.hint}`);
  eq(r.x, g1.x, '10.5 栅极列吸附 x 应等于已有栅极 x');
  eq(r.refLine, { axis: 'x', v: g1.x }, '10.3 应给出竖直参考线');
}

{
  // 10.6 电源轨吸附
  const v = makeComp(emptyDoc(), 'vdd', 700, 300);
  v.id = 'v1';
  const doc = docOf(fet('m1', 100, 100), v);
  const vy = portWorld(v, 'p').y;
  const r = snapPoint(doc, { x: 55, y: vy + 6 }, { snapGrid: false, snapTrack: true }, 6);
  eq(r.hint, 'rail', `10.4 应吸附到电源轨 | hint=${r.hint}`);
  eq(r.refLine, { axis: 'y', v: vy }, '10.4 应给出水平参考线');
}

{
  // 10.5 都不满足时落栅格
  const doc = docOf(fet('m1', 100, 100));
  const r = snapPoint(doc, { x: 813, y: 617 }, { snapGrid: true, snapTrack: true }, 6);
  eq(r.hint, 'grid', '10.7 应落栅格');
  eq({ x: r.x, y: r.y }, { x: 810, y: 620 }, '10.5 栅格吸附坐标');
}

{
  // 10.6 关掉吸附后不改变坐标
  const doc = docOf(fet('m1', 100, 100));
  const r = snapPoint(doc, { x: 813, y: 617 }, { snapGrid: false, snapTrack: false }, 0);
  eq({ x: r.x, y: r.y }, { x: 813, y: 617 }, '10.8 关闭吸附应原样返回');
}

// ============================================================================
// 11. 包围盒
// ============================================================================

{
  const doc = docOf(fet('m1', 100, 100), fet('m2', 500, 400));
  const b = boundsOf(doc);
  ok(b.w > 0 && b.h > 0, '11.1 包围盒应有正尺寸');
  const bPad = boundsOf(doc, 40);
  eq(bPad.w - b.w, 80, '11.2 padding 应双向各扩 40');

  // 空图也应返回可用尺寸（否则 fit-to-view 会算出极端缩放）
  const eb = ensureMinSize(boundsOf(emptyDoc()));
  ok(eb.w >= 200 && eb.h >= 150, `11.3 空图包围盒应有最小尺寸 | ${JSON.stringify(eb)}`);
}

// ============================================================================
// 12. 文本宽度估算
// ============================================================================

{
  // 12.1 中文字符按全宽、ASCII 按半宽 —— 同样字数时中文标注明显更宽
  const wCn = estText('中文字', 12);   // 3 × 12 = 36
  const wEn = estText('abc', 12);      // 3 × 12 × 0.56 = 20.16
  ok(wCn > wEn, `12.1 同样 3 个字，中文应比英文宽 | ${wCn} vs ${wEn}`);
  ok(Math.abs(wCn - 36) < 0.01, `12.2 中文宽度 = 字数 × 字号 | ${wCn}`);
  ok(Math.abs(wEn - 3 * 12 * 0.56) < 0.01, `12.3 英文宽度 = 字数 × 字号 × 0.56 | ${wEn}`);
}
function estText(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[\u4e00-\u9fff]/.test(ch) ? size : size * 0.56;
  return w;
}

// ============================================================================
// 13. 线型映射（导出自包含的前提）
// ============================================================================

{
  eq(DASH_PATTERNS.solid, '', '13.1 实线 dasharray 为空');
  ok(DASH_PATTERNS.dashed.length > 0, '13.2 虚线应有 dasharray');
  ok(DASH_PATTERNS.dotted.includes('.'), '13.3 点线 dasharray 应含小数');
  for (const d of ['solid', 'dashed', 'dotted'] as const) {
    ok(!/[a-z]/i.test(DASH_PATTERNS[d]), `13.4 ${d} 的 dasharray 不应含 CSS 关键字 | ${DASH_PATTERNS[d]}`);
  }
}

// ============================================================================
// 14. cleanPts 幂等
// ============================================================================

{
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }];
  const once = cleanPts(pts);
  const twice = cleanPts(once);
  eq(twice, once, '14.1 cleanPts 幂等');
  eq(once.length, 3, '14.2 共线中点与重复点应被清理');
}

// ============================================================================
// 15. rotateDir 覆盖四种朝向
// ============================================================================

{
  eq(rotateDir('R', 90), 'D', '15.1 R 转 90° 得 D');
  eq(rotateDir('U', 180), 'D', '15.2 U 转 180° 得 D');
  eq(rotateDir('L', 270), 'D', '15.3 L 转 270° 得 D');
  eq(rotateDir('D', 0), 'D', '15.4 rot=0 方向不变');
  for (const d of ['L', 'R', 'U', 'D'] as const) {
    for (const r of ROTS) {
      // 旋转四次应回到原方向
      let cur = d;
      for (let i = 0; i < 4; i++) cur = rotateDir(cur, 90);
      eq(cur, d, `15.5 ${d} 旋转四次应回到原方向`);
    }
  }
}

{
  // 15. 导出自包含性（硬性要求：拖进 PPT/Word 不能变一团黑）
  const doc = docOf(
    fet('m1', 100, 100),
    fet('m2', 500, 300),
    res('r1', 300, 200),
    { ...wire('w1', 'm1', 'd', 'm2', 'g'), label: 'I_D=1.2mA' },
  );
  doc.texts.push({ id: 't1', x: 200, y: 50, text: '偏置电流镜', size: 14, align: 'center', color: 'ink', bold: true, rot: 0 });
  doc.wires[0].style.dash = 'dashed';

  for (const dark of [false, true]) {
    const svg = exportSVG(doc, { dark });
    const tag = dark ? '暗色' : '亮色';
    ok(!svg.includes('<style'), `15.1 ${tag}导出不应含 <style> 块`);
    ok(!/class=/.test(svg), `15.2 ${tag}导出不应含 class 属性`);
    ok(!svg.includes('var(--mc-'), `15.3 ${tag}导出不应残留 CSS 变量引用`);
    ok(!/<(image|use)\b/.test(svg), `15.4 ${tag}导出不应引用外部资源`);
    // xmlns 是必需的，不算外链
    const links = svg.match(/https?:\/\/[^"'\s]+/g) ?? [];
    ok(links.every((u) => u.startsWith('http://www.w3.org/2000/svg')), `15.5 ${tag}导出只应出现 SVG 命名空间 | ${links.join(',')}`);

    // 每个可见 path 都要有 fill 或 stroke（否则会继承到默认黑色）
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    ok(paths.length > 0, `15.6 ${tag}导出应含 path`);
    const bare = paths.filter((p) => !/fill="/.test(p) || (!/stroke="/.test(p) && !/fill="none"/.test(p)));
    // 允许：stroke="none" 的实心 path（有 fill）；或 fill="none" 的描边 path（有 stroke）
    const reallyBare = paths.filter((p) => {
      const f = /fill="([^"]*)"/.exec(p)?.[1];
      const s = /stroke="([^"]*)"/.exec(p)?.[1];
      return (f === undefined || f === 'none') && (s === undefined || s === 'none');
    });
    ok(reallyBare.length === 0, `15.7 ${tag}导出有既不填充也不描边的 path | ${reallyBare.slice(0, 2).join(' ')}`);
    void bare;

    // 虚线必须写成 stroke-dasharray
    ok(svg.includes('stroke-dasharray="7 5"'), `15.8 ${tag}导出虚线应写成 stroke-dasharray`);

    // 结构完整
    ok(svg.startsWith('<svg '), `15.9 ${tag}导出应以 <svg 开头`);
    ok(svg.trimEnd().endsWith('</svg>'), `15.10 ${tag}导出应以 </svg> 结尾`);
    const openTags = (svg.match(/<(?!\/)(?!\?)[a-z]/g) ?? []).length;
    const closeTags = (svg.match(/<\/[a-z]/g) ?? []).length + (svg.match(/\/>/g) ?? []).length;
    ok(openTags === closeTags, `15.11 ${tag}导出标签应配平 | 开 ${openTags} 闭 ${closeTags}`);
  }
}

{
  // 15.12 viewBox 应恰好包住所有图元（含文字）
  const doc = docOf(fet('m1', 100, 100));
  const svg = exportSVG(doc, { pad: 20 });
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  ok(!!m, `15.12 应输出 viewBox | ${svg.slice(0, 200)}`);
  if (m) {
    const b = boundsOf(doc, 20);
    ok(
      Math.abs(Number(m[1]) - b.x) < 0.5 &&
        Math.abs(Number(m[2]) - b.y) < 0.5 &&
        Math.abs(Number(m[3]) - b.w) < 0.5 &&
        Math.abs(Number(m[4]) - b.h) < 0.5,
      `15.12 viewBox 应等于 boundsOf(doc,20) | 期望 ${JSON.stringify(b)} 实际 ${m.slice(1).join(',')}`,
    );
  }
}

{
  // 15.13 透明背景：background=null 时不输出背景 rect
  const doc = docOf(fet('m1', 0, 0));
  const withBg = exportSVG(doc, { background: '#ff0000' });
  ok(withBg.includes('fill="#ff0000"'), '15.13 指定背景色应输出对应 rect');
  const noBg = exportSVG(doc, { background: null });
  ok(!noBg.includes('#fafafa'), '15.14 background=null 不应输出默认背景');
}

{
  // 15.15 悬空端口在导出里也应保留红圈（这是有价值的自检信息）
  const doc = docOf(fet('m1', 0, 0));
  const withDiag = renderSvg(doc, { mode: 'export', diag: refreshDiags(doc) });
  const without = renderSvg(doc, { mode: 'export' });
  ok(/stroke="#c0362c"/.test(withDiag), '15.15 传入诊断时应输出悬空红圈');
  ok(!/stroke="#c0362c"/.test(without), '15.15 未传诊断时不应输出红圈');
}

{
  // 15.16 屏幕与导出共用几何：同一元件在两种模式下 transform 必须一致
  const doc = docOf({ ...fet('m1', 137, 249), rot: 90, flip: true });
  const svg = exportSVG(doc, {});
  ok(
    svg.includes('translate(137 249) rotate(90) scale(-1 1)'),
    `15.16 元件 transform 应为 translate/rotate/scale 组合 | ${svg.match(/transform="[^"]*"/)?.[0]}`,
  );
}

{
  // 16. 预设：全部必须是合法文档，且每一根线都正交
  ok(PRESETS.length >= 5, `16.1 预设数量应 >= 5，实际 ${PRESETS.length}`);
  const keys = new Set<string>();
  for (const p of PRESETS) {
    ok(!keys.has(p.key), `16.2 预设 key 重复：${p.key}`);
    keys.add(p.key);

    const doc = p.build();
    ok(doc.components.length > 0, `16.3 预设「${p.name}」应含元件`);

    // 归一化幂等：预设本身就该是合法文档
    const norm = normalize(JSON.parse(JSON.stringify(doc)));
    eq(norm.components.length, doc.components.length, `16.4 预设「${p.name}」归一化后不应丢元件`);

    // ID 全局唯一（三个命名空间内）
    const ids = [
      ...doc.components.map((c) => c.id),
      ...doc.wires.map((w) => w.id),
      ...doc.texts.map((t) => t.id),
    ];
    eq(new Set(ids).size, ids.length, `16.5 预设「${p.name}」ID 应唯一`);

    // 预设 ID 用 p 前缀，和运行时 c/w/t 隔离
    ok(
      doc.components.every((c) => c.id.startsWith('p')),
      `16.6 预设「${p.name}」元件 ID 应以 p 开头（隔离命名空间）| ${doc.components[0].id}`,
    );

    // 连线正交
    let bad = 0;
    for (const w of doc.wires) {
      const pts = wirePts(doc, w);
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = Math.abs(pts[i + 1].x - pts[i].x);
        const dy = Math.abs(pts[i + 1].y - pts[i].y);
        if (!(dx < 0.5 || dy < 0.5)) bad += 1;
      }
    }
    ok(bad === 0, `16.7 预设「${p.name}」有 ${bad} 段不垂直`);

    // 端点必须指向存在的元件与端口
    let orphan = 0;
    for (const w of doc.wires) {
      for (const e of [w.a, w.b]) {
        if (e.kind !== 'port') continue;
        const c = doc.components.find((k) => k.id === e.ref.comp);
        if (!c) {
          orphan += 1;
          continue;
        }
        const names = portNames(c.kind, isMos(c) ? c.bodyTied : false);
        if (!names.includes(e.ref.port)) orphan += 1;
      }
    }
    ok(orphan === 0, `16.8 预设「${p.name}」有 ${orphan} 个端点指向不存在的端口`);

    // 导出不崩且自包含
    const svg = exportSVG(doc, {});
    ok(svg.length > 200, `16.9 预设「${p.name}」导出 SVG 过短 | ${svg.length}`);
    ok(!svg.includes('<style') && !/class=/.test(svg), `16.10 预设「${p.name}」导出不自包含`);

    // **预设不该自带悬空端口** —— 载入即报错的预设等于没用，
    // 而且用户会以为是工具坏了。四端管的衬底尤其容易漏接。
    const dg = refreshDiags(doc);
    ok(
      dg.floating.size === 0,
      `16.13 预设「${p.name}」有 ${dg.floating.size} 个悬空端口：${[...dg.floating].join(', ')}`,
    );
  }
}

{
  // 16.11 每个预设都能被独立构建两次而不互相污染（ID 计数器重置正确）
  for (const p of PRESETS) {
    const a = p.build();
    const b = p.build();
    eq(
      a.components.map((c) => c.id),
      b.components.map((c) => c.id),
      `16.11 预设「${p.name}」两次构建的 ID 应一致`,
    );
    eq(a, b, `16.11 预设「${p.name}」两次构建结果应完全相同`);
  }
}

{
  // 16.12 空图预设
  const blank = blankPreset();
  eq(blank.components.length, 0, '16.12 空图预设无元件');
  eq(blank.wires.length, 0, '16.12 空图预设无线');
}

// ============================================================================
// 17. 标注：可拖动（labelOff）、可隐藏（labelHidden）
// ============================================================================

{
  // 带 W/L，好让下面断言覆盖**多行**标注（偏移必须整体作用于所有行）
  const mk = () => ({ ...makeComp(emptyDoc('t'), 'nmos', 100, 100), w: '1u', l: '65n' } as MosComp);
  const base = compLabels(mk());
  eq(base.length, 2, '17.1 NMOS 有实例名 + W/L 两行标注');

  // 17.2 偏移应整体作用在**所有**标注行上，而不是只挪第一行
  const moved = compLabels({ ...mk(), labelOff: { x: 30, y: -20 } } as MosComp);
  eq(moved.length, base.length, '17.2 偏移不改变标注行数');
  for (let i = 0; i < base.length; i++) {
    eq(moved[i].x - base[i].x, 30, `17.2 第 ${i + 1} 行标注 x 应偏移 +30`);
    eq(moved[i].y - base[i].y, -20, `17.2 第 ${i + 1} 行标注 y 应偏移 -20`);
  }

  // 17.3 隐藏后一条都不剩
  eq(compLabels({ ...mk(), labelHidden: true } as MosComp).length, 0, '17.3 labelHidden 时无标注');

  // 17.4 偏移 + 隐藏叠加：隐藏优先
  eq(
    compLabels({ ...mk(), labelHidden: true, labelOff: { x: 50, y: 50 } } as MosComp).length,
    0,
    '17.4 隐藏优先于偏移',
  );

  // 17.5 偏移是**相对量**：元件移动后标注要跟着走，不能停在世界原地
  const at0 = compLabels({ ...mk(), x: 0, y: 0 } as MosComp);
  const at100 = compLabels({ ...mk(), x: 100, y: 100 } as MosComp);
  const off = compLabels({ ...mk(), x: 100, y: 100, labelOff: { x: 30, y: -20 } } as MosComp);
  eq(off[0].x - at100[0].x, 30, '17.5 偏移与元件位置相互独立');
  eq(at100[0].x - at0[0].x, 100, '17.5 元件移动 100 → 标注同步移动 100');

  // 17.6 标注只在边界被包含 —— 别把别的元件的标注也一起框进来
  const doc = { ...emptyDoc('t'), components: [mk()] };
  const p0 = compLabels(doc.components[0])[0];
  eq(labelAt(doc, { x: p0.x + 2, y: p0.y }), doc.components[0].id, '17.6 标注左侧命中');
  eq(labelAt(doc, { x: p0.x + 400, y: p0.y }), null, '17.6 远处不误命中');
  eq(labelAt(doc, { x: p0.x, y: p0.y - 500 }), null, '17.6 上方不误命中');

  // 17.7 隐藏标注后不应再被命中（否则能拖一个看不见的东西）
  const hid = { ...emptyDoc('t'), components: [{ ...mk(), labelHidden: true } as MosComp] };
  eq(labelAt(hid, { x: p0.x + 2, y: p0.y }), null, '17.7 隐藏的标注不应被命中');

  // 17.8 moveLabels 相对当前偏移做增量，且只有目标元件被改
  const d2 = { ...emptyDoc('t'), components: [mk(), makeComp(emptyDoc('t'), 'pmos', -100, 0)] };
  const before = d2.components[0].labelOff ?? { x: 0, y: 0 };
  const moved2 = moveLabels(d2, new Set([d2.components[0].id]), GRID, GRID);
  eq(moved2.components[0].labelOff?.x, before.x + GRID, '17.8 moveLabels x 增量正确');
  eq(moved2.components[0].labelOff?.y, before.y + GRID, '17.8 moveLabels y 增量正确');
  eq(moved2.components[1].labelOff, undefined, '17.8 非目标元件不受影响');

  // 17.9 零位移应原样返回（保持引用，便于上层跳过重渲染）
  ok(moveLabels(d2, new Set([d2.components[0].id]), 0, 0) === d2, '17.9 零位移返回原对象');
  ok(moveLabels(d2, new Set(), GRID, GRID) === d2, '17.9 空集合返回原对象');

  // 17.10 归栅格：拖完停在半格上会让导出坐标出现小数
  const d3 = { ...emptyDoc('t'), components: [mk()] };
  const snapped = moveLabels(d3, new Set([d3.components[0].id]), GRID + 3, GRID + 7);
  const offv = snapped.components[0].labelOff!;
  eq(offv.x % GRID, 0, '17.10 标注偏移 x 落在栅格上');
  eq(offv.y % GRID, 0, '17.10 标注偏移 y 落在栅格上');

  // 17.11 标注隐藏/偏移必须能穿过 normalize（JSON 往返不能丢字段）
  const rt = normalize({
    ...emptyDoc('t'),
    components: [{ ...mk(), labelOff: { x: 40, y: -60 }, labelHidden: true }],
  });
  eq(rt.components[0].labelOff?.x, 40, '17.11 normalize 保留 labelOff.x');
  eq(rt.components[0].labelOff?.y, -60, '17.11 normalize 保留 labelOff.y');
  eq(rt.components[0].labelHidden, true, '17.11 normalize 保留 labelHidden');

  // 17.12 脏数据：labelOff 是字符串/null 时兜底成「默认位置」而不是崩
  for (const bad of [null, undefined, 'x', 123, [], { x: 'a', y: null }]) {
    const n = normalize({
      ...emptyDoc('t'),
      components: [{ ...mk(), labelOff: bad }],
    });
    const o = n.components[0].labelOff;
    ok(
      o === undefined || (Number.isFinite(o.x) && Number.isFinite(o.y)),
      `17.12 脏 labelOff ${JSON.stringify(bad)} 应兜底为有限值`,
    );
  }

  // 17.13 标注计入包围盒 —— 拖远的标注也要算进去，否则 fit 会把它切掉
  const far = { ...emptyDoc('t'), components: [{ ...mk(), labelOff: { x: 600, y: 600 } } as MosComp] };
  const bbFar = boundsOf(far);
  const lblFar = compLabels(far.components[0])[0];
  ok(bbFar.x + bbFar.w >= lblFar.x, '17.13 拖远的标注右缘应被包围盒包含');
  ok(bbFar.y + bbFar.h >= lblFar.y, '17.13 拖远的标注下缘应被包围盒包含');
}

// ============================================================================
// 18. 拖拽放置：ghost 预览与导出不互相污染
// ============================================================================

{
  const doc: MosDoc = { ...emptyDoc('t'), components: [makeComp(emptyDoc('t'), 'nmos', 0, 0)] };
  const base = { mode: 'screen' as const, view: { zoom: 1, panX: 0, panY: 0 }, vw: 800, vh: 600 };

  // 18.1 ghost 出现在屏幕模式
  const withGhost = renderSvg(doc, { ...base, placeGhost: { kind: 'pmos', x: 120, y: 80 } });
  ok(withGhost.includes('opacity="0.55"'), '18.1 屏幕模式应画出拖拽 ghost');

  // 18.2 **导出不得含 ghost** —— 它是交互反馈，进导出就是脏东西
  const exported = renderSvg(doc, { mode: 'export', placeGhost: { kind: 'pmos', x: 120, y: 80 } });
  ok(!exported.includes('opacity="0.55"'), '18.2 导出模式不应包含 ghost');
  ok(!/<style/.test(exported) && !/class=/.test(exported), '18.2 带 ghost 参数导出仍自包含');

  // 18.3 标注的拖拽命中框只在屏幕模式输出
  const labeled = { ...doc, components: [{ ...doc.components[0], label: 'M1' }] };
  const screenLbl = renderSvg(labeled, base);
  ok(screenLbl.includes('mc-label-hit'), '18.3 屏幕模式输出标注命中框');
  const exportLbl = renderSvg(labeled, { mode: 'export' });
  ok(!exportLbl.includes('mc-label-hit'), '18.3 导出不输出标注命中框');
  ok(exportLbl.includes('M1'), '18.3 标注文字本身仍要导出');

  // 18.4 隐藏标注后屏幕与导出都不再出现该文字
  const hidden = { ...doc, components: [{ ...doc.components[0], label: 'M1', labelHidden: true }] };
  ok(!renderSvg(hidden, base).includes('>M1<'), '18.4 屏幕模式隐藏标注后不渲染文字');
  ok(!renderSvg(hidden, { mode: 'export' }).includes('>M1<'), '18.4 导出模式隐藏标注后不含文字');

  // 18.5 拖走标注后，导出 SVG 里文字应出现在新位置
  const shifted = { ...doc, components: [{ ...doc.components[0], label: 'M1', labelOff: { x: 200, y: 0 } }] };
  const plain = renderSvg(doc, { mode: 'export' });
  const movedSvg = renderSvg(shifted, { mode: 'export' });
  ok(plain !== movedSvg, '18.5 标注偏移应改变导出内容');
  ok(movedSvg.includes('M1'), '18.6 偏移后标注文字仍存在');
}

// ============================================================================
// 输出
// ============================================================================

console.log(`\n通过 ${pass} 项`);
if (fails.length) {
  console.log(`失败 ${fails.length} 项：\n`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('全部通过 ✓');
}
