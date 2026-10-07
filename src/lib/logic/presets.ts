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

/** 内置示例：D 触发器接出 Q 与 /Q 两路 */
export function dffDemo(): Circuit {
  const nodes: LogicNode[] = [
    { id: 'd_a', type: 'INPUT', x: 60, y: 140, inputs: 0, outputs: 1, name: 'D' },
    { id: 'd_dff', type: 'DFF', x: 280, y: 120, inputs: 1, outputs: 2 },
    { id: 'd_q', type: 'OUTPUT', x: 520, y: 70, inputs: 1, outputs: 0, name: 'Q' },
    { id: 'd_nq', type: 'OUTPUT', x: 520, y: 230, inputs: 1, outputs: 0, name: 'N' },
  ];
  const edges: Edge[] = [
    { id: 'r1', from: { node: 'd_a', port: 0 }, to: { node: 'd_dff', port: 0 } },
    { id: 'r2', from: { node: 'd_dff', port: 0 }, to: { node: 'd_q', port: 0 } },
    { id: 'r3', from: { node: 'd_dff', port: 1 }, to: { node: 'd_nq', port: 0 } },
  ];
  return { schema: 'logic-circuit', version: 1, nodes, edges };
}

/** 内置示例：SR 锁存器（两个 NAND 交叉耦合，含环路 → 无法求值，可用来演示环路提示） */
export function srLatch(): Circuit {
  const nodes: LogicNode[] = [
    { id: 's_s', type: 'INPUT', x: 60, y: 100, inputs: 0, outputs: 1, name: 'S' },
    { id: 's_r', type: 'INPUT', x: 60, y: 330, inputs: 0, outputs: 1, name: 'R' },
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

/** 内置示例：一致性校验器（异或链），输出 1 表示校验通过 */
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

export interface Preset {
  key: string;
  name: string;
  desc: string;
  make: () => Circuit;
}

export const PRESETS: Preset[] = [
  { key: 'half-adder', name: '半加器', desc: 'S = A XOR B，C = A AND B', make: halfAdder },
  { key: 'mux2', name: '2:1 选择器', desc: '用选择位 S 在 D0 / D1 之间挑一个', make: mux2 },
  { key: 'parity', name: '奇偶校验器', desc: '三个输入的异或链，1 个数奇数则输出 1', make: parityChecker },
  { key: 'dff', name: 'D 触发器', desc: 'Q = D，同时输出 /Q', make: dffDemo },
  { key: 'sr-latch', name: 'SR 锁存器', desc: '两个 NAND 交叉耦合，含环路 → 演示环路提示', make: srLatch },
];

/** 门类型的中文名（UI 复用） */
export function gateLabel(kind: GateKind): string {
  const map: Record<GateKind, string> = {
    AND: '与门',
    OR: '或门',
    NOT: '非门',
    NAND: '与非门',
    NOR: '或非门',
    XOR: '异或门',
    XNOR: '同或门',
    DFF: 'D 触发器',
    CONST: '常量',
    INPUT: '输入',
    OUTPUT: '输出',
    CUSTOM: '自定义',
  };
  return map[kind] ?? kind;
}
