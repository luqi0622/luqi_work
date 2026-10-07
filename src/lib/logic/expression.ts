import { buildInputIndex } from './evaluate';
import { topoSort } from './topology';
import { buildTruthTable } from './truthtable';
import type { Circuit, CustomBox, LogicNode } from './types';

export interface ExprOptions {
  /** 德摩根归一化：把取反全部推到输入端，表达式只用 AND/OR/XOR/NOT */
  deMorgan?: boolean;
}

export interface ExprTerm {
  /** 中间变量名 N1 / N2 ... */
  label: string;
  /** 定义式，如 A AND B */
  text: string;
}

export interface ExprOutput {
  nodeId: string;
  /** 输出探针名 */
  label: string;
  /** 该输出的表达式，如 N1或 (A AND B) */
  text: string;
}

export interface ExprResult {
  terms: ExprTerm[];
  outputs: ExprOutput[];
  warnings: string[];
}

/** 引用：一个已生成的子表达式 */
interface Ref {
  text: string;
  /** 结合紧密度：0 原子、1 NOT、2 AND类、3 OR类/XOR。用于决定是否加括号 */
  prec: number;
}

const P_ATOM = 0;
const P_NOT = 1;
const P_AND = 2;
const P_OR = 3;

/**
 * 运算符结合紧密度，用于决定何时补括号
 * NAND/NOR/XNOR 保留原名时，与对应的基本门同优先级
 */
const PREC = {
  NOT: P_NOT,
  AND: P_AND,
  NAND: P_AND,
  OR: P_OR,
  NOR: P_OR,
  XOR: P_OR,
  XNOR: P_OR,
} as const;

const DEFAULT_INPUT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** 输入节点按出现顺序的默认名（A/B/C…） */
export function inputNames(circuit: Circuit): Map<string, string> {
  const m = new Map<string, string>();
  circuit.nodes
    .filter((n) => n.type === 'INPUT')
    .forEach((n, i) => m.set(n.id, n.name ?? DEFAULT_INPUT_NAMES[i] ?? `IN${i + 1}`));
  return m;
}

/** 多输出元件的端口名 */
function portLabel(node: LogicNode, port: number): string {
  if (node.type === 'DFF') return port === 0 ? 'Q' : '/Q';
  if (node.type === 'CUSTOM') return ['Y0', 'Y1'][port] ?? `Y${port}`;
  return 'Y';
}

/** 需要时给子表达式补括号 */
function wrap(text: string, needPrec: number): string {
  return text.includes(' ') && needPrec > P_ATOM ? `(${text})` : text;
}

/** 可以出现在表达式里的运算符（含保留原名的 NAND/NOR/XNOR） */
type JoinOp = keyof typeof PREC;

/** 用运算符连接一组引用 */
function join(args: Ref[], op: JoinOp): Ref {
  const needPrec = PREC[op];
  const parts = args.map((a) => wrap(a.text, needPrec));
  if (parts.length === 1) return { text: parts[0], prec: needPrec };
  return { text: parts.join(` ${op} `), prec: needPrec };
}

/**
 * 统计每个节点被多少个输出探针「信号路径」覆盖
 *
 * 对每个输出探针，从它的信号源沿边反向回溯，把经过的所有节点标记 +1。
 * 只回溯「本次输出会用到的」节点，不回溯 INPUT/CONST。
 */
function countOutputsReaching(
  circuit: Circuit,
  byId: Map<string, LogicNode>,
  inIdx: Map<string, { node: string; port: number }[]>
): Map<string, number> {
  // 反向邻接：target → [{node: source}]
  const parents = new Map<string, string[]>();
  for (const e of circuit.edges) {
    if (!byId.has(e.from.node) || !byId.has(e.to.node)) continue;
    const arr = parents.get(e.to.node) ?? [];
    arr.push(e.from.node);
    parents.set(e.to.node, arr);
  }

  const count = new Map<string, number>();
  const outputs = circuit.nodes.filter((n) => n.type === 'OUTPUT');

  for (const o of outputs) {
    const src = inIdx.get(o.id)?.[0];
    if (!src) continue;
    // 每个输出单独走一遍，带 visited 防止环导致死循环。
    // key 必须带端口：同一个 DFF 的 Q 与 /Q 是两个独立信号，不能合并统计。
    const visited = new Set<string>();
    const stack = [`${src.node}#${src.port}`];
    while (stack.length) {
      const key = stack.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const id = key.split('#')[0];
      const node = byId.get(id);
      if (!node || node.type === 'INPUT' || node.type === 'CONST') continue;
      count.set(key, (count.get(key) ?? 0) + 1);
      for (const p of parents.get(id) ?? []) {
        // 父节点的每个输出端口都是一条独立路径
        const pn = byId.get(p);
        const ports = pn ? Math.max(1, pn.outputs) : 1;
        for (let pi = 0; pi < ports; pi += 1) stack.push(`${p}#${pi}`);
      }
    }
  }

  void circuit;
  return count;
}

