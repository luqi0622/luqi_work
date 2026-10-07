/**
 * 逻辑电路实验台 —— 核心数据类型与全局约束
 *
 * 这个文件不含任何 DOM 依赖，可以被 node 直接import 做单元测试。
 */

/** 真值表最多枚举 4 个输入变量（2^4 = 16 行）；输入节点本身可以更多，多出的由用户 pin 成常量 */
export const MAX_ENUM_INPUTS = 4;

/**
 * 可调输入端口数的门，输入端口数范围 [2, MAX_GATE_INPUTS]
 * 注意：复合元件（MUX8 等）端口数远超这个上限，见 maxInputsOf()
 */
export const MAX_GATE_INPUTS = 4;

/** 复合元件的输入端口上限（MUX8 = 8 数据 + 3 选择 = 11，留余量） */
export const MAX_COMPLEX_INPUTS = 12;

/** 复合元件的输出端口上限（3:8 译码器 8 出、7 段数码管 7 出，留余量） */
export const MAX_COMPLEX_OUTPUTS = 8;

/** 自定义黑盒元件的输入 / 输出上限（防止真值表爆炸） */
export const MAX_CUSTOM_IN = 4;
export const MAX_CUSTOM_OUT = 2;

/** 画布世界尺寸（SVG viewBox 与 world 容器的基础尺寸） */
export const WORLD_W = 4000;
export const WORLD_H = 3000;

/** 缩放范围 */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

/** 迭代求解的最大轮数（超出判为未收敛 / 振荡） */
export const MAX_RELAX_ITER = 60;

export type GateKind =
  // —— 基础门 ——
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'NAND'
  | 'NOR'
  | 'XOR'
  | 'XNOR'
  // —— 输入输出 ——
  | 'INPUT'
  | 'SWITCH'
  | 'CONST'
  | 'OUTPUT'
  | 'PROBE'
  | 'SEG7'
  // —— 选择器 / 译码器 ——
  | 'MUX4'
  | 'MUX8'
  | 'DEMUX14'
  | 'DEC38'
  // —— 算术 / 比较 ——
  | 'HA'
  | 'FA'
  | 'CMPEQ'
  | 'CMP'
  // —— 时序 ——
  | 'DFF'
  | 'SR'
  | 'JK'
  | 'T'
  | 'CLOCK'
  // —— 自定义黑盒 ——
  | 'CUSTOM';

/** 时钟触发沿 */
export type EdgeKind = 'rising' | 'falling';

export interface LogicNode {
  id: string;
  type: GateKind;
  /** 左上角世界坐标（CSS px） */
  x: number;
  y: number;
  /** 输入端口数量 */
  inputs: number;
  /** 输出端口数量 */
  outputs: number;
  /** CONST：常量的值 */
  constValue?: boolean;
  /** SWITCH：开关当前状态（画布上点击切换） */
  switchValue?: boolean;
  /** INPUT：枚举变量名（A/B/C/D）；其它类型：展示名 */
  name?: string;
  /** INPUT：是否被固定为常量 */
  pinned?: boolean;
  /** INPUT：固定后的值 */
  pinnedValue?: boolean;
  /** CUSTOM：指向 CustomBox.id */
  customId?: string;
  /**
   * 选择/地址位的位数。
   * 约定：**末尾 selBits 个输入端口是选择位**，其余是数据位。
   * 例：MUX4 的 selBits=2 → 端口 0..3 是 D0..D3，端口 4..5 是 S0..S1
   */
  selBits?: number;
  /**
   * 时序元件的存储状态（每端口一位）
   * DFF/JK/T/SR 的 Q（以及 /Q）；CLOCK 的电平。随草稿持久化。
   */
  state?: boolean[];
  /** 时序元件的触发沿，默认 'rising' */
  edge?: EdgeKind;
}

export interface Edge {
  id: string;
  /** 输出端口 */
  from: { node: string; port: number };
  /** 输入端口 */
  to: { node: string; port: number };
}

export interface Circuit {
  schema: 'logic-circuit';
  version: 1;
  nodes: LogicNode[];
  edges: Edge[];
}

/**
 * 自定义黑盒元件
 * table 的行序 = 输入组合的二进制，input[0] 为最高位
 * 例：inputs=2 时，table[0] 对应 00，table[3] 对应 11
 */
export interface CustomBox {
  id: string;
  name: string;
  inputs: number;
  outputs: number;
  table: boolean[][];
}

/** 一次求值的输入赋值：键为 INPUT 节点 id */
export type Assign = Map<string, boolean>;

export interface EvalResult {
  /** 每个节点的输出位数组（端口 0 = outputs[0]） */
  values: Map<string, boolean[]>;
  /** 未连接输入端口等非致命问题 */
  warnings: string[];
}

/** 空电路 */
export function emptyCircuit(): Circuit {
  return { schema: 'logic-circuit', version: 1, nodes: [], edges: [] };
}

/** 简单的 id 生成器（不用 uuid，保证可读且短） */
let idCounter = 0;
export function uid(prefix = 'n'): string {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}${Date.now().toString(36).slice(-3)}`;
}