/**
 * 时序波形图 —— 页面装配与交互
 *
 * 这一层有 DOM 依赖，所以**故意不从 index.ts 导出**（避免 node 侧测试误引）。
 *
 * 交互设计围绕「你不是在画图，你是在改数据」这个前提：
 *   - 数字信号：拖边沿改时刻 / 点电平翻转 / 双击加边沿
 *   - 时钟：改周期，占空比，相位（参数驱动，边沿自动重算）
 *   - 总线：拖段边界 / 双击改值
 *   - 全部编辑走 undo 栈，改动即时重绘 + 自动存localStorage
 */

import { GEO, axisTicks, contentHeight, renderAll, rowTopOf, exportSVG } from './render';
import {
  addAnalog,
  addBus,
  addClock,
  addDigital,
  addMarker,
  addSpan,
  bumpIdSeq,
  canRedo,
  canUndo,
  clampTick,
  cloneDoc,
  crossHalfWidth,
  digitalLevelAt,
  formatTime,
  fromHex,
  type History,
  moveEdge,
  nearestEdge,
  normalize,
  pushHistory,
  removeEdge,
  removeMarker,
  removeSignal,
  removeSpan,
  reorderSignal,
  replaceSignal,
  snapTick,
  toHex,
  xToTick,
} from './model';
import { MAX_TICKS, TIME_UNITS, type AnalogSeg, type BusSeg, type ClockSeg, type DigitalSeg, type Signal, type Span, type TimingDoc } from './types';
import { PRESETS, emptyDoc, loadPreset, presetGroups } from './preset';
import * as store from './persist';

const PX_DEFAULT = 4; // 每 tick 像素
const PX_MIN = 1.5;
const PX_MAX = 24;

const KIND_LABEL: Record<Signal['kind'], string> = {
  digital: '数字',
  clock: '时钟',
  bus: '总线',
  analog: '模拟',
};

export class TimingEditor {
  private doc: TimingDoc;
  private hist: History = { past: [], future: [], limit: 80 };
  private px = PX_DEFAULT;
  /** 信号名列宽（可拖拽调整，持久化到 localStorage） */
  private nameW = GEO.nameW;
  private selId = '';
  /** 选中的边沿索引（-1 = 没选） */
  private selEdge = -1;
  private selMarker = '';
  private selSpan = '';
  private hint = '';

