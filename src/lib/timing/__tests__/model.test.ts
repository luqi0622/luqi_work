/**
 * 时序波形图 —— 断言测试
 *
 * 用 esbuild bundle 后交给 node 直接跑：
 *   npx esbuild src/lib/timing/__tests__/model.test.ts --bundle --format=esm \
 *     --platform=node --outfile=.tmp-timing-test.mjs --log-level=warning
 *   node .tmp-timing-test.mjs
 *
 * 断言失败时打印期望/实际的实际值，方便直接定位。
 */

// 接口必须带 type 修饰符（与源码保持一致，避免测试与实际运行行为不一致）
import type {
  BusSeg,
  ClockSeg,
  DigitalSeg,
  TimingDoc,
} from '../types';
import {
  addAnalog,
  addClock,
  busValueAt,
  bumpIdSeq,
  canRedo,
  canUndo,
  clampTick,
  clockEdges,
  clockLevelAt,
  cloneDoc,
  crossHalfWidth,
  digitalLevelAt,
  formatTime,
  fromHex,
  insertEdge,
  moveEdge,
  nearestEdge,
  normalize,
  nsToTick,
  pushHistory,
  removeEdge,
  removeSignal,
  snapTick,
  tickToNs,
  toHex,
  type History,
} from '../model';
import { GEO, axisTicks, exportSVG, renderAll } from '../render';
import { PRESETS, emptyDoc, loadPreset, presetGroups } from '../preset';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string, detail?: unknown): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(msg + (detail === undefined ? '' : ` → ${JSON.stringify(detail)}`));
  }
}

function eq(a: unknown, b: unknown, msg: string): void {
  ok(
    JSON.stringify(a) === JSON.stringify(b),
    msg,
    { expected: b, actual: a },
  );
}

function numEq(a: number, b: number, msg: string): void {
  ok(Math.abs(a - b) < 1e-6, msg, { expected: b, actual: a });
}

// ============================================================================
console.log('—— 时间换算 ——');
// ============================================================================

{
  const doc = { tickNs: 1 } as TimingDoc;
  numEq(tickToNs(doc, 100), 100, 'tick→ns 1:1');
  numEq(tickToNs(doc, 0), 0, 'tick0 = 0ns');
  eq(nsToTick(doc, 99.6), 100, 'ns→tick 就近取整');

  const nsDoc = { tickNs: 0.25 } as TimingDoc;
  numEq(tickToNs(nsDoc, 4), 1, '0.25ns/tick 时 4 tick = 1ns');
  eq(nsToTick(nsDoc, 1), 4, '1ns = 4 tick');

  const usDoc = { tickNs: 1000 } as TimingDoc;
  eq(formatTime(usDoc, 2), '2 μs', 'μs 格式');
  eq(formatTime(nsDoc, 4), '1 ns', 'ns 格式');
  eq(formatTime(nsDoc, 2), '500 ps', '亚纳秒自动转 ps');
  eq(formatTime({ tickNs: 1e6 } as TimingDoc, 3), '3 ms', 'ms 格式');
  eq(formatTime(nsDoc, 0), '0', '0 单独处理');

  // 浮点尾巴：0.1+0.2 类问题必须被截掉。
  // 0.1ns×3 = 0.3ns 属于亚纳秒，按单位规则显示为 300 ps（而不是 0.30000000000000004）
  eq(formatTime({ tickNs: 0.1 } as TimingDoc, 3), '300 ps', '0.1×3 不显示成 0.30000000000000004');
  eq(formatTime({ tickNs: 0.1 } as TimingDoc, 30), '3 ns', '0.1×30 精确等于 3ns');
  eq(formatTime({ tickNs: 0.001 } as TimingDoc, 1), '1 ps', 'ps 精度');

  eq(clampTick(-5), 0, '负 tick 钳到 0');
  eq(clampTick(1e9), 100000, '超上限被钳');
  eq(clampTick(3.6), 4, '小数取整');
  eq(clampTick(NaN), 0, 'NaN 归零');
}

// ============================================================================
console.log('—— 时钟展开 ——');
// ============================================================================

