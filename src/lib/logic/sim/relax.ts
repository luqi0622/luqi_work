import { evalGate } from '../gates';
import { lookupCustom } from '../evaluate';
import { topoSort } from '../topology';
import { MAX_RELAX_ITER } from '../types';
import type { Circuit, CustomBox, LogicNode } from '../types';
import { nodeRole } from './types';
import type { RelaxResult, SeqStates } from './types';

/**
 * 迭代松弛求稳态（组合逻辑 + 透明锁存器）
 *
 * 为什么需要这个：锁存器、环形振荡器含反馈环路，无法拓扑排序求值。
 * 这里用类似 SPICE 直流工作点的迭代松弛：反复扫一遍所有节点直到不再变化。
 *
 * 两层设计的关键：
 * - **边沿型时序元件**（DFF/JK/T/CLK）在松弛期间输出**冻结为已存状态**，
 *   这样它们不会进入反馈环、不会自己振荡。
 * - **透明锁存器**（SR）输出是「输入 + 当前 Q」的计算结果，**参与松弛**，
 *   靠迭代找到稳定点。
 */

/** 建立 (node,port) → 源的索引 */
function buildInputIndex(circuit: Circuit) {
  const idx = new Map<string, { node: string; port: number }[]>();
  for (const n of circuit.nodes) idx.set(n.id, []);
  for (const e of circuit.edges) {
    const arr = idx.get(e.to.node);
    if (!arr) continue;
    if (arr[e.to.port] === undefined) arr[e.to.port] = { node: e.from.node, port: e.from.port };
  }
  return idx;
}

/**
 * 求某个节点的输出（松弛用）
 * @param states 时序元件的存储态；边沿型元件直接返回冻结值
 */
function evalRelaxNode(
  node: LogicNode,
  ins: boolean[],
  states: SeqStates,
  customs: Map<string, CustomBox>
): boolean[] {
  const role = nodeRole(node);

  // 边沿型元件 + 时钟：松弛期间输出冻结
  if (role === 'edge' || role === 'clock') {
    const st = states.get(node.id);
    if (st && st.length) return st.slice();
    // 尚未初始化时给一个确定的初值（全0），避免不同步导致的不确定
    return new Array(Math.max(1, node.outputs)).fill(false);
  }

  // 透明型锁存器：输出 = f(输入, 当前 Q)
  if (role === 'latch') {
    const st = states.get(node.id);
    const q = st?.[0] ?? false;
    // SR 锁存器：S 置位、R 复位、都有输出时视为禁用（保持）
    const s = ins[0] ?? false;
    const r = ins[1] ?? false;
    let next = q;
    if (s && !r) next = true;
    else if (r && !s) next = false;
    // s && r → 禁用态，保持原状态
    const out = [next, !next];
    return node.outputs >= 2 ? out : [out[0]];
  }

  // SWITCH / CONST 由外部给定
  if (node.type === 'SWITCH') return [node.switchValue ?? false];
  if (node.type === 'CONST') return [node.constValue ?? false];
  if (node.type === 'INPUT') return [false]; // 由 inputs 参数决定，这里是占位

  // 自定义黑盒
  if (node.type === 'CUSTOM') {
    const box = node.customId ? customs.get(node.customId) : undefined;
    return box ? lookupCustom(box, ins) : new Array(Math.max(1, node.outputs)).fill(false);
  }

  // 基础门与复合元件
  return evalGate(node.type, ins);
}

/** 两个 values 是否完全相同（收敛判据） */
function sameValues(
  a: Map<string, boolean[]>,
  b: Map<string, boolean[]>
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, av] of a) {
    const bv = b.get(id);
    if (!bv || bv.length !== av.length) return false;
    for (let i = 0; i < av.length; i += 1) if (av[i] !== bv[i]) return false;
  }
  return true;
}

/** 转成可比较的字符串（用于振荡检测的快照） */
function fingerprint(v: Map<string, boolean[]>): string {
  const parts: string[] = [];
  for (const [id, arr] of [...v].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    parts.push(`${id}:${arr.map(Number).join('')}`);
  }
  return parts.join('|');
}

