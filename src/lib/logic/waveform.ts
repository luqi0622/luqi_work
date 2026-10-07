import { isSequential } from './gates';
import type { Circuit } from './types';
import type { Simulator } from './sim/engine';
import type { TimePoint } from './sim/types';

/**
 * 波形面板（SVG 阶梯波）
 *
 * 关键设计：**每个信号一条 <path> 阶梯线**，复杂度 =跳变次数（≪ 时间点数），
 * 所以 200 步 × 20 信号也只有一个 path/信号，绘制开销可以忽略。
 *
 * 布局：
 *   - 左侧固定信号名列
 *   - 右侧横向滚动的时间轴（数字波形每一步都有意义，所以不抽稀）
 */

/** 行高（一个信号占的高度） */
const ROW_H = 26;
/** 左侧信号名列宽 */
const NAME_W = 96;
/** 每个时间步的宽度 */
const STEP_W = 30;
/** 上下留白 */
const PAD_Y = 18;

export interface WavePanelOptions {
  /** 显示哪些信号（节点 id） */
  signals: { id: string; label: string }[];
  /** 时间点 */
  steps: TimePoint[];
  /** 电路（用来取端口数与名称） */
  circuit: Circuit;
  /** 高亮到第几步（-1 表示不标记） */
  cursor?: number;
}

/**
 * 生成单个信号的阶梯 path
 *
 * @param values 每个时间点的该信号值（boolean[]，端口0 在前）
 * @param port画第几个输出端口（多输出元件每个端口单独一行）
 */
function stepPath(values: (boolean | undefined)[], row: number): string {
  if (values.length === 0) return '';
  const yOf = (v: boolean) => PAD_Y + row * ROW_H + (v ? 3 : ROW_H - 9);
  const xOf = (i: number) => NAME_W + i * STEP_W;

  /*
   * 数字波形是**正交**的：电平不变时沿水平方向走，
   * 电平变化时在同一个 x 上垂直跳到新电平。
   *
   * 关键：跳变处的顺序是「先垂直、后水平」。
   * 如果只输出一个 L(x_new, y_new)，SVG 会从上一��电平直接斜线过去，
   * 画出来就是三角形而不是方波。
   */
  const parts: string[] = [`M ${xOf(0)} ${yOf(!!values[0])}`];
  for (let i = 1; i < values.length; i += 1) {
    const prev = !!values[i - 1];
    const now = !!values[i];
    const x = xOf(i);
    if (prev === now) {
      parts.push(`L ${x} ${yOf(prev)}`);
    } else {
      parts.push(`L ${x} ${yOf(prev)}`); // 先在旧 x 上垂直跳变
      parts.push(`L ${x} ${yOf(now)}`);
    }
  }
  // 末尾拉一格，让最后一个电平有可见长度
  parts.push(`L ${xOf(values.length)} ${yOf(!!values[values.length - 1])}`);
  return parts.join(' ');
}