{
  const c: ClockSeg = { kind: 'clock', id: 'c', name: 'CLK', period: 10, duty: 0.5, initial: 0, phase: 0, color: '#000' };
  eq(clockEdges(c, 100), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100], '50% 占空比：周期内均分');

  // 电平与边沿必须一致：每个边沿处电平翻转
  // 注意要在边沿「前后」比较—— 边沿位置本身电平已经翻转了，
  // 拿 t=e 和 t=0 比是比不出翻转的（t=0 恰好是第一个边沿）
  let consistent = true;
  const edgeList = clockEdges(c, 100);
  for (const e of edgeList) {
    if (clockLevelAt(c, e) === clockLevelAt(c, e - 0.5)) consistent = false;
  }
  ok(consistent, 'clockLevelAt 与边沿列表处处一致（边沿前后电平必翻转）');

  // 每个边沿前后电平必须相反，且首个边沿之后的电平与 initial 相反
  ok(edgeList.every((e) => clockLevelAt(c, e) !== clockLevelAt(c, e - 0.5)), '所有边沿都是真实翻转点');
  eq(clockLevelAt(c, 0), clockLevelAt(c, 0.5), '边沿内电平保持不变');

  // 25% 占空比
  const q: ClockSeg = { ...c, duty: 0.25 };
  eq(clockEdges(q, 20).slice(0, 5), [0, 3, 10, 13, 20], '25% 占空比落在 1/4 周期处');

  // 相位偏移
  const p: ClockSeg = { ...c, phase: 3 };
  eq(clockEdges(p, 20).slice(0, 3), [3, 8, 13], '相位右移3 tick');

  // initial=1（CPOL=1）
  const inv: ClockSeg = { ...c, initial: 1 };
  eq(clockLevelAt(inv, 0), 1, 'initial=1 时起始为高');
  eq(clockLevelAt(inv, 5), 0, 'initial=1 时高电平在后半段');
  // 50% 占空比下 initial=0：高电平区间是 [0,5)，所以 t=4 为高、t=5 已变低
  eq(clockLevelAt(c, 4), 1, 'initial=0 时高电平在前半段');
  eq(clockLevelAt(c, 5), 0, '占空比分界点归入低电平（半开区间 [0,5)）');

  // 占空比钳制：0和1 会让波形退化
  eq(clockEdges({ ...c, duty: 0 }, 40).length, clockEdges({ ...c, duty: 0.05 }, 40).length, 'duty=0 被钳到 0.05');
  ok(clockEdges({ ...c, duty: 1.5 }, 40).length > 0, 'duty>1 被钳到 0.95 后仍有边沿');

  eq(clockEdges({ ...c, period: 1 }, 40), [], 'period<2 不产生边沿');
  eq(clockLevelAt({ ...c, period: 1 }, 10), 0, 'period 非法时回落到 initial');

  ok(clockEdges(c, 100).every((e) => e >= 0 && e <= 100), '边沿不越界');
  const asc = clockEdges(c, 100);
  ok(asc.every((e, i) => i === 0 || e > asc[i - 1]), '边沿严格升序（无重合）');
}

// ============================================================================
console.log('—— 数字信号电平 ——');
// ============================================================================

{
  const d: DigitalSeg = { kind: 'digital', id: 'd', name: 'SIG', initial: 0, edges: [10, 20, 30], color: '#000' };
  eq(digitalLevelAt(d, 0), 0, 't=0 为 initial');
  eq(digitalLevelAt(d, 9), 0, '边沿前保持');
  eq(digitalLevelAt(d, 10), 1, '边沿处翻转');
  eq(digitalLevelAt(d, 15), 1, '段内保持');
  eq(digitalLevelAt(d, 20), 0, '第二个边沿再翻');
  eq(digitalLevelAt(d, 100), 1, '最后一个边沿后保持翻转后的电平');

  // 边沿是「翻转点」，电平按半开区间归属：t=10 已翻，t=9 还是旧电平
  const lvl = [0, 5, 9, 10, 15, 19, 20].map((t) => digitalLevelAt(d, t));
  eq(lvl, [0, 0, 0, 1, 1, 1, 0], '边沿处电平已翻转（前一半格仍为旧值）');

  // 电平变化次数必须等于边沿数（内建一致性检查）
  let flips = 0;
  let prevL = digitalLevelAt(d, 0);
  for (let t = 1; t <= 50; t++) {
    const l = digitalLevelAt(d, t);
    if (l !== prevL) flips += 1;
    prevL = l;
  }
  eq(flips, d.edges.length, '逐 tick 扫描出的翻转次数 == 边沿数量');
}

// ============================================================================
console.log('—— 边沿编辑 ——');
// ============================================================================

