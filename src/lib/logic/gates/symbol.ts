import type { GateKind, LogicNode } from '../types';
import { MAX_COMPLEX_INPUTS, MAX_COMPLEX_OUTPUTS, MAX_GATE_INPUTS } from '../types';

/**
 * 元件符号注册表
 *
 * 所有元件统一画成 **IEC 标准方框**：矩形框 + 框内限定符（qualifier），
 * 与《图灵计算》的观感一致，也让20+ 个元件风格统一、易维护。
 *
 * 关键设计：**画布上的元件和元件面板的预览 chip 共用这一份定义**，
 * 所以两边永远不会画得不一样。
 */

/** 框的形状 */
export type SymbolShape =
  | 'box'// 普通矩形（门、算术元件、时序元件）
  | 'mux' // 梯形（左侧收口，选择位在梯形内）
  | 'decoder' // 左侧斜边（译码器）
  | 'seg7' // 7 段数码管（框内画七段字形）
  | 'io'; // 输入输出端子（圆角小盒）

/** 反相小圆位置 */
export type BubblePos = 'out' | 'in' | null;

export interface SymbolSpec {
  shape: SymbolShape;
  /** 框内限定符。短符号用数学符号（& ≥1 =1 Σ），复合元件用缩写（MUX DEC） */
  qualifier: string;
  /** 反相小圆（NAND/NOR/XNOR/NOT 的输出端） */
  bubble?: BubblePos;
  /** 输入端口旁的标签 */
  inLabels?: string[];
  /** 输出端口旁的标签 */
  outLabels?: string[];
  /** 是否需要内嵌额外 DOM（7 段数码管的七段、JK 的反馈弧等） */
  inner?: string;
}

/** 各元件的默认端口数与可选范围 */
export interface PortSpec {
  inputs: number;
  outputs: number;
  /** 输入端口数是否允许用户调整（基础门可2-4） */
  adjustableInputs: boolean;
  /** 该类型允许的输入端口上限（复合元件用） */
  maxInputs: number;
  /** 该类型允许的输出端口上限 */
  maxOutputs: number;
  /** 选择位宽度（0 = 无选择位） */
  selBits: number;
}

/** 端口规范表：所有元件的端口数在这里统一定义 */
export const PORT_SPECS: Record<GateKind, PortSpec> = {
  // 基础门
  AND: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },
  OR: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },
  NOT: { inputs: 1, outputs: 1, adjustableInputs: false, maxInputs: 1, maxOutputs: 1, selBits: 0 },
  NAND: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },
  NOR: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },
  XOR: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },
  XNOR: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 1, selBits: 0 },

  // 输入输出
  INPUT: { inputs: 0, outputs: 1, adjustableInputs: false, maxInputs: 0, maxOutputs: 1, selBits: 0 },
  SWITCH: { inputs: 0, outputs: 1, adjustableInputs: false, maxInputs: 0, maxOutputs: 1, selBits: 0 },
  CONST: { inputs: 0, outputs: 1, adjustableInputs: false, maxInputs: 0, maxOutputs: 1, selBits: 0 },
  OUTPUT: { inputs: 1, outputs: 0, adjustableInputs: false, maxInputs: 1, maxOutputs: 0, selBits: 0 },
  PROBE: { inputs: 1, outputs: 0, adjustableInputs: false, maxInputs: 1, maxOutputs: 0, selBits: 0 },
  SEG7: { inputs: 4, outputs: 7, adjustableInputs: false, maxInputs: 4, maxOutputs: 7, selBits: 0 },

  // 选择器 / 译码器
  MUX4: { inputs: 6, outputs: 1, adjustableInputs: false, maxInputs: 6, maxOutputs: 1, selBits: 2 },
  MUX8: { inputs: 11, outputs: 1, adjustableInputs: false, maxInputs: 11, maxOutputs: 1, selBits: 3 },
  DEMUX14: { inputs: 3, outputs: 4, adjustableInputs: false, maxInputs: 3, maxOutputs: 4, selBits: 2 },
  DEC38: { inputs: 3, outputs: 8, adjustableInputs: false, maxInputs: 3, maxOutputs: 8, selBits: 3 },

  // 算术 / 比较
  HA: { inputs: 2, outputs: 2, adjustableInputs: false, maxInputs: 2, maxOutputs: 2, selBits: 0 },
  FA: { inputs: 3, outputs: 2, adjustableInputs: false, maxInputs: 3, maxOutputs: 2, selBits: 0 },
  CMPEQ: { inputs: 2, outputs: 2, adjustableInputs: false, maxInputs: 2, maxOutputs: 2, selBits: 0 },
  CMP: { inputs: 2, outputs: 3, adjustableInputs: false, maxInputs: 2, maxOutputs: 3, selBits: 0 },

  // 时序
  DFF: { inputs: 2, outputs: 2, adjustableInputs: false, maxInputs: 2, maxOutputs: 2, selBits: 0 },
  SR: { inputs: 2, outputs: 2, adjustableInputs: false, maxInputs: 2, maxOutputs: 2, selBits: 0 },
  JK: { inputs: 3, outputs: 2, adjustableInputs: false, maxInputs: 3, maxOutputs: 2, selBits: 0 },
  T: { inputs: 2, outputs: 2, adjustableInputs: false, maxInputs: 2, maxOutputs: 2, selBits: 0 },
  CLOCK: { inputs: 0, outputs: 1, adjustableInputs: false, maxInputs: 0, maxOutputs: 1, selBits: 0 },

  // 自定义黑盒
  CUSTOM: { inputs: 2, outputs: 1, adjustableInputs: true, maxInputs: MAX_GATE_INPUTS, maxOutputs: 2, selBits: 0 },
};

