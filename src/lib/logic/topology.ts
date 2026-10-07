import type { Circuit } from './types';

export interface TopoResult {
  /** 拓扑序的节点 id；含环时只包含可排序的部分 */
  order: string[];
  /** 是否存在环 */
  hasCycle: boolean;
  /** 参与环的节点 id（无法排序的残留节点） */
  cycleNodes: string[];
}

/**
 * Kahn 拓扑排序 + 环检测
 *
 * 用「边source → target」构造邻接表。入度为 0 的节点入队，逐个出队并削减后继入度。
 * 结束后若仍有节点未出队，它们必然位于环上（或环的下游）。
 *
 * 有环时不抛异常，而是把环上节点返回给 UI 去高亮报错。
 */
export function topoSort(circuit: Circuit): TopoResult {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of circuit.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }

  for (const e of circuit.edges) {
    // 忽略指向不存在节点的脏数据
    if (!indeg.has(e.from.node) || !indeg.has(e.to.node)) continue;
    adj.get(e.from.node)!.push(e.to.node);
    indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);

  const order: string[] = [];
  // 用指针而非 shift()，避免 O(n^2)
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    order.push(id);
    for (const nxt of adj.get(id)!) {
      const d = (indeg.get(nxt) ?? 0) - 1;
      indeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }

  const cycleNodes = order.length === circuit.nodes.length
    ? []
    : circuit.nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);

  return { order, hasCycle: cycleNodes.length > 0, cycleNodes };
}