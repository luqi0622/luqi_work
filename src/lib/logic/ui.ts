/**
 * 逻辑电路实验台 v2 —— 页面 UI 装配层
 *
 * 职责边界：
 * - bench.ts 管画布与电路数据（DOM 重）
 * - sim/* 管仿真（松弛 + 时序）
 * - gates/symbol.ts 管符号定义（画布与元件面板共用）
 * - 这个文件负责把它们接起来，并渲染抽屉里的面板
 */
import katex from 'katex';

import { LogicBench } from './bench';
import {
  blankTable,
  customsMap,
  deleteCustom,
  exportCustoms,
  importCustoms,
  listCustoms,
  nameTaken,
  newCustomId,
  saveCustom,
  validateBox,
} from './customBox';
import { gateDef, PALETTE_GROUPS, symbolFor } from './gates';
import { generateExpressions, toLatex, verifyExpressions } from './expression';
import { PRESETS } from './presets';
import {
  downloadText,
  exportCircuit,
  flushDraft,
  importCircuit,
  loadDraft,
  pickTextFile,
  saveDraft,
  stampFilename,
} from './serialize';
import { detectMode, modeHint } from './sim/mode';
import { Simulator } from './sim/engine';
import { buildTruthTable } from './truthtable';
import type { TruthTable } from './truthtable';
import { collectWaveSignals, renderWavePanel } from './waveform';
import type { Circuit, CustomBox, GateKind, LogicNode } from './types';

/**
 * 取元素
 * 找不到时返回 null（而不是假装成功），调用方多数做了?. 判断，
 * 关键路径（#canvas）在 boot() 里单独检查并提示。
 */
const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel);

// ============================================================
// 状态
// ============================================================

let bench: LogicBench;
let sim: Simulator;
let tt: TruthTable;
let mode: 'table' | 'wave' = 'table';

let deMorgan = false;
let currentRow = -1;
/** 波形是否在连续运行 */
let simRunning = false;
let simTimer: ReturnType<typeof setInterval> | null = null;
let activeTab: 'wave' | 'table' | 'expr' = 'wave';
let editingCustom: CustomBox | null = null;
/** 检视抽屉是否被用户手动打开过（选中节点时不自动弹） */
let inspectorPinned = false;

// ============================================================
// 初始化
// ============================================================

function boot() {
  // 生产构建里这个模块脚本可能在 DOM 就绪前执行（dev 时机不同，本地不暴露这个竞态）。
  // 挂载点缺失就等 DOMContentLoaded 再跑，否则 querySelector 返回 null 会静默失败。
  const host = document.querySelector<HTMLElement>('#canvas');
  if (!host) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
    } else {
      // DOM 已就绪却还是找不到挂载点，说明页面结构变了，给出可见提示而不是静默失败
      console.error('[logic] 找不到画布挂载点 #canvas，页面结构可能已变更');
      const err = document.querySelector('#status-text');
      if (err) err.textContent = '页面初始化失败：缺少画布挂载点';
    }
    return;
  }

  const draft = loadDraft();
  const circuit = draft ?? PRESETS[0].make();

  bench = new LogicBench(host, circuit);
  sim = new Simulator(bench.circuit, customsMap());

  bench.customLookup = (id) => {
    const box = listCustoms().find((b) => b.id === id);
    return box ? { id: box.id, name: box.name, inputs: box.inputs, outputs: box.outputs } : undefined;
  };

  bench.onChange(onBenchChange);

  renderPalette();
  bindToolbar();
  bindKeyboard();
  bindPaletteDrag();
  bindCustomDialog();
  bindTabs();

  window.addEventListener('beforeunload', () => flushDraft(bench.circuit));

  bench.fitToView();
  refreshAll();

  // 初次进来就把底部面板打开，让用户立刻看到真值表 / 波形
  if (mode === 'wave') activeTab = 'wave';
  else activeTab = 'table';
  syncTabs();
  toggleBottom();
}

// ============================================================
// 变化处理
// ============================================================

function onBenchChange(reason: string) {
  if (reason === 'view') {
    updateZoomLabel();
    return;
  }
  if (reason === 'select') {
    renderInspector();
    return;
  }
  saveDraft(bench.circuit);
  sim.setCircuit(bench.circuit, customsMap());
  refreshAll();
}

function refreshAll() {
  const customs = customsMap();
  tt = buildTruthTable(bench.circuit, customs);
  mode = detectMode(bench.circuit);

  // 模式决定默认打开哪个 tab
  if (mode === 'wave' && activeTab === 'table') {
    // 真值表在时序电路下无意义，留在表达式更合适
    activeTab = 'wave';
  }

  renderStatus();
  renderTruthTable();
  renderExpressions(customs);
  renderInspector();
  renderWave();
  renderModeHint();
  syncTabs();
  updateToolbarState();
  updateZoomLabel();
  updateEmptyHint();
  syncSimToCanvas();
}

