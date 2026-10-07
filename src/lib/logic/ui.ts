/**
 * 逻辑电路实验台 —— 页面 UI 装配层
 *
 * 职责边界：
 * - bench.ts管画布与电路数据（DOM 重）
 * - 纯逻辑模块管求值/ 真值表 / 表达式（无 DOM）
 * - 这个文件负责把三者接起来，并渲染右侧面板
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
import { gateDef } from './gates';
import { generateExpressions, toLatex, verifyExpressions } from './expression';
import { evaluate } from './evaluate';
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
import { buildTruthTable } from './truthtable';
import type { TruthTable } from './truthtable';
import { MAX_ENUM_INPUTS } from './types';
import type { Circuit, CustomBox, LogicNode } from './types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector<T>(sel) as T;

const canvasHost = $('#canvas');
if (!canvasHost) throw new Error('找不到画布挂载点 #canvas');

// ============================================================
// 状态
// ============================================================

let bench: LogicBench;
let tt: TruthTable = buildTruthTable({ schema: 'logic-circuit', version: 1, nodes: [], edges: [] });
let currentRow = -1;
let playing = false;
let playTimer: ReturnType<typeof setInterval> | null = null;
let deMorgan = false;
let editingCustom: CustomBox | null = null;

// ============================================================
// 初始化
// ============================================================

function boot() {
  const draft = loadDraft();
  bench = new LogicBench(canvasHost, draft ?? PRESETS[0].make());

  bench.customLookup = (id) => {
    const box = listCustoms().find((b) => b.id === id);
    return box ? { id: box.id, name: box.name, inputs: box.inputs, outputs: box.outputs } : undefined;
  };

  bench.onChange(onBenchChange);
  bench.fitToView();

  bindToolbar();
  bindKeyboard();
  bindPaletteDrag();
  bindCustomDialog();
  bindInspectorEvents();

  window.addEventListener('beforeunload', () => flushDraft(bench.circuit));

  refreshAll();
}

// ============================================================
// 变化处理：一次改动 → 重算真值表 + 表达式 + 重绘面板
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
  clampCurrentRow();
  refreshAll();
}

function clampCurrentRow() {
  const max = tt.rows.length - 1;
  if (max < 0) {
    currentRow = -1;
  } else if (currentRow > max) {
    currentRow = max;
  } else if (currentRow < 0) {
    currentRow = 0;
  }
}

function refreshAll() {
  const customs = customsMap();
  tt = buildTruthTable(bench.circuit, customs);

  renderStatus();
  renderTruthTable();
  renderExpressions(customs);
  renderInspector();
  updateToolbarState();
  updateZoomLabel();
  updateEmptyHint();
  updatePlayhead();
}

// ============================================================
// 顶部状态
// ============================================================

function renderStatus() {
  const wrap = $('#status');
  const text = $('#status-text');
  if (!wrap || !text) return;

  wrap.classList.remove('is-warn', 'is-err');

  if (bench.hasCycle()) {
    wrap.classList.add('is-err');
    const ids = bench.getCycleNodes();
    const names = ids
      .map((id) => bench.findNode(id))
      .filter((n): n is LogicNode => !!n)
      .map((n) => n.name ?? gateDef(n.type).label);
    text.textContent = `检测到环路（${names.slice(0, 3).join('、')}${names.length > 3 ? '…' : ''}），求值器不会陷入死循环，真值表无法计算`;
    return;
  }
  if (tt.error) {
    wrap.classList.add('is-warn');
    text.textContent = tt.error;
    return;
  }
  const nNodes = bench.circuit.nodes.length;
  const nOut = bench.circuit.nodes.filter((n) => n.type === 'OUTPUT').length;
  text.textContent = `${nNodes} 个元件 · ${bench.circuit.edges.length} 根连线 · ${nOut} 个输出 · 真值表 ${tt.rows.length} 行`;
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

function updatePlayhead() {
  // 真值表当前行高亮
  document.querySelectorAll('#tt-wrap tbody tr').forEach((tr) => {
    tr.classList.toggle('is-current', Number((tr as HTMLElement).dataset.row) === currentRow);
  });

  const row = currentRow >= 0 ? tt.rows[currentRow] : undefined;
  const ind = $('#row-indicator');
  if (ind) {
    ind.textContent = tt.rows.length
      ? `第 ${currentRow + 1} / ${tt.rows.length} 行`
      : '共 0 行';
  }

  // 把这一行的值画到电路里
  if (row && !bench.hasCycle()) {
    bench.setLiveValues(evaluate(bench.circuit, row.assign, customsMap()).values);
  } else {
    bench.setLiveValues(null);
  }

  const playIcon = document.querySelector<HTMLElement>('#play-icon');
  const playLabel = $('#play-label');
  if (playIcon) {
    // astro-icon 已经渲染完，改 data-icon 不会触发重渲染，
    // 所以直接换图标节点的显示状态，文字标签负责表达状态
    playIcon.style.display = playing ? 'none' : '';
  }
  if (playLabel) playLabel.textContent = playing ? '暂停' : '播放';
}

// ============================================================
// 真值表渲染
// ============================================================

function renderTruthTable() {
  const wrap = $('#tt-wrap');
  const badge = $('#tt-badge');
  if (!wrap) return;

  if (tt.pinnedInputs.length) {
    if (badge) {
      badge.textContent = `固定 ${tt.pinnedInputs.map((p) => `${p.name}=${p.value ? 1 : 0}`).join(' ')}`;
    }
  } else if (badge) {
    const free = tt.columns.length - tt.outputCount;
    badge.textContent = `${free} 个输入变量`;
  }

  if (tt.rows.length === 0) {
    wrap.innerHTML = `<p class="lc-hint p-3">${escapeHtml(tt.error ?? '先放几个输入和输出元件。')}</p>`;
    return;
  }

  const inputCols = tt.columns.length - tt.outputCount;
  const parts: string[] = [];

  parts.push('<table><thead><tr>');
  for (let i = 0; i < inputCols; i += 1) {
    parts.push(`<th class="is-input">${escapeHtml(tt.columns[i])}</th>`);
  }
  if (tt.outputCount > 0) {
    parts.push('<th class="is-out-divider lc-divider"></th>');
    for (let i = inputCols; i < tt.columns.length; i += 1) {
      parts.push(`<th class="is-output">${escapeHtml(tt.columns[i])}</th>`);
    }
  }
  parts.push('</tr></thead><tbody>');

  for (const row of tt.rows) {
    parts.push(`<tr data-row="${row.index}">`);
    row.inputs.forEach((v) => parts.push(`<td class="td-in">${v ? 1 : 0}</td>`));
    if (tt.outputCount > 0) {
      parts.push('<td class="lc-divider"></td>');
      row.outputs.forEach((v) => parts.push(`<td class="td-out">${v ? 1 : 0}</td>`));
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');

  wrap.innerHTML = parts.join('');

  // 点行 → 跳到该行
  wrap.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      currentRow = Number((tr as HTMLElement).dataset.row);
      stopPlay();
      updatePlayhead();
      renderTruthTableSelection();
    });
  });
}

/** 只更新高亮，避免整表重绘打断滚动位置 */
function renderTruthTableSelection() {
  document.querySelectorAll('#tt-wrap tbody tr').forEach((tr) => {
    tr.classList.toggle('is-current', Number((tr as HTMLElement).dataset.row) === currentRow);
  });
  const ind = $('#row-indicator');
  if (ind && tt.rows.length) ind.textContent = `第 ${currentRow + 1} / ${tt.rows.length} 行`;
}

