import type { GateKind } from './types';
import {
  evalCompare,
  evalCompareEq,
  evalFullAdder,
  evalHalfAdder,
  evalSeg7,
} from './gates/arithmetic';
import { evalDecoder, evalDemux, evalMux } from './gates/mux';
import { portSpec } from './gates/symbol';

/**
 * 元件定义聚合层
 *
 * 端口数统一由 gates/symbol.ts 的 PORT_SPECS 定义，这里只提供：
 * - 中文显示名与说明
 * - 求值分发（evalGate）
 * - 元件面板分组
 */

export interface GateDef {
  /** 中文显示名 */
  label: string;
  /** 输入端口数（默认） */
  inputs: number;
  /** 输出端口数（默认） */
  outputs: number;
  /** 是否允许用户在检视面板调整输入端口数 */
  adjustableInputs: boolean;
  /** 说明/备注 */
  hint?: string;
}

/** 中文名 + 说明 */
const INFO: Partial<Record<GateKind, { label: string; hint?: string }>> = {
  AND: { label: '与门', hint: '全1 才 1' },
  OR: { label: '或门', hint: '有 1 就 1' },
  NOT: { label: '非门', hint: '取反' },
  NAND: { label: '与非', hint: '与门取反' },
  NOR: { label: '或非', hint: '或门取反' },
  XOR: { label: '异或', hint: '不同为 1；多输入为奇偶校验' },
  XNOR: { label: '同或', hint: '相同为 1；多输入为奇偶校验取反' },

  INPUT: { label: '输入', hint: '真值表的枚举变量' },
  SWITCH: { label: '开关', hint: '画布上点一下切换 0/1' },
  CONST: { label: '常量', hint: '接一个固定电平' },
  OUTPUT: { label: '输出', hint: '真值表的一列' },
  PROBE: { label: '线探针', hint: '探测任意一根线的值' },
  SEG7: { label: '7 段数码管', hint: '4 位输入 → 7 段输出' },

  MUX4: { label: '4:1 选择器', hint: '2 位地址选4 路数据之一' },
  MUX8: { label: '8:1 选择器', hint: '3 位地址选 8 路数据之一' },
  DEMUX14: { label: '1:4 反选择器', hint: '把一路数据送到 4 路中的一路' },
  DEC38: { label: '3:8 译码器', hint: '3 位地址 → 8 路 one-hot' },

  HA: { label: '半加器', hint: 'S = A⊕B，C = A·B' },
  FA: { label: '全加器', hint: '带进位的三位加法' },
  CMPEQ: { label: '等值比较', hint: '输出 EQ 与 ≠' },
  CMP: { label: '比较器', hint: '输出 EQ / < / >' },

  DFF: { label: 'D 触发器', hint: '时钟上升沿把 D 存入 Q' },
  SR: { label: 'SR 锁存器', hint: '置位/复位，S=R=1 为禁用态' },
  JK: { label: 'JK 触发器', hint: 'J=K=1 时翻转' },
  T: { label: 'T 触发器', hint: 'T=1 时每个时钟翻转' },
  CLOCK: { label: '时钟', hint: '每步翻转一次' },

  CUSTOM: { label: '自定义黑盒', hint: '自己填真值表' },
};

/** 取元件定义；未知类型给安全兜底 */
export function gateDef(kind: GateKind): GateDef {
  const ports = portSpec(kind);
  const info = INFO[kind];
  return {
    label: info?.label ?? kind,
    inputs: ports.inputs,
    outputs: ports.outputs,
    adjustableInputs: ports.adjustableInputs,
    hint: info?.hint,
  };
}

/** 该类型允许的最大输入端口数（复合元件远大于基础门） */
export function maxInputsOf(kind: GateKind): number {
  return portSpec(kind).maxInputs;
}

/** 该类型允许的最大输出端口数 */
export function maxOutputsOf(kind: GateKind): number {
  return portSpec(kind).maxOutputs;
}

