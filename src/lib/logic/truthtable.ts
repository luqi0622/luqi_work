import { evaluate } from './evaluate';
import { MAX_ENUM_INPUTS } from './types';
import type { Assign, Circuit, CustomBox } from './types';

export interface TruthRow {
  /** 枚举输入的值，顺序与 columns 里的输入部分一致 */
  inputs: boolean[];
  /** 每个输出探针的值，顺序与 columns 里的输出部分一致 */
  outputs: boolean[];
  /** 该行的输入赋值（可直接喂给 evaluate 做 playhead） */
  assign: Assign;
  /** 第几行 */
  index: number;
}

export interface TruthTable {
  /** 列名：先是枚举输入名，再是每个输出探针名 */
  columns: string[];
  /** 有多少个输出列（= 输出探针数） */
  outputCount: number;
  rows: TruthRow[];
  /** 非致命问题，如「没有输出探针」 */
  error?: string;
  /** 被 pin 住的输入（不进枚举），UI 用来展示 */
  pinnedInputs: { id: string; name: string; value: boolean }[];
}

const DEFAULT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** 收集参与枚举的输入节点（未 pin）与被 pin 的输入节点 */
function collectInputs(circuit: Circuit) {
  const enumIds: string[] = [];
  const pinned: TruthTable['pinnedInputs'] = [];
  const names = new Map<string, string>();

  circuit.nodes
    .filter((n) => n.type === 'INPUT')
    .forEach((n, i) => {
      const name = n.name ?? DEFAULT_NAMES[i] ?? `IN${i + 1}`;
      names.set(n.id, name);
      if (n.pinned) {
        pinned.push({ id: n.id, name, value: n.pinnedValue ?? false });
      } else {
        enumIds.push(n.id);
      }
    });

  return { enumIds, pinned, names };
}

/** 输出探针节点，顺序按其在 nodes 数组中的出现顺序 */
function collectOutputs(circuit: Circuit) {
  return circuit.nodes.filter((n) => n.type === 'OUTPUT');
}

/**
 * 构建真值表
 *
 * 规则：
 * - 只有未 pin 的 INPUT 参与枚举，最多 MAX_ENUM_INPUTS(4) 个 → 最多 16 行
 * - 被 pin 的 INPUT 直接用固定值，不占列
 * - 每个 OUTPUT 探针占一列
 */
export function buildTruthTable(
  circuit: Circuit,
  customs: Map<string, CustomBox> = new Map()
): TruthTable {
  const { enumIds, pinned, names } = collectInputs(circuit);
  const outputs = collectOutputs(circuit);

  const columns = [
    ...enumIds.map((id) => names.get(id) ?? '?'),
    ...outputs.map((o) => o.name ?? 'Y'),
  ];

  const base: TruthTable = {
    columns,
    outputCount: outputs.length,
    rows: [],
    pinnedInputs: pinned,
  };

  // 没有输入变量时无法枚举
  if (enumIds.length === 0) {
    if (pinned.length === 0) {
      return { ...base, error: '画布上还没有输入元件，先从左侧拖一个进来' };
    }
    // 全部被 pin：只有一行，所有输入固定
    const assign: Assign = new Map(pinned.map((p) => [p.id, p.value]));
    const res = evaluate(circuit, assign, customs);
    const row: TruthRow = {
      inputs: [],
      outputs: outputs.map((o) => res.values.get(o.id)?.[0] ?? false),
      assign,
      index: 0,
    };
    return { ...base, rows: [row] };
  }

  if (enumIds.length > MAX_ENUM_INPUTS) {
    return {
      ...base,
      error: `未固定的输入有 ${enumIds.length} 个，超过 ${MAX_ENUM_INPUTS} 个上限。请在检视面板里把多余的输入固定为 0 或 1（pin），固定的输入不占真值表列。`,
    };
  }

  if (outputs.length === 0) {
    base.error = '还没有输出探针。从左侧拖一个「输出」元件到电路里，真值表才有输出列。';
  }

  const total = 1 << enumIds.length;
  const rows: TruthRow[] = [];

  for (let mask = 0; mask < total; mask += 1) {
    const assign: Assign = new Map(pinned.map((p) => [p.id, p.value]));

    // mask 的第 i 位（从低到高）对应 enumIds[i]
    // 为了让真值表读起来自然（A 为最高位），用高位在前
    enumIds.forEach((id, i) => {
      const bit = (mask >> (enumIds.length - 1 - i)) & 1;
      assign.set(id, bit === 1);
    });

    const res = evaluate(circuit, assign, customs);

    rows.push({
      inputs: enumIds.map((id) => assign.get(id) ?? false),
      outputs: outputs.map((o) => res.values.get(o.id)?.[0] ?? false),
      assign,
      index: rows.length,
    });
  }

  return { ...base, rows };
}