function updateToolbarState() {
  const undo = $<HTMLButtonElement>('[data-act="undo"]');
  const redo = $<HTMLButtonElement>('[data-act="redo"]');
  if (undo) undo.disabled = !bench.canUndo();
  if (redo) redo.disabled = !bench.canRedo();
}

function updateZoomLabel() {
  const el = $('#zoom-label');
  if (el) el.textContent = `${Math.round(bench.getZoom() * 100)}%`;
}

function updateEmptyHint() {
  const el = $('#canvas-empty');
  if (el) el.hidden = bench.circuit.nodes.length > 0;
}

function syncSimToCanvas() {
  // 把当前时刻的值画到电路节点上
  const tp = sim.getWaveform().steps[sim.stepCount - 1];
  bench.setLiveValues(tp?.values ?? null);
}

// ============================================================
// 状态栏
// ============================================================

function renderStatus() {
  const wrap = $('#status');
  const text = $('#status-text');
  if (!wrap || !text) return;
  wrap.classList.remove('is-warn', 'is-err');

  const nNodes = bench.circuit.nodes.length;
  const nWires = bench.circuit.edges.length;

  if (bench.hasCycle()) {
    wrap.classList.add('is-err');
    text.textContent = `检测到反馈环路（${nNodes} 个元件）— 求值器已切换为迭代求解，真值表在环路下没有唯一答案`;
    return;
  }
  if (tt.error && mode === 'table') {
    wrap.classList.add('is-warn');
    text.textContent = tt.error;
    return;
  }
  const relax = sim.lastRelax;
  if (relax && !relax.converged) {
    wrap.classList.add('is-warn');
    text.textContent = relax.oscillation ?? '电路未收敛';
    return;
  }
  const modeLabel = mode === 'wave' ? '波形模式' : `真值表 ${tt.rows.length} 行`;
  text.textContent = `${nNodes} 个元件 · ${nWires} 根连线 · ${modeLabel}`;
}

function renderModeHint() {
  const el = $('#mode-hint');
  if (!el) return;
  const hint = modeHint(mode);
  el.textContent = hint;
  el.hidden = !hint;
}

// ============================================================
// 真值表
// ============================================================

function renderTruthTable() {
  const wrap = $('#tt-wrap');
  const badge = $('#tt-badge');
  if (!wrap) return;

  if (badge) {
    badge.textContent = tt.pinnedInputs.length
      ? `固定 ${tt.pinnedInputs.map((p) => `${p.name}=${p.value ? 1 : 0}`).join(' ')}`
      : `${tt.columns.length - tt.outputCount} 个输入变量`;
  }

  if (tt.rows.length === 0) {
    wrap.innerHTML = `<p class="lc-hint p-3">${escapeHtml(tt.error ?? '先放几个输入和输出元件。')}</p>`;
    return;
  }

  const inputCols = tt.columns.length - tt.outputCount;
  const parts: string[] = ['<table><thead><tr>'];
  for (let i = 0; i < inputCols; i += 1) {
    parts.push(`<th class="is-input">${escapeHtml(tt.columns[i])}</th>`);
  }
  if (tt.outputCount > 0) {
    parts.push('<th class="lc-divider"></th>');
    for (let i = inputCols; i < tt.columns.length; i += 1) {
      parts.push(`<th class="is-output">${escapeHtml(tt.columns[i])}</th>`);
    }
  }
  parts.push('</tr></thead><tbody>');

  for (const row of tt.rows) {
    parts.push(`<tr data-row="${row.index}"${row.index === currentRow ? ' class="is-current"' : ''}>`);
    row.inputs.forEach((v) => parts.push(`<td class="td-in">${v ? 1 : 0}</td>`));
    if (tt.outputCount > 0) {
      parts.push('<td class="lc-divider"></td>');
      row.outputs.forEach((v) => parts.push(`<td class="td-out">${v ? 1 : 0}</td>`));
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  wrap.innerHTML = parts.join('');

  // 点行 → 逐行求值并高亮电路
  wrap.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      currentRow = Number((tr as HTMLElement).dataset.row);
      const row = tt.rows[currentRow];
      if (row) bench.setLiveValues(simulateAssign(row.assign).values);
      renderTruthTableCursor();
      renderStatus();
    });
  });
}

function renderTruthTableCursor() {
  document.querySelectorAll('#tt-wrap tbody tr').forEach((tr) => {
    tr.classList.toggle('is-current', Number((tr as HTMLElement).dataset.row) === currentRow);
  });
}

/** 组合模式下按真值表的一行求值（无记忆，纯组合） */
function simulateAssign(assign: Map<string, boolean>) {
  // 复用 Simulator 但不推进时间：直接算一次稳态
  return { values: sim.currentValuesFor(assign) };
}

