import { buildInputIndex } from '../evaluate';
import { isSequential } from '../gates';
import type { Circuit, CustomBox } from '../types';
import { detectMode } from './mode';
import { relaxCombinational } from './relax';
import { commitSequential, initialClk, initialStates } from './seq';
import { nodeRole } from './types';
import type { SeqStates, TimePoint, Waveform } from './types';

/**
 * 仿真器
 *
 * 把「用户按了一下开关/点了一下时钟」抽象成一次 `step()`：
 *   1. 读当前输入（开关/固定输入）
 *   2. 迭代松弛求稳态
 *   3. 提交时序状态（检测时钟边沿）
 *   4. 记一个时间点
 *
 * 松弛迭代本身不产生时间点——用户看到的波形列 = 他操作的次数。
 */
export class Simulator {
  private circuit: Circuit;
  private customs: Map<string, CustomBox>;

  /** 时序元件的存储态 */
  private states: SeqStates;
  /** 上一步各触发器的时钟电平（用于判边沿） */
  private clk: Map<string, boolean>;
  /** 上一步的稳态值（作为下一次松弛的初值） */
  private lastValues: Map<string, boolean[]>;

  private steps: TimePoint[] = [];

  /** 最近一次松弛的收敛信息 */
  lastRelax: { converged: boolean; iters: number; oscillation?: string } | null = null;
  /** 最近一次触发边沿的节点 id */
  lastTriggered: string[] = [];

  constructor(circuit: Circuit, customs: Map<string, CustomBox> = new Map()) {
    this.circuit = circuit;
    this.customs = customs;
    this.states = initialStates(circuit);
    this.clk = initialClk(circuit);
    this.lastValues = new Map();
  }

  /** 换电路（载入示例 / 导入文件后调用），重置全部状态 */
  setCircuit(circuit: Circuit, customs?: Map<string, CustomBox>) {
    this.circuit = circuit;
    if (customs) this.customs = customs;
    this.reset();
  }

  get mode() {
    return detectMode(this.circuit);
  }

  /** 当前时序状态（供UI 显示锁存器的 Q） */
  getStates(): SeqStates {
    return this.states;
  }

  /**
 * 推进一个时间点
 *
 * 顺序很关键：**先翻转时钟 → 再求稳态 → 最后提交时序状态**。
 * 因为触发器是靠「时钟边沿」写入的，如果先松弛再翻时钟，
 * 本步的稳态里时钟还是旧电平，边沿就检测不到，整整慢一拍。
 */
step(note?: string): TimePoint {
  // 0) 时钟先翻转（本步的新电平要参与本步的稳态计算）
  this.tickClock();

  const inputs = this.readInputs();

  // 1) 求稳态（此时 values 里的时钟已是新电平）
  const relax = relaxCombinational(this.circuit, this.states, this.lastValues, {
    inputs,
    customs: this.customs,
  });
  this.lastRelax = {
    converged: relax.converged,
    iters: relax.iters,
    oscillation: relax.oscillation,
  };

  // 2) 提交时序状态（本步的 clk 与上一步的 clk 对比，判定边沿）
  const commit = commitSequential(this.circuit, this.states, this.clk, relax.values, this.customs);
  this.states = commit.states;
  this.clk = commit.clk;
  this.lastTriggered = commit.triggered;

  // 3) 记时间点
  const tp: TimePoint = {
    t: this.steps.length,
    note,
    inputs,
    values: relax.values,
    states: cloneStates(this.states),
  };
  this.steps.push(tp);
  this.lastValues = relax.values;

    return tp;
  }

  /**
 * 时钟翻转：把电路里所有 CLOCK 元件的电平取反
 *
 * 必须在 step() 的最前面调用——触发器依赖时钟边沿写入，
 * 所以本步要看到的必须是「翻转后」的电平。
 */
private tickClock() {
  for (const node of this.circuit.nodes) {
    if (node.type !== 'CLOCK') continue;
    const was = this.states.get(node.id)?.[0] ?? false;
    this.states.set(node.id, [!was]);
  }
}

/** 读当前所有自由输入的取值 */
  private readInputs(): Map<string, boolean> {
    const m = new Map<string, boolean>();
    for (const n of this.circuit.nodes) {
      if (n.type === 'SWITCH') {
        m.set(n.id, n.switchValue ?? false);
      } else if (n.type === 'INPUT' && !n.pinned) {
        // 未固定的 INPUT 在波形模式下没有「当前值」概念，默认 0
        m.set(n.id, n.pinnedValue ?? false);
      }
    }
    return m;
  }

  /** 切换某个开关，返回切换后的状态 */
  toggleSwitch(nodeId: string): boolean {
    const node = this.circuit.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    if (node.type === 'SWITCH') {
      node.switchValue = !(node.switchValue ?? false);
      return node.switchValue;
    }
    if (node.type === 'CONST') {
      node.constValue = !(node.constValue ?? false);
      return node.constValue;
    }
    return false;
  }

  /** 重置：清空状态与波形 */
  reset() {
    this.states = initialStates(this.circuit);
    this.clk = initialClk(this.circuit);
    this.lastValues = new Map();
    this.steps = [];
    this.lastRelax = null;
    this.lastTriggered = [];
  }

  /** 取出波形，并自动选出要绘制的信号 */
  getWaveform(extraPlotted: string[] = []): Waveform {
    return {
      steps: this.steps,
      plotted: [...this.defaultPlotted(), ...extraPlotted],
    };
  }

  /** 默认绘制：所有输出探针 + 所有线探针 */
  defaultPlotted(): string[] {
    const ids: string[] = [];
    for (const n of this.circuit.nodes) {
      if (n.type === 'OUTPUT' || n.type === 'PROBE') ids.push(n.id);
      // 时序元件的 Q 也值得看
      if (isSequential(n.type) && nodeRole(n) !== 'clock') ids.push(n.id);
    }
    return ids;
  }

  /** 按指定输入赋值算一次稳态（真值表点行时用，不推进时间） */
  currentValuesFor(assign: Map<string, boolean>): Map<string, boolean[]> {
    const relax = relaxCombinational(this.circuit, this.states, this.lastValues, {
      inputs: assign,
      customs: this.customs,
    });
    return relax.values;
  }

  /** 某个节点在当前时刻的值 */
  currentValue(nodeId: string): boolean[] | undefined {
    const last = this.steps[this.steps.length - 1];
    if (last) return last.values.get(nodeId);
    // 还没走过一步时，求一次稳态
    const relax = relaxCombinational(this.circuit, this.states, undefined, {
      inputs: this.readInputs(),
      customs: this.customs,
    });
    return relax.values.get(nodeId);
  }

  /** 走过的步数 */
  get stepCount() {
    return this.steps.length;
  }

  /** 找出所有未连接输入端口（UI 灰色虚线提示用） */
  unconnectedInputs(): Set<string> {
    const idx = buildInputIndex(this.circuit);
    const bad = new Set<string>();
    for (const n of this.circuit.nodes) {
      const arr = idx.get(n.id) ?? [];
      for (let p = 0; p < n.inputs; p += 1) {
        if (!arr[p]) bad.add(`${n.id}:${p}`);
      }
    }
    return bad;
  }
}

function cloneStates(s: SeqStates): SeqStates {
  const out: SeqStates = new Map();
  for (const [k, v] of s) out.set(k, [...v]);
  return out;
}