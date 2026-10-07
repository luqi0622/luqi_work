import type { Circuit, GateKind, LogicNode, Edge } from './types';

let seq = 0;

/** 内置示例电路：半加器 S = A XOR B, C = A AND B */
export function halfAdder(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'i_a', type: 'INPUT', x: 60, y: 100, inputs: 0, outputs: 1, name: 'A' },
    { id: 'i_b', type: 'INPUT', x: 60, y: 220, inputs: 0, outputs: 1, name: 'B' },
    { id: 'g_xor', type: 'XOR', x: 280, y: 60, inputs: 2, outputs: 1 },
    { id: 'g_and', type: 'AND', x: 280, y: 250, inputs: 2, outputs: 1 },
    { id: 'o_s', type: 'OUTPUT', x: 520, y: 70, inputs: 1, outputs: 0, name: 'S' },
    { id: 'o_c', type: 'OUTPUT', x: 520, y: 250, inputs: 1, outputs: 0, name: 'C' },
  ];
  const edges: Edge[] = [
    { id: 'w1', from: { node: 'i_a', port: 0 }, to: { node: 'g_xor', port: 0 } },
    { id: 'w2', from: { node: 'i_b', port: 0 }, to: { node: 'g_xor', port: 1 } },
    { id: 'w3', from: { node: 'i_a', port: 0 }, to: { node: 'g_and', port: 0 } },
    { id: 'w4', from: { node: 'i_b', port: 0 }, to: { node: 'g_and', port: 1 } },
    { id: 'w5', from: { node: 'g_xor', port: 0 }, to: { node: 'o_s', port: 0 } },
    { id: 'w6', from: { node: 'g_and', port: 0 }, to: { node: 'o_c', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/** 内置示例：2:1 数据选择器 Y = (NOT S AND D0) OR (S AND D1) */
export function mux2(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'm_s', type: 'INPUT', x: 60, y: 60, inputs: 0, outputs: 1, name: 'S' },
    { id: 'm_d0', type: 'INPUT', x: 60, y: 200, inputs: 0, outputs: 1, name: 'D0' },
    { id: 'm_d1', type: 'INPUT', x: 60, y: 340, inputs: 0, outputs: 1, name: 'D1' },
    { id: 'm_n0', type: 'NOT', x: 250, y: 40, inputs: 1, outputs: 1 },
    { id: 'm_a0', type: 'AND', x: 450, y: 150, inputs: 2, outputs: 1 },
    { id: 'm_a1', type: 'AND', x: 450, y: 320, inputs: 2, outputs: 1 },
    { id: 'm_or', type: 'OR', x: 650, y: 230, inputs: 2, outputs: 1 },
    { id: 'm_y', type: 'OUTPUT', x: 850, y: 230, inputs: 1, outputs: 0, name: 'Y' },
  ];
  const edges: Edge[] = [
    { id: 'q1', from: { node: 'm_s', port: 0 }, to: { node: 'm_n0', port: 0 } },
    { id: 'q2', from: { node: 'm_d0', port: 0 }, to: { node: 'm_a0', port: 1 } },
    { id: 'q3', from: { node: 'm_n0', port: 0 }, to: { node: 'm_a0', port: 0 } },
    { id: 'q4', from: { node: 'm_d1', port: 0 }, to: { node: 'm_a1', port: 1 } },
    { id: 'q5', from: { node: 'm_s', port: 0 }, to: { node: 'm_a1', port: 0 } },
    { id: 'q6', from: { node: 'm_a0', port: 0 }, to: { node: 'm_or', port: 0 } },
    { id: 'q7', from: { node: 'm_a1', port: 0 }, to: { node: 'm_or', port: 1 } },
    { id: 'q8', from: { node: 'm_or', port: 0 }, to: { node: 'm_y', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/** 内置示例：D 触发器把 D 接回 /Q，构成二分频（每两个时钟沿翻一次） */
export function dffDemo(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'd_sw', type: 'SWITCH', x: 60, y: 60, inputs: 0, outputs: 1, switchValue: false, name: 'D' },
    { id: 'd_clk', type: 'CLOCK', x: 60, y: 220, inputs: 0, outputs: 1 },
    { id: 'd_dff', type: 'DFF', x: 300, y: 130, inputs: 2, outputs: 2, state: [false, true] },
    { id: 'd_q', type: 'OUTPUT', x: 560, y: 100, inputs: 1, outputs: 0, name: 'Q' },
    { id: 'd_nq', type: 'PROBE', x: 560, y: 200, inputs: 1, outputs: 0, name: 'N' },
  ];
  const edges: Edge[] = [
    { id: 'r1', from: { node: 'd_sw', port: 0 }, to: { node: 'd_dff', port: 0 } },
    { id: 'r2', from: { node: 'd_clk', port: 0 }, to: { node: 'd_dff', port: 1 } },
    { id: 'r3', from: { node: 'd_dff', port: 0 }, to: { node: 'd_q', port: 0 } },
    { id: 'r4', from: { node: 'd_dff', port: 1 }, to: { node: 'd_nq', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/**
 * 内置示例：4 位二进制计数器
 * 4 个 T 触发器级联，前一级��Q 接下一级的时钟 → 每 16 步进位一次
 */
export function counter4(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'k_en', type: 'SWITCH', x: 40, y: 180, inputs: 0, outputs: 1, switchValue: true, name: 'EN' },
    { id: 'k_clk', type: 'CLOCK', x: 40, y: 300, inputs: 0, outputs: 1 },
  ];
  const edges: Edge[] = [];
  let prevClk = 'k_clk';
  for (let i = 0; i < 4; i += 1) {
    nodes.push({
      id: `k_t${i}`, type: 'T', x: 240 + i * 190, y: 180 + i * 0,
      inputs: 2, outputs: 2, state: [false, true],
    });
    nodes.push({
      id: `k_q${i}`, type: 'OUTPUT', x: 420 + i * 190, y: 120 + i * 0,
      inputs: 1, outputs: 0, name: `Q${i}`,
    });
    edges.push({ id: `ke${i}a`, from: { node: 'k_en', port: 0 }, to: { node: `k_t${i}`, port: 0 } });
    edges.push({ id: `ke${i}b`, from: { node: prevClk, port: 0 }, to: { node: `k_t${i}`, port: 1 } });
    edges.push({ id: `ke${i}c`, from: { node: `k_t${i}`, port: 0 }, to: { node: `k_q${i}`, port: 0 } });
    prevClk = `k_t${i}`;
  }
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/** 内置示例：4 位加法器（两个 4:1 MUX + 若干门拼出一个 1 位全加器的和） */
export function adder4(): Circuit {
  const nodes: LogicNode[] = [];
  const edges: Edge[] = [];
  let idc = 0;
  const nn = (t: GateKind, i: number, o: number, x: number, y: number, extra: Partial<LogicNode> = {}) => {
    idc += 1;
    const node: LogicNode = { id: `a${idc}`, type: t, x, y, inputs: i, outputs: o, ...extra };
    nodes.push(node);
    return node.id;
  };
  const we = (from: string, to: string, fp = 0, tp = 0) => {
    idc += 1;
    edges.push({ id: `aw${idc}`, from: { node: from, port: fp }, to: { node: to, port: tp } });
  };

  // A0..A3
  for (let i = 0; i < 4; i += 1) nn('SWITCH', 0, 1, 40, 60 + i * 90, { switchValue: false, name: `A${i}` });
  // B0..B3
  for (let i = 0; i < 4; i += 1) nn('SWITCH', 0, 1, 40, 460 + i * 90, { switchValue: false, name: `B${i}` });

  let carry = '';
  for (let i = 0; i < 4; i += 1) {
    const y = 80 + i * 130;
    const fa = nn('FA', 3, 2, 330 + i * 260, y);
    we(`a${i + 1}`, fa, 0, 0);
    we(`a${i + 5}`, fa, 0, 1);
    if (carry) we(carry, fa, 0, 2);
    const out = nn('OUTPUT', 1, 0, 620 + i * 260, y, { name: `S${i}` });
    we(fa, out, 0, 0);
    carry = fa;
  }
  // 最终进位
  const cout = nn('PROBE', 1, 0, 620 + 4 * 260 - 160, 80 + 4 * 130, { name: 'C' });
  we(carry, cout, 1, 0);

  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/**
 * 内置示例：4 位二进制 → 数码管
 *
 * 4 个开关 → 4 位二进制 → SEG7 的a b c d 四个输入
 * SEG7 内部自带 0–9 的段码译码，所以这一段就是它的全部用法。
 */
export function seg7Demo(): Circuit {
  const nodes: LogicNode[] = [];
  const edges: Edge[] = [];
  let idc = 0;
  const nn = (
    t: GateKind, i: number, o: number, x: number, y: number,
    extra: Partial<LogicNode> = {}
  ): string => {
    idc += 1;
    const node: LogicNode = { id: `g${idc}`, type: t, x, y, inputs: i, outputs: o, ...extra };
    nodes.push(node);
    return node.id;
  };
  const we = (from: string, to: string, fp = 0, tp = 0) => {
    idc += 1;
    edges.push({ id: `gw${idc}`, from: { node: from, port: fp }, to: { node: to, port: tp } });
  };

  // SEG7 的 a..d 输入（第0 位是最高位，所以接 B3 B2 B1 B0）
  const seg = nn('SEG7', 4, 7, 460, 140, { name: '数码管' });
  for (let i = 0; i < 4; i += 1) {
    // 默认显示 0（0000）
    const sw = nn('SWITCH', 0, 1, 120, 60 + i * 110, {
      switchValue: false,
      name: `B${3 - i}`,
    });
    we(sw, seg, 0, i);
  }
  // 探针挂在 /Q 类端口上不太合适，这里用 PROBE 看第一个输出段
  const prb = nn('PROBE', 1, 0, 700, 140, { name: '段A' });
  we(seg, prb, 0, 0);

  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/**
 * 内置示例：奇偶校验器
 * 三个输入的异或链 —— 1 的个数为奇数则输出 1
 */
export function parityChecker(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'p_a', type: 'INPUT', x: 60, y: 80, inputs: 0, outputs: 1, name: 'A' },
    { id: 'p_b', type: 'INPUT', x: 60, y: 200, inputs: 0, outputs: 1, name: 'B' },
    { id: 'p_c', type: 'INPUT', x: 60, y: 320, inputs: 0, outputs: 1, name: 'C' },
    { id: 'p_g1', type: 'XOR', x: 280, y: 140, inputs: 2, outputs: 1 },
    { id: 'p_g2', type: 'XOR', x: 480, y: 220, inputs: 2, outputs: 1 },
    { id: 'p_y', type: 'OUTPUT', x: 690, y: 220, inputs: 1, outputs: 0, name: 'OK' },
  ];
  const edges: Edge[] = [
    { id: 'v1', from: { node: 'p_a', port: 0 }, to: { node: 'p_g1', port: 0 } },
    { id: 'v2', from: { node: 'p_b', port: 0 }, to: { node: 'p_g1', port: 1 } },
    { id: 'v3', from: { node: 'p_g1', port: 0 }, to: { node: 'p_g2', port: 0 } },
    { id: 'v4', from: { node: 'p_c', port: 0 }, to: { node: 'p_g2', port: 1 } },
    { id: 'v5', from: { node: 'p_g2', port: 0 }, to: { node: 'p_y', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/**
 * 内置示例：SR 锁存器（两个 NAND 交叉耦合）
 * 含反馈环路 → detectMode 会自动切到波形视图
 */
export function srLatch(): Circuit {
  const nodes: LogicNode[] = [
    { id: 's_s', type: 'SWITCH', x: 60, y: 100, inputs: 0, outputs: 1, switchValue: false, name: 'S' },
    { id: 's_r', type: 'SWITCH', x: 60, y: 330, inputs: 0, outputs: 1, switchValue: false, name: 'R' },
    { id: 's_n1', type: 'NAND', x: 290, y: 60, inputs: 2, outputs: 1 },
    { id: 's_n2', type: 'NAND', x: 290, y: 310, inputs: 2, outputs: 1 },
    { id: 's_q', type: 'OUTPUT', x: 550, y: 130, inputs: 1, outputs: 0, name: 'Q' },
    { id: 's_nq', type: 'OUTPUT', x: 550, y: 310, inputs: 1, outputs: 0, name: 'NQ' },
  ];
  const edges: Edge[] = [
    { id: 't1', from: { node: 's_s', port: 0 }, to: { node: 's_n1', port: 0 } },
    { id: 't2', from: { node: 's_r', port: 0 }, to: { node: 's_n2', port: 0 } },
    { id: 't3', from: { node: 's_n1', port: 0 }, to: { node: 's_n2', port: 1 } },
    { id: 't4', from: { node: 's_n2', port: 0 }, to: { node: 's_n1', port: 1 } },
    { id: 't5', from: { node: 's_n1', port: 0 }, to: { node: 's_q', port: 0 } },
    { id: 't6', from: { node: 's_n2', port: 0 }, to: { node: 's_nq', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

export interface Preset {
  key: string;
  name: string;
  desc: string;
  make: () => Circuit;
}

/** 内置示例电路 */
export const PRESETS: Preset[] = [
  { key: 'half-adder', name: '半加器', desc: 'S = A XOR B，C = A AND B', make: halfAdder },
  { key: 'mux2', name: '2:1 选择器', desc: '用选择位 S 在 D0 / D1 之间挑一个', make: mux2 },
  { key: 'parity', name: '奇偶校验器', desc: '三个输入的异或链，1 的个数为奇数则输出 1', make: parityChecker },
  { key: 'dff', name: 'D 触发器', desc: '时钟上升沿采样 D，同时输出 /Q', make: dffDemo },
  { key: 'counter4', name: '4 位计数器', desc: '四个 T 触发器级联，看 Q0~Q3 按二进制进位', make: counter4 },
  { key: 'adder4', name: '4 位加法器', desc: '四个全加器级联，A+B 的逐位和与进位', make: adder4 },
  { key: 'seg7', name: '7 段数码管', desc: '四个开关直接接数码管的 a/b/c/d', make: seg7Demo },
  { key: 'sr-latch', name: 'SR 锁存器', desc: '两个 NAND 交叉耦合，含环路 → 自动切波形视图', make: srLatch },
];

/** 门类型的中文名（UI 复用）；完整的定义在 gates.ts 的 gateDef */
export function gateLabel(kind: GateKind): string {
  const map: Partial<Record<GateKind, string>> = {
    AND: '与门',
    OR: '或门',
    NOT: '非门',
    NAND: '与非门',
    NOR: '或非门',
    XOR: '异或门',
    XNOR: '同或门',
    INPUT: '输入',
    SWITCH: '开关',
    CONST: '常量',
    OUTPUT: '输出',
    PROBE: '线探针',
    SEG7: '7 段数码管',
    MUX4: '4:1 选择器',
    MUX8: '8:1 选择器',
    DEMUX14: '1:4 反选择器',
    DEC38: '3:8 译码器',
    HA: '半加器',
    FA: '全加器',
    CMPEQ: '等值比较',
    CMP: '比较器',
    DFF: 'D 触发器',
    SR: 'SR 锁存器',
    JK: 'JK 触发器',
    T: 'T 触发器',
    CLOCK: '时钟',
    CUSTOM: '自定义黑盒',
  };
  return map[kind] ?? kind;
}