/**
 * 基础门与组合元件的求值
 *
 * 时序元件（DFF/SR/JK/T/CLOCK）**不在这里求值**——
 * 它们由 sim/seq.ts 在时钟边沿提交阶段处理。
 * INPUT / SWITCH / CONST / OUTPUT / PROBE 的值由调用方直接给定。
 */
export function evalGate(kind: GateKind, ins: boolean[]): boolean[] {
  // 未连接端口按 0 处理
  const v = ins.length ? ins : [false];

  switch (kind) {
    // —— 基础门 ——
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
      // 注意必须用 !== 返回真布尔，`parity ^= b` 在 JS 里会让parity 变成数字
      let parity = false;
      for (const b of v) parity = parity !== b;
      return [parity];
    }
    case 'XNOR': {
      let parity = false;
      for (const b of v) parity = parity !== b;
      return [!parity];
    }

    // —— 选择器 / 译码器 ——
    case 'MUX4':
      return evalMux(v, 2, 4);
    case 'MUX8':
      return evalMux(v, 3, 8);
    case 'DEMUX14':
      return evalDemux(v, 2, 4);
    case 'DEC38':
      return evalDecoder(v.slice(0, 3), 8);

    // —— 算术 / 比较 ——
    case 'HA':
      return evalHalfAdder(v);
    case 'FA':
      return evalFullAdder(v);
    case 'CMPEQ':
      return evalCompareEq(v);
    case 'CMP':
      return evalCompare(v);

    // —— 输出类 ——
    case 'SEG7':
      return evalSeg7(v);
    case 'SWITCH':
    case 'CONST':
      return [v[0]];
    case 'OUTPUT':
    case 'PROBE':
      return [v[0]];

    // —— 时序元件：不在组合路径求值（由 sim/seq.ts 处理）——
    case 'DFF':
    case 'SR':
    case 'JK':
    case 'T':
    case 'CLOCK':
      return [false];

    default:
      return [false];
  }
}

/** 是否是「边沿型时序元件」（有CLK，松弛期间输出冻结） */
export const EDGE_TRIGGERED = new Set<GateKind>(['DFF', 'JK', 'T']);

/** 是否是「透明型时序元件」（无 CLK，参与反馈松弛） */
export const TRANSPARENT_LATCH = new Set<GateKind>(['SR']);

/** 是否是时序元件（含记忆，不参与纯组合真值表） */
export const SEQUENTIAL_KINDS = new Set<GateKind>(['DFF', 'SR', 'JK', 'T', 'CLOCK']);

/** 是否是时序元件 */
export function isSequential(kind: GateKind): boolean {
  return SEQUENTIAL_KINDS.has(kind);
}

/** 元件面板分组 */
export interface PaletteGroup {
  title: string;
  kinds: GateKind[];
}

/** 元件面板的分组与顺序 */
export const PALETTE_GROUPS: PaletteGroup[] = [
  { title: '基础门', kinds: ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR'] },
  { title: '输入输出', kinds: ['INPUT', 'SWITCH', 'CONST', 'OUTPUT', 'PROBE', 'SEG7'] },
  { title: '选择器', kinds: ['MUX4', 'MUX8', 'DEMUX14', 'DEC38'] },
  { title: '算术比较', kinds: ['HA', 'FA', 'CMPEQ', 'CMP'] },
  { title: '时序', kinds: ['CLOCK', 'DFF', 'SR', 'JK', 'T'] },
];

/** 可从元件面板拖出的全部元件 */
export const PALETTE_GATES: GateKind[] = PALETTE_GROUPS.flatMap((g) => g.kinds);

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
    // 复合元件在表达式里展开成基本门，不保留元件名
    case 'HA':
    case 'FA':
    case 'CMPEQ':
    case 'CMP':
    case 'MUX4':
    case 'MUX8':
    case 'DEMUX14':
    case 'DEC38':
    case 'SEG7':
      return null;
    default:
      return null;
  }
}

export { portSpec, PORT_SPECS, symbolFor, portName, portGroups, hasSelBits } from './gates/symbol';
export type { SymbolSpec, SymbolShape, BubblePos, PortSpec } from './gates/symbol';