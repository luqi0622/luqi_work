import { evalGate } from './gates';
import { topoSort } from './topology';
import type { Assign, Circuit, CustomBox, EvalResult, LogicNode } from './types';

/** 按 (nodeId, port) 建索引，快速拿到输入端口连的是谁 */
export function buildInputIndex(circuit: Circuit): Map<string, { node: string; port: number }[]> {
  const idx = new Map<string, { node: string; port: number }[]>();
  for (const n of circuit.nodes) idx.set(n.id, []);
  for (const e of circuit.edges) {
    const arr = idx.get(e.to.node);
    if (!arr) continue;
    if (arr[e.to.port] === undefined) arr[e.to.port] = { node: e.from.node, port: e.from.port };
  }
  return idx;
}

/** 列出所有输入端口未被连接的节点（用于 UI 灰色虚线提示） */
export function findUnconnectedInputs(circuit: Circuit): Set<string> {
  const idx = buildInputIndex(circuit);
  const bad = new Set<string>();
  for (const n of circuit.nodes) {
    const arr = idx.get(n.id) ?? [];
    for (let p = 0; p < n.inputs; p += 1) {
      if (!arr[p]) bad.add(`${n.id}:${p}`);
    }
  }
  return bad;
}

/** 黑盒元件查表；行号 = 输入组合的二进制值（input[0] 为最高位） */
export function lookupCustom(box: CustomBox, ins: boolean[]): boolean[] {
  let row = 0;
  for (const b of ins) row = (row << 1) | (b ? 1 : 0);
  const hit = box.table[row];
  const out: boolean[] = [];
  for (let p = 0; p < box.outputs; p += 1) out.push(hit?.[p] ?? false);
  return out;
}

/** 求值单个节点 */
function evalNode(
  node: LogicNode,
  inputs: boolean[],
  customs: Map<string, CustomBox>
): boolean[] {
  switch (node.type) {
    case 'INPUT':
      return [false]; // 由调用方从 assign 覆盖
    case 'CONST':
      return [node.constValue ?? false];
    case 'OUTPUT':
      return [inputs[0] ?? false];
    case 'DFF': {
      // 本工具按组合元件处理：Q = D；配置第二个输出口时同时给出 /Q
      const d = inputs[0] ?? false;
      return node.outputs >= 2 ? [d, !d] : [d];
    }
    case 'CUSTOM': {
      const box = node.customId ? customs.get(node.customId) : undefined;
      return box ? lookupCustom(box, inputs) : new Array(node.outputs).fill(false);
    }
    default:
      return evalGate(node.type, inputs);
  }
}

/**
 * 组合求值：给定输入赋值，算出所有节点的输出
 *
 * 有环时返回空 values（由调用方先检查 topo.hasCycle 并给出 UI 提示），
 * 这样求值器本身永远不抛异常。
 */
export function evaluate(
  circuit: Circuit,
  assign: Assign,
  customs: Map<string, CustomBox> = new Map()
): EvalResult {
  const warnings: string[] = [];
  const values = new Map<string, boolean[]>();
  const topo = topoSort(circuit);

  if (topo.hasCycle) {
    return { values, warnings: ['电路中存在环路，无法求值'] };
  }

  const inIdx = buildInputIndex(circuit);
  const byId = new Map(circuit.nodes.map((n) => [n.id, n]));

  for (const id of topo.order) {
    const node = byId.get(id);
    if (!node) continue;

    // 收集本节点各输入端口的值
    const ports = inIdx.get(id) ?? [];
    const ins: boolean[] = [];
    for (let p = 0; p < node.inputs; p += 1) {
      const src = ports[p];
      if (!src) {
        ins.push(false);
        warnings.push(`「${node.name ?? node.type}」的第 ${p + 1} 个输入端口未连接，按 0 处理`);
        continue;
      }
      const srcVal = values.get(src.node);
      // 理论上不会undefined（拓扑序保证），兜底成 false
      ins.push(srcVal?.[src.port] ?? false);
    }

    // INPUT 的值直接来自 assign
    if (node.type === 'INPUT') {
      const v = node.pinned ? (node.pinnedValue ?? false) : (assign.get(id) ?? false);
      values.set(id, [v]);
      continue;
    }

    values.set(id, evalNode(node, ins, customs));
  }

  return { values, warnings };
}