import type { GateKind } from './types';

export interface GateDef {
  /** 中文显示名 */
  label: string;
  /** 输入端口数（固定 1 的门为 1，其余默认 2，可在检视面板改成 2-4） */
  inputs: number;
  /** 输出端口数 */
  outputs: number;
  /** 是否允许用户在检视面板调整输入端口数 */
  adjustableInputs: boolean;
  /** 说明/备注 */
  hint?: string;
}

/**
 * 基础门定义
 * 注意：多输入 XOR / XNOR 按**奇偶校验**处理（每多接一个输入翻转一次）
 */
const DEFS: Partial<Record<GateKind, GateDef>> = {
  AND: { label: '与门', inputs: 2, outputs: 1, adjustableInputs: true, hint: '全 1 才输出 1' },
  OR: { label: '或门', inputs: 2, outputs: 1, adjustableInputs: true, hint: '有 1 就输出 1' },
  NOT: { label: '非门', inputs: 1, outputs: 1, adjustableInputs: false, hint: '取反' },
  NAND: { label: '与非', inputs: 2, outputs: 1, adjustableInputs: true, hint: '与门取反' },
  NOR: { label: '或非', inputs: 2, outputs: 1, adjustableInputs: true, hint: '或门取反' },
  XOR: { label: '异或', inputs: 2, outputs: 1, adjustableInputs: true, hint: '不同为 1；多输入为奇偶校验' },
  XNOR: { label: '同或', inputs: 2, outputs: 1, adjustableInputs: true, hint: '相同为 1；多输入为奇偶校验取反' },
  DFF: { label: 'D 触发器', inputs: 1, outputs: 1, adjustableInputs: false, hint: '本工具按组合元件处理：Q = D' },
  CONST: { label: '常量', inputs: 0, outputs: 1, adjustableInputs: false },
  INPUT: { label: '输入', inputs: 0, outputs: 1, adjustableInputs: false },
  OUTPUT: { label: '输出', inputs: 1, outputs: 0, adjustableInputs: false },
};

/** 取元件定义；未知类型给一个安全的空定义，避免 UI 崩 */
export function gateDef(kind: GateKind): GateDef {
  return DEFS[kind] ?? { label: kind, inputs: 0, outputs: 0, adjustableInputs: false };
}

/** 可从元件面板拖出的基础门（顺序即面板显示顺序） */
export const PALETTE_GATES: GateKind[] = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'];

/**
 * 基础门求值
 * @param ins 已按端口顺序排列的输入值（未连接的端口为 false）
 * @returns输出位数组，长度与门的输出端口数一致
 */
export function evalGate(kind: GateKind, ins: boolean[]): boolean[] {
  // 未连接端口按 0 处理
  const v = ins.length ? ins : [false];

  switch (kind) {
    case 'AND':
      return [v.every(Boolean)];
    case 'OR':
      return [v.some(Boolean)];
    case 'NOT':
      return [!v[0]];
    case 'NAND':
      return [!v.every(Boolean)];
    case 'NOR':
      return [!v.some(Boolean)];
    case 'XOR': {
      // 奇偶校验：1 的个数为奇数则输出 1
      // 注意必须用 !==|=== 之类返回真布尔，`parity ^= b` 在 JS 里会让parity 变成数字
      let parity = false;
      for (const b of v) parity = parity !== b;
      return [parity];
    }
    case 'XNOR': {
      let parity = false;
      for (const b of v) parity = parity !== b;
      return [!parity];
    }
    default:
      return [false];
  }
}

/** 门的符号表示（表达式生成用） */
export function gateSymbol(kind: GateKind): string | null {
  switch (kind) {
    case 'AND':
      return 'AND';
    case 'OR':
      return 'OR';
    case 'NOT':
      return 'NOT';
    case 'NAND':
      return 'NAND';
    case 'NOR':
      return 'NOR';
    case 'XOR':
      return 'XOR';
    case 'XNOR':
      return 'XNOR';
    default:
      return null;
  }
}