// ============================================================
// 波形
// ============================================================

function renderWave() {
  const host = $('#wave-host');
  const info = $('#sim-info');
  if (!host) return;

  const wf = sim.getWaveform();
  const signals = collectWaveSignals(bench.circuit, sim);

  renderWavePanel(host, {
    signals,
    steps: wf.steps,
    circuit: bench.circuit,
    cursor: wf.steps.length - 1,
  });

  if (info) {
    const relax = sim.lastRelax;
    const flag = relax && !relax.converged ? ' ·未收敛' : '';
    info.textContent = wf.steps.length ? `共 ${wf.steps.length} 步${flag}` : '共 0 步 · 点「单步」开始';
  }
}

function simStep() {
  sim.step();
  renderWave();
  renderStatus();
  syncSimToCanvas();
}

function simReset() {
  stopRun();
  sim.reset();
  renderWave();
  renderStatus();
  syncSimToCanvas();
}

function toggleRun() {
  if (simRunning) {
    stopRun();
    return;
  }
  simRunning = true;
  const speed = Number($<HTMLSelectElement>('#sim-speed')?.value ?? 600);
  simTimer = setInterval(() => {
    sim.step();
    renderWave();
    syncSimToCanvas();
  }, speed);
  updateRunButton();
  // 跑一段就停，避免波形无限增长
  if (sim.stepCount >= 60) stopRun();
}

function stopRun() {
  simRunning = false;
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
  }
  updateRunButton();
  renderStatus();
}

function updateRunButton() {
  const btn = $('#sim-run-btn');
  const label = $('#sim-run-label');
  if (btn) btn.classList.toggle('is-active', simRunning);
  if (label) label.textContent = simRunning ? '暂停' : '运行';
}

// ============================================================
// 表达式
// ============================================================

function renderExpressions(customs: Map<string, CustomBox>) {
  const body = $('#expr-body');
  const verify = $('#verify');
  if (!body) return;

  const expr = generateExpressions(bench.circuit, { deMorgan }, customs);

  if (expr.outputs.length === 0) {
    body.innerHTML = `<p class="lc-hint">${escapeHtml(expr.warnings[0] ?? '连好电路后这里会显示推导出的表达式。')}</p>`;
    if (verify) verify.hidden = true;
    return;
  }

  const parts: string[] = [];

  if (expr.terms.length > 0) {
    parts.push('<div class="lc-expr-terms">');
    for (const t of expr.terms) {
      parts.push(
        `<div class="lc-expr-row"><span class="lc-expr-lhs">${escapeHtml(t.label)} =</span><span>${escapeHtml(t.text)}</span></div>`
      );
    }
    parts.push('</div>');
  }

  parts.push('<div class="lc-expr">');
  for (const o of expr.outputs) {
    parts.push(
      `<div class="lc-expr-row"><span class="lc-expr-lhs">${escapeHtml(o.label)} =</span><span>${escapeHtml(o.text || '（未连接）')}</span></div>`
    );
  }
  parts.push('</div>');

  // KaTeX
  const katexRows = expr.outputs
    .filter((o) => o.text)
    .map((o) => {
      try {
        return `<div class="mb-1" data-tex="${escapeAttr(toLatex(`${o.label} = ${o.text}`))}"></div>`;
      } catch {
        return '';
      }
    })
    .join('');
  if (katexRows) parts.push(`<div class="lc-katex" id="expr-katex">${katexRows}</div>`);

  body.innerHTML = parts.join('');

  const katexHost = document.querySelector('#expr-katex');
  katexHost?.querySelectorAll<HTMLElement>('[data-tex]').forEach((el) => {
    try {
      katex.render(el.getAttribute('data-tex') ?? '', el, { throwOnError: false });
    } catch {
      /* 渲染失败就保留文本 */
    }
  });

  // 自检
  if (verify) {
    const res = verifyExpressions(bench.circuit, expr, customs);
    if (!res.checked) {
      verify.hidden = true;
    } else {
      verify.hidden = false;
      verify.className = `lc-verify ${res.ok ? 'is-ok' : 'is-bad'}`;
      verify.textContent = res.ok
        ? `✓ 已校验 ${res.checked} 个格子，表达式与电路一致`
        : `✗ 第 ${res.firstFail!.row + 1} 行「${res.firstFail!.column}」不一致：表达式算出 ${res.firstFail!.expr}，电路是 ${res.firstFail!.circuit}`;
    }
  }
}

function expressionPlainText(): string {
  const expr = generateExpressions(bench.circuit, { deMorgan }, customsMap());
  const lines = expr.terms.map((t) => `${t.label} = ${t.text}`);
  lines.push(...expr.outputs.map((o) => `${o.label} = ${o.text}`));
  return lines.join('\n');
}