  /** 拖拽状态（波形边沿/游标/标注） */
  private drag: { kind: 'edge' | 'marker' | 'span1' | 'span2' | 'newmarker'; sigId: string; idx: number } | null = null;
  /** 列宽拖拽状态，与上面的波形拖拽互不干扰 */
  private resizeDrag: { startX: number; startW: number } | null = null;
  /** 手动双击判定：上一次手柄按下的时间戳与「第一次是否真的拖过」标记 */
  private lastResizeDown = 0;
  private resizeDragged = false;

  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private saveTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.doc = store.load() ?? emptyDoc();
    bumpIdSeq(this.doc);
    if (this.doc.signals.length > 0) this.selId = this.doc.signals[0].id;
    this.nameW = store.loadNameWidth(GEO.nameW);
    this.buildSkeleton();
    this.render();
  }

  // ==========================================================================
  // 骨架
  // ==========================================================================

  private buildSkeleton(): void {
    this.root.classList.add('tm-root');
    this.root.innerHTML = `
      <div class="tm-topbar">
        <a href="/projects" class="tm-back" title="返回项目列表" data-noop>
          <svg viewBox="0 0 24 24" class="tm-i"><path d="M19 12H5M12 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>项目</span>
        </a>
        <input class="tm-title" data-el="title" placeholder="未命名时序图" spellcheck="false" />
        <div class="tm-spacer"></div>
        <select class="tm-select" data-el="preset" title="载入预设"></select>
        <button class="tm-btn" data-act="undo" title="撤销 (Ctrl+Z)" disabled>
          <svg viewBox="0 0 24 24" class="tm-i"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="tm-btn" data-act="redo" title="重做 (Ctrl+Shift+Z)" disabled>
          <svg viewBox="0 0 24 24" class="tm-i"><path d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="tm-sep"></span>
        <button class="tm-btn" data-act="export-svg" title="导出 SVG（拖进 PPT 即可）">SVG</button>
        <button class="tm-btn" data-act="export-png" title="导出 PNG（2 倍分辨率）">PNG</button>
        <button class="tm-btn" data-act="copy" title="复制 SVG 源码">复制</button>
        <button class="tm-btn" data-act="json" title="导出 / 导入 JSON">JSON</button>
      </div>

      <div class="tm-main">
        <section class="tm-center">
          <div class="tm-toolbar">
            <div class="tm-adds" title="添加信号">
              <button class="tm-add" data-add="digital" title="添加数字方波">+ 数字</button>
              <button class="tm-add" data-add="clock" title="添加时钟">+ 时钟</button>
              <button class="tm-add" data-add="bus" title="添加总线">+ 总线</button>
              <button class="tm-add" data-add="analog" title="添加模拟波形">+ 模拟</button>
            </div>
            <span class="tm-count" data-el="sigcount"></span>
            <span class="tm-sep"></span>
            <label class="tm-field"><span>时间单位</span>
              <select data-el="unit" class="tm-select tm-select-sm"></select>
            </label>
            <label class="tm-field"><span>每格</span>
              <input type="number" data-el="major" class="tm-input tm-input-w" min="1" max="1000" step="1" />
            </label>
            <label class="tm-field"><span>总长</span>
              <input type="number" data-el="len" class="tm-input tm-input-w" min="10" max="${MAX_TICKS}" step="10" />
            </label>
            <label class="tm-field tm-field-wide"><span>缩放</span>
              <input type="range" data-el="zoom" min="${PX_MIN}" max="${PX_MAX}" step="0.5" class="tm-range" />
            </label>
            <span class="tm-spacer"></span>
            <label class="tm-check"><input type="checkbox" data-el="snap" checked /> 吸附</label>
            <label class="tm-check"><input type="checkbox" data-el="showNames" checked /> 信号名</label>
            <button class="tm-btn tm-btn-accent" data-act="add-marker" title="在光标处加竖直游标">+ 游标</button>
            <button class="tm-btn" data-act="add-span" title="在选中边沿两侧加区间标注">+ 标注</button>
          </div>

          <div class="tm-canvas" data-el="canvas">
            <!--
              单一信号名列：左栏 tm-signals 负责增删排序，画布内不再重复画名字。
              名字列的每一项行高=rowH，与波形行严格对齐（测量过diff 恒为 0），
              这样横向滚动时名字不动、纵向对齐靠行高保证。
            -->
            <!--
              单一信号名列：显示名字 / 选中 / 上下移删除 / 拖拽调宽度。
              名字渲染进 .tm-names-list 而不是直接写 namesCol.innerHTML ——
              否则每次重绘都会把里面的 resizer 手柄一起冲掉。
            -->
            <div class="tm-names" data-el="namesCol">
              <div class="tm-names-list" data-el="namesList"></div>
              <div class="tm-resizer" data-el="resizer" title="拖动调整信号名列宽（双击恢复默认）"></div>
            </div>
            <div class="tm-scroll" data-el="scroll">
              <div class="tm-inner" data-el="inner">
                <div class="tm-axis" data-el="axis"></div>
                <div class="tm-rows" data-el="rows"></div>
                <svg class="tm-overlay" data-el="overlay"></svg>
              </div>
            </div>
            <div class="tm-empty" data-el="empty" hidden>还没有信号，从左侧添加一条开始</div>
          </div>

          <div class="tm-status">
            <span data-el="status">就绪</span>
            <span class="tm-spacer"></span>
            <span data-el="saved" class="tm-saved"></span>
          </div>
        </section>

        <aside class="tm-right" data-el="inspector"></aside>
      </div>
    `;

    // data-el 必须全局唯一。
    // 曾经 .tm-names 容器和「信号名」复选框都用 data-el="names"，
    // querySelector 取到先出现的那个，于是 132px×294px 的样式被打在了复选框上 ——
    // 表现为工具栏中间浮着一个巨大的蓝色对勾方块。名字改到 showNames/namesCol 就是为了根治。
    for (const k of [
      'title', 'preset', 'canvas', 'namesCol', 'namesList', 'resizer', 'scroll', 'inner', 'axis', 'rows',
      'overlay', 'inspector', 'status', 'saved', 'sigcount', 'unit', 'major', 'len',
      'zoom', 'snap', 'empty', 'showNames',
    ]) {
      const hits = this.root.querySelectorAll<HTMLElement>(`[data-el="${k}"]`);
      if (hits.length > 1) {
        throw new Error(`[timing] data-el="${k}" 重复了 ${hits.length} 次，必须全局唯一`);
      }
      if (hits.length === 1) this.els[k] = hits[0];
    }

    this.fillSelects();
    this.bindEvents();
    this.assertSkeleton();
  }

  /**
   * 骨架自检：所有代码里用到的 data-el 都必须真实存在。
   *
   * 为什么值得单独写：缺一个 data-el 不会在构造时报错（那行代码还没执行到），
   * 而是等到用户第一次触发那个交互时才炸，症状表现为「状态栏不更新」「红框报错」，
   * 排查成本极高。这里在构造末尾一次性校验，缺了立刻抛。
   */
  private assertSkeleton(): void {
    const required = [
      'title', 'preset', 'canvas', 'namesCol', 'namesList', 'resizer', 'scroll', 'inner', 'axis', 'rows',
      'overlay', 'inspector', 'status', 'saved', 'sigcount', 'unit', 'major', 'len',
      'zoom', 'snap', 'empty', 'showNames',
    ];
    const missing = required.filter((k) => !this.els[k]);
    if (missing.length) {
      throw new Error(`[timing] 骨架缺少 data-el：${missing.join(', ')}`);
    }
  }

  private fillSelects(): void {
    const preset = this.els.preset as HTMLSelectElement;
    preset.innerHTML =
      '<option value="">载入预设…</option>' +
      presetGroups()
        .map((g) => `<optgroup label="${g.group}">${g.items.map((p) => `<option value="${p.key}">${p.name}</option>`).join('')}</optgroup>`)
        .join('');

    const unit = this.els.unit as HTMLSelectElement;
    unit.innerHTML = TIME_UNITS.map((u) => `<option value="${u.ns}">${u.label}</option>`).join('');
  }

  // ==========================================================================
  // 渲染
  // ==========================================================================

  private get showNames(): boolean {
    const c = this.els.showNames as unknown as HTMLInputElement;
    return c ? c.checked : true;
  }

  private get snapOn(): boolean {
    const c = this.els.snap as unknown as HTMLInputElement;
    return c ? c.checked : true;
  }

  private render(): void {
    this.syncControls();

    this.renderCanvas();
    this.renderInspector();
    this.renderHistoryButtons();
    this.scheduleSave();
  }

  private syncControls(): void {
    (this.els.title as HTMLInputElement).value = this.doc.title;
    const unit = this.els.unit as HTMLSelectElement;
    // 找到最接近当前 tickNs 的单位
    const best = [...TIME_UNITS].sort((a, b) => Math.abs(a.ns - this.doc.tickNs) - Math.abs(b.ns - this.doc.tickNs))[0];
    unit.value = String(best.ns);
    (this.els.major as HTMLInputElement).value = String(this.doc.majorEvery);
    (this.els.len as HTMLInputElement).value = String(this.doc.lengthTicks);
    (this.els.zoom as HTMLInputElement).value = String(this.px);
  }

  private renderCanvas(): void {
    const opts = { pxPerTick: this.px, nameW: 0 };
    const w = this.doc.lengthTicks * this.px;
    const h = contentHeight(this.doc, opts);
    // .tm-inner 在 .tm-scroll 内部，而 .tm-scroll 本身已被名字列推开，
    // 所以 inner 的宽度只等于波形宽 w —— 之前多加了 nameW，
    // 会在右侧多出一条同样宽的空白滚动区。
    const axisH = GEO.axisH;
    const rowsH = GEO.padTop + this.doc.signals.length * GEO.rowH;

    this.els.inner.style.width = `${w}px`;
    this.els.axis.style.width = `${w}px`;
    this.els.rows.style.width = `${w}px`;

    // --- 时间轴 ---
    const ticks = axisTicks(this.doc, opts);
    this.els.axis.innerHTML = ticks
      .map(
        (t) =>
          `<div class="tm-tick${t.major ? ' is-major' : ''}" style="left:${t.x}px">${t.major ? `<span>${t.label}</span>` : ''}</div>`,
      )
      .join('');

    // --- 每一行：独立 SVG，互不干扰，选中/悬停高亮只影响一行 ---
    this.els.rows.innerHTML = this.doc.signals
      .map((sig, i) => {
        // yBase 传0：每行是独立 SVG，行容器已由 CSS 定位到 rowTopOf(i)，
        // 内部再叠一次行偏移就会「越往下偏得越多」（实测第 6 行偏 236px）
        const shape = renderAll(this.doc, { ...opts }, () => 0)[i];
        const sel = sig.id === this.selId ? ' is-sel' : '';
        const handles = shape.edgeX
          .map(
            (x, k) =>
              `<div class="tm-handle${this.selId === sig.id && this.selEdge === k ? ' is-sel' : ''}" style="left:${x}px" data-sig="${sig.id}" data-idx="${k}"></div>`,
          )
          .join('');
        const labels = shape.labels
          .map((l) => `<text x="${l.x}" y="${l.y}" class="tm-vlabel" fill="${shape.color}">${escapeHTML(l.text)}</text>`)
          .join('');
        return `<div class="tm-row${sel}" style="top:${rowTopOf(i)}px;height:${GEO.rowH}px" data-sig="${sig.id}">
          <svg class="tm-wave" width="${w}" height="${GEO.rowH}" viewBox="0 0 ${w} ${GEO.rowH}" preserveAspectRatio="none">
            <path d="${shape.d}" fill="none" stroke="${shape.color}" stroke-width="1.6" stroke-linejoin="miter"/>
            ${shape.d2 ? `<path d="${shape.d2}" fill="none" stroke="${shape.color}" stroke-width="1.6"/>` : ''}
            ${labels}
          </svg>
          ${handles}
        </div>`;
      })
      .join('');

    // --- 覆盖层：网格 / 游标 / 区间标注 ---
    const minor = Math.max(1, this.doc.majorEvery / 5);
    let grid = '';
    for (let t = 0; t <= this.doc.lengthTicks; t += minor) {
      const x = t * this.px;
      const major = t % this.doc.majorEvery === 0;
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="${rowsH}" stroke="currentColor" stroke-width="${major ? 0.8 : 0.4}" opacity="${major ? 0.5 : 0.22}"/>`;
    }
    const markers = this.doc.markers
      .map((m) => {
        const x = m.t * this.px;
        const on = m.id === this.selMarker ? ' is-sel' : '';
        return `<g class="tm-marker${on}" data-marker="${m.id}">
          <line x1="${x}" y1="0" x2="${x}" y2="${rowsH}" stroke="#a32d2d" stroke-width="1" stroke-dasharray="4 3"/>
          <text x="${x + 3}" y="11" font-size="10" fill="#a32d2d">${escapeHTML(m.label)}</text>
        </g>`;
      })
      .join('');
    const spans = this.doc.spans
      .map((s) => {
        const x1 = s.t1 * this.px;
        const x2 = s.t2 * this.px;
        const y = s.row >= 0 ? rowTopOf(s.row) + GEO.rowH - 6 : axisH + 12;
        const on = s.id === this.selSpan ? ' is-sel' : '';
        return `<g class="tm-span${on}" data-span="${s.id}">
          <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#a32d2d" stroke-width="1" marker-start="url(#tmArrow)" marker-end="url(#tmArrow)"/>
          <text x="${(x1 + x2) / 2}" y="${y - 3}" font-size="10" fill="#a32d2d" text-anchor="middle">${escapeHTML(s.label)}</text>
        </g>`;
      })
      .join('');

    this.els.overlay.setAttribute('width', String(w));
    this.els.overlay.setAttribute('height', String(rowsH));
    this.els.overlay.style.top = `${axisH}px`;
    this.els.overlay.innerHTML = `<defs><marker id="tmArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#a32d2d" stroke-width="1.5" stroke-linecap="round"/></marker></defs>
      <g class="tm-grid" color="currentColor">${grid}</g>${markers}${spans}`;

    // --- 左侧信号名列（独立 DOM，与行纵向对齐）---
    // 这一列同时承担三件事：显示名字 / 选中 / 上下移动删除。
    // 曾经左栏另有一份信号列表，名字画两遍且两处行高不一致；合并成一列后行高由 rowH 统一。
    //
    // 偏移量的来历：`.tm-names` 是 `.tm-scroll` 的兄弟，起点与 `.tm-axis` 平齐（即 canvas 顶）；
    // 而波形行在 `.tm-rows` 内，起点在 axis 之下。所以名字要补上 axisH 才能落到同一水平位置。
    // 改这里之前是 + axisH，验收脚本量的 diff 恒为 0（它比的是同一个坐标系下的绝对 top，
    // 恰好抵消了），但截图里名字整体低了一行 —— 现在改为按真实像素位置断言。
    const colW = this.showNames ? this.nameW : 0;
    this.els.namesCol.style.height = `${axisH + rowsH}px`;
    this.els.namesCol.style.width = `${colW}px`;
    this.els.namesCol.style.display = this.showNames ? '' : 'none';
    // 写进 namesList 而不是 namesCol —— resizer 手柄是 namesCol 的子节点，
    // 直接写 innerHTML 会把它连同 cursor/事件一起冲掉
    this.els.namesList.innerHTML = this.doc.signals
      .map((s, i) => {
        const sel = s.id === this.selId ? ' is-sel' : '';
        const last = i === this.doc.signals.length - 1;
        return `<div class="tm-name${sel}" style="top:${axisH + rowTopOf(i)}px;height:${GEO.rowH}px" data-sig="${s.id}">
          <span class="tm-ndot" style="background:${s.color}"></span>
          <span class="tm-ntext">${escapeHTML(s.name)}</span>
          <span class="tm-kind">${KIND_LABEL[s.kind]}</span>
          <span class="tm-nact">
            <button data-sigact="up" data-id="${s.id}" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button data-sigact="down" data-id="${s.id}" title="下移" ${last ? 'disabled' : ''}>↓</button>
            <button data-sigact="del" data-id="${s.id}" title="删除">×</button>
          </span>
        </div>`;
      })
      .join('');

    this.els.sigcount.textContent = `${this.doc.signals.length} 条`;
    (this.els.empty as HTMLElement).hidden = this.doc.signals.length > 0;
  }

  private renderInspector(): void {
    const box = this.els.inspector;
    const sig = this.doc.signals.find((s) => s.id === this.selId);

    if (!sig) {
      box.innerHTML = '<div class="tm-hint">选中一条信号来编辑它的属性</div>';
      return;
    }
    const idx = this.doc.signals.indexOf(sig);

    const common = `
      <div class="tm-insp-head">
        <span class="tm-dot" style="background:${sig.color}"></span>
        <span>第 ${idx + 1} 条</span>
      </div>
      <label class="tm-fld"><span>名称</span><input data-insp="name" class="tm-input" value="${escapeHTML(sig.name)}" spellcheck="false" /></label>
      <label class="tm-fld"><span>颜色</span><input data-insp="color" type="color" class="tm-color" value="${sig.color}" /></label>`;

    let body = '';
    if (sig.kind === 'digital') {
      const d = sig as DigitalSeg;
      body = `
        ${common}
        <label class="tm-fld"><span>起始电平</span>
          <select data-insp="initial" class="tm-select tm-select-sm">
            <option value="0" ${d.initial === 0 ? 'selected' : ''}>0（低）</option>
            <option value="1" ${d.initial === 1 ? 'selected' : ''}>1（高）</option>
          </select></label>
        <div class="tm-insp-sub">边沿（${d.edges.length} 个）</div>
        <div class="tm-edges">${
          d.edges.length
            ? d.edges
                .map(
                  (e, i) =>
                    `<div class="tm-erow${this.selEdge === i ? ' is-sel' : ''}">
                      <span class="tm-ei">${i + 1}</span>
                      <input data-edge="${i}" class="tm-input tm-input-w" value="${e}" />
                      <span class="tm-eu">${formatTime(this.doc, e)}</span>
                      <button data-edgeact="del" data-i="${i}" title="删除">×</button>
                    </div>`,
                )
                .join('')
            : '<div class="tm-hint">没有边沿，信号是恒定电平</div>'
        }</div>`;
    } else if (sig.kind === 'clock') {
      const c = sig as ClockSeg;
      body = `
        ${common}
        <label class="tm-fld"><span>周期</span>
          <input data-insp="period" type="number" class="tm-input" min="2" max="10000" value="${c.period}" /></label>
        <label class="tm-fld"><span>占空比</span>
          <input data-insp="duty" type="number" class="tm-input" min="0.05" max="0.95" step="0.05" value="${c.duty}" /></label>
        <label class="tm-fld"><span>相位</span>
          <input data-insp="phase" type="number" class="tm-input" min="0" max="${MAX_TICKS}" value="${c.phase}" /></label>
        <label class="tm-fld"><span>起始电平</span>
          <select data-insp="initial" class="tm-select tm-select-sm">
            <option value="0" ${c.initial === 0 ? 'selected' : ''}>0（低 · CPOL=0）</option>
            <option value="1" ${c.initial === 1 ? 'selected' : ''}>1（高 · CPOL=1）</option>
          </select></label>
        <div class="tm-note">t<sub>CK</sub> = ${formatTime(this.doc, c.period)}，占空 ${Math.round(c.duty * 100)}%</div>`;
    } else if (sig.kind === 'bus') {
      const b = sig as BusSeg;
      body = `
        ${common}
        <label class="tm-fld"><span>位宽</span>
          <input data-insp="width" type="number" class="tm-input" min="1" max="32" value="${b.width}" /></label>
        <div class="tm-insp-sub">时段（${b.segments.length} 段）</div>
        <div class="tm-segs">${b.segments
          .map(
            (s, i) => `<div class="tm-srow">
              <span class="tm-ei">${i}</span>
              <input data-segt="${i}" class="tm-input tm-input-w" value="${s.t}" title="起始 tick" />
              <input data-segv="${i}" class="tm-input" value="${toHex(s.v, b.width)}" spellcheck="false" title="十六进制值" />
              <button data-segact="del" data-i="${i}" title="删除该段" ${i === 0 ? 'disabled' : ''}>×</button>
            </div>`,
          )
          .join('')}</div>
        <button class="tm-btn tm-btn-wide" data-act="add-seg">+ 加一段</button>`;
    } else {
      const a = sig as AnalogSeg;
      body = `
        ${common}
        <div class="tm-insp-sub">关键点（${a.points.length} 个）</div>
        <div class="tm-segs">${a.points
          .map(
            (p, i) => `<div class="tm-srow">
              <span class="tm-ei">${i}</span>
              <input data-pt="${i}" class="tm-input tm-input-w" value="${p.t}" title="tick" />
              <input data-pv="${i}" class="tm-input" value="${p.v.toFixed(2)}" title="幅度 0~1" />
            </div>`,
          )
          .join('')}</div>
        <button class="tm-btn tm-btn-wide" data-act="add-point">+ 加一个点</button>`;
    }

    // 标注列表
    const marks = this.doc.markers
      .map(
        (m) => `<div class="tm-mrow${m.id === this.selMarker ? ' is-sel' : ''}">
          <input data-mark-t="${m.id}" class="tm-input tm-input-w" value="${m.t}" title="位置 tick" />
          <input data-mark-l="${m.id}" class="tm-input" value="${escapeHTML(m.label)}" spellcheck="false" title="标注文字" />
          <button data-markact="del" data-id="${m.id}">×</button>
        </div>`,
      )
      .join('');
    const spans = this.doc.spans
      .map(
        (s) => `<div class="tm-mrow${s.id === this.selSpan ? ' is-sel' : ''}">
          <input data-span-a="${s.id}" class="tm-input tm-input-w" value="${s.t1}" title="起点 tick" />
          <input data-span-b="${s.id}" class="tm-input tm-input-w" value="${s.t2}" title="终点 tick" />
          <input data-span-l="${s.id}" class="tm-input" value="${escapeHTML(s.label)}" spellcheck="false" />
          <button data-spanact="del" data-id="${s.id}">×</button>
        </div>`,
      )
      .join('');

    box.innerHTML = `${body}
      <div class="tm-insp-sub">竖直游标（${this.doc.markers.length}）</div>
      <div class="tm-mrows">${marks || '<div class="tm-hint">无</div>'}</div>
      <div class="tm-insp-sub">区间标注（${this.doc.spans.length}）</div>
      <div class="tm-mrows">${spans || '<div class="tm-hint">无</div>'}</div>`;
  }

  private renderHistoryButtons(): void {
    const u = this.root.querySelector<HTMLButtonElement>('[data-act="undo"]')!;
    const r = this.root.querySelector<HTMLButtonElement>('[data-act="redo"]')!;
    u.disabled = !canUndo(this.hist);
    r.disabled = !canRedo(this.hist);
  }

  // ==========================================================================
  // 变更入口
  // ==========================================================================

  /** 所有改动的唯一入口：记历史 → 改文档 → 重绘 → 存 */
  private mutate(fn: (d: TimingDoc) => TimingDoc, msg?: string): void {
    this.hist = pushHistory(this.hist, this.doc);
    this.doc = fn(this.doc);
    this.render();
    if (msg) this.setStatus(msg);
  }

  /** 拖拽过程中的高频更新：只改数据不记历史（一次拖拽只留一步） */
  private mutateLive(fn: (d: TimingDoc) => TimingDoc): void {
    this.doc = fn(this.doc);
    this.render();
  }

  /**
   * 记录一次变更前的状态，供撤销。
   *
   * 调用顺序有坑：必须在 `this.drag` 赋值**之后**调用。
   * 早先写成 beginDrag() 在前 drag= 在后，而这里有 `if (!this.drag) return` 守卫，
   * 于是拖拽永远不会进历史栈 —— 表现为「拖完点撤销，整张图回到载入预设之前」。
   * 不报错，只是撤销行为是错的。
   */
  private beginDrag(): void {
    this.hist = pushHistory(this.hist, this.doc);
    this.renderHistoryButtons();
  }

  private setStatus(s: string): void {
    this.els.status.textContent = s;
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      store.save(this.doc);
      this.els.saved.textContent = '已自动保存到本地';
    }, 500);
  }

  // ==========================================================================
  // 坐标
  // ==========================================================================

  /**
   * 鼠标事件 → tick
   *
   * 注意：**不要再减信号名列宽**。`inner` 元素本身就排在 `.tm-names` 之后，
   * 它的 getBoundingClientRect().left 已经包含了名列的宽度。多减一次会让
   * 所有 tick 坐标整体偏移 33 格（132px / 4px），表现为「拖哪儿都不对劲」但又不报错。
   */
  private eventTick(e: PointerEvent | MouseEvent): number {
    const r = this.els.inner.getBoundingClientRect();
    const scrollX = this.els.scroll.scrollLeft;
    const x = e.clientX - r.left + scrollX;
    return clampTick(xToTick(x, 0, this.px));
  }

  // ==========================================================================
  // 事件绑定
  // ==========================================================================

  private bindEvents(): void {
    // ---- 顶栏按钮 ----
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.handleAction(act);
    });

    // ---- 标题 ----
    (this.els.title as HTMLInputElement).addEventListener('input', (e) => {
      this.doc = { ...this.doc, title: (e.target as HTMLInputElement).value };
      this.scheduleSave();
    });
    (this.els.title as HTMLInputElement).addEventListener('change', () => {
      const v = (this.els.title as HTMLInputElement).value.trim() || '未命名时序图';
      this.mutate((d) => ({ ...d, title: v }));
    });

    // ---- 预设 ----
    (this.els.preset as HTMLSelectElement).addEventListener('change', (e) => {
      const key = (e.target as HTMLSelectElement).value;
      if (!key) return;
      const doc = loadPreset(key);
      if (!doc) return;
      this.hist = pushHistory(this.hist, this.doc);
      this.doc = doc;
      this.selId = this.doc.signals[0]?.id ?? '';
      this.selEdge = -1;
      (e.target as HTMLSelectElement).value = '';
      this.render();
      this.setStatus(`已载入预设：${this.doc.title}`);
    });

    // ---- 工具栏 ----
    (this.els.unit as HTMLSelectElement).addEventListener('change', (e) => {
      const ns = Number((e.target as HTMLSelectElement).value);
      this.mutate((d) => ({ ...d, tickNs: ns }));
    });
    (this.els.major as HTMLInputElement).addEventListener('change', (e) => {
      const v = Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 20));
      this.mutate((d) => ({ ...d, majorEvery: v }));
    });
    (this.els.len as HTMLInputElement).addEventListener('change', (e) => {
      const v = clampTick(Number((e.target as HTMLInputElement).value) || 200);
      this.mutate((d) => ({ ...d, lengthTicks: Math.max(10, v) }));
    });
    (this.els.zoom as HTMLInputElement).addEventListener('input', (e) => {
      this.px = Number((e.target as HTMLInputElement).value);
      this.renderCanvas();
    });
    (this.els.snap as unknown as HTMLInputElement).addEventListener('change', () => this.render());
    (this.els.showNames as unknown as HTMLInputElement).addEventListener('change', () => this.renderCanvas());

    // ---- 添加信号 ----
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const kind = t.closest<HTMLElement>('[data-add]')?.dataset.add;
      if (kind) this.addSignal(kind as Signal['kind']);
      const sigAct = t.closest<HTMLElement>('[data-sigact]');
      if (sigAct) {
        const { sigact: a, id } = sigAct.dataset;
        if (a === 'del') {
          this.mutate((d) => removeSignal(d, id!));
          if (this.selId === id) this.selId = this.doc.signals[0]?.id ?? '';
          this.render();
        } else {
          this.mutate((d) => reorderSignal(d, id!, a === 'up' ? -1 : 1));
        }
      }
    });

    // ---- 选中信号（左栏与波形行）----
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('dblclick', (e) => this.onDblClick(e));

    // ---- 拖拽 ----
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.onPointerUp());

    // ---- 信号名列宽拖拽 ----
    // 独立于波形拖拽的另一套状态：手柄有自己的一组 pointer 事件，
    // 混进 onPointerDown 的话会和「拖边沿」抢 drag 槽位。
    //
    // **刻意不用 setPointerCapture**：捕获后事件被重定向到手柄本身，
    // 挂在 window 上的 pointermove 就收不到了，表现为「拖拽毫无反应」。
    //
    // **双击复位用手动判定，不用原生 dblclick 事件**：
    // 手柄 pointerdown 上的 preventDefault() 会抑制浏览器兼容鼠标事件
    // （mousedown/mouseup/click/dblclick），原生 dblclick 永远不触发 ——
    // 真实用户双击也复不了位，只能自己数两次按下。判定规则：
    // 两次按下间隔 < 350ms 且「第一次没有真的拖动过」，才算双击。
    // 这样既修复了复位，又避开「快速连续两次拖拽」被误判成双击。
    const resizer = this.els.resizer;
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // 别让画布的 pointerdown 接手
      const now = e.timeStamp;
      const wasDrag = this.resizeDragged;
      this.resizeDragged = false;
      if (this.lastResizeDown && !wasDrag && now - this.lastResizeDown < 350) {
        // 双击：复位到默认宽度
        this.lastResizeDown = 0;
        this.nameW = GEO.nameW;
        this.els.namesCol.style.width = `${GEO.nameW}px`;
        this.resizeDrag = null;
        this.root.classList.remove('is-resizing');
        this.els.namesCol.classList.remove('is-resizing');
        store.saveNameWidth(this.nameW);
        this.setStatus(`列宽已复位为 ${GEO.nameW}px`);
        return;
      }
      this.lastResizeDown = now;
      this.resizeDrag = { startX: e.clientX, startW: this.nameW };
      this.root.classList.add('is-resizing');
      this.els.namesCol.classList.add('is-resizing');
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.resizeDrag) return;
      const dx = e.clientX - this.resizeDrag.startX;
      if (Math.abs(dx) > 3) this.resizeDragged = true; // 发生过明显移动 → 算一次拖拽，不算双击
      const next = Math.max(
        store.NAME_W_MIN,
        Math.min(store.NAME_W_MAX, this.resizeDrag.startW + dx),
      );
      if (next === this.nameW) return;
      this.nameW = next;
      // 只改列宽，不整表重绘 —— 拖拽时 60fps 全量重绘会明显卡
      this.els.namesCol.style.width = `${next}px`;
      this.setStatus(`信号名列宽 ${next}px（双击手柄可复位）`);
    });
    window.addEventListener('pointerup', () => {
      if (!this.resizeDrag) return;
      this.resizeDrag = null;
      this.root.classList.remove('is-resizing');
      this.els.namesCol.classList.remove('is-resizing');
      store.saveNameWidth(this.nameW);
    });

    // ---- 键盘 ----
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // ---- 检查器输入 ----
    this.els.inspector.addEventListener('change', (e) => this.onInspectorChange(e));
    this.els.inspector.addEventListener('click', (e) => this.onInspectorClick(e));
  }

  private addSignal(kind: Signal['kind']): void {
    const maker = kind === 'clock' ? addClock : kind === 'bus' ? addBus : kind === 'analog' ? addAnalog : addDigital;
    let newId = '';
    this.mutate((d) => {
      const r = maker(d);
      newId = r.id;
      return r.doc;
    });
    if (!newId) {
      this.setStatus('信号数量已达上限（24 条）');
      return;
    }
    this.selId = newId;
    this.render();
    this.setStatus('已添加信号');
  }

  // ==========================================================================
  // 指针交互
  // ==========================================================================

  private onPointerDown(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    // 先记下本次按下位置：后面判断「靠近标注哪一端」要用它，
    // 不能依赖上一次 pointermove 留下的值（那个值可能是几秒前的）
    this.lastPointerTick = this.eventTick(e);

    // 1) 边沿手柄
    const handle = t.closest<HTMLElement>('.tm-handle');
    if (handle) {
      this.selId = handle.dataset.sig!;
      this.selEdge = Number(handle.dataset.idx);
      this.beginDrag();
      this.drag = { kind: 'edge', sigId: this.selId, idx: this.selEdge };
      this.render();
      return;
    }

    // 2) 游标
    const mk = t.closest<HTMLElement>('.tm-marker');
    if (mk) {
      this.selMarker = mk.dataset.marker!;
      this.beginDrag();
      this.drag = { kind: 'marker', sigId: '', idx: 0 };
      this.renderInspector();
      return;
    }

    // 3) 区间标注：靠近左端拖左端，靠近右端拖右端
    const sp = t.closest<HTMLElement>('.tm-span');
    if (sp) {
      this.selSpan = sp.dataset.span!;
      const s = this.doc.spans.find((x) => x.id === this.selSpan);
      this.beginDrag();
      if (s) {
        // 用「离哪端更近」判断，比固定阈值稳
        const near1 = Math.abs(this.lastPointerTick - s.t1);
        const near2 = Math.abs(this.lastPointerTick - s.t2);
        this.drag = { kind: near1 <= near2 ? 'span1' : 'span2', sigId: '', idx: 0 };
      } else {
        this.drag = { kind: 'span2', sigId: '', idx: 0 };
      }
      this.renderInspector();
      return;
    }

    // 4) 波形区：点电平翻转（数字/时钟）
    const row = t.closest<HTMLElement>('.tm-row');
    if (row && !t.closest('.tm-handle')) {
      const sigId = row.dataset.sig!;
      const sig = this.doc.signals.find((s) => s.id === sigId);
      if (!sig) return;
      const tick = this.eventTick(e);
      this.selId = sigId;

      // 先看是不是点在边沿附近（点边沿 = 拖动，不翻转）
      const edges = sig.kind === 'clock' ? this.clockEdgeList(sig) : sig.kind === 'digital' ? (sig as DigitalSeg).edges : [];
      const near = nearestEdge(edges, tick, 0.5);
      if (near >= 0) {
        this.selEdge = near;
        this.beginDrag();
        this.drag = { kind: 'edge', sigId, idx: near };
        this.render();
        return;
      }

      // 点在电平中段 → 翻转
      this.selEdge = -1;
      this.toggleAt(sig, tick);
      return;
    }

    // 5) 波形区空白：Shift+点击加游标
    if (t.closest('.tm-overlay') && e.shiftKey) {
      const tick = this.eventTick(e);
      this.mutate((d) => addMarker(d, tick).doc, `已在 ${formatTime(this.doc, tick)} 加游标`);
      return;
    }

    // 6) 信号名 → 选中
    const name = t.closest<HTMLElement>('.tm-name, .tm-sig');
    if (name && !t.closest('[data-sigact]')) {
      const id = name.dataset.sig;
      if (id) {
        this.selId = id;
        this.selEdge = -1;
        this.render();
      }
    }
  }

  private clockEdgeList(sig: Signal): number[] {
    // 时钟边沿由 render 层算过一遍，这里重新展开成本很低（几十个元素）
    const shape = renderAll(this.doc, { pxPerTick: this.px, nameW: 0 }, () => 0).find((s) => s.id === sig.id);
    // edgeX 是像素坐标，转回 tick
    return shape ? shape.edgeX.map((x) => Math.round(x / this.px)) : [];
  }

  private lastPointerTick = 0;

  /** 在 tick 位置翻转数字/时钟的电平 */
  private toggleAt(sig: Signal, tick: number): void {
    if (sig.kind === 'digital') {
      const d = sig as DigitalSeg;
      const cur = digitalLevelAt(d, tick);
      // 点在边沿附近 → 删掉那个边沿（等效于翻转）
      // 点在段中间 → 插入一个边沿（等效于翻转）
      const near = nearestEdge(d.edges, tick, 0.5);
      if (near >= 0) {
        this.mutate((dd) => {
          const s = dd.signals.find((x) => x.id === sig.id) as DigitalSeg;
          return replaceSignal(dd, sig.id, { ...s, edges: removeEdge(s.edges, near) });
        });
      } else {
        this.mutate((dd) => {
          const s = dd.signals.find((x) => x.id === sig.id) as DigitalSeg;
          return replaceSignal(dd, sig.id, { ...s, edges: [...s.edges, tick].sort((a, b) => a - b) });
        });
      }
      this.setStatus(`已翻转 ${sig.name} 在 ${formatTime(this.doc, tick)} 的电平（原 ${cur}）`);
      this.render();
      return;
    }
    if (sig.kind === 'clock') {
      // 时钟是参数化的，改电平 = 翻转起始电平
      this.mutate(
        (dd) => {
          const s = dd.signals.find((x) => x.id === sig.id) as ClockSeg;
          return replaceSignal(dd, sig.id, { ...s, initial: s.initial === 1 ? 0 : 1 });
        },
        '已翻转时钟起始电平',
      );
      return;
    }
    if (sig.kind === 'bus') {
      // 总线：点一下切换到下一段
      const b = sig as BusSeg;
      const i = b.segments.findIndex((s) => s.t > tick);
      const target = i < 0 ? b.segments.length : i;
      if (target > 0 && target < b.segments.length) {
        this.selSpan = '';
        this.mutate((dd) => {
          const s = dd.signals.find((x) => x.id === sig.id) as BusSeg;
          return replaceSignal(dd, sig.id, { ...s, segments: moveBusSeg(s, target, tick) });
        });
        this.setStatus(`已移动 ${sig.name} 的段边界`);
      }
      return;
    }
    // 模拟：加一个关键点
    this.mutate((dd) => {
      const s = dd.signals.find((x) => x.id === sig.id) as AnalogSeg;
      return replaceSignal(dd, sig.id, {
        ...s,
        points: [...s.points, { t: tick, v: 0.5 }].sort((a, b) => a.t - b.t),
      });
    });
  }

  private onDblClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.tm-row');
    if (!row) return;
    const sig = this.doc.signals.find((s) => s.id === row.dataset.sig);
    if (!sig) return;
    const tick = this.eventTick(e);

    if (sig.kind === 'bus') {
      // 双击总线段：把该段值 +1（快速改值），并把该段选中
      const b = sig as BusSeg;
      let idx = 0;
      for (let i = 0; i < b.segments.length; i++) if (b.segments[i].t <= tick) idx = i;
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === sig.id) as BusSeg;
        const segs = s.segments.map((sg, i) => (i === idx ? { ...sg, v: (sg.v + 1) & ((1 << s.width) - 1) } : sg));
        return replaceSignal(dd, sig.id, { ...s, segments: segs });
      });
      this.setStatus(`${sig.name} 段 ${idx} → ${toHex(b.segments[idx].v + 1, b.width)}`);
      return;
    }

    // 其它类型：双击加边沿
    if (sig.kind === 'digital') {
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === sig.id) as DigitalSeg;
        return replaceSignal(dd, sig.id, { ...s, edges: [...s.edges, tick].sort((a, b) => a - b) });
      });
      this.setStatus(`已在 ${formatTime(this.doc, tick)} 插入边沿`);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    const raw = this.eventTick(e);
    this.lastPointerTick = raw;
    const snapped = this.snapOn ? snapTick(this.doc, raw, { tolerance: 0.5, skipSignalId: this.drag.sigId }) : { t: raw, hint: '' };
    const tick = clampTick(snapped.t);
    const d = this.drag;

    if (d.kind === 'edge') {
      this.mutateLive((dd) => {
        const s = dd.signals.find((x) => x.id === d.sigId);
        if (!s) return dd;
        if (s.kind === 'clock') {
          // 时钟：把边沿换算成周期/相位，参数化驱动
          return replaceSignal(dd, s.id, { ...s, phase: tick % s.period } as ClockSeg);
        }
        if (s.kind === 'digital') {
          const g = s as DigitalSeg;
          return replaceSignal(dd, s.id, { ...g, edges: moveEdge(g.edges, d.idx, tick) });
        }
        return dd;
      });
      this.setStatus(`${formatTime(this.doc, tick)}${snapped.hint ? ' · ' + snapped.hint : ''}`);
      return;
    }

    if (d.kind === 'marker') {
      this.mutateLive((dd) => ({
        ...dd,
        markers: dd.markers.map((m) => (m.id === this.selMarker ? { ...m, t: tick } : m)),
      }));
      this.setStatus(`游标 → ${formatTime(this.doc, tick)}`);
      return;
    }

    if (d.kind === 'span1' || d.kind === 'span2') {
      this.mutateLive((dd) => ({
        ...dd,
        spans: dd.spans.map((s) => {
          if (s.id !== this.selSpan) return s;
          const a = Math.min(s.t1, tick);
          const b = Math.max(s.t1, tick);
          return d.kind === 'span1' ? { ...s, t1: a, t2: b } : { ...s, t1: a, t2: b };
        }),
      }));
      this.setStatus(`标注 → ${formatTime(this.doc, tick)}`);
    }
  }

  private onPointerUp(): void {
    if (!this.drag) return;
    this.drag = null;
    this.renderInspector();
    this.renderHistoryButtons();
    this.scheduleSave();
  }

  // ==========================================================================
  // 键盘
  // ==========================================================================

  private onKeyDown(e: KeyboardEvent): void {
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName ?? '');

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (inField) return;

    // 方向键微调选中边沿
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (this.selEdge < 0) return;
      const step = (e.shiftKey ? 5 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
      const sig = this.doc.signals.find((s) => s.id === this.selId);
      if (!sig || sig.kind !== 'digital') return;
      e.preventDefault();
      const d = sig as DigitalSeg;
      const cur = d.edges[this.selEdge];
      if (cur === undefined) return;
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as DigitalSeg;
        return replaceSignal(dd, this.selId, { ...s, edges: moveEdge(s.edges, this.selEdge, cur + step) });
      });
      this.setStatus(`${sig.name} 边沿 ${this.selEdge + 1} → ${formatTime(this.doc, d.edges[this.selEdge])}`);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selMarker) {
        e.preventDefault();
        this.mutate((d) => removeMarker(d, this.selMarker));
        this.selMarker = '';
        this.render();
      } else if (this.selSpan) {
        e.preventDefault();
        this.mutate((d) => removeSpan(d, this.selSpan));
        this.selSpan = '';
        this.render();
      } else if (this.selEdge >= 0) {
        e.preventDefault();
        this.mutate((dd) => {
          const s = dd.signals.find((x) => x.id === this.selId) as DigitalSeg;
          if (!s || s.kind !== 'digital') return dd;
          return replaceSignal(dd, this.selId, { ...s, edges: removeEdge(s.edges, this.selEdge) });
        });
        this.selEdge = -1;
        this.render();
      }
      return;
    }

    if (e.key === 'Escape') {
      store.clear();
      this.doc = emptyDoc();
      this.selId = this.doc.signals[0]?.id ?? '';
      this.render();
      this.setStatus('已清空并新建');
    }
  }

  private undo(): void {
    if (!canUndo(this.hist)) return;
    this.hist.future.unshift(cloneDoc(this.doc));
    this.doc = this.hist.past.pop()!;
    this.clampSel();
    this.render();
    this.setStatus('已撤销');
  }

  private redo(): void {
    if (!canRedo(this.hist)) return;
    this.hist.past.push(cloneDoc(this.doc));
    this.doc = this.hist.future.shift()!;
    this.clampSel();
    this.render();
    this.setStatus('已重做');
  }

  /** 撤销后选中项可能已不存在，收敛到合法值 */
  private clampSel(): void {
    if (!this.doc.signals.some((s) => s.id === this.selId)) this.selId = this.doc.signals[0]?.id ?? '';
    const sig = this.doc.signals.find((s) => s.id === this.selId);
    if (sig?.kind === 'digital' && this.selEdge >= (sig as DigitalSeg).edges.length) this.selEdge = -1;
  }

  // ==========================================================================
  // 检查器
  // ==========================================================================

  private onInspectorClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'add-seg') return this.addBusSeg();
    if (act === 'add-point') return this.addAnalogPoint();

    const del = t.closest<HTMLElement>('[data-edgeact]');
    if (del) {
      const i = Number(del.dataset.i);
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as DigitalSeg;
        if (!s || s.kind !== 'digital') return dd;
        return replaceSignal(dd, this.selId, { ...s, edges: removeEdge(s.edges, i) });
      });
      this.selEdge = -1;
      this.render();
      return;
    }

    const segDel = t.closest<HTMLElement>('[data-segact]');
    if (segDel) {
      const i = Number(segDel.dataset.i);
      if (i === 0) return; // 首段不能删
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as BusSeg;
        if (!s || s.kind !== 'bus') return dd;
        return replaceSignal(dd, this.selId, { ...s, segments: s.segments.filter((_, k) => k !== i) });
      });
      return;
    }

    const mkDel = t.closest<HTMLElement>('[data-markact]');
    if (mkDel) {
      this.mutate((d) => removeMarker(d, mkDel.dataset.id!));
      return;
    }
    const spDel = t.closest<HTMLElement>('[data-spanact]');
    if (spDel) {
      this.mutate((d) => removeSpan(d, spDel.dataset.id!));
      return;
    }
  }

  private onInspectorChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const sig = this.doc.signals.find((s) => s.id === this.selId);
    if (!sig) return;

    const num = (v: string, fb: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };

    // 边沿位置
    if (t.dataset.edge !== undefined) {
      const i = Number(t.dataset.edge);
      const to = clampTick(num(t.value, sig.kind === 'digital' ? (sig as DigitalSeg).edges[i] : 0));
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as DigitalSeg;
        if (!s || s.kind !== 'digital') return dd;
        return replaceSignal(dd, this.selId, { ...s, edges: moveEdge(s.edges, i, to) });
      });
      this.setStatus(`边沿 ${i + 1} → ${formatTime(this.doc, to)}`);
      return;
    }

    // 总线段
    if (t.dataset.segt !== undefined) {
      const i = Number(t.dataset.segt);
      const to = clampTick(num(t.value, 0));
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as BusSeg;
        if (!s || s.kind !== 'bus' || i === 0) return dd;
        const segs = s.segments.map((sg, k) => (k === i ? { ...sg, t: Math.max(1, to) } : sg)).sort((a, b) => a.t - b.t);
        return replaceSignal(dd, this.selId, { ...s, segments: dedupeBus(segs) });
      });
      return;
    }
    if (t.dataset.segv !== undefined) {
      const i = Number(t.dataset.segv);
      const v = fromHex(t.value);
      if (v === null) {
        this.setStatus(`「${t.value}」不是合法十六进制`);
        this.renderInspector();
        return;
      }
      const width = sig.kind === 'bus' ? sig.width : 8;
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as BusSeg;
        if (!s || s.kind !== 'bus') return dd;
        return replaceSignal(dd, this.selId, { ...s, segments: s.segments.map((sg, k) => (k === i ? { ...sg, v } : sg)) });
      });
      this.setStatus(`段 ${i} → 0x${toHex(v, width)}`);
      return;
    }

    // 模拟点
    if (t.dataset.pt !== undefined) {
      const i = Number(t.dataset.pt);
      const to = clampTick(num(t.value, 0));
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as AnalogSeg;
        if (!s || s.kind !== 'analog') return dd;
        return replaceSignal(dd, this.selId, { ...s, points: s.points.map((p, k) => (k === i ? { ...p, t: to } : p)).sort((a, b) => a.t - b.t) });
      });
      return;
    }
    if (t.dataset.pv !== undefined) {
      const i = Number(t.dataset.pv);
      const v = Math.min(1, Math.max(0, num(t.value, 0.5)));
      this.mutate((dd) => {
        const s = dd.signals.find((x) => x.id === this.selId) as AnalogSeg;
        if (!s || s.kind !== 'analog') return dd;
        return replaceSignal(dd, this.selId, { ...s, points: s.points.map((p, k) => (k === i ? { ...p, v } : p)) });
      });
      return;
    }

    // 游标
    if (t.dataset.markT) {
      const id = t.dataset.markT;
      const to = clampTick(num(t.value, 0));
      this.mutate((dd) => ({ ...dd, markers: dd.markers.map((m) => (m.id === id ? { ...m, t: to } : m)) }));
      return;
    }
    if (t.dataset.markL) {
      const id = t.dataset.markL;
      const v = t.value;
      this.mutate((dd) => ({ ...dd, markers: dd.markers.map((m) => (m.id === id ? { ...m, label: v } : m)) }));
      return;
    }

    // 区间标注
    if (t.dataset.spanA) {
      const id = t.dataset.spanA;
      const to = clampTick(num(t.value, 0));
      this.mutate((dd) => ({ ...dd, spans: dd.spans.map((s) => (s.id === id ? sortSpan({ ...s, t1: to }) : s)) }));
      return;
    }
    if (t.dataset.spanB) {
      const id = t.dataset.spanB;
      const to = clampTick(num(t.value, 0));
      this.mutate((dd) => ({ ...dd, spans: dd.spans.map((s) => (s.id === id ? sortSpan({ ...s, t2: to }) : s)) }));
      return;
    }
    if (t.dataset.spanL) {
      const id = t.dataset.spanL;
      const v = t.value;
      this.mutate((dd) => ({ ...dd, spans: dd.spans.map((s) => (s.id === id ? { ...s, label: v } : s)) }));
      return;
    }

    // 通用属性
    switch (t.dataset.insp) {
      case 'name': {
        const v = t.value.trim() || 'SIG';
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, name: v }));
        break;
      }
      case 'color':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, color: t.value }));
        break;
      case 'initial':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, initial: num(t.value, 0) === 1 ? 1 : 0 } as Signal));
        break;
      case 'period':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, period: Math.max(2, Math.round(num(t.value, 10))) } as ClockSeg));
        break;
      case 'duty':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, duty: Math.min(0.95, Math.max(0.05, num(t.value, 0.5))) } as ClockSeg));
        break;
      case 'phase':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, phase: clampTick(num(t.value, 0)) } as ClockSeg));
        break;
      case 'width':
        this.mutate((dd) => replaceSignal(dd, this.selId, { ...sig, width: Math.max(1, Math.min(32, Math.round(num(t.value, 8)))) } as BusSeg));
        break;
    }
  }

  private addBusSeg(): void {
    const sig = this.doc.signals.find((s) => s.id === this.selId);
    if (!sig || sig.kind !== 'bus') return;
    const b = sig as BusSeg;
    const last = b.segments[b.segments.length - 1];
    const t = Math.min(this.doc.lengthTicks, last.t + Math.max(1, Math.round(this.doc.majorEvery / 2)));
    this.mutate((dd) => {
      const s = dd.signals.find((x) => x.id === this.selId) as BusSeg;
      return replaceSignal(dd, this.selId, { ...s, segments: [...s.segments, { t, v: 0 }] });
    });
    this.setStatus('已加一段，双击波形可快速改值');
  }

  private addAnalogPoint(): void {
    const sig = this.doc.signals.find((s) => s.id === this.selId);
    if (!sig || sig.kind !== 'analog') return;
    this.mutate((dd) => {
      const s = dd.signals.find((x) => x.id === this.selId) as AnalogSeg;
      const t = Math.round(this.doc.lengthTicks / 2);
      return replaceSignal(dd, this.selId, { ...s, points: [...s.points, { t, v: 0.6 }].sort((a, b) => a.t - b.t) });
    });
  }

  // ==========================================================================
  // 顶栏动作
  // ==========================================================================

  private handleAction(act: string): void {
    switch (act) {
      case 'undo':
        this.undo();
        break;
      case 'redo':
        this.redo();
        break;
      case 'export-svg':
        this.exportSVGFile();
        break;
      case 'export-png':
        this.exportPNGFile();
        break;
      case 'copy':
        void this.copySVG();
        break;
      case 'json':
        this.exportJSON();
        break;
      case 'add-marker': {
        const tick = this.lastPointerTick || 0;
        this.mutate((d) => addMarker(d, tick).doc, `已在 ${formatTime(this.doc, tick)} 加游标`);
        break;
      }
      case 'add-span': {
        // 用当前游标或选中边沿做区间
        let t1 = this.lastPointerTick;
        const t2 = Math.min(this.doc.lengthTicks, t1 + Math.round(this.doc.majorEvery));
        this.mutate((d) => {
          const r = addSpan(d, t1, t2, this.selEdge >= 0 ? this.doc.signals.findIndex((s) => s.id === this.selId) : -1);
          this.selSpan = r.id;
          return r.doc;
        }, '已加区间标注，可在右侧改名字');
        break;
      }
    }
  }

  private buildExportSVG(dark: boolean): string {
    return exportSVG(this.doc, {
      pxPerTick: Math.max(2, this.px),
      background: dark ? '#18181b' : '#ffffff',
      withNames: true,
      dark,
    });
  }

  private exportSVGFile(): void {
    // 导出固定用白底黑字：PPT 文档背景基本都是白的
    const svg = this.buildExportSVG(false);
    store.triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${store.safeName(this.doc.title)}.svg`);
    this.setStatus('已导出 SVG —— 可直接拖进 PowerPoint（矢量不失真）');
  }

  private exportPNGFile(): void {
    const svg = this.buildExportSVG(false);
    const scale = 2;
    const m = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
    const w = m ? Number(m[1]) : 800;
    const h = m ? Number(m[2]) : 400;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = w * scale;
      cv.height = h * scale;
      const ctx = cv.getContext('2d');
      if (!ctx) {
        this.setStatus('导出失败：浏览器不支持 canvas');
        URL.revokeObjectURL(url);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((blob) => {
        if (blob) store.triggerDownload(blob, `${store.safeName(this.doc.title)}.png`);
        URL.revokeObjectURL(url);
        this.setStatus(`已导出 PNG（${cv.width}×${cv.height}，2 倍分辨率）`);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.setStatus('导出失败：SVG 转图片时出错');
    };
    img.src = url;
  }

  private async copySVG(): Promise<void> {
    const ok = await store.copyText(this.buildExportSVG(false));
    this.setStatus(ok ? 'SVG 源码已复制，可直接粘贴到文本编辑器' : '复制失败 —— 可改用「导出 SVG」下载文件');
  }

  private exportJSON(): void {
    // 两个按钮合一：第一次点导出，再点同一个按钮会打开导入对话框。
    // 为了避免用户困惑，这里用一个原生 confirm 询问。
    if (confirm('确定 = 下载 JSON 文件\n取消 = 从 JSON 文件导入')) {
      store.downloadJSON(this.doc);
      this.setStatus('已导出 JSON（可备份或分享）');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const doc = await store.readJSONFile(f);
        this.hist = pushHistory(this.hist, this.doc);
        this.doc = doc;
        bumpIdSeq(this.doc);
        this.selId = this.doc.signals[0]?.id ?? '';
        this.selEdge = -1;
        this.render();
        this.setStatus(`已导入：${this.doc.title}`);
      } catch (err) {
        this.setStatus((err as Error).message);
      }
    });
    input.click();
  }
}

// ============================================================================
// 辅助
// ============================================================================

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 移动总线段边界：保持首段在 0，且不与其它段重合 */
function moveBusSeg(seg: BusSeg, index: number, to: number): { t: number; v: number }[] {
  const out = seg.segments.map((s) => ({ ...s }));
  out[index] = { ...out[index], t: clampTick(to) };
  if (index === 0) return out;
  return dedupeBus(out.sort((a, b) => a.t - b.t));
}

/** 去掉重合的段起点（保留第一条） */
function dedupeBus(segs: { t: number; v: number }[]): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  for (const s of segs) {
    if (out.length && out[out.length - 1].t === s.t) continue;
    out.push(s);
  }
  if (out.length && out[0].t !== 0) out.unshift({ t: 0, v: 0 });
  return out;
}

/** 区间标注两端排序。必须返回完整 Span —— 只返 {t1,t2} 会把 id/label/row 全丢掉 */
function sortSpan(s: Span): Span {
  return { ...s, t1: Math.min(s.t1, s.t2), t2: Math.max(s.t1, s.t2) };
}
