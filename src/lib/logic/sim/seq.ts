import { lookupCustom } from '../evaluate';
import { evalGate } from '../gates';
import type { Circuit, CustomBox, LogicNode } from '../types';
import { nodeRole } from './types';
import type { SeqStates } from './types';

/**
 * 时序元件的时钟边沿提交
 *
 * 在**松弛求稳态之后**执行：此时全电路的组合部分已经稳定，
 * 可以安全地「看一眼时钟边沿，把新值写进触发器的存储态」。
 *
 * 为什么要分两步：边沿型元件（DFF/JK/T）在松弛期间输出冻结，
 * 所以它们不会进入反馈环产生自激；等稳态定了再统一提交，
 * 顺序就不会打架。
 */

/** 时钟输入端口的索引约定 */
const CLK_PORT: Partial<Record<LogicNode['type'], number>> = {
  DFF: 1, // 端口 0 = D，端口 1 = CLK
  JK: 2, // 端口 0 = J，端口 1 = K，端口 2 = CLK
  T: 1, // 端口 0 = T，端口 1 = CLK
};

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

/** 取某个输入端口的当前值 */
function portValue(
  idx: Map<string, { node: string; port: number }[]>,
  values: Map<string, boolean[]>,
  nodeId: string,
  port: number
): boolean {
  const src = idx.get(nodeId)?.[port];
  if (!src) return false;
  return values.get(src.node)?.[src.port] ?? false;
}

/** 是否发生了指定沿 */
function hasEdge(prev: boolean, now: boolean, edge: 'rising' | 'falling'): boolean {
  return edge === 'rising' ? !prev && now : prev && !now;
}

/**
 * 提交本步的时序状态
 *
 * @param prevStates 上一步的存储态
 * @param prevClk 上一步各触发器的时钟端口取值（nodeId → 电平）
 * @param values 本步松弛后的稳态值
 * @returns 新存储态与新的时钟电平快照
 */
export function commitSequential(
  circuit: Circuit,
  prevStates: SeqStates,
  prevClk: Map<string, boolean>,
  values: Map<string, boolean[]>,
  customs: Map<string, CustomBox> = new Map()
): { states: SeqStates; clk: Map<string, boolean>; triggered: string[] } {
  const idx = buildInputIndex(circuit);
  const states: SeqStates = new Map();
  const clk = new Map<string, boolean>();
  const triggered: string[] = [];

  for (const node of circuit.nodes) {
    const role = nodeRole(node);

    // —— 时钟 ——
    // 注意：时钟的翻转由 Simulator.tickClock() 在 step() 最前面完成，
    // 这里只把当前电平记进 clk 快照，**不要再次翻转**（否则一步翻两次）。
    if (role === 'clock') {
      const cur = prevStates.get(node.id)?.[0] ?? false;
      states.set(node.id, [cur]);
      clk.set(node.id, cur);
      continue;
    }

    // —— 边沿型触发器 ——
    if (role === 'edge') {
      const clkPort = CLK_PORT[node.type] ?? 1;
      const nowClk = portValue(idx, values, node.id, clkPort);
      clk.set(node.id, nowClk);

      const was = prevStates.get(node.id)?.[0] ?? false;
      const edge = node.edge ?? 'rising';
      const fire = hasEdge(prevClk.get(node.id) ?? false, nowClk, edge);

      let next = was;
      if (fire) {
        triggered.push(node.id);
        switch (node.type) {
          case 'DFF':
            next = portValue(idx, values, node.id, 0);
            break;
          case 'JK': {
            const j = portValue(idx, values, node.id, 0);
            const k = portValue(idx, values, node.id, 1);
            if (j && !k) next = true;
            else if (!j && k) next = false;
            else if (j && k) next = !was;
            break;
          }
          case 'T': {
            const t = portValue(idx, values, node.id, 0);
            if (t) next = !was;
            break;
          }
          default:
            break;
        }
      }

      const out = node.outputs >= 2 ? [next, !next] : [next];
      states.set(node.id, out);
      continue;
    }

    // —— 透明型锁存器：状态由松弛阶段算出，这里只保留 ——
    if (role === 'latch') {
      const q = values.get(node.id)?.[0] ?? prevStates.get(node.id)?.[0] ?? false;
      states.set(node.id, node.outputs >= 2 ? [q, !q] : [q]);
      continue;
    }

    // —— 其余元件不存状态 ——
  }

  void customs;
  void evalGate;
  void lookupCustom;
  return { states, clk, triggered };
}

/** 初始状态：所有时序元件清零 */
export function initialStates(circuit: Circuit): SeqStates {
  const s: SeqStates = new Map();
  for (const node of circuit.nodes) {
    const role = nodeRole(node);
    if (role === 'clock' || role === 'edge' || role === 'latch') {
      s.set(node.id, new Array(Math.max(1, node.outputs)).fill(false));
    }
  }
  return s;
}

/** 初始时钟快照 */
export function initialClk(circuit: Circuit): Map<string, boolean> {
  const c = new Map<string, boolean>();
  for (const node of circuit.nodes) {
    const role = nodeRole(node);
    if (role === 'clock' || role === 'edge') c.set(node.id, false);
  }
  return c;
}