// ============================================================
// 元件库
// ============================================================

function chipHtml(kind: GateKind): string {
  const def = gateDef(kind);
  // 用与画布同一份符号定义，保证两边一致
  const spec = symbolFor({
    id: '',
    type: kind,
    x: 0,
    y: 0,
    inputs: def.inputs,
    outputs: def.outputs,
  });
  const sym = spec.qualifier || def.label.slice(0, 2);
  return (
    `<div class="lc-chip" draggable="true" data-gate="${kind}" title="${escapeAttr(def.hint ?? def.label)}">` +
    `<span class="lc-chip-sym" data-shape="${spec.shape}" data-bubble="${spec.bubble ?? ''}">${escapeHtml(sym)}</span>` +
    `<span class="lc-chip-text"><b>${escapeHtml(def.label)}</b><i>${escapeHtml(def.hint ?? '')}</i></span>` +
    `</div>`
  );
}

function renderPalette() {
  const host = $('#palette');
  if (!host) return;
  host.innerHTML =
    PALETTE_GROUPS.map(
      (g) =>
        `<div class="lc-palette-group">` +
        `<div class="lc-palette-title">${escapeHtml(g.title)}</div>` +
        g.kinds.map(chipHtml).join('') +
        `</div>`
    ).join('') +
    // 自定义黑盒
    `<div class="lc-palette-group">` +
    `<div class="lc-palette-title">自定义</div>` +
    `<button type="button" class="lc-chip is-btn" data-act="custom">` +
    `<span class="lc-chip-sym" data-shape="box">?</span>` +
    `<span class="lc-chip-text"><b>新建黑盒</b><i>自己填真值表</i></span></button>` +
    `<div id="custom-list" class="lc-palette-group"></div>` +
    `</div>`;
  renderCustomPalette();
}

function renderCustomPalette() {
  const host = $('#custom-list');
  if (!host) return;
  const boxes = listCustoms();
  if (boxes.length === 0) {
    host.innerHTML = '<p class="lc-hint">还没有自定义元件</p>';
    return;
  }
  host.innerHTML = boxes
    .map(
      (b) =>
        `<div class="lc-chip" draggable="true" data-gate="CUSTOM" data-custom-id="${escapeAttr(b.id)}" ` +
        `title="${escapeAttr(b.name)}：${b.inputs} 入 ${b.outputs} 出">` +
        `<span class="lc-chip-sym" data-shape="box">#</span>` +
        `<span class="lc-chip-text"><b>${escapeHtml(b.name)}</b><i>${b.inputs} 入 ${b.outputs} 出</i></span></div>`
    )
    .join('');
}

function bindPaletteDrag() {
  const palette = $('#palette');
  if (!palette) return;

  palette.addEventListener('dragstart', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-gate]') as HTMLElement | null;
    if (!chip) return;
    e.dataTransfer?.setData('application/x-logic-gate', chip.dataset.gate!);
    bench.pendingCustomId = chip.dataset.customId ?? '';
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  });

  palette.addEventListener('dragend', () => {
    bench.pendingCustomId = '';
  });

  // 点击直接放到视口里的空位（比拖拽更适合触屏）
  palette.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-gate]') as HTMLElement | null;
    if (!chip) return;
    const kind = chip.dataset.gate as GateKind;
    bench.pendingCustomId = chip.dataset.customId ?? '';
    const node = bench.makeNode(kind, 0, 0);
    const spot = findFreeSpot(bench.circuit.nodes, node.inputs, node.outputs);
    bench.placeNode(node, spot.x, spot.y);
    bench.pendingCustomId = '';
    closePalette();
  });
}

/**
 * 在现有元件周围找一个不重叠的空位
 *
 * 从视口中心开始螺旋往外找，步进加大 —— 简单但足够好用，
 * 避免新元件直接压在旧元件上（之前固定放中心会重叠）。
 */