{
  eq(moveEdge([10, 20, 30], 1, 25), [10, 25, 30], '边沿可自由移动');
  eq(moveEdge([10, 20, 30], 0, 5), [5, 20, 30], '第一个边沿可左移');
  // 拖过头时不能压到邻居身上：index=0 的上界是 next[1]-1 = 19
  eq(moveEdge([10, 20, 30], 0, 50), [19, 20, 30], '越过右邻居时被拦在邻居前一格');
  eq(moveEdge([10, 20, 30], 1, 0), [10, 11, 30], '越过左邻居时被挤开一格');
  eq(moveEdge([10, 20, 30], 5, 15), [10, 20, 30], '越界索引返回原数组');
  eq(moveEdge([10, 20, 30], -1, 15), [10, 20, 30], '负索引返回原数组');

  // 不变量：编辑后边沿始终严格升序且无重合
  const cases = [[1, 5], [5, 1], [100, 200], [2, 3], [0, 99999]];
  let inv = true;
  for (const [i, to] of cases) {
    const r = moveEdge([10, 20, 30], i, to);
    if (!r.every((e, k) => k === 0 || e > r[k - 1])) inv = false;
  }
  ok(inv, '各种移动后边沿仍严格升序');

  eq(insertEdge([10, 30], 20), [10, 20, 30], '插入保持升序');
  eq(insertEdge([], 5), [5], '空数组插入');
  eq(insertEdge([10], 10), [10, 10], '插入重合点会产生重复（交由 normalize 去重）');

  eq(removeEdge([10, 20, 30], 1), [10, 30], '删除中间边沿');
  eq(removeEdge([10, 20], 9), [10, 20], '删除越界索引无副作用');

  // 21 距离最近边沿(20)是 1，超出0.5 容差 → 不命中
  eq(nearestEdge([10, 20, 30], 21, 0.5), -1, '超出容差不命中');
  eq(nearestEdge([10, 20, 30], 20.4, 0.5), 1, '容差内命中最近边沿');
  eq(nearestEdge([], 5, 1), -1, '空数组返回 -1');
  eq(nearestEdge([10, 20], 20, 0), 1, '容差为 0 时命中精确位置');
}

// ============================================================================
console.log('—— 总线 ——');
// ============================================================================

{
  eq(toHex(5, 8), '05', '补零到2 位');
  eq(toHex(255, 8), 'FF', 'FF 补齐');
  eq(toHex(0, 8), '00', '0 补齐');
  eq(toHex(0xa3, 8), 'A3', '大写十六进制');
  eq(toHex(16, 8), '10', '8 位宽下的 0x10');
  // 16 超出 4 位宽（能表示 0~15），必须被掩码截断成 0，而不是显示成 10
  eq(toHex(16, 4), '0', '超出4 位宽的值被掩码');
  eq(toHex(5, 1), '1', '1 位宽');
  eq(toHex(0x123, 16), '0123', '16 位宽补4位');
  // 溢出值必须被位宽掩码截断，否则会显示成 100（超出 8 位）
  eq(toHex(256, 8), '00', '超出位宽的值被掩码');
  eq(toHex(-1, 8), 'FF', '负值按补码处理');

  eq(fromHex('0A'), 10, '解析十六进制');
  eq(fromHex('0xff'), 255, '小写 + 0x 前缀');
  eq(fromHex('FF'), 255, '无前缀');
  eq(fromHex('GG'), null, '非法字符返回 null');
  eq(fromHex(''), null, '空串返回 null');
  eq(fromHex('  12  '), 0x12, '前后空白被裁掉（0x12 = 18 十进制）');

  const b: BusSeg = {
    kind: 'bus', id: 'b', name: 'B', width: 8, color: '#000',
    segments: [{ t: 0, v: 1 }, { t: 40, v: 2 }, { t: 80, v: 3 }],
  };
  eq(busValueAt(b, 0), 1, 't=0 取第一段');
  eq(busValueAt(b, 39), 1, '段内取值');
  eq(busValueAt(b, 40), 2, '边界点取新段');
  eq(busValueAt(b, 999), 3, '超出末尾取最后一段');

  // X 交叉半宽不得超过相邻段
  const half = crossHalfWidth(b, 1, 9);
  numEq(half, 9, '段够长时用 maxW');
  const tight: BusSeg = { ...b, segments: [{ t: 0, v: 1 }, { t: 20, v: 2 }, { t: 40, v: 3 }] };
  numEq(crossHalfWidth(tight, 1, 9), 5, '段短时被段长/4 约束');
  // 首段没有左邻居，只受右侧段长约束：40/4 = 10 > maxW=9 → 取 9
  numEq(crossHalfWidth(b, 0, 9), 9, '首段受右侧段长约束');
}

// ============================================================================
console.log('—— 吸附 ——');
// ============================================================================