/** 兜底，避免未知 type 崩掉 */
export function portSpec(kind: GateKind): PortSpec {
  return (
    PORT_SPECS[kind] ?? {
      inputs: 2,
      outputs: 1,
      adjustableInputs: false,
      maxInputs: MAX_COMPLEX_INPUTS,
      maxOutputs: MAX_COMPLEX_OUTPUTS,
      selBits: 0,
    }
  );
}

/** 数字转字母（0→A, 1→B …），用于端口标签 */
function alpha(i: number): string {
  return String.fromCharCode(65 + i);
}

/** 生成 D0..Dn / S0..Sn 之类的标签组 */
function dataLabels(n: number, prefix: string): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}
function selLabels(n: number): string[] {
  return dataLabels(n, 'S');
}

/** 时序元件输出口的标签（Q 与 /Q） */
const Q_LABELS = ['Q', '/Q'];

/**
 * 符号注册表
 *
 * key 是 GateKind；value 可为常量，也可为函数（需要看节点的输入端口数才能决定标签）。
 */
const REGISTRY: Record<GateKind, SymbolSpec | ((node: LogicNode) => SymbolSpec)> = {
  // —— 基础门：IEC 方框 + 数学符号 ——
  AND: { shape: 'box', qualifier: '&' },
  OR: { shape: 'box', qualifier: '≥1' },
  NOT: { shape: 'box', qualifier: '1', bubble: 'out' },
  NAND: { shape: 'box', qualifier: '&', bubble: 'out' },
  NOR: { shape: 'box', qualifier: '≥1', bubble: 'out' },
  XOR: { shape: 'box', qualifier: '=1' },
  XNOR: { shape: 'box', qualifier: '=1', bubble: 'out' },

  // —— 输入输出 ——
  INPUT: { shape: 'io', qualifier: '' },
  CONST: { shape: 'io', qualifier: '' },
  SWITCH: { shape: 'io', qualifier: '' },
  OUTPUT: { shape: 'io', qualifier: '' },
  PROBE: { shape: 'io', qualifier: '' },

  SEG7: {
    shape: 'seg7',
    qualifier: '',
    inLabels: ['a', 'b', 'c', 'd'],
    outLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  },

  // —— 选择器：梯形框 ——
  MUX4: {
    shape: 'mux',
    qualifier: 'MUX',
    inLabels: ['D0', 'D1', 'D2', 'D3', 'S0', 'S1'],
    outLabels: ['Y'],
  },
  MUX8: {
    shape: 'mux',
    qualifier: 'MUX',
    inLabels: [...dataLabels(8, 'D'), ...selLabels(3)],
    outLabels: ['Y'],
  },
  DEMUX14: {
    shape: 'box',
    qualifier: 'DMX',
    inLabels: ['D', 'S0', 'S1'],
    outLabels: ['Y0', 'Y1', 'Y2', 'Y3'],
  },
  DEC38: {
    shape: 'decoder',
    qualifier: 'DEC',
    inLabels: ['A', 'B', 'C'],
    outLabels: ['0', '1', '2', '3', '4', '5', '6', '7'],
  },

  // —— 算术 / 比较 ——
  HA: { shape: 'box', qualifier: '∑', inLabels: ['A', 'B'], outLabels: ['S', 'C'] },
  FA: { shape: 'box', qualifier: '∑', inLabels: ['A', 'B', 'Cin'], outLabels: ['S', 'C'] },
  CMPEQ: { shape: 'box', qualifier: '=', inLabels: ['A', 'B'], outLabels: ['EQ', '≠'] },
  CMP: { shape: 'box', qualifier: 'CMP', inLabels: ['A', 'B'], outLabels: ['EQ', '<', '>'] },

  // —— 时序：方框 + 底部一道横线（延迟符号）——
  DFF: { shape: 'box', qualifier: 'D', inLabels: ['D', 'CLK'], outLabels: Q_LABELS },
  SR: { shape: 'box', qualifier: 'SR', inLabels: ['S', 'R'], outLabels: Q_LABELS },
  JK: { shape: 'box', qualifier: 'JK', inLabels: ['J', 'K', 'CLK'], outLabels: Q_LABELS },
  T: { shape: 'box', qualifier: 'T', inLabels: ['T', 'CLK'], outLabels: Q_LABELS },
  CLOCK: { shape: 'box', qualifier: 'CLK' },

  // —— 自定义黑盒：虚线框 + 名字 ——
  CUSTOM: (node) => ({ shape: 'box', qualifier: node.name ?? '?' }),
};