function findFreeSpot(
  nodes: { x: number; y: number }[],
  inputs: number,
  outputs: number
): { x: number; y: number } {
  const rect = ($('.lc-vp') as HTMLElement)?.getBoundingClientRect();
  const z = bench.getZoom();
  const pan = bench.getPan();
  const cx = rect ? (rect.width / 2 - pan.x) / z : 200;
  const cy = rect ? (rect.height / 2 - pan.y) / z : 150;

  // 估算新元件的占位尺寸（与 bench 的 metric 保持同一量级）
  const ports = Math.max(1, inputs, outputs);
  const w = ports > 4 ? 102 : 84;
  const h = Math.max(56, ports * 18 + 22);
  const gap = 34;

  const overlaps = (x: number, y: number) =>
    nodes.some((n) => {
      // 已有元件的尺寸未知，用一个保守的最小盒子判断
      const nw = 90;
      const nh = Math.max(56, 18 * 4 + 22);
      return (
        x < n.x + nw + gap &&
        x + w + gap > n.x &&
        y < n.y + nh + gap &&
        y + h + gap > n.y
      );
    });

  if (!overlaps(cx, cy)) return { x: Math.round(cx), y: Math.round(cy) };

  // 螺旋往外找
  for (let ring = 1; ring <= 8; ring += 1) {
    const step = ring * 70;
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        // 只看这个环的边界
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = Math.round(cx + dx * step);
        const y = Math.round(cy + dy * step);
        if (!overlaps(x, y)) return { x, y };
      }
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

// ============================================================
// 抽屉
// ============================================================

function openPalette() {
  const d = $<HTMLElement>('#palette-drawer');
  const btn = $<HTMLElement>('#palette-toggle');
  if (!d) return;
  d.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
}

function closePalette() {
  const d = $<HTMLElement>('#palette-drawer');
  const btn = $<HTMLElement>('#palette-toggle');
  if (!d) return;
  d.hidden = true;
  btn?.setAttribute('aria-expanded', 'false');
}

function openInspector() {
  const d = $<HTMLElement>('#inspector-drawer');
  if (d) d.hidden = false;
}

function closeInspector() {
  const d = $<HTMLElement>('#inspector-drawer');
  if (d) d.hidden = true;
  inspectorPinned = false;
}

function toggleBottom() {
  const p = $<HTMLElement>('#bottom-panel');
  const btn = $<HTMLElement>('#bottom-toggle');
  if (!p) return;
  p.hidden = !p.hidden;
  btn?.setAttribute('aria-expanded', String(!p.hidden));
  if (!p.hidden) renderWave();
}

// ============================================================
// Tabs
// ============================================================

function bindTabs() {
  document.querySelectorAll('.lc-tab').forEach((t) => {
    t.addEventListener('click', () => {
      activeTab = (t as HTMLElement).dataset.tab as typeof activeTab;
      syncTabs();
    });
  });

  // 移动端底部 tab
  document.querySelectorAll('.lc-mtab').forEach((t) => {
    t.addEventListener('click', () => {
      const mt = (t as HTMLElement).dataset.mtab!;
      document.querySelectorAll('.lc-mtab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      if (mt === 'palette') {
        const d = $<HTMLElement>('#palette-drawer');
        if (d) d.hidden = false;
      } else {
        activeTab = mt as typeof activeTab;
        const p = $<HTMLElement>('#bottom-panel');
        if (p) p.hidden = false;
        syncTabs();
      }
    });
  });
}

function syncTabs() {
  document.querySelectorAll('.lc-tab').forEach((t) => {
    t.classList.toggle('is-active', (t as HTMLElement).dataset.tab === activeTab);
  });
  document.querySelectorAll('.lc-bottom-body').forEach((b) => {
    (b as HTMLElement).hidden = (b as HTMLElement).dataset.pane !== activeTab;
  });
  if (activeTab === 'wave') renderWave();
}

// ============================================================
// 检视面板
// ============================================================

function renderInspector() {
  const body = $('#inspector-body');
  if (!body) return;

  const sel = bench.getSelection();
  if (sel.kind !== 'node' || !sel.id) {
    const edgeSel = sel.kind === 'edge';
    body.innerHTML = `<p class="lc-hint">${
      edgeSel
        ? '选中了一根连线。按 Delete 删除它。'
        : '点画布上的元件，这里可以改名字、调端口数、改开关状态。'
    }</p>`;
    if (!inspectorPinned) closeInspector();
    return;
  }

  const node = bench.findNode(sel.id);
  if (!node) return;
  if (!inspectorPinned) openInspector();

  const def = gateDef(node.type);
  const parts: string[] = [];
  parts.push(
    `<p class="lc-node-meta">${escapeHtml(def.label)}${def.hint ? ' · ' + escapeHtml(def.hint) : ''}</p>`
  );

  // 名称
  if (node.type === 'INPUT' || node.type === 'OUTPUT' || node.type === 'PROBE') {
    parts.push(
      `<label class="lc-field"><span>名称</span><input type="text" id="ins-name" maxlength="12" value="${escapeAttr(node.name ?? '')}" /></label>`
    );
  }

  // 可调输入端口数
  if (def.adjustableInputs) {
    const opts = [2, 3, 4]
      .map((k) => `<option value="${k}"${node.inputs === k ? ' selected' : ''}>${k}</option>`)
      .join('');
    parts.push(`<label class="lc-field"><span>输入端口数</span><select id="ins-inputs">${opts}</select></label>`);
  }

  // 开关 / 常量的值
  if (node.type === 'SWITCH') {
    parts.push(
      `<label class="lc-field"><span>开关状态</span><select id="ins-switch">` +
        `<option value="0"${!node.switchValue ? ' selected' : ''}>0</option>` +
        `<option value="1"${node.switchValue ? ' selected' : ''}>1</option></select></label>`
    );
  }
  if (node.type === 'CONST') {
    parts.push(
      `<label class="lc-field"><span>常量值</span><select id="ins-const">` +
        `<option value="0"${!node.constValue ? ' selected' : ''}>0</option>` +
        `<option value="1"${node.constValue ? ' selected' : ''}>1</option></select></label>`
    );
  }

  // DFF 输出口数
  if (node.type === 'DFF') {
    parts.push(
      `<label class="lc-field"><span>输出口</span><select id="ins-outputs">` +
        `<option value="1"${node.outputs === 1 ? ' selected' : ''}>只出 Q</option>` +
        `<option value="2"${node.outputs === 2 ? ' selected' : ''}>Q 和 /Q</option></select></label>`
    );
  }

  // 时序元件的触发沿
  if (node.type === 'DFF' || node.type === 'JK' || node.type === 'T') {
    const edge = node.edge ?? 'rising';
    parts.push(
      `<label class="lc-field"><span>触发沿</span><select id="ins-edge">` +
        `<option value="rising"${edge === 'rising' ? ' selected' : ''}>上升沿 ↑</option>` +
        `<option value="falling"${edge === 'falling' ? ' selected' : ''}>下降沿 ↓</option></select></label>`
    );
  }

  // 输入固定值（pin）
  if (node.type === 'INPUT') {
    parts.push(
      `<div class="lc-field-row"><span>固定为常量<em class="lc-hint block">固定的输入不进真值表列</em></span>` +
        `<input type="checkbox" id="ins-pin"${node.pinned ? ' checked' : ''} /></div>`
    );
    if (node.pinned) {
      parts.push(
        `<label class="lc-field"><span>固定值</span><select id="ins-pinval">` +
          `<option value="0"${!node.pinnedValue ? ' selected' : ''}>0</option>` +
          `<option value="1"${node.pinnedValue ? ' selected' : ''}>1</option></select></label>`
      );
    }
  }

  // 端口数超限提示
  if (node.type === 'INPUT' && !node.pinned) {
    const free = bench.circuit.nodes.filter((n) => n.type === 'INPUT' && !n.pinned).length;
    if (free > 4) {
      parts.push(
        `<p class="lc-error">未固定的输入共 ${free} 个，超过 4 个上限。把多余的固定成 0 或 1 就能继续。</p>`
      );
    }
  }

  parts.push(
    `<button type="button" data-act="delete-node" class="lc-btn lc-btn-danger mt-2 w-full justify-center">` +
      `<span class="text-xs">删除这个元件</span></button>`
  );

  body.innerHTML = parts.join('');
  bindInspectorFields(node);
}

function bindInspectorFields(node: LogicNode) {
  document.querySelector('#ins-name')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { name: (e.target as HTMLInputElement).value.trim() || undefined });
  });
  document.querySelector('#ins-inputs')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { inputs: Number((e.target as HTMLSelectElement).value) });
  });
  document.querySelector('#ins-switch')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { switchValue: (e.target as HTMLSelectElement).value === '1' });
  });
  document.querySelector('#ins-const')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { constValue: (e.target as HTMLSelectElement).value === '1' });
  });
  document.querySelector('#ins-outputs')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { outputs: Number((e.target as HTMLSelectElement).value) });
  });
  document.querySelector('#ins-edge')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, {
      edge: (e.target as HTMLSelectElement).value === 'falling' ? 'falling' : 'rising',
    });
  });
  document.querySelector('#ins-pin')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    bench.updateNode(node.id, {
      pinned: on,
      pinnedValue: on ? (node.pinnedValue ?? false) : undefined,
    });
    renderInspector();
  });
  document.querySelector('#ins-pinval')?.addEventListener('change', (e) => {
    bench.updateNode(node.id, { pinnedValue: (e.target as HTMLSelectElement).value === '1' });
  });
}