// ============================================================
// 表达式渲染
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

  // 中间变量（共享子式）
  if (expr.terms.length > 0) {
    parts.push('<div class="lc-expr-terms">');
    for (const t of expr.terms) {
      parts.push(
        `<div class="lc-expr-row"><span class="lc-expr-lhs">${escapeHtml(t.label)} =</span><span>${escapeHtml(t.text)}</span></div>`
      );
    }
    parts.push('</div>');
  }

  // 各输出
  parts.push('<div class="lc-expr">');
  for (const o of expr.outputs) {
    parts.push(
      `<div class="lc-expr-row"><span class="lc-expr-lhs">${escapeHtml(o.label)} =</span><span>${escapeHtml(o.text || '（未连接）')}</span></div>`
    );
  }
  parts.push('</div>');

  // KaTeX 版：data-tex 里放原始 LaTeX，插入 DOM 后再渲染
  const katexRows = expr.outputs
    .filter((o) => o.text)
    .map((o) => {
      try {
        const tex = toLatex(`${o.label} = ${o.text}`);
        return `<div class="mb-1" data-tex="${escapeAttr(tex)}"></div>`;
      } catch {
        return '';
      }
    })
    .join('');
  if (katexRows) {
    parts.push(`<div class="lc-katex" id="expr-katex">${katexRows}</div>`);
  }

  body.innerHTML = parts.join('');

  // 渲染 KaTeX
  const katexHost = document.querySelector('#expr-katex');
  if (katexHost) {
    katexHost.querySelectorAll<HTMLElement>('[data-tex]').forEach((el) => {
      try {
        katex.render(el.getAttribute('data-tex') ?? '', el, { throwOnError: false });
      } catch {
        /* 渲染失败就保留文本 */
      }
    });
  }

  // 一致性自检
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

