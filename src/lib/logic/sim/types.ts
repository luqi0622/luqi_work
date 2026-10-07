import type { Circuit, LogicNode } from '../types';

/**
 * 仿真相关类型
 *
 * 单 bit 世界观：每个节点的输出就是一个位（多输出元件是位数组）。
 */

/** 时序元件的存储状态：nodeId → 输出位数组 */
export type SeqStates = Map<string, boolean[]>;

/** 一个时间点（用户的一步） */
export interface TimePoint {
  /** 步序号，从 0 开始 */
  t: number;
  /** 这步发生了什么，如 "SW A=1" / "clk↑" */
  note?: string;
  /** 自由输入节点的取值快照（SWITCH / INPUT） */
  inputs: Map<string, boolean>;
  /** 所有节点的稳态输出 */
  values: Map<string, boolean[]>;
  /** 时序元件本步提交后的存储态 */
  states: SeqStates;
}

export interface Waveform {
  steps: TimePoint[];
  /** 实际要绘制的节点 id（输出探针 + 线探针 + 用户勾选） */
  plotted: string[];
}

/** 一次松弛求解的结果 */
export interface RelaxResult {
  values: Map<string, boolean[]>;
  converged: boolean;
  /** 实际迭代轮数 */
  iters: number;
  /** 检测到振荡时的说明（如「周期 2 振荡」） */
  oscillation?: string;
}

/** 节点在一次步进中的分类 */
export function nodeRole(node: LogicNode): 'clock' | 'edge' | 'latch' | 'comb' {
  if (node.type === 'CLOCK') return 'clock';
  if (node.type === 'DFF' || node.type === 'JK' || node.type === 'T') return 'edge';
  if (node.type === 'SR') return 'latch';
  return 'comb';
}

/** 电路里是否有时序元件 */
export function hasSequential(circuit: Circuit): boolean {
  return circuit.nodes.some((n) =>
    n.type === 'CLOCK' || n.type === 'DFF' || n.type === 'SR' || n.type === 'JK' || n.type === 'T'
  );
}

/** 空状态集合 */
export function emptyStates(): SeqStates {
  return new Map();
}