// ============================================================
// 工具栏
// ============================================================

function bindToolbar() {
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;

    switch (t.dataset.act) {
      case 'undo': bench.undo(); break;
      case 'redo': bench.redo(); break;
      case 'clear':
        if (confirm('清空画布？可以用撤销找回。')) bench.clearAll();
        break;
      case 'export':
        downloadText(stampFilename('logic-circuit'), exportCircuit(bench.circuit));
        toast('电路已导出为 JSON');
        break;
      case 'import': void doImport(); break;
      case 'preset': openPresetDialog(); break;
      case 'custom': openCustomDialog(); break;

      // 抽屉
      case 'close-palette': closePalette(); break;
      case 'close-inspector': closeInspector(); break;
      case 'close-bottom': toggleBottom(); break;

      // 缩放
      case 'zoom-in': bench.zoomBy(1.15); break;
      case 'zoom-out': bench.zoomBy(1 / 1.15); break;
      case 'fit': bench.fitToView(); break;
      case 'reset-view': bench.resetView(); break;

      // 仿真
      case 'sim-step': simStep(); break;
      case 'sim-run': toggleRun(); break;
      case 'sim-reset': simReset(); break;

      case 'copy-expr': void copyExpr(); break;
      default: break;
    }
  });

  document.querySelector('#palette-toggle')?.addEventListener('click', () => {
    const d = $<HTMLElement>('#palette-drawer');
    if (d?.hidden) openPalette();
    else closePalette();
  });

  document.querySelector('#bottom-toggle')?.addEventListener('click', () => {
    toggleBottom();
  });

  // 点画布空白 → 收起元件库
  document.querySelector('.lc-vp')?.addEventListener('pointerdown', () => {
    closePalette();
  });

  const dm = $<HTMLInputElement>('#dm-toggle');
  dm?.addEventListener('change', () => {
    deMorgan = dm.checked;
    renderExpressions(customsMap());
  });

  const speed = $<HTMLSelectElement>('#sim-speed');
  speed?.addEventListener('change', () => {
    if (simRunning) {
      stopRun();
      toggleRun();
    }
  });
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    const inField =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) bench.redo();
      else bench.undo();
      return;
    }
    if (inField) return;

    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        bench.deleteSelection();
        break;
      case ' ':
        e.preventDefault();
        if (mode === 'wave') simStep();
        break;
      case 'Escape':
        closePalette();
        closeInspector();
        bench.select(null, null);
        break;
      default:
        break;
    }
  });
}