/** 供「复制表达式」使用 */
function expressionPlainText(): string {
  const expr = generateExpressions(bench.circuit, { deMorgan }, customsMap());
  const lines = expr.terms.map((t) => `${t.label} = ${t.text}`);
  lines.push(...expr.outputs.map((o) => `${o.label} = ${o.text}`));
  return lines.join('\n');
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
        : '点画布上的元件，这里可以改名字、调输入端口数、固定输入值。'
    }</p>`;
    return;
  }

  const node = bench.findNode(sel.id);
  if (!node) {
    body.innerHTML = '<p class="lc-hint">元件已被删除。</p>';
    return;
  }

  const def = gateDef(node.type);
  const parts: string[] = [];

  parts.push(
    `<p class="lc-node-meta">${escapeHtml(def.label)}${def.hint ? ' · ' + escapeHtml(def.hint) : ''}</p>`
  );

  // 名字
  if (node.type === 'INPUT' || node.type === 'OUTPUT' || node.type === 'CUSTOM') {
    const isCustom = node.type === 'CUSTOM';
    parts.push(`<label class="lc-field mb-2"><span>${isCustom ? '元件名（只读）' : '名称'}</span>
      <input type="text" id="ins-name" value="${escapeAttr(node.name ?? '')}" ${
        isCustom ? 'disabled' : 'maxlength="16"'
      } /></label>`);
  }

  // 输入端口数
  if (def.adjustableInputs) {
    parts.push(`<label class="lc-field mb-2"><span>输入端口数</span>
      <select id="ins-inputs">${[2, 3, 4]
        .map((k) => `<option value="${k}" ${node.inputs === k ? 'selected' : ''}>${k}</option>`)
        .join('')}</select></label>`);
  }

  // 常量值
  if (node.type === 'CONST') {
    parts.push(`<label class="lc-field mb-2"><span>常量值</span>
      <select id="ins-const">
        <option value="0" ${!node.constValue ? 'selected' : ''}>0</option>
        <option value="1" ${node.constValue ? 'selected' : ''}>1</option>
      </select></label>`);
  }

  // DFF 输出口数
  if (node.type === 'DFF') {
    parts.push(`<label class="lc-field mb-2"><span>输出口</span>
      <select id="ins-outputs">
        <option value="1" ${node.outputs === 1 ? 'selected' : ''}>只出 Q</option>
        <option value="2" ${node.outputs === 2 ? 'selected' : ''}>Q 和 /Q</option>
      </select></label>`);
  }

  // 输入固定值（pin）
  if (node.type === 'INPUT') {
    const pinned = !!node.pinned;
    parts.push(`<div class="lc-field-row">
      <span>固定为常量<em class="lc-hint block">固定的输入不进真值表列</em></span>
      <input type="checkbox" id="ins-pin" ${pinned ? 'checked' : ''} />
    </div>`);
    if (pinned) {
      parts.push(`<label class="lc-field mt-2"><span>固定值</span>
        <select id="ins-pinval">
          <option value="0" ${!node.pinnedValue ? 'selected' : ''}>0</option>
          <option value="1" ${node.pinnedValue ? 'selected' : ''}>1</option>
        </select></label>`);
    }
  }

  // 未固定输入数量提示
  if (node.type === 'INPUT') {
    const free = bench.circuit.nodes.filter((n) => n.type === 'INPUT' && !n.pinned).length;
    if (free > MAX_ENUM_INPUTS && !node.pinned) {
      parts.push(
        `<p class="lc-error">未固定的输入共 ${free} 个，超过 ${MAX_ENUM_INPUTS} 个上限。把多余的输入固定成 0 或 1 就能继续。</p>`
      );
    }
  }

  parts.push(
    `<button type="button" data-act="delete-node" class="lc-btn lc-btn-danger mt-2 w-full justify-center">
      <span class="text-xs">删除这个元件</span></button>`
  );

  body.innerHTML = parts.join('');

  // 绑定
  const nameEl = document.querySelector<HTMLInputElement>('#ins-name');
  nameEl?.addEventListener('change', () => {
    bench.updateNode(node.id, { name: nameEl.value.trim() || undefined });
  });

  const inputsEl = document.querySelector<HTMLSelectElement>('#ins-inputs');
  inputsEl?.addEventListener('change', () => {
    bench.updateNode(node.id, { inputs: Number(inputsEl.value) });
  });

  const constEl = document.querySelector<HTMLSelectElement>('#ins-const');
  constEl?.addEventListener('change', () => {
    bench.updateNode(node.id, { constValue: constEl.value === '1' });
  });

  const outputsEl = document.querySelector<HTMLSelectElement>('#ins-outputs');
  outputsEl?.addEventListener('change', () => {
    bench.updateNode(node.id, { outputs: Number(outputsEl.value) });
  });

  const pinEl = document.querySelector<HTMLInputElement>('#ins-pin');
  pinEl?.addEventListener('change', () => {
    bench.updateNode(node.id, {
      pinned: pinEl.checked,
      pinnedValue: pinEl.checked ? (node.pinnedValue ?? false) : undefined,
    });
    renderInspector();
  });

  const pinValEl = document.querySelector<HTMLSelectElement>('#ins-pinval');
  pinValEl?.addEventListener('change', () => {
    bench.updateNode(node.id, { pinnedValue: pinValEl.value === '1' });
  });

  body.querySelector('[data-act="delete-node"]')?.addEventListener('click', () => {
    bench.deleteSelection();
  });
}

function bindInspectorEvents() {
  // 检视面板的删除按钮是动态生成的，用事件委托兜住
  $('#inspector-body')?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.act === 'delete-node') bench.deleteSelection();
  });
}

// ============================================================
// 工具栏
// ============================================================

function bindToolbar() {
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act!;
    if (act === 'delete-node') return; // 检视面板自己处理

    switch (act) {
      case 'undo':
        bench.undo();
        break;
      case 'redo':
        bench.redo();
        break;
      case 'clear':
        if (confirm('清空画布？可以用撤销找回。')) bench.clearAll();
        break;
      case 'export': {
        downloadText(stampFilename('logic-circuit'), exportCircuit(bench.circuit));
        toast('电路已导出为 JSON');
        break;
      }
      case 'import': {
        void doImportCircuit();
        break;
      }
      case 'preset':
        openPresetDialog();
        break;
      case 'custom':
        openCustomDialog();
        break;
      case 'zoom-in':
        bench.zoomBy(1.15);
        break;
      case 'zoom-out':
        bench.zoomBy(1 / 1.15);
        break;
      case 'fit':
        bench.fitToView();
        break;
      case 'reset-view':
        bench.resetView();
        break;
      case 'first':
        stopPlay();
        currentRow = 0;
        updatePlayhead();
        renderTruthTableSelection();
        break;
      case 'prev':
        stopPlay();
        currentRow = Math.max(0, currentRow - 1);
        updatePlayhead();
        renderTruthTableSelection();
        break;
      case 'next':
        stopPlay();
        currentRow = Math.min(tt.rows.length - 1, currentRow + 1);
        updatePlayhead();
        renderTruthTableSelection();
        break;
      case 'play':
        togglePlay();
        break;
      case 'copy-expr':
        void copyExpr();
        break;
      default:
        break;
    }
  });

  // 德摩根开关
  const dm = $<HTMLInputElement>('#dm-toggle');
  dm?.addEventListener('change', () => {
    deMorgan = dm.checked;
    renderExpressions(customsMap());
  });

  // 播放速度
  const speed = $<HTMLSelectElement>('#speed');
  speed?.addEventListener('change', () => {
    if (playing) {
      stopPlay();
      togglePlay();
    }
  });

  // 弹窗关闭
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => (b.closest('dialog') as HTMLDialogElement)?.close());
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      bench.redo();
      return;
    }
    if (inField) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      bench.deleteSelection();
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      stopPlay();
      currentRow = Math.min(tt.rows.length - 1, currentRow + 1);
      updatePlayhead();
      renderTruthTableSelection();
    } else if (e.key === 'ArrowLeft') {
      stopPlay();
      currentRow = Math.max(0, currentRow - 1);
      updatePlayhead();
      renderTruthTableSelection();
    } else if (e.key === 'Escape') {
      bench.select(null, null);
    }
  });
}

// ============================================================
// 播放控制
// ============================================================

function togglePlay() {
  if (playing) {
    stopPlay();
    return;
  }
  if (tt.rows.length === 0) {
    toast('先搭一个能算出真值表的电路', true);
    return;
  }
  playing = true;
  const speed = Number($<HTMLSelectElement>('#speed')?.value ?? 700);
  playTimer = setInterval(() => {
    currentRow += 1;
    if (currentRow >= tt.rows.length) currentRow = 0;
    updatePlayhead();
    renderTruthTableSelection();
    scrollRowIntoView();
  }, speed);
  updatePlayhead();
  renderTruthTableSelection();
}

function stopPlay() {
  playing = false;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  updatePlayhead();
}

function scrollRowIntoView() {
  const tr = document.querySelector('#tt-wrap tbody tr.is-current') as HTMLElement | null;
  tr?.scrollIntoView({ block: 'nearest' });
}

// ============================================================
// 元件面板拖放
// ============================================================

function bindPaletteDrag() {
  const palette = $('#palette');
  if (!palette) return;

  palette.addEventListener('dragstart', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-gate]') as HTMLElement | null;
    if (!chip) return;
    const kind = chip.dataset.gate!;
    e.dataTransfer?.setData('application/x-logic-gate', kind);
    // 自定义元件：把 id 挂在 bench 上，drop 时用
    bench.pendingCustomId = chip.dataset.customId ?? '';
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  });

  palette.addEventListener('dragend', () => {
    bench.pendingCustomId = '';
  });
}

/** 渲染已保存的自定义元件到面板 */
function renderCustomPalette() {
  const host = $('#custom-list');
  if (!host) return;
  const boxes = listCustoms();
  if (boxes.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML =
    '<div class="lc-chip-sep"></div>' +
    boxes
      .map(
        (b) => `<div class="lc-chip" draggable="true" data-gate="CUSTOM" data-custom-id="${escapeAttr(b.id)}"
          title="已保存的自定义元件">
          <span class="lc-chip-glyph" data-glyph="custom"></span>
          <span class="lc-chip-text"><b>${escapeHtml(b.name)}</b><i>${b.inputs} 入 ${b.outputs} 出</i></span>
        </div>`
      )
      .join('');
}

// ============================================================
// 示例电路弹窗
// ============================================================

function openPresetDialog() {
  const dlg = $<HTMLDialogElement>('#dlg-preset');
  const list = $('#preset-list');
  if (!dlg || !list) return;

  list.innerHTML = PRESETS.map(
    (p) => `<button type="button" class="lc-dlg-item" data-preset="${p.key}">
      <span class="lc-dlg-item-body">
        <b>${escapeHtml(p.name)}</b>
        <span>${escapeHtml(p.desc)}</span>
      </span>
    </button>`
  ).join('');

  list.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find((x) => x.key === (btn as HTMLElement).dataset.preset);
      if (!p) return;
      bench.replaceCircuit(p.make());
      currentRow = 0;
      dlg.close();
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
  (<HTMLInputElement>($('#cx-name'))).value = '';
  (<HTMLSelectElement>($('#cx-in'))).value = '2';
  (<HTMLSelectElement>($('#cx-out'))).value = '1';
  $('#cx-error')!.hidden = true;
  renderCustomTable(blankTable(2, 1));
  renderCustomList();
  dlg.showModal();
}

function currentCxDims(): { inputs: number; outputs: number } {
  return {
    inputs: Number((<HTMLSelectElement>$('#cx-in')).value),
    outputs: Number((<HTMLSelectElement>$('#cx-out')).value),
  };
}

/** 当前编辑中的真值表数据（先从 DOM 读回来） */
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
      cell.classList.toggle('is-1');
      const r = Number(cell.closest('tr')!.dataset.row);
      const p = Number(cell.dataset.cell);
      const table2 = readCxTable();
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
      (b) => `<div class="lc-dlg-item" style="cursor:default">
        <span class="lc-dlg-item-body">
          <b>${escapeHtml(b.name)}</b>
          <span>${b.inputs} 个输入 · ${b.outputs} 个输出 · ${b.table.length} 行真值表</span>
        </span>
        <button type="button" class="lc-btn lc-btn-sm lc-btn-danger" data-del-cx="${escapeAttr(b.id)}">
          <span class="text-xs">删除</span>
        </button>
      </div>`
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
      // 画布上引用它的元件变空壳
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
    // 尽量保留已有的填写：尺寸一致就原样带过来
    const table =
      old.length === 2 ** inputs && old.every((r) => r.length === outputs)
        ? old
        : blankTable(inputs, outputs);
    renderCustomTable(table);
  };

  ins?.addEventListener('change', regen);
  outs?.addEventListener('change', regen);

  $('#cx-save')?.addEventListener('click', () => {
    const name = (<HTMLInputElement>$('#cx-name')).value.trim();
    const { inputs, outputs } = currentCxDims();
    const table = readCxTable();

    const err = validateBox(name, inputs, outputs, table);
    const errEl = $('#cx-error')!;
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

    saveCustom({
      id: editingCustom?.id ?? newCustomId(),
      name,
      inputs,
      outputs,
      table,
    });
    errEl.hidden = true;
    renderCustomList();
    renderCustomPalette();
    (<HTMLDialogElement>$('#dlg-custom')).close();
    toast(`已保存自定义元件「${name}」，可以从左侧拖到画布上`);
  });

  $('#cx-export')?.addEventListener('click', () => {
    downloadText(stampFilename('logic-customs'), exportCustoms());
    toast('元件库已导出');
  });

  $('#cx-import')?.addEventListener('click', () => {
    void (async () => {
      const text = await pickTextFile();
      if (text === null) return;
      const res = importCustoms(text);
      if (res.ok) {
        renderCustomList();
        renderCustomPalette();
        toast(`导入成功：新增 ${res.added} 个${res.renamed ? `，${res.renamed} 个因重名自动改名` : ''}`);
      } else {
        const errEl = $('#cx-error')!;
        errEl.textContent = res.error ?? '导入失败';
        errEl.hidden = false;
      }
    })();
  });

  renderCustomPalette();
}

async function doImportCircuit() {
  const text = await pickTextFile();
  if (text === null) return;
  const res = importCircuit(text);
  if (res.ok && res.circuit) {
    bench.replaceCircuit(res.circuit);
    currentRow = 0;
    toast('电路已导入');
  } else {
    toast(res.error ?? '导入失败', true);
  }
}

async function copyExpr() {
  try {
    await navigator.clipboard.writeText(expressionPlainText());
    toast('表达式已复制到剪贴板');
  } catch {
    toast('复制失败，浏览器不允许访问剪贴板', true);
  }
}

// ============================================================
// 工具函数
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

// Astro 视图过渡可能重挂载，直接跑即可
boot();