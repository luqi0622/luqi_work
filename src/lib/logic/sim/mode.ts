import { hasSequential } from './types';
import type { Circuit } from '../types';

/** 工作模式 */
export type SimMode = 'table' | 'wave';

/**
 * 判断电路该用哪种展示模式
 *
 * - 纯组合（无时序元件、无环）→ 真值表 + 表达式
 * - 含时序元件或反馈环路 → 波形
 *
 * 为什么含环也要切波形：环路（如 SR 锁存器、环形振荡器）的输出取决于历史状态，
 * 真值表在数学上没有唯一答案，强行展示会误导。
 */
export function detectMode(circuit: Circuit): SimMode {
  if (circuit.nodes.length === 0) return 'table';
  if (hasSequential(circuit)) return 'wave';
  if (hasCycle(circuit)) return 'wave';
  return 'table';
}

/**
 * 电路是否存在反馈环路
 *
 * 自己实现而不是复用 topo/topology.ts，是为了避免 sim/ 反向依赖，
 * 同时这里只需要一个布尔值、不需要 cycleNodes 明细。
 */
function hasCycle(circuit: Circuit): boolean {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of circuit.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of circuit.edges) {
    if (!indeg.has(e.from.node) || !indeg.has(e.to.node)) continue;
    adj.get(e.from.node)!.push(e.to.node);
    indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
  }
  const q: string[] = [];
  for (const [id, d] of indeg) if (d === 0) q.push(id);
  const seen = new Set<string>();
  let head = 0;
  while (head < q.length) {
    const id = q[head++];
    seen.add(id);
    for (const nx of adj.get(id)!) {
      const d = (indeg.get(nx) ?? 0) - 1;
      indeg.set(nx, d);
      if (d === 0) q.push(nx);
    }
  }
  // 有节点没被排到 → 在环上
  return seen.size !== circuit.nodes.length;
}

/** 模式的中文说明，UI 用 */
export function modeHint(mode: SimMode): string {
  return mode === 'wave'
    ? '电路含时序元件或反馈环路，输出取决于历史状态 —— 已切换为波形视图。真值表在此情形下没有唯一答案。'
    : '';
}