/**
 * 纯逻辑层断言测试（不依赖浏览器）
 * 跑法：npx esbuild src/lib/logic/__tests__/engine.test.ts --bundle --format=esm --platform=node | node --input-type=module
 */
import { evalGate } from '../gates';
import { topoSort } from '../topology';
import { evaluate } from '../evaluate';
import { buildTruthTable } from '../truthtable';
import { generateExpressions, verifyExpressions } from '../expression';
import type { Circuit, CustomBox, GateKind, LogicNode } from '../types';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error('  ✗ ' + msg);
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);
}
function section(name: string) {
  console.log('\n■ ' + name);
}

// ---------- 构造辅助 ----------
let seq = 0;
function n(type: GateKind, inputs: number, outputs: number, extra: Partial<LogicNode> = {}): LogicNode {
  seq += 1;
  return { id: `n${seq}`, type, x: 0, y: 0, inputs, outputs, ...extra };
}
function wire(c: Circuit, from: string, to: string, fp = 0, tp = 0) {
  seq += 1;
  c.edges.push({ id: `e${seq}`, from: { node: from, port: fp }, to: { node: to, port: tp } });
}
function build(nodes: LogicNode[], edges: Circuit['edges']): Circuit {
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

// ============================================================
section('基础门求值');
{
  eq(evalGate('AND', [true, true]), [true], 'AND(1,1)');
  eq(evalGate('AND', [true, false]), [false], 'AND(1,0)');
  eq(evalGate('OR', [false, true]), [true], 'OR(0,1)');
  eq(evalGate('NOT', [false]), [true], 'NOT(0)');
  eq(evalGate('NAND', [true, true]), [false], 'NAND(1,1)');
  eq(evalGate('NOR', [false, false]), [true], 'NOR(0,0)');
  eq(evalGate('XOR', [true, false]), [true], 'XOR(1,0)');
  eq(evalGate('XNOR', [true, false]), [false], 'XNOR(1,0)');
  // 奇偶校验：3 输入 XOR，全 1 → 1（3 个 1 是奇数）
  eq(evalGate('XOR', [true, true, true]), [true], 'XOR 三输入奇偶校验');
  eq(evalGate('XOR', [true, true, false]), [false], 'XOR 三输入两两抵消');
  eq(evalGate('XNOR', [true, true, true]), [false], 'XNOR 三输入为XOR 取反');
  eq(evalGate('AND', []), [false], '未连接端口按 0：AND() = 0');
  eq(evalGate('NOT', []), [true], '未连接端口按 0：NOT() = 1');
}

// ============================================================
section('拓扑排序与环检测');
{
  const a = n('INPUT', 0, 1);
  const g = n('AND', 2, 1);
  const o = n('OUTPUT', 1, 0);
  const c = build([a, g, o], []);
  wire(c, a.id, g.id, 0, 0);
  wire(c, a.id, g.id, 0, 1);
  wire(c, g.id, o.id);
  const t = topoSort(c);
  ok(!t.hasCycle, '无环电路 hasCycle=false');
  eq(t.order, [a.id, g.id, o.id], '拓扑序 INPUT→AND→OUTPUT');

  // 制造环：o1 → g1 → o1
  const g1 = n('AND', 2, 1);
  const g2 = n('OR', 2, 1);
  const cyc = build([g1, g2], []);
  wire(cyc, g1.id, g2.id);
  wire(cyc, g2.id, g1.id);
  const t2 = topoSort(cyc);
  ok(t2.hasCycle, '检出环');
  eq(t2.cycleNodes.sort(), [g1.id, g2.id].sort(), '环上节点全部列出');

  const res = evaluate(cyc, new Map());
  ok(res.values.size === 0, '有环时 evaluate 返回空值而非崩溃');
  ok(res.warnings.length > 0, '有环时给出 warning');
}

// ============================================================
section('半加器：S = A XOR B, C = A AND B');
{
  const A = n('INPUT', 0, 1, { name: 'A' });
  const B = n('INPUT', 0, 1, { name: 'B' });
  const XOR = n('XOR', 2, 1);
  const AND = n('AND', 2, 1);
  const OS = n('OUTPUT', 1, 0, { name: 'S' });
  const OC = n('OUTPUT', 1, 0, { name: 'C' });
  const c = build([A, B, XOR, AND, OS, OC], []);
  wire(c, A.id, XOR.id, 0, 0);
  wire(c, B.id, XOR.id, 0, 1);
  wire(c, A.id, AND.id, 0, 0);
  wire(c, B.id, AND.id, 0, 1);
  wire(c, XOR.id, OS.id);
  wire(c, AND.id, OC.id);

  const tt = buildTruthTable(c);
  ok(!tt.error, '半加器真值表无错误：' + (tt.error ?? ''));
  eq(tt.columns, ['A', 'B', 'S', 'C'], '列= 输入A/B + 输出S/C');
  eq(
    tt.rows.map((r) => r.outputs.map(Number).join('')),
    ['00', '10', '10', '01'], // (S,C)：00→00, 01→10, 10→10, 11→01
    '半加器真值表输出正确（S=A XOR B, C=A AND B）'
  );

  const expr = generateExpressions(c, { deMorgan: false });
  const s = expr.outputs.find((o) => o.nodeId === OS.id);
  const co = expr.outputs.find((o) => o.nodeId === OC.id);
  ok(!!s && s.text.includes('XOR'), 'S 表达式含 XOR：' + (s?.text ?? '缺失'));
  ok(!!co && (co.text.includes('AND')), 'C 表达式含 AND：' + (co?.text ?? '缺失'));

  const v = verifyExpressions(c, expr);
  ok(v.ok, '表达式与电路一致', );
}

// ============================================================
section('4 输入上限 + pin 固定输入');
{
  const mk = (names: string[]) => {
    const ins = names.map((nm) => n('INPUT', 0, 1, { name: nm }));
    // 输出探针只有 1 个输入端口，用可调输入数的 OR 门把多个输入汇聚过去
    const OR = n('OR', names.length, 1);
    const o = n('OUTPUT', 1, 0, { name: 'Y' });
    const c = build([...ins, OR, o], []);
    names.forEach((_, i) => wire(c, ins[i].id, OR.id, 0, i));
    wire(c, OR.id, o.id);
    return { c, ins };
  };

  // 4 个输入 → 16 行
  const four = mk(['A', 'B', 'C', 'D']);
  const t4 = buildTruthTable(four.c);
  ok(!t4.error, '4 个输入合法');
  eq(t4.rows.length, 16, '4 个输入 = 16 行');

  // 5 个输入，全不 pin → 超限报错
  const five = mk(['A', 'B', 'C', 'D', 'E']);
  const t5 = buildTruthTable(five.c);
  ok(!!t5.error, '5 个未固定输入超限报错：' + (t5.error ?? '未报错'));

  // pin 掉第 5 个 → 合法，且第 5 列不进枚举
  five.ins[4].pinned = true;
  five.ins[4].pinnedValue = true;
  const t5b = buildTruthTable(five.c);
  ok(!t5b.error, 'pin 一个后合法：' + (t5b.error ?? ''));
  eq(t5b.rows.length, 16, 'pin 后仍16 行（枚举 4 个）');
  ok(!t5b.columns.includes('E'), '被 pin 的 E 不进列：' + JSON.stringify(t5b.columns));
  ok(t5b.rows.every((r) => r.inputs.length === 4), '每行只有 4 个枚举输入');
  // pin 为 true 意味着电路里 Y 恒为 1
  ok(t5b.rows.every((r) => r.outputs[0] === true), 'pin(E=1) 后输出恒 1');
}

// ============================================================
section('D 触发器（组合语义 Q=D）与 /Q 端口');
{
  const A = n('INPUT', 0, 1, { name: 'A' });
  const D = n('DFF', 1, 2); // outputs=2 → Q 与 /Q
  const Q = n('OUTPUT', 1, 0, { name: 'Q' });
  const NQ = n('OUTPUT', 1, 0, { name: 'NQ' });
  const c = build([A, D, Q, NQ], []);
  wire(c, A.id, D.id);
  wire(c, D.id, Q.id, 0, 0);
  wire(c, D.id, NQ.id, 1, 0);

  const tt = buildTruthTable(c);
  eq(tt.rows.map((r) => r.outputs.map(Number).join('')), ['01', '10'], 'D=0 → Q=0,/Q=1；D=1 → Q=1,/Q=0');
}

// ============================================================
section('自定义黑盒元件');
{
  // 2 输入 1 输出「与非」黑盒
  const box: CustomBox = {
    id: 'box1',
    name: '我的与非',
    inputs: 2,
    outputs: 1,
    // 行序 00,01,10,11
    table: [[true], [true], [true], [false]],
  };
  const map = new Map([[box.id, box]]);

  const A = n('INPUT', 0, 1, { name: 'A' });
  const B = n('INPUT', 0, 1, { name: 'B' });
  const U = n('CUSTOM', 2, 1, { name: '我的与非', customId: 'box1' });
  const O = n('OUTPUT', 1, 0, { name: 'Y' });
  const c = build([A, B, U, O], []);
  wire(c, A.id, U.id, 0, 0);
  wire(c, B.id, U.id, 0, 1);
  wire(c, U.id, O.id);

  const tt = buildTruthTable(c, map);
  eq(tt.rows.map((r) => r.outputs[0]), [true, true, true, false], '黑盒与非真值表');

  // 黑盒 2 输出
  const half: CustomBox = {
    id: 'half',
    name: '半加器',
    inputs: 2,
    outputs: 2,
    table: [
      [false, false],
      [true, false],
      [true, false],
      [false, true],
    ],
  };
  const map2 = new Map([[half.id, half]]);
  const A2 = n('INPUT', 0, 1, { name: 'A' });
  const B2 = n('INPUT', 0, 1, { name: 'B' });
  const H = n('CUSTOM', 2, 2, { name: '半加器', customId: 'half' });
  const S = n('OUTPUT', 1, 0, { name: 'S' });
  const CO = n('OUTPUT', 1, 0, { name: 'C' });
  const c2 = build([A2, B2, H, S, CO], []);
  wire(c2, A2.id, H.id, 0, 0);
  wire(c2, B2.id, H.id, 0, 1);
  wire(c2, H.id, S.id, 0, 0);
  wire(c2, H.id, CO.id, 1, 0);
  const tt2 = buildTruthTable(c2, map2);
  eq(tt2.rows.map((r) => r.outputs.map(Number).join('')), ['00', '10', '10', '01'], '黑盒半加器与真实半加器一致');

  // 黑盒在表达式里应展开成子式（最小项）
  const ex = generateExpressions(c2, { deMorgan: false }, map2);
  const sExpr = ex.outputs.find((o) => o.nodeId === S.id);
  ok(
    !!sExpr && typeof sExpr.text === 'string' && sExpr.text.length > 0,
    '黑盒输出能生成表达式：' + (sExpr ? String(sExpr.text) : '(缺失)')
  );
  // 黑盒应展开成最小项，而不是保留「黑盒」这个名字
  ok(
    !!sExpr && typeof sExpr.text === 'string' && sExpr.text.includes('x0'),
    '黑盒展开为最小项（x0/x1）而非元件名：' + (sExpr ? String(sExpr.text) : '(缺失)')
  );
  // 求值器不认识 x0/x1，verify 应安全跳过而不是误报
  ok(verifyExpressions(c2, ex, map2).checked === 0, '黑盒表达式跳过校验（不误报）');
}

// ============================================================
section('德摩根归一化');
{
  const A = n('INPUT', 0, 1, { name: 'A' });
  const B = n('INPUT', 0, 1, { name: 'B' });
  const NAND = n('NAND', 2, 1);
  const O = n('OUTPUT', 1, 0, { name: 'Y' });
  const c = build([A, B, NAND, O], []);
  wire(c, A.id, NAND.id, 0, 0);
  wire(c, B.id, NAND.id, 0, 1);
  wire(c, NAND.id, O.id);

  const raw = generateExpressions(c, { deMorgan: false });
  ok((raw.outputs[0].text.includes('NAND')), '关闭时保留 NAND：' + raw.outputs[0].text);

  const dm = generateExpressions(c, { deMorgan: true });
  ok(!dm.outputs[0].text.includes('NAND'), '开启后不含 NAND：' + dm.outputs[0].text);
  ok(dm.outputs[0].text.includes('NOT'), '开启后含 NOT：' + dm.outputs[0].text);
  ok(verifyExpressions(c, dm).ok, '德摩根形式仍与电路一致');
}

// ============================================================
section('共享子式提取为中间变量');
{
  // (A AND B) 出两份，一路直接到 Y3，一路经NOT 到 Y1
  const A = n('INPUT', 0, 1, { name: 'A' });
  const B = n('INPUT', 0, 1, { name: 'B' });
  const AND = n('AND', 2, 1);
  const Y3 = n('OUTPUT', 1, 0, { name: 'Y3' });
  const NT = n('NOT', 1, 1);
  const Y1 = n('OUTPUT', 1, 0, { name: 'Y1' });
  const c = build([A, B, AND, Y3, NT, Y1], []);
  wire(c, A.id, AND.id, 0, 0);
  wire(c, B.id, AND.id, 0, 1);
  wire(c, AND.id, Y3.id);
  wire(c, AND.id, NT.id);
  wire(c, NT.id, Y1.id);

  const ex = generateExpressions(c, { deMorgan: false });
  ok(ex.terms.length > 0, '提取到中间变量：' + JSON.stringify(ex.terms.map((t) => t.label)));
  const hasN1 = ex.terms.some((t) => /^N\d+$/.test(t.label));
  ok(hasN1, '中间变量命名为 N1 形式：' + JSON.stringify(ex.terms.map((t) => t.label)));
  // Y3 应直接是 N1 而不是重复展开
  const y3 = ex.outputs.find((o) => o.nodeId === Y3.id);
  ok(!!y3 && /^N\d+$/.test(y3.text.trim()), '下游引用中间变量而非重复展开：' + (y3?.text ?? ''));
  ok(verifyExpressions(c, ex).ok, '含中间变量的表达式与电路一致');

  // 反例：单输出电路不该冒出没人复用的中间变量
  const A2 = n('INPUT', 0, 1, { name: 'A' });
  const NOT = n('NOT', 1, 1);
  const Y = n('OUTPUT', 1, 0, { name: 'Y' });
  const single = build([A2, NOT, Y], []);
  wire(single, A2.id, NOT.id);
  wire(single, NOT.id, Y.id);
  const ex2 = generateExpressions(single, { deMorgan: false });
  eq(ex2.terms.length, 0, '单输出电路不提取中间变量');
  ok(ex2.outputs[0].text.includes('NOT'), '单输出直接展开：' + ex2.outputs[0].text);
}

// ============================================================
section('无输出探针 / 空电路边界');
{
  const empty = build([], []);
  const tt = buildTruthTable(empty);
  ok(typeof tt.error === 'string', '空电路给出提示：' + tt.error);
  eq(tt.rows.length, 0, '空电路 0 行');

  const A = n('INPUT', 0, 1, { name: 'A' });
  const noOut = build([A], []);
  const tt2 = buildTruthTable(noOut);
  ok(!!tt2.error, '只有输入无输出时提示：' + tt2.error);
  eq(tt2.rows.length, 2, '1 个输入 → 2 行');

  const ex = generateExpressions(empty, {});
  eq(ex.outputs.length, 0, '空电路无表达式输出');
  ok(ex.warnings.length > 0, '空电路给出警告');
}

// ============================================================
section('未连接输入 → warning 且按 0 处理');
{
  const A = n('INPUT', 0, 1, { name: 'A' });
  const AND = n('AND', 2, 1);
  const O = n('OUTPUT', 1, 0, { name: 'Y' });
  const c = build([A, AND, O], []);
  wire(c, A.id, AND.id, 0, 0); // 只接一个
  wire(c, AND.id, O.id);
  const res = evaluate(c, new Map([[A.id, true]]));
  eq(res.values.get(O.id), [false], '未接端口=0，AND(1,0)=0');
  ok(res.warnings.some((w) => w.includes('未连接')), '产生未连接警告：' + JSON.stringify(res.warnings));
}

console.log(`\n${'─'.repeat(46)}`);
console.log(`通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✓'}`);
if (fail > 0) process.exit(1);