// ============================================================
// 示例电路弹窗
// ============================================================

function openPresetDialog() {
  const dlg = $<HTMLDialogElement>('#dlg-preset');
  const list = $('#preset-list');
  if (!dlg || !list) return;

  list.innerHTML = PRESETS.map(
    (p) =>
      `<button type="button" class="lc-dlg-item" data-preset="${p.key}">` +
      `<span class="lc-dlg-item-body"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.desc)}</span></span></button>`
  ).join('');

  list.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.key === (btn as HTMLElement).dataset.preset);
      if (!p) return;
      stopRun();
      bench.replaceCircuit(p.make());
      sim.setCircuit(bench.circuit, customsMap());
      currentRow = -1;
      dlg.close();
      // 自动打开底部面板：组合电路看真值表，时序电路看波形
      if (mode === 'wave') activeTab = 'wave';
      else activeTab = 'table';
      const bottom = $<HTMLElement>('#bottom-panel');
      if (bottom?.hidden) toggleBottom();
      syncTabs();
      toast(`已载入「${p.name}」`);
    });
  });

  dlg.showModal();
}

// ============================================================
// 自定义黑盒弹窗
// ============================================================

function openCustomDialog() {
  const dlg = $<HTMLDialogElement>('#dlg-custom');
  if (!dlg) return;
  editingCustom = null;
  ($('#cx-name') as HTMLInputElement).value = '';
  ($('#cx-in') as HTMLSelectElement).value = '2';
  ($('#cx-out') as HTMLSelectElement).value = '1';
  const err = $('#cx-error')!;
  err.hidden = true;
  renderCustomTable(blankTable(2, 1));
  renderCustomList();
  dlg.showModal();
}

function currentCxDims() {
  return {
    inputs: Number(($('#cx-in') as HTMLSelectElement).value),
    outputs: Number(($('#cx-out') as HTMLSelectElement).value),
  };
}

function readCxTable(): boolean[][] {
  const rows: boolean[][] = [];
  document.querySelectorAll<HTMLElement>('#cx-table tr[data-row]').forEach((tr) => {
    const row: boolean[] = [];
    tr.querySelectorAll<HTMLElement>('[data-cell]').forEach((td) => {
      row.push(td.classList.contains('is-1'));
    });
    rows.push(row);
  });
  return rows;
}