/** 波形面板渲染 */
export function renderWavePanel(host: HTMLElement, opt: WavePanelOptions) {
  const { signals, steps, circuit } = opt;
  const cursor = opt.cursor ?? steps.length - 1;

  host.innerHTML = '';

  if (signals.length === 0) {
    host.innerHTML =
      '<p class="lc-hint p-3">还没有可显示的信号。放一个「输出」或「线探针」元件到电路里。</p>';
    return;
  }
  if (steps.length === 0) {
    host.innerHTML =
      '<p class="lc-hint p-3">点「单步」推进时间，或点「运行」连续播放。每一步会往波形上加一列。</p>';
    return;
  }

  // 把每个信号的每个输出端口展开成一行
  interface Row {
    id: string;
    label: string;
    port: number;
    portName: string;
  }
  const rows: Row[] = [];
  for (const sig of signals) {
    const node = circuit.nodes.find((n) => n.id === sig.id);
    const ports = node ? Math.max(1, node.outputs) : 1;
    for (let p = 0; p < ports; p += 1) {
      const pn = portLabelOf(node?.type, p);
      rows.push({
        id: sig.id,
        label: sig.label,
        port: p,
        portName: ports > 1 ? `${sig.label}${pn}` : sig.label,
      });
    }
  }

  const w = NAME_W + steps.length * STEP_W + 24;
  const h = PAD_Y * 2 + rows.length * ROW_H;

  // ---------- 左侧信号名列（HTML，便于排版与点击） ----------
  const nameCol = document.createElement('div');
  nameCol.className = 'lc-wave-names';
  nameCol.style.setProperty('--rows', String(rows.length));
  nameCol.innerHTML = rows
    .map(
      (r, i) =>
        `<button type="button" class="lc-wave-name" data-row="${i}" ` +
        `style="top:${PAD_Y + i * ROW_H}px;height:${ROW_H}px" ` +
        `title="${escapeAttr(r.label)} 的第 ${r.port + 1} 路输出">` +
        `<span>${escapeHtml(r.portName)}</span></button>`
    )
    .join('');
  host.appendChild(nameCol);

  // ---------- 右侧 SVG ----------
  const scroll = document.createElement('div');
  scroll.className = 'lc-wave-scroll';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lc-wave-svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // 时间刻度
  const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  ticks.setAttribute('class', 'lc-wave-ticks');
  for (let i = 0; i < steps.length; i += 1) {
    const x = NAME_W + i * STEP_W;
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tick.setAttribute('x', String(x + STEP_W / 2));
    tick.setAttribute('y', '12');
    tick.setAttribute('class', 'lc-wave-tick');
    tick.textContent = String(i);
    ticks.appendChild(tick);
  }
  svg.appendChild(ticks);

  // 游标列（最新一步）
  if (cursor >= 0 && cursor < steps.length) {
    const cx = NAME_W + cursor * STEP_W;
    const cur = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    cur.setAttribute('x', String(cx));
    cur.setAttribute('y', String(PAD_Y - 6));
    cur.setAttribute('width', String(STEP_W));
    cur.setAttribute('height', String(h - PAD_Y * 2 + 12));
    cur.setAttribute('class', 'lc-wave-cursor');
    svg.appendChild(cur);
  }

  // 行分隔线
  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  grid.setAttribute('class', 'lc-wave-grid');
  for (let i = 0; i <= rows.length; i += 1) {
    const y = PAD_Y + i * ROW_H;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(NAME_W));
    line.setAttribute('x2', String(w - 12));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    grid.appendChild(line);
  }
  // 竖线（每步）
  for (let i = 0; i <= steps.length; i += 1) {
    const x = NAME_W + i * STEP_W;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(PAD_Y - 6));
    line.setAttribute('y2', String(h - PAD_Y));
    grid.appendChild(line);
  }
  svg.appendChild(grid);

  // 阶梯波形
  const wave = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wave.setAttribute('class', 'lc-wave-lines');
  rows.forEach((row, i) => {
    const values = steps.map((s) => s.values.get(row.id)?.[row.port]);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'lc-wave-line');
    path.setAttribute('d', stepPath(values, i));
    wave.appendChild(path);
  });
  svg.appendChild(wave);

  scroll.appendChild(svg);
  host.appendChild(scroll);

  // 滚到最新一步
  requestAnimationFrame(() => {
    scroll.scrollLeft = Math.max(0, NAME_W + (steps.length - 1) * STEP_W - scroll.clientWidth + 40);
  });
}

/** 端口名（与symbol.ts 的约定一致） */
function portLabelOf(type: string | undefined, port: number): string {
  if (type === 'DFF' || type === 'JK' || type === 'T' || type === 'SR') {
    return port === 0 ? '' : "'";
  }
  return port === 0 ? '' : String(port);
}

/** 生成波形面板要显示的信号清单 */
export function collectWaveSignals(circuit: Circuit, simulator: Simulator) {
  const out: { id: string; label: string }[] = [];
  for (const node of circuit.nodes) {
    if (node.type === 'OUTPUT') {
      out.push({ id: node.id, label: node.name ?? '输出' });
    } else if (node.type === 'PROBE') {
      out.push({ id: node.id, label: node.name ?? '探针' });
    } else if (node.type === 'SWITCH') {
      out.push({ id: node.id, label: node.name ?? '开关' });
    } else if (node.type === 'CLOCK') {
      out.push({ id: node.id, label: 'CLK' });
    } else if (isSequential(node.type)) {
      out.push({ id: node.id, label: node.name ?? node.type });
    }
  }
  void simulator;
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}