export interface RelaxOptions {
  /** 自由输入（SWITCH / INPUT）的取值 */
  inputs?: Map<string, boolean>;
  customs?: Map<string, CustomBox>;
  /** 迭代上限，默认 MAX_RELAX_ITER */
  maxIter?: number;
}

/**
 * 迭代松弛求稳态
 *
 * @param states 时序元件当前存储态（边沿型元件的冻结输出来源于它）
 * @param seedValues 上一步的值，用作迭代初值（让状态变化更贴近真实电路的惯性）
 */
export function relaxCombinational(
  circuit: Circuit,
  states: SeqStates,
  seedValues?: Map<string, boolean[]>,
  opt: RelaxOptions = {}
): RelaxResult {
  const customs = opt.customs ?? new Map<string, CustomBox>();
  const inputs = opt.inputs ?? new Map<string, boolean>();
  const maxIter = opt.maxIter ?? MAX_RELAX_ITER;
  const inIdx = buildInputIndex(circuit);

  // 遍历顺序：先按拓扑序，再把环上/下游的节点补在后面
  const topo = topoSort(circuit);
  const order = [...topo.order];
  const seen = new Set(order);
  for (const n of circuit.nodes) {
    if (!seen.has(n.id)) {
      order.push(n.id);
      seen.add(n.id);
    }
  }

  // 迭代初值：用上一步的值；没有的节点按 role 给确定初值
  let values = new Map<string, boolean[]>();
  for (const n of circuit.nodes) {
    const prev = seedValues?.get(n.id);
    if (prev) {
      values.set(n.id, [...prev]);
    } else if (nodeRole(n) === 'comb' || n.type === 'SWITCH' || n.type === 'CONST') {
      values.set(n.id, new Array(Math.max(1, n.outputs)).fill(false));
    }
  }

  // 最近几轮的指纹，用于周期振荡检测
  const history: string[] = [];

  for (let it = 1; it <= maxIter; it += 1) {
    const snapshot = fingerprint(values);
    history.push(snapshot);
    if (history.length > 3) history.shift();

    // 周期 2 检测：V_k == V_{k-2} 且 V_k != V_{k-1} → 振荡
    if (history.length === 3 && history[2] === history[0] && history[2] !== history[1]) {
      return { values, converged: false, iters: it, oscillation: '检测到振荡（信号在两个状态间来回翻转）' };
    }

    let changed = false;

    for (const id of order) {
      const node = circuit.nodes.find((n) => n.id === id);
      if (!node) continue;

      // 边沿型元件与时钟在整个松弛过程中冻结，不重算
      const role = nodeRole(node);
      if (role === 'edge' || role === 'clock') {
        const st = states.get(id);
        if (st) values.set(id, [...st]);
        continue;
      }

      // INPUT 节点由 inputs 参数决定
      if (node.type === 'INPUT') {
        const v = node.pinned ? (node.pinnedValue ?? false) : (inputs.get(id) ?? false);
        const prev = values.get(id);
        if (!prev || prev[0] !== v) {
          values.set(id, [v]);
          changed = true;
        }
        continue;
      }

      // 收集输入
      const srcs = inIdx.get(id) ?? [];
      const ins: boolean[] = [];
      for (let p = 0; p < node.inputs; p += 1) {
        const src = srcs[p];
        if (!src) {
          ins.push(false);
          continue;
        }
        ins.push(values.get(src.node)?.[src.port] ?? false);
      }

      const out = evalRelaxNode(node, ins, states, customs);
      const prev = values.get(id);

      if (!prev || prev.length !== out.length || prev.some((b, i) => b !== out[i])) {
        values.set(id, out);
        changed = true;
      }
    }

    if (!changed) {
      return { values, converged: true, iters: it };
    }
  }

  return {
    values,
    converged: false,
    iters: maxIter,
    oscillation: `迭代 ${maxIter} 轮仍未稳定，电路可能存在振荡`,
  };
}