{
  const doc: TimingDoc = {
    title: 't', tickNs: 1, lengthTicks: 100, majorEvery: 20,
    signals: [{ kind: 'clock', id: 'ck', name: 'CLK', period: 10, duty: 0.5, initial: 0, phase: 0, color: '#000' }],
    markers: [{ id: 'm1', t: 35, label: 'm' }],
    spans: [],
  };
  eq(snapTick(doc, 35.2, { tolerance: 0.5 }).t, 35, '吸附到游标');
  ok(snapTick(doc, 35.2).hint.includes('游标'), '吸附提示标出目标');
  eq(snapTick(doc, 10.1, { tolerance: 0.5 }).t, 10, '吸附到时钟沿');
  ok(snapTick(doc, 10.1).hint.includes('CLK'), '提示指出是哪条信号的沿');

  // 跳过自身：拖 CLK 的沿时不吸自己（否则会自我锁定）
  const r = snapTick(doc, 10.1, { skipSignalId: 'ck', tolerance: 0.5 });
  ok(!r.hint.includes('CLK'), 'skipSignalId 生效：不吸自己的沿');

  // 网格吸附：majorEvery=20 → 次网格 = 4
  // 21 距最近网格(20) 是 1 tick，超出 0.5 容差 → 不吸附
  eq(snapTick(doc, 21, { tolerance: 0.5 }).t, 21, '离网格 1 tick 时不吸附（容差 0.5）');
  eq(snapTick(doc, 20.4, { tolerance: 0.5 }).t, 20, '距网格 0.4 tick 时吸附');
  // 20.4 优先吸到时钟沿（20）而不是网格 —— 标志物优先于网格，这是设计意图
  eq(snapTick(doc, 20.4, { tolerance: 0.5 }).hint, '对齐 CLK 沿', '标志物优先于网格');
  // 24.4 附近没有时钟沿（最近的 25 差 0.6，超容差），只能吸到网格 24
  eq(snapTick(doc, 24.4, { tolerance: 0.5 }).t, 24, '无标志物时吸附到网格');
  eq(snapTick(doc, 24.4, { tolerance: 0.5 }).hint, '吸附网格', '给出网格吸附提示');
  eq(snapTick(doc, 22.5, { tolerance: 0.5 }).hint, '', '不命中任何目标时无提示');
  eq(snapTick(doc, 22.5, { tolerance: 0.5 }).t, 22.5, '不命中时原样返回');
}

// ============================================================================
console.log('—— 撤销历史 ——');
// ============================================================================

{
  const a = emptyDoc();
  const b = cloneDoc(a);
  b.title = '改过';
  let h: History = { past: [], future: [], limit: 80 };
  eq(canUndo(h), false, '初始不能撤销');
  h = pushHistory(h, a);
  eq(canUndo(h), true, '记录后可以撤销');
  eq(h.future.length, 0, '新变更清空 redo 栈');
  eq(cloneDoc(a).title, a.title, '深拷贝互不影响');

  // 上限保护
  let h2: History = { past: [], future: [], limit: 5 };
  for (let i = 0; i < 20; i++) h2 = pushHistory(h2, a);
  eq(h2.past.length, 5, '历史栈长度受 limit 限制');
  eq(canRedo(h2), false, 'limit 测试后无 redo');
}

// ============================================================================
console.log('—— normalize 容错 ——');
// ============================================================================

{
  const n = normalize(null);
  ok(Array.isArray(n.signals), 'null 输入返回合法文档');
  eq(n.signals.length, 0, 'null 输入无信号');
  eq(n.title, '未命名时序图', '缺省标题');

  const bad = normalize({
    title: 123, tickNs: -5, lengthTicks: 'abc', majorEvery: 0,
    signals: [
      { kind: 'clock', name: '', period: 0, duty: 99, initial: 5 },
      { kind: 'bus', width: 99, segments: [{ t: 20, v: 1 }, { t: 5, v: 2 }] },
      { kind: 'analog', points: [{ t: 10, v: 5 }, { t: 5, v: -1 }] },
      { kind: 'digital', edges: [10, 10, 20, -5] },
      null,
      { kind: '不认识' },
    ],
    markers: [{ t: -3 }, { t: 'x', label: 5 }],
    spans: [{ t1: 50, t2: 10 }],
  });
  eq(bad.title, '未命名时序图', '非字符串标题被替换');
  ok(bad.tickNs > 0, '负 tickNs 被修正');
  ok(Number.isFinite(bad.lengthTicks) && bad.lengthTicks > 0, '非法 lengthTicks 兜底为 200');
  ok(bad.majorEvery >= 1, 'majorEvery 至少为 1');

  const ck = bad.signals[0] as ClockSeg;
  ok(ck.period >= 2, 'period 下限被强制');
  ok(ck.duty <= 0.95 && ck.duty >= 0.05, 'duty 被钳制');
  ok(ck.initial === 0 || ck.initial === 1, 'initial 归一到 0/1');
  eq(ck.name, 'SIG1', '空名兜底');

  const bs = bad.signals[1] as BusSeg;
  ok(bs.width >= 1 && bs.width <= 32, '总线位宽钳制');
  eq(bs.segments[0].t, 0, '总线首段自动补到 t=0');
  ok(bs.segments[0].t <= bs.segments[1].t, '总线时段被排成升序');

  const an = bad.signals[2];
  ok(an.kind === 'analog' && an.points.every((p) => p.v >= 0 && p.v <= 1), '模拟值钳制到 0~1');
  ok(an.kind === 'analog' && an.points[0].t <= an.points[1].t, '模拟关键点排序');

  const dg = bad.signals[3] as DigitalSeg;
  eq(dg.edges, [0, 10, 20], '边沿去重 + 负值钳到 0');
  ok(dg.edges.every((e, i) => i === 0 || e > dg.edges[i - 1]), '归一后边沿严格升序');

  ok(bad.signals.length === 6, '未知 kind 降级为数字信号而非丢弃');
  ok(bad.markers.every((m) => m.t >= 0), '游标位置修正');
  ok(bad.markers.every((m) => typeof m.label === 'string'), '游标标签类型兜底');
  const sp = bad.spans[0];
  eq([sp.t1, sp.t2], [10, 50], '标注起终点自动排序');

  // 往返：normalize(normalize(x)) 应幂等
  const again = normalize(bad);
  eq(again.signals.length, bad.signals.length, 'normalize 幂等（信号数）');
  eq(again.lengthTicks, bad.lengthTicks, 'normalize 幂等（长度）');
}