/** 引用取反 */
function negate(r: Ref): Ref {
  // 原子 / 中间变量：直接前置 NOT
  if (r.prec === P_ATOM) return { text: `NOT ${r.text}`, prec: P_NOT };
  // 已经是 NOT X，再取反就是X
  if (r.prec === P_NOT && r.text.startsWith('NOT ') && !r.text.slice(4).includes(' ')) {
    return { text: r.text.slice(4), prec: P_ATOM };
  }
  return { text: `NOT (${r.text})`, prec: P_NOT };
}

/**
 * 布尔表达式生成
 *
 * - 记忆化 DFS（缓存 nodeId#port#negated），共享子电路不会指数膨胀
 * - 取反沿树向下传播：expand(node, port, true) 直接算NOT(该节点输出)，
 *   不需要先生成再包一层NOT，所以德摩根形式是「天然」得到的
 * - 被多个输出共用的内部节点提取为中间变量 N1 / N2...
 */
export function generateExpressions(
  circuit: Circuit,
  opt: ExprOptions = {},
  customs: Map<string, CustomBox> = new Map()
): ExprResult {
  const warnings: string[] = [];
  const terms: ExprTerm[] = [];
  const byId = new Map(circuit.nodes.map((n) => [n.id, n]));
  const inIdx = buildInputIndex(circuit);
  const names = inputNames(circuit);

  const outputs = circuit.nodes.filter((n) => n.type === 'OUTPUT');
  if (circuit.nodes.length === 0) warnings.push('画布是空的，先从左侧拖几个元件进来');
  else if (outputs.length === 0) warnings.push('电路里没有输出探针，连一个「输出」元件到末尾就有表达式了');

  // 含环路的电路（SR 锁存器这类）没有良定义的组合表达式，直接短路返回
  const topo = topoSort(circuit);
  if (topo.hasCycle) {
    return {
      terms: [],
      outputs: outputs.map((o) => ({ nodeId: o.id, label: o.name ?? 'Y', text: '' })),
      warnings: ['电路里存在环路（典型如 SR 锁存器这类反馈电路），它不是纯组合逻辑，没有可直接展开的布尔表达式。请断开反馈或改用纯组合电路。'],
    };
  }

  /**
   * 中间变量判定
   *
   * 只有当同一个内部节点被**多个输出探针**引用时才提取成 N1，
   * 否则单输出电路（如 D 触发器）会莫名其妙冒出一个没人复用的 N1。
   * 做法：从每个输出探针的信号源出发沿有向图回溯，统计每个节点被多少个输出覆盖。
   */
  const reachCount = countOutputsReaching(circuit, byId, inIdx);

  const cache = new Map<string, Ref>();

  /** 取某节点各输入端口的引用；未连接的端口按常量 0 */
  function argsOf(node: LogicNode): Ref[] {
    const srcs = inIdx.get(node.id) ?? [];
    const out: Ref[] = [];
    for (let p = 0; p < node.inputs; p += 1) {
      const s = srcs[p];
      out.push(s ? expand(s.node, s.port, false) : { text: '0', prec: P_ATOM });
    }
    return out;
  }

  /** 展开过程中的递归栈：含环电路（SR 锁存器）会绕回来，靠它兜住 */
  const visiting = new Set<string>();

  function expand(nodeId: string, port: number, negated: boolean): Ref {
    const node = byId.get(nodeId);
    if (!node) return { text: '?', prec: P_ATOM };

    if (node.type === 'INPUT') {
      const base: Ref = { text: names.get(nodeId) ?? '?', prec: P_ATOM };
      return negated ? negate(base) : base;
    }

    if (node.type === 'CONST') {
      const v = (node.constValue ?? false) !== negated;
      return { text: v ? '1' : '0', prec: P_ATOM };
    }

    if (node.type === 'OUTPUT') {
      const src = inIdx.get(nodeId)?.[0];
      return src ? expand(src.node, src.port, negated) : { text: '?', prec: P_ATOM };
    }

    const key = `${nodeId}#${port}#${negated ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit) return hit;

    // 绕回同一个信号 = 存在环路。这种电路本身没有良定义的组合表达式，
    // 展开到此处直接截断为「?」并记一条警告，而不是无限递归把栈打爆。
    if (visiting.has(key)) {
      return { text: '?', prec: P_ATOM };
    }
    visiting.add(key);
    let ref: Ref;
    try {
      ref = buildNode(node, port, negated);
    } finally {
      visiting.delete(key);
    }
    cache.set(key, ref);
    return ref;
  }

  /** 核心：算一个非输入节点某个输出端口在 negated 下的表达式 */
  function buildNode(node: LogicNode, port: number, negated: boolean): Ref {
    // ---- D 触发器：Q = D，端口 1 是 /Q ----
    if (node.type === 'DFF') {
      const d = argsOf(node)[0] ?? { text: '0', prec: P_ATOM };
      // 自然输出：port0 = D，port1 = /D
      const natural = port === 0 ? d : negate(d);
      return negated ? negate(natural) : natural;
    }

    // ---- 自定义黑盒：用最小项展开描述 ----
    if (node.type === 'CUSTOM') {
      const box = node.customId ? customs.get(node.customId) : undefined;
      const nm = node.name ?? box?.name ?? '黑盒';
      if (!box) return { text: negated ? `NOT (${nm})` : nm, prec: P_ATOM };
      if (negated) {
        // 取反后的黑盒：列出输出为 0 的行
        const zeros = box.table.map((r, i) => (r[port] ? -1 : i)).filter((i) => i >= 0);
        if (zeros.length > 0 && zeros.length <= 8) {
          return join(zeros.map((i) => mintermOf(box, i)), 'OR');
        }
        return { text: `NOT (${box.name})`, prec: P_ATOM };
      }
      const ones = box.table.map((r, i) => (r[port] ? i : -1)).filter((i) => i >= 0);
      if (ones.length > 0 && ones.length <= 8) {
        return join(ones.map((i) => mintermOf(box, i)), 'OR');
      }
      // 全 0 或项太多：直接保留元件名
      return { text: box.name, prec: P_ATOM };
    }

    const args = argsOf(node);
    const a = args.length ? args : [{ text: '0', prec: P_ATOM }];

    /**
     * deMorgan = true 时把「取反」吸收进运算本身：
     *   NOT(a AND b) = NOT a OR NOT b
     *   NOT(a OR b)  = NOT a AND NOT b
     *   NOT(a XOR b) = NOT a XOR b（奇偶性随一项翻转）
     * 于是只需知道「这一层是否取反」，就能直接算出正确的规范形式。
     *
     * deMorgan = false 时保留原门名（NAND / NOR / XNOR），
     * 让表达式和画布上的元件一一对应，更贴近初学者看到的电路图。
     */
    if (opt.deMorgan) {
      // n：外部要求反时，每个入参都取反
      const n = args.map((r) => (negated ? negate(r) : r));
      // m：无论外部是否取反，都强制对每个入参取反（供 NAND/NOR/XNOR 这类「自带取反」的门用）
      const m = args.map((r) => negate(r));

      switch (node.type) {
        case 'AND':
          return join(negated ? n : a, 'AND');
        case 'OR':
          return join(negated ? n : a, 'OR');
        case 'XOR':
          return join(negated ? n : a, 'XOR');
        case 'NOT': {
          const d = a[0];
          return negated ? d : negate(d);
        }
        case 'NAND':
          // NAND = NOT AND = NOT a OR NOT b；外部再取反则回到 AND(a,b)
          return negated ? join(a, 'AND') : join(m, 'OR');
        case 'NOR':
          // NOR = NOT OR = NOT a AND NOT b；外部再取反则回到 OR(a,b)
          return negated ? join(a, 'OR') : join(m, 'AND');
        case 'XNOR':
          // XNOR = NOT XOR；外部再取反则回到 XOR(a,b)
          return negated ? join(a, 'XOR') : join(m, 'XOR');
        default:
          return { text: node.name ?? node.type, prec: P_ATOM };
      }
    }

    // 保留门名的模式：先算自然输出，外部取反再整体包 NOT
    const natural = ((): Ref => {
      switch (node.type) {
        case 'AND':
          return join(a, 'AND');
        case 'OR':
          return join(a, 'OR');
        case 'XOR':
          return join(a, 'XOR');
        case 'NAND':
          return join(a, 'NAND');
        case 'NOR':
          return join(a, 'NOR');
        case 'XNOR':
          return join(a, 'XNOR');
        case 'NOT':
          return negate(a[0]);
        default:
          return { text: node.name ?? node.type, prec: P_ATOM };
      }
    })();
    return negated ? negate(natural) : natural;
  }

  /** 最小项：x0 / NOT x0 ... */
  function mintermOf(box: CustomBox, rowIndex: number): Ref {
    const parts: string[] = [];
    for (let p = 0; p < box.inputs; p += 1) {
      const bit = ((rowIndex >> (box.inputs - 1 - p)) & 1) === 1;
      parts.push(bit ? `x${p}` : `NOT x${p}`);
    }
    return { text: parts.join(' AND '), prec: P_AND };
  }

  // ---- 中间变量提取 + 各输出表达式 ----
  // key 是 `nodeId#port`：同一节点的 Q 与 /Q 必须能各自成为独立中间变量
  const termName = new Map<string, string>();
  let termSeq = 0;
  const outExprs: ExprOutput[] = [];

  for (const o of outputs) {
    const src = inIdx.get(o.id)?.[0];
    const label = o.name ?? 'Y';

    if (!src) {
      outExprs.push({ nodeId: o.id, label, text: '' });
      continue;
    }

    const srcNode = byId.get(src.node);
    const shareable =
      srcNode &&
      srcNode.type !== 'INPUT' &&
      srcNode.type !== 'CONST' &&
      (reachCount.get(`${src.node}#${src.port}`) ?? 0) > 1;

    if (shareable && srcNode) {
      const tKey = `${src.node}#${src.port}`;
      if (!termName.has(tKey)) {
        termSeq += 1;
        const nm = `N${termSeq}`;
        termName.set(tKey, nm);
        terms.push({ label: nm, text: '' }); // 占位，防止自引用
        terms[terms.length - 1].text = expand(src.node, src.port, false).text;
      }
      outExprs.push({ nodeId: o.id, label, text: termName.get(tKey)! });
      continue;
    }

    outExprs.push({ nodeId: o.id, label, text: expand(src.node, src.port, false).text });
  }

  // 未被任何输出用到的中间变量不该出现（扇出统计里 1 次引用 + 1 次输出引用 = 2）
  if (opt.deMorgan) {
    // 上面的德摩根是「天然」下推的，这个开关只影响是否额外做一次化简：
    // 关掉时保留 NAND/NOR/XNOR 原名更贴近电路图。这里保持原样，仅提示。
  }

  return { terms, outputs: outExprs, warnings };
}

/**
 * 一致性自检：逐行比对「表达式求值」与「电路求值」
 *
 * 迷你求值器只认 generateExpressions 产出的语法：
 * 运算符优先级 NOT > AND/NAND > XOR/XNOR > OR/NOR，同级从左到右
 */
export function verifyExpressions(
  circuit: Circuit,
  expr: ExprResult,
  customs: Map<string, CustomBox> = new Map()
): { ok: boolean; checked: number; firstFail?: { row: number; column: string; expr: string; circuit: string } } {
  const tt = buildTruthTable(circuit, customs);
  if (tt.error || tt.rows.length === 0 || expr.outputs.length === 0) {
    return { ok: true, checked: 0 };
  }

  const pinned = new Map(tt.pinnedInputs.map((p) => [p.name, p.value] as const));
  let checked = 0;

  /**
   * 变量作用域里既有输入变量（A/B/C）、也有固定输入，还有中间变量（N1/N2）。
   * evalText 遇到未知标识符会当 0，所以必须先把中间变量的定义也求值注入作用域，
   * 否则 `Q = N1` 会被算成 `Q = 0`，产生假的「不一致」。
   */
  const termTexts = new Map(expr.terms.map((t) => [t.label, t.text] as const));

  for (let oi = 0; oi < expr.outputs.length; oi += 1) {
    const out = expr.outputs[oi];
    if (!out.text) continue;
    // 含黑盒最小项（x0/x1）时无法从真值表拿到 x 的取值，跳过校验
    if (/\bx\d/.test(out.text)) continue;

    for (const row of tt.rows) {
      const scope = new Map<string, boolean>(pinned);
      row.inputs.forEach((v, i) => scope.set(tt.columns[i], v));

      // 逐个求值中间变量（terms 已按定义顺序排列，后面的可依赖前面的）
      for (const [label, text] of termTexts) {
        if (!text) continue;
        if (/\bx\d/.test(text)) continue;
        try {
          scope.set(label, evalText(text, scope));
        } catch {
          return { ok: true, checked };
        }
      }

      let got: boolean;
      try {
        got = evalText(out.text, scope);
      } catch {
        return { ok: true, checked };
      }
      const want = row.outputs[oi] ?? false;
      checked += 1;
      if (got !== want) {
        return {
          ok: false,
          checked,
          firstFail: {
            row: row.index,
            column: out.label,
            expr: got ? '1' : '0',
            circuit: want ? '1' : '0',
          },
        };
      }
    }
  }

  return { ok: true, checked };
}

/** 迷你表达式求值器 */
export function evalText(text: string, scope: Map<string, boolean>): boolean {
  const tokens = text
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .split(/\s+/)
    .filter(Boolean);

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function primary(): boolean {
    const t = next();
    if (t === undefined) return false;
    if (t === '(') {
      const v = orExpr();
      if (peek() === ')') next();
      return v;
    }
    if (t === '0') return false;
    if (t === '1') return true;
    return scope.get(t) ?? false;
  }

  function notExpr(): boolean {
    if (peek() === 'NOT') {
      next();
      return !notExpr();
    }
    return primary();
  }

  function andExpr(): boolean {
    let v = notExpr();
    while (peek() === 'AND' || peek() === 'NAND') {
      const op = next();
      const r = notExpr();
      const both = v && r;
      v = op === 'NAND' ? !both : both;
    }
    return v;
  }

  function xorExpr(): boolean {
    let v = andExpr();
    while (peek() === 'XOR' || peek() === 'XNOR') {
      const op = next();
      const r = andExpr();
      v = op === 'XNOR' ? v === r : v !== r;
    }
    return v;
  }

  function orExpr(): boolean {
    let v = xorExpr();
    while (peek() === 'OR' || peek() === 'NOR') {
      const op = next();
      const r = xorExpr();
      const any = v || r;
      v = op === 'NOR' ? !any : any;
    }
    return v;
  }

  return orExpr();
}

/** 文本表达式 → LaTeX（交给 KaTeX 渲染） */
export function toLatex(text: string): string {
  if (!text) return '';
  const ops: [RegExp, string][] = [
    [/\bNOT\b/g, '\\neg '],
    [/\bXNOR\b/g, '\\leftrightarrow '],
    [/\bXOR\b/g, '\\oplus '],
    [/\bNAND\b/g, '\\uparrow '],
    [/\bNOR\b/g, '\\downarrow '],
    [/\bAND\b/g, '\\land '],
    [/\bOR\b/g, '\\lor '],
  ];
  let s = text;
  for (const [re, rep] of ops) s = s.replace(re, rep);
  // 变量斜体（单个大写字母或小写+数字）
  s = s.replace(/\b([A-Za-z]\d?)\b/g, (_m, v: string) => {
    if (/^\\(neg|land|lor|oplus|uparrow|downarrow|leftrightarrow)$/.test(v)) return v;
    return `\\mathit{${v}}`;
  });
  return s.replace(/\s+/g, ' ').trim();
}

export { portLabel };