function renderCustomTable(table: boolean[][]) {
  const host = $('#cx-table');
  if (!host) return;
  const { outputs } = currentCxDims();

  let html = '<table><thead><tr><th></th>';
  for (let p = 0; p < outputs; p += 1) html += `<th>${p === 0 ? 'Y' : `Y${p}`}</th>`;
  html += '</tr></thead><tbody>';

  table.forEach((row, r) => {
    let bits = '';
    for (let p = 0; p < row.length; p += 1) bits += row[p] ? '1' : '0';
    html += `<tr data-row="${r}"><td class="row-head">${bits}</td>`;
    for (let p = 0; p < outputs; p += 1) {
      const v = row[p] ? 1 : 0;
      html += `<td><span class="lc-tt-cell${v ? ' is-1' : ''}" data-cell="${p}">${v}</span></td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  host.innerHTML = html;

  host.querySelectorAll<HTMLElement>('[data-cell]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const table2 = readCxTable();
      const r = Number(cell.closest('tr')!.dataset.row);
      const p = Number(cell.dataset.cell);
      table2[r][p] = !table2[r][p];
      renderCustomTable(table2);
    });
  });
}

function renderCustomList() {
  const list = $('#cx-list');
  if (!list) return;
  const boxes = listCustoms();
  if (boxes.length === 0) {
    list.innerHTML = '<p class="lc-hint">还没有自定义元件。填好上面的表，点「保存元件」。</p>';
    return;
  }
  list.innerHTML = boxes
    .map(
      (b) =>
        `<div class="lc-dlg-item" style="cursor:default">` +
        `<span class="lc-dlg-item-body"><b>${escapeHtml(b.name)}</b>` +
        `<span>${b.inputs} 个输入 · ${b.outputs} 个输出 · ${b.table.length} 行真值表</span></span>` +
        `<button type="button" class="lc-btn lc-btn-sm lc-btn-danger" data-del-cx="${escapeAttr(b.id)}">` +
        `<span class="text-xs">删除</span></button></div>`
    )
    .join('');

  list.querySelectorAll('[data-del-cx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.delCx!;
      const box = listCustoms().find((b) => b.id === id);
      if (!box) return;
      if (!confirm(`删除自定义元件「${box.name}」？`)) return;
      deleteCustom(id);
      renderCustomList();
      renderCustomPalette();
      bench.circuit.nodes
        .filter((n) => n.type === 'CUSTOM' && n.customId === id)
        .forEach((n) => bench.updateNode(n.id, { customId: undefined }, false));
      bench.renderAll();
    });
  });
}

function bindCustomDialog() {
  const ins = $<HTMLSelectElement>('#cx-in');
  const outs = $<HTMLSelectElement>('#cx-out');
  const regen = () => {
    const { inputs, outputs } = currentCxDims();
    const old = readCxTable();
    const table =
      old.length === 2 ** inputs && old.every((r) => r.length === outputs)
        ? old
        : blankTable(inputs, outputs);
    renderCustomTable(table);
  };
  ins?.addEventListener('change', regen);
  outs?.addEventListener('change', regen);

  document.querySelector('#cx-save')?.addEventListener('click', () => {
    const name = ($('#cx-name') as HTMLInputElement).value.trim();
    const { inputs, outputs } = currentCxDims();
    const table = readCxTable();

    const errEl = $('#cx-error')!;
    const err = validateBox(name, inputs, outputs, table);
    if (err) {
      errEl.textContent = err;
      errEl.hidden = false;
      return;
    }
    if (nameTaken(name, editingCustom?.id)) {
      errEl.textContent = `已经有叫「${name}」的元件了，换个名字`;
      errEl.hidden = false;
      return;
    }

    saveCustom({ id: editingCustom?.id ?? newCustomId(), name, inputs, outputs, table });
    errEl.hidden = true;
    renderCustomList();
    renderCustomPalette();
    ($('#dlg-custom') as HTMLDialogElement).close();
    toast(`已保存「${name}」，可以从元件库拖到画布上`);
  });

  document.querySelector('#cx-export')?.addEventListener('click', () => {
    downloadText(stampFilename('logic-customs'), exportCustoms());
    toast('元件库已导出');
  });

  document.querySelector('#cx-import')?.addEventListener('click', () => {
    void (async () => {
      const text = await pickTextFile();
      if (text === null) return;
      const res = importCustoms(text);
      if (res.ok) {
        renderCustomList();
        renderCustomPalette();
        toast(`导入成功：新增 ${res.added} 个${res.renamed ? `，${res.renamed} 个自动改名` : ''}`);
      } else {
        const errEl = $('#cx-error')!;
        errEl.textContent = res.error ?? '导入失败';
        errEl.hidden = false;
      }
    })();
  });

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => (b.closest('dialog') as HTMLDialogElement)?.close());
  });
}

async function doImport() {
  const text = await pickTextFile();
  if (text === null) return;
  const res = importCircuit(text);
  if (res.ok && res.circuit) {
    bench.replaceCircuit(res.circuit);
    sim.setCircuit(bench.circuit, customsMap());
    toast('电路已导入');
  } else {
    toast(res.error ?? '导入失败', true);
  }
}

async function copyExpr() {
  try {
    await navigator.clipboard.writeText(expressionPlainText());
    toast('表达式已复制');
  } catch {
    toast('复制失败，浏览器不允许访问剪贴板', true);
  }
}

// ============================================================
// 工具
// ============================================================

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string, isErr = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `lc-toast${isErr ? ' is-err' : ''}`;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

boot();