// ============================================================================
console.log('—— 渲染 path ——');
// ============================================================================

{
  const doc = emptyDoc();
  const shapes = renderAll(doc, { pxPerTick: 4 });
  eq(shapes.length, doc.signals.length, '每条信号产出一个 shape');
  ok(shapes.every((s) => s.d.startsWith('M ')), '每条 path 以M 开头（合法 SVG 语法）');
  ok(shapes.every((s) => !s.d.includes('NaN')), 'path 中无 NaN');
  ok(shapes.every((s) => !s.d.includes('undefined')), 'path 中无 undefined');
  ok(shapes.every((s) => s.d.split(/[HVL]/).length > 1), 'path 至少含一个绘制指令');

  // 数字信号：H/V 交替，绝不能有斜线。
  // 检查「斜线」的方式：去掉 M 之后，剩下的路径里不能出现 (数字 空格 数字) 这种
  // 「从当前点直接连到另一点」的写法（L 命令会引入空格分隔的坐标对）
  const dig = shapes.find((s) => s.id === doc.signals[1].id)!;
  const body = dig.d.replace(/^M\s*-?[\d.]+\s+-?[\d.]+/, '');
  ok(!/\s-?[\d.]+\s+-?[\d.]+/.test(body), '数字波形没有斜线段（只有 H/V）');
  // RESET# 有 1 个边沿 → 2 个水平段：翻转前后各一段，末尾再延伸一段
  ok((dig.d.match(/H/g) || []).length >= 2, '数字波形含水平段');
  ok((dig.d.match(/V/g) || []).length >= 1, '数字波形含垂直跳变段');
  ok(dig.edgeX.length > 0, '数字信号提供可拖动边沿坐标');

  // 时钟边沿数= 渲染出的边沿手柄数
  const ck = shapes.find((s) => s.id === doc.signals[0].id)!;
  eq(ck.edgeX.length, clockEdges(doc.signals[0] as ClockSeg, doc.lengthTicks).length, '时钟手柄数 == 展开边沿数');

  // 总线：两条 path + 段内标签
  const bs = shapes.find((s) => s.id === doc.signals[2].id)!;
  ok(bs.d2 !== undefined, '总线输出两条 path（X 交叉需要）');
  eq(bs.labels.length, 3, '总线每段一个值标签');
  ok(bs.labels.every((l) => /^[0-9A-F]+$/.test(l.text)), '总线标签是十六进制');

  // 总线的两条线都必须从 t=0 开始，且延伸到画布右缘（不能画一半就停）
  ok(/^M\s*132(\s|$)/.test(bs.d), '总线第一条线从信号名列右缘(t=0) 起笔');
  ok(/^M\s*132(\s|$)/.test(bs.d2!), '总线第二条线同样从 t=0 起笔');
  ok(bs.d.includes('H 10000132'), '总线第一条线延伸到画布右缘');
  ok(bs.d2!.includes('H 10000132'), '总线第二条线延伸到画布右缘');
  // X 交叉必须存在：段数 > 1 时应出现 L 命令
  ok((bs.d.match(/L/g) || []).length >= 1, '总线段间存在 X 交叉（L 命令）');

  // 几何常量：名字列宽要大于 0，否则总线 X 会盖到名字上
  ok(GEO.nameW > 40, '信号名列宽度足够');
  ok(GEO.rowH > 20 && GEO.rowH < 80, '行高在合理区间');
  ok(GEO.ampRatio > 0.3 && GEO.ampRatio < 1, '振幅占比在合理区间');

  // 网格刻度
  const ticks = axisTicks(doc, { pxPerTick: 4 });
  ok(ticks.every((t) => t.x >= GEO.nameW), '刻度 x 不落在信号名列里');
  ok(ticks.filter((t) => t.major).length >= Math.floor(doc.lengthTicks / doc.majorEvery) + 1, '主刻度数量正确');
}

{
  // 空文档不能崩
  const empty = normalize({});
  const s = renderAll(empty, { pxPerTick: 4 });
  eq(s.length, 0, '空文档渲染出 0 个 shape');
  ok(typeof exportSVG(empty, { pxPerTick: 4, background: null, withNames: true }) === 'string', '空文档可导出');
}

