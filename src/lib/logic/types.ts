/**
 * 逻辑电路实验台 —— 核心数据类型与全局约束
 *
 * 这个文件不含任何 DOM 依赖，可以被 node 直接import 做单元测试。
 */

/** 真值表最多枚举 4 个输入变量（2^4 = 16 行）；输入节点本身可以更多，多出的由用户 pin 成常量 */
export const MAX_ENUM_INPUTS = 4;

/** 一个门最多几个输入端口 */
export const MAX_GATE_INPUTS = 4;

/** 自定义黑盒元件的输入 / 输出上限（防止真值表爆炸） */
export const MAX_CUSTOM_IN = 4;
export const MAX_CUSTOM_OUT = 2;

/** 画布世界尺寸（SVG viewBox 与 world 容器的基础尺寸） */
export const WORLD_W = 4000;
export const WORLD_H = 3000;

/** 缩放范围 */
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

export type GateKind =
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'NAND'
  | 'NOR'
  | 'XOR'
  | 'XNOR'
  | 'DFF'
  | 'CONST'
  | 'INPUT'
  | 'OUTPUT'
  | 'CUSTOM';

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
  /** INPUT：枚举变量名（A/B/C/D）；其它类型：展示名 */
  name?: string;
  /** INPUT：是否被固定为常量 */
  pinned?: boolean;
  /** INPUT：固定后的值 */
  pinnedValue?: boolean;
  /** CUSTOM：指向 CustomBox.id */
  customId?: string;
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