/**
 * 取某个节点的符号规格
 * 输入端口数变化时动态门的标签（如 3 输入与门要显示 A/B/C）
 */
export function symbolFor(node: LogicNode): SymbolSpec {
  const raw = REGISTRY[node.type];
  const base = typeof raw === 'function' ? raw(node) : (raw ?? { shape: 'box' as SymbolShape, qualifier: '?' });

  // 基础门的输入标签按实际端口数动态生成（A、B、C…）
  const dynamicIn: Record<string, string> = {
    AND: '&', NAND: '&', OR: '≥1', NOR: '≥1', XOR: '=1', XNOR: '=1',
  };
  if (dynamicIn[node.type] && node.inputs > 2) {
    return { ...base, inLabels: dataLabels(node.inputs, '') };
  }
  return base;
}

/**
 * 端口在元件上的显示名
 *
 * 只给「端口有语义」的元件起名字：复合元件的 D0/S0、时序元件的 D/CLK/JK/T、
 * 数码管的 a/b/c/d…，以及带多输出的元件（Q /Q、S / Cout）。
 * 基础门的端口没语义，返回空串 —— 在图上标「输入1」纯属噪音。
 */
export function portName(node: LogicNode, port: number, dir: 'in' | 'out'): string {
  const spec = symbolFor(node);
  const labels = dir === 'in' ? spec.inLabels : spec.outLabels;
  if (labels && labels[port]) return labels[port];
  if (dir === 'out' && node.type === 'CUSTOM') return `Y${port}`;
  if (dir === 'in' && node.type === 'CUSTOM') return alpha(port);
  // 无语义端口：多输出元件至少标一下序号（如 7 段数码管的 7 个输出）
  if (dir === 'out' && node.outputs > 1) return `Y${port}`;
  return '';
}

/** 这个端口是否需要显示标签（没有语义的端口不画） */
export function portHasLabel(node: LogicNode, port: number, dir: 'in' | 'out'): boolean {
  return portName(node, port, dir) !== '';
}

/** 输入端口的分组：数据位 [0, dataCount) 与选择位 [dataCount, inputs) */
export function portGroups(node: LogicNode): { data: number; sel: number } {
  const sel = node.selBits ?? portSpec(node.type).selBits;
  return { data: Math.max(0, node.inputs - sel), sel };
}

/** 是否是需要「选择位」标注的元件（渲染时给端口加小字标签） */
export function hasSelBits(kind: GateKind): boolean {
  return portSpec(kind).selBits > 0;
}