{
  // 极端值不能产生 NaN
  const wild = normalize({
    tickNs: 0.001,
    lengthTicks: 1,
    majorEvery: 1,
    signals: [
      { kind: 'clock', period: 2, duty: 0.5 },
      { kind: 'bus', width: 32, segments: [{ t: 0, v: 0 }] },
      { kind: 'analog', points: [{ t: 0, v: 0 }, { t: 1, v: 1 }] },
      { kind: 'digital', edges: [] },
    ],
    markers: [{ t: 1, label: '' }],
    spans: [{ t1: 0, t2: 1, label: '', row: -5 }],
  });
  const sh = renderAll(wild, { pxPerTick: 100 });
  ok(sh.every((s) => !s.d.includes('NaN')), '极端参数下无 NaN');
  ok(sh.every((s) => !s.d.includes('Infinity')), '极端参数下无 Infinity');
}

// ============================================================================
console.log('—— SVG 导出 ——');
// ============================================================================

{
  const doc = emptyDoc();
  const svg = exportSVG(doc, { pxPerTick: 4, background: '#fff', withNames: true });

  ok(svg.startsWith('<svg'), '是合法 SVG 开头');
  ok(svg.trimEnd().endsWith('</svg>'), '是合法 SVG 结尾');
  ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), '带 xmlns（否则单独打开不渲染）');
  ok(svg.includes('viewBox='), '带 viewBox');
  ok(!svg.includes('NaN'), '导出无 NaN');
  ok(!svg.includes('undefined'), '导出无 undefined');
  ok(!svg.includes('class='), '不用 CSS class —— 外部样式会丢失');

  // 自包含：所有颜色必须是内联属性，不能有 <style> 或 url() 引用外部资源
  ok(!svg.includes('<style'), '不含 <style> 块（外部打开会丢样式）');
  ok(!/url\((?!#)/.test(svg), '无外部资源引用（只允许内部 marker 的 #id）');

  ok(svg.includes('CLK'), '含信号名');
  // 箭头标注需要区间数据，emptyDoc 里没有 spans，所以用DDR 预设来验
  const withSpans = exportSVG(loadPreset('ddr3-read')!, { pxPerTick: 4, background: null, withNames: true });
  ok(withSpans.includes('marker-start='), '区间标注有起点箭头');
  ok(withSpans.includes('marker-end='), '区间标注有终点箭头');
  ok(withSpans.includes('tRCD'), 'DRAM 预设的 tRCD 标注出现在导出里');

  // 导出的样式必须是内联属性：所有 stroke/fill 都要出现在标签属性里，
  // 而不是靠 class + <style>。否则拖进 PPT / Figma 会全变默认黑
  const styledByAttr = (svg.match(/stroke="[^"]*"/g) || []).length;
  ok(styledByAttr >= 10, '描边颜色写成 presentation attribute', { count: styledByAttr });

  // 不画信号名列时坐标要整体左移
  const noNames = exportSVG(doc, { pxPerTick: 4, background: null, withNames: false });
  ok(!noNames.includes('>CLK<'), 'withNames=false 时不输出信号名');
  ok(noNames.length < svg.length, '去掉名字列后文件更小');

  // XSS：信号名里的尖括号必须转义
  const xss = normalize({
    title: 'x',
    signals: [{ kind: 'digital', name: '<script>alert(1)</script>', edges: [] }],
    markers: [],
    spans: [],
  });
  const xsvg = exportSVG(xss, { pxPerTick: 4, background: null, withNames: true });
  ok(!xsvg.includes('<script>'), '信号名中的尖括号被转义');
  ok(xsvg.includes('&lt;script&gt;'), '转义成实体');

  // 标注文字同样要转义
  const xss2 = normalize({
    signals: [],
    markers: [{ t: 1, label: 'a&b<c>' }],
    spans: [],
  });
  const xsvg2 = exportSVG(xss2, { pxPerTick: 4, background: null, withNames: true });
  ok(!xsvg2.includes('a&b<c>'), '游标标签也被转义');
}

// ============================================================================
console.log('—— 预设 ——');
// ============================================================================

{
  eq(PRESETS.length >= 10, true, '预设数量足够');
  const groups = presetGroups();
  ok(groups.length >= 3, '预设分组存在');
  ok(groups.some((g) => g.group.includes('DRAM')), '有 DRAM 相关分组（核心需求）');

  // 每个预设都必须能构建出合法文档，且能渲染、能导出
  let allOk = true;
  const notes: string[] = [];
  for (const p of PRESETS) {
    try {
      const doc = p.build();
      if (doc.signals.length === 0) { allOk = false; notes.push(`${p.key}:无信号`); }
      if (doc.lengthTicks <= 0) { allOk = false; notes.push(`${p.key}:长度非正`); }
      const shapes = renderAll(doc, { pxPerTick: 3 });
      shapes.forEach((s) => {
        if (s.d.includes('NaN')) { allOk = false; notes.push(`${p.key}:path 含 NaN`); }
      });
      const svg = exportSVG(doc, { pxPerTick: 3, background: null, withNames: true });
      if (svg.includes('NaN')) { allOk = false; notes.push(`${p.key}:SVG 含 NaN`); }
      // 标注的行号不能越界，否则会画到画布外
      doc.spans.forEach((sp) => {
        if (sp.row >= doc.signals.length) { allOk = false; notes.push(`${p.key}:span 行号越界`); }
      });
      if (doc.spans.some((s) => s.t2 <= s.t1)) { allOk = false; notes.push(`${p.key}:存在零宽标注`); }
    } catch (e) {
      allOk = false;
      notes.push(`${p.key}:抛异常 ${(e as Error).message}`);
    }
  }
  ok(allOk, '全部预设都能构建/渲染/导出', notes.length ? notes : undefined);

  // loadPreset 返回独立副本：改一份不影响下次载入
  const a = loadPreset('ddr3-read')!;
  a.signals.forEach((s) => { s.name = '改过'; });
  a.title = '改过';
  const b = loadPreset('ddr3-read')!;
  ok(b.signals.every((s) => s.name !== '改过'), 'loadPreset 每次返回新对象');
  ok(b.title !== '改过', 'loadPreset 标题不受上次修改影响');

  eq(loadPreset('不存在'), null, '未知预设 key 返回 null');
  eq(loadPreset('ddr3-read')!.title, loadPreset('ddr3-read')!.title, '同名预设构建结果一致');

  // 重复载入两次的 id 不能冲突（否则会撞上已保存的数据）
  const p1 = loadPreset('spi');
  const p2 = loadPreset('spi');
  const ids1 = p1!.signals.map((s) => s.id).concat(p1!.markers.map((m) => m.id));
  const ids2 = p2!.signals.map((s) => s.id).concat(p2!.markers.map((m) => m.id));
  eq(ids1, ids2, '同一预设两次载入 id 一致');

  // 跨预设 id 不冲突：载入A 再载入B，B 的 id 不与 A 重叠是好事（反之也没问题，
  // 因为 normalize 会重排），但至少各自内部不重复
  const all = PRESETS.map((p) => p.build());
  all.forEach((doc) => {
    const ids = doc.signals.map((s) => s.id);
    eq(ids.length, new Set(ids).size, `预设 ${doc.title} 内信号 id 无重复`);
  });

  // DRAM 预设应包含标注（用户画 DRAM 图就是要标参数）
  const dram = loadPreset('ddr3-read')!;
  ok(dram.spans.length >= 3, 'DDR3 读预设带参数标注');
  ok(dram.markers.length >= 2, 'DDR3 读预设带游标');
  ok(dram.spans.some((s) => s.label.includes('tRCD')), '含 tRCD 标注');
  ok(dram.signals.some((s) => s.kind === 'bus'), '含总线信号（DRAM 命令）');

  const ref = loadPreset('dram-refresh')!;
  ok(ref.spans.some((s) => s.label === 'tRFC'), '刷新预设含 tRFC');
  ok(ref.spans.some((s) => s.label === 'tREFI'), '刷新预设含 tREFI');

  ok(loadPreset('por')!.signals.some((s) => s.kind === 'analog'), '上电预设含模拟电源轨');

  // 时序语义正确性：DQS 边沿必须落在 CK 的时钟沿上。
  // DQS 是从 CK 分频出来的，边沿不对齐就画不出「DQS 相对 CK 的相位偏移」——
  // 而这是 DDR 时序图里最要紧的信息。数值错了图看着还是「像模像样」，只能靠断言守。
  for (const key of ['ddr3-read', 'ddr4-write']) {
    const d = loadPreset(key)!;
    const ck = d.signals.find((s) => s.kind === 'clock' && s.name === 'CK') as ClockSeg;
    const dqsT = d.signals.find((s) => s.kind === 'clock' && s.name === 'DQS_t') as ClockSeg;
    ok(!!ck && !!dqsT, `${key}: 有 CK 与 DQS_t`);
    if (ck && dqsT) {
      eq(dqsT.period, ck.period, `${key}: DQS_t 与 CK 同频（都是分频出来的）`);
      eq(dqsT.phase, ck.period / 2, `${key}: DQS_t 相对 CK 偏移半周期`);
      eq(dqsT.initial, 1, `${key}: DQS_t 空闲为高（与 DQS 反相）`);
    }
    // DQS 的每个边沿都应落在 CK 的半周期栅格上（±1 tick 容差，考虑取整）
    const dqs = d.signals.find((s) => s.kind === 'digital' && s.name === 'DQS') as DigitalSeg | undefined;
    if (dqs && ck) {
      const grid = ck.period / 2;
      const offGrid = dqs.edges.filter((e) => Math.abs((e % grid)) > 1 && Math.abs((e % grid) - grid) > 1);
      eq(offGrid, [], `${key}: DQS 所有边沿都对齐到 CK 半周期栅格`);
    }
  }

  // Bank 冲突预设：同 bank 两次 ACT 的间隔（tRC）必须 > 换 bank 的间隔（tRCD）
  // 注意用 startsWith精确匹配，别用 includes —— 'tRC' 是 'tRCD' 的子串，
  // includes 会先撞上 DDR3 预设的 tRCD 标注，量出来的其实是别的区间。
  const bank = loadPreset('dram-bank')!;
  const hitSpan = bank.spans.find((s) => s.label.startsWith('行命中'));
  const conflictSpan = bank.spans.find((s) => s.label.startsWith('同bank'));
  ok(!!hitSpan && !!conflictSpan, 'Bank 预设含命中与冲突两个区间标注', bank.spans.map((s) => s.label));
  if (hitSpan && conflictSpan) {
    ok(
      (conflictSpan.t2 - conflictSpan.t1) > (hitSpan.t2 - hitSpan.t1),
      '冲突等待(tRC) 比行命中(tRCD) 长——否则语义反了',
      { tRC: conflictSpan.t2 - conflictSpan.t1, tRCD: hitSpan.t2 - hitSpan.t1 },
    );
  }

  // 所有 DDR 预设的命令总线：位宽 6（JEDEC 命令编码），且必须以 NOP(0x3F) 收尾
  for (const key of ['ddr3-read', 'ddr4-write', 'dram-refresh', 'dram-bank']) {
    const d = loadPreset(key)!;
    const cmd = d.signals.find((s) => s.kind === 'bus' && s.name === 'CMD') as BusSeg | undefined;
    ok(!!cmd, `${key}: 有 CMD 总线`);
    if (cmd) {
      eq(cmd.width, 6, `${key}: CMD 位宽 6（JEDEC 命令编码）`);
      eq(cmd.segments[cmd.segments.length - 1].v, 0x3f, `${key}: CMD 以 NOP 收尾（总线回到空闲）`);
      ok(cmd.segments.every((s) => s.t >= 0), `${key}: CMD 各段起点非负`);
    }
  }
}

// ============================================================================
console.log('—— ID 唯一性（曾导致「删一条少两条」）——');
// ============================================================================

{
  /**
   * 回归测试：model.ts 的 nextId 计数器与 preset.ts 的 seq 是两套独立计数器。
   * 载入预设后接着新建信号，如果 ID 撞车，removeSignal(id) 会一次删掉两条。
   * 这里模拟真实流程：载入预设 → 新建信号 → 检查 ID 是否冲突。
   */
  const doc = loadPreset('ddr3-read')!;
  bumpIdSeq(doc);
  const before = doc.signals.length;

  let cur = doc;
  const added: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = addAnalog(cur);
    cur = r.doc;
    added.push(r.id);
  }
  ok(cur.signals.length === before + 5, '连续新建 5 条信号都成功', cur.signals.length);

  const ids = cur.signals.map((s) => s.id);
  eq(ids.length, new Set(ids).size, '新建后所有信号 id 唯一');

  // 预设内部的 id 也必须唯一
  const presetIds = PRESETS.map((p) => p.build().signals.map((s) => s.id)).flat();
  ok(presetIds.every((id) => /^p[spm]/.test(id)), '预设 id 用 p 前缀，与运行时 id 空间隔离');

  // 删除只能删一条：即使 id 撞车也只能删一条
  const victim = cur.signals[cur.signals.length - 1].id;
  const afterDel = removeSignal(cur, victim);
  eq(afterDel.signals.length, cur.signals.length - 1, '删除一条信号只少一条');

  // 即使传入一个重复存在的 id，也只删一条（不扩散）
  const dup: TimingDoc = { ...cur, signals: [...cur.signals, { ...cur.signals[0] }] };
  const dupLen = dup.signals.length;
  eq(removeSignal(dup, cur.signals[0].id).signals.length, dupLen - 1, 'id 撞车时也只删一条');

  eq(removeSignal(cur, '不存在的id').signals.length, cur.signals.length, '删除不存在的 id 是无副作用');
}

// ============================================================================
console.log('—— 空文档 ——');
// ============================================================================

{
  const d = emptyDoc();
  ok(d.signals.length === 3, '空文档带 3 条示例信号');
  ok(d.signals.map((s) => s.kind).includes('clock'), '含时钟');
  ok(d.signals.map((s) => s.kind).includes('bus'), '含总线');
  const n = normalize(d);
  eq(n.signals.length, 3, '空文档能通过 normalize');
}

// ============================================================================
// 汇总
// ============================================================================
console.log('');
console.log(`通过 ${pass} · 失败 ${fail}`);
if (fail > 0) {
  console.log('');
  console.log('失败明细：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}