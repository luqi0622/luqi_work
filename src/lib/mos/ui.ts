/**
 * MOS 管级电路图 —— 编辑器交互层（唯一有 DOM 的核心文件）
 *
 * ## 架构
 *
 * 状态在 `this.doc`，所有改动走 model 的纯函数（返回新对象）。
 * 渲染走 render.ts 的 `renderSvg()` —— **屏幕与导出同一个渲染器**，
 * 所以屏上看到的和导出的必然一致。
 *
 * ## 关键纪律
 *
 * 1. **诊断先于渲染**：`renderAll()` 里先 `refreshDiags()` 再渲染。
 *    顺序反了高亮慢一拍，且用户会以为功能坏了。
 * 2. **`this.drag` 必须先赋值再 `beginHistory()`**。后者有守卫，
 *    顺序反了历史栈永远不进东西，表现为「拖完点撤销，图跳回原样」。
 * 3. **拖拽中用 `mutateLive`**（改 doc 不记历史），pointerup 才记一次。
 * 4. **`data-el` 骨架 key 全局唯一**，构造时校验重名并抛错。
 */

import {
  type ColorToken,
  type CompKind,
  type DiagResult,
  type Dir,
  type Endpoint,
  type MosComp,
  type MosDoc,
  type MosFet,
  type Pt,
  type Rect,
  type Rot,
  type StrokeStyle,
  type TextNote,
  type View,
  type Wire,
  COMP_LABEL,
  GRID,
  MAX_ZOOM,
  MIN_ZOOM,
  ROTS,
  isMos,
} from './types';
import { compBBox, portDirWorld, portNames, portWorld } from './symbols';
import {
  type SnapResult,
  boundsOf,
  compAt,
  dragVertex,
  ensureMinSize,
  nearestPort,
  nearestWirePoint,
  orthoRoute,
  screenToWorld,
  snapPoint,
  snapToGrid,
  textAt,
  wireAt,
  wirePts,
} from './geometry';
import {
  type AlignOp,
  type History,
  type Selection,
  addComp,
  addWire,
  alignComps,
  arrayCopy,
  bumpIdSeq,
  canRedo,
  canUndo,
  cloneDoc,
  distributeComps,
  emptyHistory,
  flipComps,
  makeComp,
  makeWire,
  moveComps,
  nextId,
  normalize,
  pushHistory,
  redo,
  refreshDiags,
  removeComps,
  removeTexts,
  removeWires,
  rotateComps,
  undo,
  updateComp,
  updateText,
  updateWire,
} from './model';
import { exportPNG, exportSVG, paletteOf, renderSvg, symbolThumb } from './render';
import { PRESETS, blankPreset } from './presets';
import * as persist from './persist';

// ============================================================================
// 交互状态
// ============================================================================

type DragKind = 'none' | 'pan' | 'comp' | 'wire' | 'bend' | 'marquee' | 'text';

interface DragBase {
  startWorld: Pt;
  startClient: { x: number; y: number };
}

/**
 * 拖拽状态用 discriminated union 而不是一堆可选字段。
 *
 * 之前用 `fromPort: Endpoint | null` 全局可选，结果每个赋值点都要补
 * `fromPort: null, fromDir: 'U'` —— 而这两行在 comp/pan 拖拽里毫无意义，
 * 漏写就报错。union 让「哪种拖拽需要什么」写进类型里。
 */
type DragState =
  | ({ kind: 'none' } & DragBase)
  | ({ kind: 'pan'; panStart: { panX: number; panY: number } } & DragBase)
  | ({ kind: 'comp'; ids: string[]; origX: Map<string, Pt>; moved: boolean } & DragBase)
  | ({ kind: 'wire'; fromPort: Endpoint; fromDir: Dir; } & DragBase)
  | ({ kind: 'bend'; wireId: string; bendIdx: number } & DragBase)
  | ({ kind: 'marquee'; additive: boolean } & DragBase)
  | ({ kind: 'text'; textId: string } & DragBase);

const NO_DRAG: DragState = {
  kind: 'none',
  startWorld: { x: 0, y: 0 },
  startClient: { x: 0, y: 0 },
};

const PALETTE_KINDS: CompKind[] = [
  'nmos', 'pmos',
  'resistor', 'capacitor', 'capPol', 'diode', 'zener',
  'vsrc', 'isrc', 'vdd', 'gnd', 'port', 'junction', 'jump',
];

const ALIGN_OPS: Array<{ op: AlignOp; label: string }> = [
  { op: 'left', label: '左对齐' },
  { op: 'hcenter', label: '水平居中' },
  { op: 'right', label: '右对齐' },
  { op: 'top', label: '顶对齐' },
  { op: 'vcenter', label: '垂直居中' },
  { op: 'bottom', label: '底对齐' },
];

const COLOR_OPTIONS: ColorToken[] = ['ink', 'accent', 'red', 'green', 'blue', 'orange', 'muted'];
const WIDTH_OPTIONS = [1, 1.5, 2, 3];

// ============================================================================
// 编辑器
// ============================================================================

export class MosEditor {
  private root: HTMLElement;
  private doc: MosDoc;
  private view: View = { zoom: 1, panX: 60, panY: 60 };
  private history: History = emptyHistory();
  private sel: Selection = { comps: [], wires: [], texts: [] };
  private drag: DragState = NO_DRAG;
  private diag: DiagResult | null = null;
  private clip: MosDoc | null = null;
  /**
   * 骨架元素缓存。
   *
   * 刻意**不**声明成 `Record<string, HTMLElement>` 的一把抓 —— 那样
   * `this.els.title.value` 会报「HTMLElement 没有 value」，
   * 而实际它就是 input。分类型声明让类型检查真正起作用。
   */
  private els!: {
    title: HTMLInputElement;
    left: HTMLElement;
    center: HTMLElement;
    viewport: HTMLElement;
    svgwrap: HTMLElement;
    right: HTMLElement;
    status: HTMLElement;
    file: HTMLInputElement;
    drawerL: HTMLElement;
    drawerR: HTMLElement;
  };
  private saveTimer: number | null = null;
  private pendingWire: { a: Pt; aDir: string; b: Pt; bDir: string } | null = null;
  private guide: { axis: 'x' | 'y'; v: number } | null = null;
  private marquee: Rect | null = null;
  private activeBend: { wireId: string; idx: number } | null = null;
  private spaceDown = false;
  private pointerInside = false;
  private statusMsg = '';
  /** 同类元件连续放置时的偏移计数 */
  private sameKindCount = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.doc = persist.load() ?? blankPreset();
    bumpIdSeq(this.doc);
    this.renderShell();
    this.bindEvents();
    this.renderAll();
    this.fitView();
  }

  // --------------------------------------------------------------------------
  // 骨架
  // --------------------------------------------------------------------------

  private renderShell(): void {
    const dark = document.documentElement.classList.contains('dark');
    const thumbs = PALETTE_KINDS.map((k) => {
      const label = COMP_LABEL[k];
      return `<button class="mc-chip" data-kind="${k}" title="${label}"><span class="mc-chip-ico">${symbolThumb(k, dark)}</span><span class="mc-chip-tx">${label}</span></button>`;
    }).join('');

    this.root.innerHTML = `
<div class="mc-root">
  <header class="mc-top">
    <button class="mc-drawer-btn" data-el="drawerL" title="元件库">☰</button>
    <a class="mc-back" href="/projects" title="返回项目展厅">← 项目</a>
    <input class="mc-title" data-el="title" value="${escapeAttr(this.doc.title)}" aria-label="图纸标题" />
    <div class="mc-top-actions">
      <button class="mc-btn" data-act="undo" title="撤销 Ctrl+Z">撤销</button>
      <button class="mc-btn" data-act="redo" title="重做 Ctrl+Shift+Z">重做</button>
      <span class="mc-sep"></span>
      <button class="mc-btn" data-act="fit" title="缩放到适合 F">适应</button>
      <button class="mc-btn" data-act="grid" title="切换网格显示">网格</button>
      <button class="mc-btn" data-act="snapgrid" title="切换栅格吸附">吸附</button>
      <button class="mc-btn" data-act="presets">预设</button>
      <span class="mc-sep"></span>
      <button class="mc-btn" data-act="import">导入</button>
      <button class="mc-btn" data-act="json">JSON</button>
      <button class="mc-btn mc-btn-pri" data-act="svg">导出 SVG</button>
      <button class="mc-btn mc-btn-pri" data-act="png">PNG</button>
      <button class="mc-btn" data-act="clear" title="清空画布">清空</button>
      <button class="mc-drawer-btn" data-el="drawerR" title="属性面板">属性</button>
    </div>
  </header>

  <div class="mc-grid">
    <aside class="mc-left" data-el="left">
      <div class="mc-sec-t">元件库<span class="mc-hint">点击放置</span></div>
      <div class="mc-chips">${thumbs}</div>
      <div class="mc-sec-t">对齐<span class="mc-hint">需选中 ≥2</span></div>
      <div class="mc-aligns">
        ${ALIGN_OPS.map((a) => `<button class="mc-abtn" data-align="${a.op}" title="${a.label}">${a.label}</button>`).join('')}
        <button class="mc-abtn" data-dist="x" title="水平等距分布">横向分布</button>
        <button class="mc-abtn" data-dist="y" title="竖直等距分布">纵向分布</button>
      </div>
      <div class="mc-sec-t">预设电路</div>
      <div class="mc-presets">
        ${PRESETS.map((p) => `<button class="mc-pbtn" data-preset="${p.key}" title="${escapeAttr(p.hint)}">${escapeHtml(p.name)}</button>`).join('')}
      </div>
      <div class="mc-sec-t">快捷键</div>
      <dl class="mc-keys">
        <dt>R / Ctrl+R</dt><dd>旋转 / 反向旋转</dd>
        <dt>X</dt><dd>水平镜像</dd>
        <dt>拖端口</dt><dd>连线</dd>
        <dt>点拐点</dt><dd>拖动改形</dd>
        <dt>Alt+点拐点</dt><dd>删除拐点</dd>
        <dt>Ctrl+C/V</dt><dd>复制 / 粘贴</dd>
        <dt>Ctrl+Shift+D</dt><dd>阵列复制</dd>
        <dt>Del</dt><dd>删除选中</dd>
        <dt>Ctrl+Z</dt><dd>撤销 / 重做</dd>
        <dt>Ctrl+A</dt><dd>全选</dd>
        <dt>F / 滚轮</dt><dd>适应 / 缩放</dd>
        <dt>空格+拖</dt><dd>平移画布</dd>
      </dl>
    </aside>

    <section class="mc-center" data-el="center">
      <div class="mc-viewport" data-el="viewport" tabindex="0">
        <div class="mc-svgwrap" data-el="svgwrap"></div>
      </div>
      <div class="mc-status" data-el="status"></div>
    </section>

    <aside class="mc-right" data-el="right"></aside>
  </div>

  <input type="file" accept="application/json,.json" data-el="file" hidden />
</div>`;

    // data-el 必须全局唯一 —— 重名会让样式打到错误元素上
    // （曾因两处都叫 names，把 132px 列宽打在了复选框上，工具栏浮出巨大蓝勾方块）
    const all = this.root.querySelectorAll<HTMLElement>('[data-el]');
    const seen = new Map<string, number>();
    all.forEach((el) => {
      const k = el.dataset.el!;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    for (const [k, cnt] of seen) {
      if (cnt > 1) throw new Error(`骨架 data-el="${k}" 重复 ${cnt} 次`);
    }

    const pick = <T extends HTMLElement>(k: string): T => {
      const el = this.root.querySelector<T>(`[data-el="${k}"]`);
      if (!el) throw new Error(`骨架缺少 data-el：${k}`);
      return el;
    };

    // 构造末尾统一校验：缺一个就立刻抛，别留到用户第一次点那个按钮才炸
    this.els = {
      title: pick<HTMLInputElement>('title'),
      left: pick('left'),
      center: pick('center'),
      viewport: pick('viewport'),
      svgwrap: pick('svgwrap'),
      right: pick('right'),
      status: pick('status'),
      file: pick<HTMLInputElement>('file'),
      drawerL: pick('drawerL'),
      drawerR: pick('drawerR'),
    };

    // 移动端抽屉：点画布或按 Esc 关闭
    this.els.drawerL.addEventListener('click', () => {
      this.els.right.classList.remove('is-open');
      this.els.left.classList.toggle('is-open');
    });
    this.els.drawerR.addEventListener('click', () => {
      this.els.left.classList.remove('is-open');
      this.els.right.classList.toggle('is-open');
    });
    this.els.viewport.addEventListener('pointerdown', () => {
      this.els.left.classList.remove('is-open');
      this.els.right.classList.remove('is-open');
    });
  }

  // --------------------------------------------------------------------------
  // 坐标换算
  // --------------------------------------------------------------------------

  private viewportRect(): DOMRect {
    const r = this.els.viewport.getBoundingClientRect();
    // 高度链塌成 0 时 getBoundingClientRect 全读到 0，
    // fit-to-view 会算出极小缩放，看起来像「缩放坏了」。这里兜一下。
    return r;
  }

  private toWorld(e: { clientX: number; clientY: number }): Pt {
    // 交互命中走 getScreenCTM：浏览器保证它和实际渲染矩阵一致，比手算更不会错。
    //
    // **必须取 `.mc-world` 的矩阵，不能取外层 svg 的。**
    // 外层 svg 的 viewBox 与像素尺寸 1:1，它的 CTM 只有平移、没有缩放；
    // 真正的 zoom/pan 在内层 `<g class="mc-world">` 上。
    // 取错的后果很隐蔽：世界坐标算出来差一个 zoom 倍数，
    // 表现为「点元件没反应、拖端口连不上」，但控制台一条错都不报。
    const world = this.els.svgwrap.querySelector<SVGGElement>('svg > g.mc-world');
    if (world) {
      const ctm = world.getScreenCTM();
      if (ctm) {
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
      }
    }
    // 兜底：没有 world 层时退回手算
    const r = this.viewportRect();
    return screenToWorld(e.clientX, e.clientY, r, this.view);
  }

  // --------------------------------------------------------------------------
  // 渲染
  // --------------------------------------------------------------------------

  private isDark(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  private renderAll(): void {
    // **诊断必须先于渲染** —— 顺序反了高亮慢一拍
    this.diag = refreshDiags(this.doc);

    const r = this.viewportRect();
    const vw = Math.max(1, Math.round(r.width));
    const vh = Math.max(1, Math.round(r.height));
    if (this.els.viewport.clientWidth !== vw || this.els.viewport.clientHeight !== vh) {
      // 视口尺寸变了（窗口缩放 / 面板折叠），交给 ResizeObserver 重排
    }

    const svg = renderSvg(this.doc, {
      mode: 'screen',
      view: this.view,
      vw,
      vh,
      selected: this.selectedSet(),
      diag: this.diag,
      dark: this.isDark(),
      pending: this.pendingWire,
      activeBend: this.activeBend,
      guide: this.guide,
      marquee: this.marquee,
    });
    this.els.svgwrap.innerHTML = svg;

    this.updateGrid();
    this.renderInspector();
    this.renderStatus();
  }

  private selectedSet(): Set<string> {
    return new Set([...this.sel.comps, ...this.sel.wires, ...this.sel.texts]);
  }

  private updateGrid(): void {
    const vp = this.els.viewport;
    const pal = paletteOf(this.isDark());
    if (!this.doc.showGrid) {
      vp.style.backgroundImage = 'none';
      return;
    }
    // 双层 linear-gradient：缩放时同步改 background-size，视觉密度才恒定。
    // 不用 SVG <pattern> —— 那要手动维护 patternTransform，容易错。
    const g1 = GRID * this.view.zoom;
    const g2 = GRID * this.view.zoom * 5;
    vp.style.backgroundImage = `linear-gradient(${pal.grid} 1px, transparent 1px), linear-gradient(90deg, ${pal.grid} 1px, transparent 1px), linear-gradient(${pal.gridMajor} 1px, transparent 1px), linear-gradient(90deg, ${pal.gridMajor} 1px, transparent 1px)`;
    vp.style.backgroundSize = `${g1}px ${g1}px, ${g1}px ${g1}px, ${g2}px ${g2}px, ${g2}px ${g2}px`;
    vp.style.backgroundPosition = `${this.view.panX}px ${this.view.panY}px`;
  }

  // --------------------------------------------------------------------------
  // 状态栏
  // --------------------------------------------------------------------------

  private renderStatus(): void {
    const parts: string[] = [];
    const nComps = this.doc.components.length;
    const nWires = this.doc.wires.length;
    const nSel = this.sel.comps.length + this.sel.wires.length + this.sel.texts.length;
    parts.push(`${nComps} 元件 · ${nWires} 连线`);
    if (nSel) parts.push(`选中 ${nSel}`);
    if (this.diag?.floating.size) parts.push(`⚠ ${this.diag.floating.size} 个悬空端口`);
    parts.push(`缩放 ${Math.round(this.view.zoom * 100)}%`);
    if (this.statusMsg) parts.push(this.statusMsg);
    this.els.status.textContent = parts.join('　|　');
    this.els.status.classList.toggle('mc-status-warn', (this.diag?.floating.size ?? 0) > 0);
  }

  private setStatus(msg: string): void {
    this.statusMsg = msg;
    this.renderStatus();
  }

  // --------------------------------------------------------------------------
  // 检查器（右侧属性面板）
  // --------------------------------------------------------------------------

  private renderInspector(): void {
    const host = this.els.right;
    // **先诊断后渲染**已完成，这里只消费
    const parts: string[] = [];

    const one = this.sel.comps.length === 1 ? this.doc.components.find((c) => c.id === this.sel.comps[0]) : undefined;
    const oneWire = this.sel.wires.length === 1 ? this.doc.wires.find((w) => w.id === this.sel.wires[0]) : undefined;
    const oneText = this.sel.texts.length === 1 ? this.doc.texts.find((t) => t.id === this.sel.texts[0]) : undefined;

    if (one) parts.push(this.compForm(one));
    else if (oneWire) parts.push(this.wireForm(oneWire));
    else if (oneText) parts.push(this.textForm(oneText));
    else if (this.sel.comps.length + this.sel.wires.length + this.sel.texts.length > 1) {
      parts.push(`<div class="mc-empty">已选中 ${this.sel.comps.length + this.sel.wires.length + this.sel.texts.length} 个对象<div class="mc-sub">可在左侧用对齐 / 分布工具整理</div></div>`);
    } else {
      parts.push(`<div class="mc-empty">未选中对象<div class="mc-sub">点击元件或连线查看属性</div></div>`);
    }

    parts.push(this.diagPanel());
    host.innerHTML = parts.join('');
    this.bindInspector();
  }

  private compForm(c: MosComp): string {
    const rows: string[] = [];
    rows.push(`<div class="mc-form-t">${COMP_LABEL[c.kind]}<span class="mc-sub">${escapeHtml(c.id)}</span></div>`);

    rows.push(
      `<label class="mc-f"><span>实例名</span><input data-cf="label" value="${escapeAttr(c.label)}" placeholder="M1"/></label>`,
    );

    if (isMos(c)) {
      const m = c as MosFet;
      rows.push(
        `<label class="mc-f"><span>模型</span><input data-cf="model" value="${escapeAttr(m.model ?? '')}" placeholder="NMOS_0P18"/></label>`,
      );
      rows.push(
        `<div class="mc-f2"><label class="mc-f"><span>W</span><input data-cf="w" value="${escapeAttr(m.w ?? '')}" placeholder="2u"/></label>` +
          `<label class="mc-f"><span>L</span><input data-cf="l" value="${escapeAttr(m.l ?? '')}" placeholder="65n"/></label></div>`,
      );
      rows.push(
        `<label class="mc-f"><span>Vt</span><input data-cf="vth" value="${escapeAttr(m.vth ?? '')}" placeholder="0.45"/></label>`,
      );
      rows.push(
        `<label class="mc-chk"><input type="checkbox" data-cf="bodyTied" ${m.bodyTied ? 'checked' : ''}/><span>体短接（三端）</span></label>`,
      );
    } else if ('value' in c) {
      rows.push(
        `<label class="mc-f"><span>参数值</span><input data-cf="value" value="${escapeAttr(String((c as { value?: string }).value ?? ''))}" placeholder="10k / 1p"/></label>`,
      );
    }

    if (c.kind === 'vdd' || c.kind === 'gnd' || c.kind === 'port') {
      rows.push(
        `<label class="mc-f"><span>网络名</span><input data-cf="net" value="${escapeAttr((c as { net?: string }).net ?? '')}" placeholder="VDD / IN / OUT"/></label>`,
      );
      rows.push(
        `<label class="mc-f"><span>电平</span><input data-cf="level" value="${escapeAttr((c as { level?: string }).level ?? '')}" placeholder="3.3V"/></label>`,
      );
      rows.push(`<div class="mc-sub">同名网络会自动互连，省去长距离走线</div>`);
    }

    rows.push(
      `<div class="mc-f2"><label class="mc-f"><span>旋转</span><select data-cf="rot">${ROTS.map((r) => `<option value="${r}" ${c.rot === r ? 'selected' : ''}>${r}°</option>`).join('')}</select></label>` +
        `<label class="mc-f"><span>镜像</span><select data-cf="flip"><option value="0" ${!c.flip ? 'selected' : ''}>否</option><option value="1" ${c.flip ? 'selected' : ''}>水平</option></select></label></div>`,
    );

    rows.push(
      `<label class="mc-f"><span>颜色</span><select data-cf="color"><option value="">默认</option>${COLOR_OPTIONS.map((t) => `<option value="${t}" ${c.color === t ? 'selected' : ''}>${colorName(t)}</option>`).join('')}</select></label>`,
    );

    const ports = portNames(c.kind, isMos(c) ? c.bodyTied : false);
    const portRows = ports
      .map((p) => {
        const floating = this.diag?.floating.has(`${c.id}#${p}`);
        const pp = portWorld(c, p);
        return `<li class="${floating ? 'mc-portf' : ''}"><code>${p}</code><span>${Math.round(pp.x)}, ${Math.round(pp.y)}</span>${floating ? '<em>悬空</em>' : ''}</li>`;
      })
      .join('');
    rows.push(`<div class="mc-sec-t">端口</div><ul class="mc-ports">${portRows}</ul>`);

    return `<div class="mc-form">${rows.join('')}</div>`;
  }

  private wireForm(w: Wire): string {
    return `<div class="mc-form">
  <div class="mc-form-t">连线<span class="mc-sub">${escapeHtml(w.id)}</span></div>
  <label class="mc-f"><span>标注</span><input data-wf="label" value="${escapeAttr(w.label ?? '')}" placeholder="I_D=1.2mA"/></label>
  <label class="mc-f"><span>线宽</span><select data-wf="width">${WIDTH_OPTIONS.map((x) => `<option value="${x}" ${w.style.width === x ? 'selected' : ''}>${x}px</option>`).join('')}</select></label>
  <label class="mc-f"><span>颜色</span><select data-wf="color">${COLOR_OPTIONS.map((t) => `<option value="${t}" ${w.style.color === t ? 'selected' : ''}>${colorName(t)}</option>`).join('')}</select></label>
  <label class="mc-f"><span>线型</span><select data-wf="dash"><option value="solid" ${w.style.dash === 'solid' ? 'selected' : ''}>实线</option><option value="dashed" ${w.style.dash === 'dashed' ? 'selected' : ''}>虚线</option><option value="dotted" ${w.style.dash === 'dotted' ? 'selected' : ''}>点线</option></select></label>
  <div class="mc-sec-t">拐点</div>
  <ul class="mc-ports">${wireViaPointsOf(this.doc, w).map((p, i) => `<li><code>${i + 1}</code><span>${Math.round(p.x)}, ${Math.round(p.y)}</span></li>`).join('') || '<li><span>无拐点（自动 L/Z 形）</span></li>'}</ul>
</div>`;
  }

  private textForm(t: TextNote): string {
    return `<div class="mc-form">
  <div class="mc-form-t">文本</div>
  <label class="mc-f"><span>内容</span><input data-tf="text" value="${escapeAttr(t.text)}"/></label>
  <label class="mc-f"><span>字号</span><select data-tf="size">${[10, 11, 12, 14, 18, 24].map((s) => `<option value="${s}" ${t.size === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
  <label class="mc-f"><span>对齐</span><select data-tf="align"><option value="left" ${t.align === 'left' ? 'selected' : ''}>左</option><option value="center" ${t.align === 'center' ? 'selected' : ''}>中</option><option value="right" ${t.align === 'right' ? 'selected' : ''}>右</option></select></label>
  <label class="mc-f"><span>旋转</span><select data-tf="rot">${ROTS.map((r) => `<option value="${r}" ${t.rot === r ? 'selected' : ''}>${r}°</option>`).join('')}</select></label>
  <label class="mc-f"><span>颜色</span><select data-tf="color">${COLOR_OPTIONS.map((c) => `<option value="${c}" ${t.color === c ? 'selected' : ''}>${colorName(c)}</option>`).join('')}</select></label>
  <label class="mc-chk"><input type="checkbox" data-tf="bold" ${t.bold ? 'checked' : ''}/><span>加粗</span></label>
</div>`;
  }

  private diagPanel(): string {
    const f = this.diag?.floating ?? new Set<string>();
    const list = [...f].slice(0, 14);
    return `<div class="mc-diag">
  <div class="mc-sec-t">自检<span class="mc-sub">${f.size ? `${f.size} 处` : '通过'}</span></div>
  ${list.length ? `<ul class="mc-dlist">${list.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('')}</ul><div class="mc-sub">红圈标出未接线的端口</div>` : '<div class="mc-sub">所有端口都已接线</div>'}
</div>`;
  }

  private bindInspector(): void {
    const host = this.els.right;

    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cf]').forEach((el) => {
      el.addEventListener('change', () => this.applyCompField(el.dataset.cf!, el));
    });
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-wf]').forEach((el) => {
      el.addEventListener('change', () => this.applyWireField(el.dataset.wf!, el));
    });
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-tf]').forEach((el) => {
      el.addEventListener('change', () => this.applyTextField(el.dataset.tf!, el));
    });
  }

  private applyCompField(key: string, el: HTMLInputElement | HTMLSelectElement): void {
    const id = this.sel.comps[0];
    if (!id) return;
    let v: unknown = el.value;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') v = el.checked;
    if (key === 'rot') v = Number(el.value) as Rot;
    if (key === 'flip') v = el.value === '1';
    if (key === 'color') v = el.value === '' ? null : el.value;
    this.beginHistory();
    this.doc = updateComp(this.doc, id, { [key]: v } as Partial<MosComp>);
    this.commit();
    this.setStatus('');
  }

  private applyWireField(key: string, el: HTMLInputElement | HTMLSelectElement): void {
    const id = this.sel.wires[0];
    if (!id) return;
    const w = this.doc.wires.find((k) => k.id === id);
    if (!w) return;
    let patch: Partial<Wire>;
    if (key === 'label') patch = { label: el.value };
    else if (key === 'width') patch = { style: { ...w.style, width: Number(el.value) } };
    else if (key === 'color') patch = { style: { ...w.style, color: el.value as ColorToken } };
    else patch = { style: { ...w.style, dash: el.value as StrokeStyle['dash'] } };
    this.beginHistory();
    this.doc = updateWire(this.doc, id, patch);
    this.commit();
  }

  private applyTextField(key: string, el: HTMLInputElement | HTMLSelectElement): void {
    const id = this.sel.texts[0];
    if (!id) return;
    let v: unknown = el.value;
    if (key === 'bold') v = (el as HTMLInputElement).checked;
    if (key === 'size' || key === 'rot') v = Number(el.value);
    this.beginHistory();
    this.doc = updateText(this.doc, id, { [key]: v } as Partial<TextNote>);
    this.commit();
  }

  // --------------------------------------------------------------------------
  // 历史与提交
  // --------------------------------------------------------------------------

  private beginHistory(): void {
    pushHistory(this.history, cloneDoc(this.doc));
  }

  /** 改完 doc 之后统一调用：重渲染 + 防抖保存 */
  private commit(): void {
    this.renderAll();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      persist.save(this.doc);
    }, 400) as unknown as number;
  }

  // --------------------------------------------------------------------------
  // 事件绑定
  // --------------------------------------------------------------------------

  private bindEvents(): void {
    const vp = this.els.viewport;

    vp.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    vp.addEventListener('pointermove', (e) => this.onPointerMove(e));
    vp.addEventListener('pointerup', (e) => this.onPointerUp(e));
    vp.addEventListener('pointercancel', () => this.endDrag());
    vp.addEventListener('pointerleave', () => {
      this.pointerInside = false;
    });
    vp.addEventListener('pointerenter', () => {
      this.pointerInside = true;
    });

    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false },
    );

    vp.addEventListener('dblclick', (e) => this.onDblClick(e));
    vp.addEventListener('contextmenu', (e) => e.preventDefault());

    // 工具栏与面板（事件委托，避免重渲染后重新绑定）
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.els.title.addEventListener('input', () => {
      this.doc = { ...this.doc, title: this.els.title.value };
      this.scheduleSave();
    });

    this.els.file.addEventListener('change', () => {
      const f = this.els.file.files?.[0];
      if (f) void this.onFileChosen(f);
      // 清空以便再次选同一文件也能触发 change
      this.els.file.value = '';
    });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.root.classList.remove('mc-space');
      }
    });

    // 视口尺寸变化 → 重排（fit 计算依赖它）
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.renderAll()).observe(vp);
    }

    // 主题切换后重渲染（CSS 变量由页面切换，这里换实际色）
    new MutationObserver(() => this.renderAll()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    this.loop();
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;

    const kind = t.closest<HTMLElement>('[data-kind]')?.dataset.kind;
    if (kind) {
      this.placeComp(kind as CompKind);
      return;
    }

    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) {
      this.doAction(act);
      return;
    }

    const align = t.closest<HTMLElement>('[data-align]')?.dataset.align;
    if (align) {
      this.beginHistory();
      this.doc = alignComps(this.doc, new Set(this.sel.comps), align as AlignOp);
      this.commit();
      this.setStatus(`已${ALIGN_OPS.find((a) => a.op === align)?.label ?? ''}`);
      return;
    }

    const dist = t.closest<HTMLElement>('[data-dist]')?.dataset.dist;
    if (dist) {
      this.beginHistory();
      this.doc = distributeComps(this.doc, new Set(this.sel.comps), dist as 'x' | 'y');
      this.commit();
      this.setStatus('已等距分布');
      return;
    }

    const preset = t.closest<HTMLElement>('[data-preset]')?.dataset.preset;
    if (preset) {
      const p = PRESETS.find((k) => k.key === preset);
      if (p && confirm(`载入预设「${p.name}」？当前图纸会被替换（可 Ctrl+Z 撤销）。`)) {
        this.beginHistory();
        this.doc = p.build();
        this.sel = { comps: [], wires: [], texts: [] };
        // 标题要跟着换，否则输入框还显示上一篇的名字
        this.els.title.value = this.doc.title;
        this.commit();
        this.fitView();
        this.setStatus(`已载入 ${p.name}`);
      }
    }
  }

  private doAction(act: string): void {
    switch (act) {
      case 'undo': {
        const prev = undo(this.history, this.doc);
        if (prev) {
          this.doc = prev;
          this.commit();
          this.setStatus('已撤销');
        }
        return;
      }
      case 'redo': {
        const nxt = redo(this.history, this.doc);
        if (nxt) {
          this.doc = nxt;
          this.commit();
          this.setStatus('已重做');
        }
        return;
      }
      case 'fit':
        this.fitView();
        return;
      case 'grid':
        this.doc = { ...this.doc, showGrid: !this.doc.showGrid };
        this.commit();
        return;
      case 'snapgrid':
        this.doc = {
          ...this.doc,
          snapGrid: !this.doc.snapGrid,
          snapTrack: this.doc.snapGrid ? this.doc.snapTrack : this.doc.snapTrack,
        };
        this.commit();
        this.setStatus(this.doc.snapGrid ? '栅格吸附开' : '栅格吸附关');
        return;
      case 'presets':
        this.els.left.scrollIntoView({ behavior: 'smooth' });
        this.setStatus('在左侧「预设电路」里选');
        return;
      case 'import':
        this.els.file.click();
        return;
      case 'json':
        persist.downloadJSON(this.doc);
        this.setStatus('已导出 JSON');
        return;
      case 'svg':
        this.exportSVGFile();
        return;
      case 'png':
        void this.exportPNGFile();
        return;
      case 'clear':
        if (confirm('清空当前图纸？可 Ctrl+Z 撤销。')) {
          this.beginHistory();
          this.doc = blankPreset();
          this.sel = { comps: [], wires: [], texts: [] };
          this.els.title.value = this.doc.title;
          this.commit();
          this.setStatus('已清空');
        }
        return;
      default:
        return;
    }
  }

  /**
   * 从元件库放置元件。
   *
   * 落点 = 视口中心 → 过吸附 → 落栅格。
   * 连续放同一个元件时给个偏移，否则叠在一起完全看不出放没放成功。
   */
  private placeComp(kind: CompKind): void {
    const r = this.viewportRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const world = screenToWorld(cx, cy, r, this.view);

    this.sameKindCount = this.doc.components.filter((c) => c.kind === kind).length;
    const jitter = (this.sameKindCount % 5) * GRID * 2;

    const s = snapPoint(
      this.doc,
      { x: world.x + jitter, y: world.y + jitter },
      { snapGrid: this.doc.snapGrid, snapTrack: this.doc.snapTrack },
      0,
    );
    const p = this.doc.snapGrid ? snapToGrid(s.x, s.y) : { x: s.x, y: s.y };

    this.beginHistory();
    const c = makeComp(this.doc, kind, p.x, p.y);
    this.doc = addComp(this.doc, c);
    this.sel = { comps: [c.id], wires: [], texts: [] };
    this.commit();
    this.setStatus(`已放置 ${COMP_LABEL[kind]}${c.label ? ` ${c.label}` : ''}，拖端口即可连线`);
  }

  private async onFileChosen(file: File): Promise<void> {
    try {
      const doc = await persist.readJSONFile(file);
      this.beginHistory();
      this.doc = doc;
      this.sel = { comps: [], wires: [], texts: [] };
      this.els.title.value = doc.title;
      this.commit();
      this.fitView();
      this.setStatus(`已导入「${doc.title}」`);
    } catch (err) {
      alert(`导入失败：${(err as Error).message}`);
    }
  }

  private async exportSVGFile(): Promise<void> {
    try {
      const svg = exportSVG(this.doc, { dark: this.isDark(), background: this.isDark() ? '#18181b' : '#fafafa' });
      persist.triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${persist.safeName(this.doc.title)}.svg`);
      this.setStatus('已导出 SVG（可直接拖进 PPT / Word）');
    } catch (err) {
      this.setStatus(`导出失败：${(err as Error).message}`);
    }
  }

  private async exportPNGFile(): Promise<void> {
    try {
      this.setStatus('正在生成 PNG…');
      const blob = await exportPNG(this.doc, {
        dark: this.isDark(),
        pxScale: 2,
        background: this.isDark() ? '#18181b' : '#fafafa',
      });
      persist.triggerDownload(blob, `${persist.safeName(this.doc.title)}.png`);
      this.setStatus('已导出 PNG（2× 分辨率）');
    } catch (err) {
      this.setStatus(`导出失败：${(err as Error).message}`);
    }
  }

  // --------------------------------------------------------------------------
  // 指针交互
  // --------------------------------------------------------------------------

  private onPointerDown(e: PointerEvent): void {
    const w = this.toWorld(e);
    // 每种拖拽都从这里拿统一的起点字段，避免各分支重复写
    const base = { startWorld: w, startClient: { x: e.clientX, y: e.clientY } };

    // 中键 / 空格 = 平移
    if (e.button === 1 || this.spaceDown) {
      this.drag = {
        kind: 'pan',
        ...base,
        panStart: { panX: this.view.panX, panY: this.view.panY },
      };
      this.els.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    this.els.viewport.focus();

    // 1) 端口 → 开始连线
    const port = nearestPort(this.doc, w, 10);
    if (port) {
      const c = this.doc.components.find((k) => k.id === port.comp)!;
      this.drag = {
        kind: 'wire',
        ...base,
        fromPort: { kind: 'port', ref: { comp: port.comp, port: port.port } },
        fromDir: portDirWorld(c, port.port),
      };
      this.pendingWire = { a: port.pos, aDir: port.dir, b: w, bDir: 'U' };
      this.els.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 2) 拐点手柄（只在已选中该线时生效，否则会和框选冲突）
    const bend = nearestWirePoint(this.doc, w, 9);
    if (bend && bend.kind === 'vertex' && bend.idx >= 0 && this.sel.wires.includes(bend.wireId)) {
      this.beginHistory();
      this.drag = { kind: 'bend', ...base, wireId: bend.wireId, bendIdx: bend.idx };
      this.activeBend = { wireId: bend.wireId, idx: bend.idx };
      this.els.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 3) 元件
    const comp = compAt(this.doc, w);
    if (comp) {
      this.selectOne(comp.id, e.shiftKey);
      // Shift 点已选中的元件 → 取消选择（toggle 语义）
      if (!this.sel.comps.includes(comp.id)) return;
      this.beginHistory();
      const origX = new Map<string, Pt>();
      for (const id of this.sel.comps) {
        const c = this.doc.components.find((k) => k.id === id);
        if (c) origX.set(id, { x: c.x, y: c.y });
      }
      this.drag = { kind: 'comp', ...base, ids: [...this.sel.comps], origX, moved: false };
      this.els.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 4) 文本
    const txtId = textAt(this.doc, w);
    if (txtId) {
      this.selectText(txtId, e.shiftKey);
      if (!this.sel.texts.includes(txtId)) return;
      this.beginHistory();
      this.drag = { kind: 'text', ...base, textId: txtId };
      this.els.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 5) 连线
    const wl = wireAt(this.doc, w, 7);
    if (wl) {
      this.selectWire(wl.id, e.shiftKey);
      e.preventDefault();
      return;
    }

    // 6) 空白 → 框选（Shift 保留原有选择）
    if (!e.shiftKey) this.clearSelection();
    this.drag = { kind: 'marquee', ...base, additive: e.shiftKey };
    this.marquee = { x: w.x, y: w.y, w: 0, h: 0 };
    this.els.viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (d.kind === 'none') {
      // 悬停时高亮同网络
      if (this.pointerInside) this.hoverAt(e);
      return;
    }

    const w = this.toWorld(e);

    if (d.kind === 'pan') {
      const s = d.panStart!;
      this.view = { ...this.view, panX: s.panX + (e.clientX - d.startClient.x), panY: s.panY + (e.clientY - d.startClient.y) };
      this.renderAll();
      return;
    }

    if (d.kind === 'comp') {
      let dx = w.x - d.startWorld.x;
      let dy = w.y - d.startWorld.y;
      if (!d.moved && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < 3) return;
      d.moved = true;
      if (e.shiftKey) {
        // Shift = 锁定单轴
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const snapped = this.doc.snapGrid ? snapToGrid(dx, dy) : { x: dx, y: dy };
      // 相对**原始**位置重算，避免累积误差
      const origX = d.origX;
      this.doc = {
        ...this.doc,
        components: this.doc.components.map((c) => {
          const o = origX.get(c.id);
          return o ? { ...c, x: o.x + snapped.x, y: o.y + snapped.y } : c;
        }),
      };
      this.updateGuide();
      this.renderAll();
      return;
    }

    if (d.kind === 'text') {
      const s = this.doc.snapGrid ? snapToGrid(w.x, w.y) : w;
      this.doc = updateText(this.doc, d.textId, { x: s.x, y: s.y });
      this.renderAll();
      return;
    }

    if (d.kind === 'bend') {
      const wl = this.doc.wires.find((k) => k.id === d.wireId);
      if (!wl) return;
      const a = endpointPosOf(this.doc, wl.a);
      const b = endpointPosOf(this.doc, wl.b);
      const via = dragVertex(a, b, wireViaPointsOf(this.doc, wl), d.bendIdx, w);
      this.doc = updateWire(this.doc, d.wireId, { via });
      this.renderAll();
      return;
    }

    if (d.kind === 'wire') {
      const port = nearestPort(this.doc, w, 12);
      this.pendingWire = {
        a: endpointPosOf(this.doc, d.fromPort),
        aDir: d.fromDir,
        b: port ? port.pos : w,
        bDir: port ? port.dir : 'U',
      };
      this.updateGuide();
      this.renderAll();
      return;
    }

    if (d.kind === 'marquee') {
      const r = normRect(d.startWorld, w);
      this.marquee = r;
      // 只是点了一下没拖动 → 视为「点空白」，清空选择
      // 不清的话点一下空白会留下一个 0×0 的框选，applyMarquee 什么都不选，
      // 但 onPointerDown 已经 clearSelection 了，这里保持一致即可
      if (r.w < 3 && r.h < 3) {
        this.marquee = null;
        return;
      }
      this.applyMarquee(r, d.additive);
      this.renderAll();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (d.kind === 'wire') {
      const w = this.toWorld(e);
      const port = nearestPort(this.doc, w, 12);
      if (port) {
        const ref: Endpoint = { kind: 'port', ref: { comp: port.comp, port: port.port } };
        // 同一个端口自连无意义
        const same =
          d.fromPort.kind === 'port' &&
          d.fromPort.ref.comp === port.comp &&
          d.fromPort.ref.port === port.port;
        if (!same) {
          this.beginHistory();
          this.doc = addWire(this.doc, makeWire(this.doc, d.fromPort, ref));
          this.commit();
          this.setStatus('已连线');
          this.endDrag();
          return;
        }
      }
    }
    this.endDrag();
  }

  private endDrag(): void {
    const d = this.drag;
    switch (d.kind) {
      case 'comp':
        if (d.moved) {
          this.commit();
          this.setStatus(`移动 ${d.ids.length} 个元件`);
        } else {
          // 没真正拖动：撤掉刚记的空快照，否则按一下撤销键「没反应」
          this.history.past.pop();
        }
        break;
      case 'text':
      case 'bend':
        this.commit();
        break;
      case 'wire':
        // 未落到端口 → 丢弃。保持「连线必须接到端口」的约定，避免半截线
        this.setStatus(this.pendingWire ? '未连接到端口，已取消' : '');
        break;
      case 'marquee':
        if (this.marquee) {
          this.setStatus(`选中 ${this.sel.comps.length} 元件 / ${this.sel.wires.length} 连线`);
        }
        break;
      default:
        break;
    }

    this.drag = NO_DRAG;
    this.pendingWire = null;
    this.guide = null;
    this.marquee = null;
    this.activeBend = null;
    this.renderAll();
  }

  private onDblClick(e: MouseEvent): void {
    const w = this.toWorld(e);
    const comp = compAt(this.doc, w);
    if (!comp) return;
    // 双击空白处新增文本
    this.beginHistory();
    const s = this.doc.snapGrid ? snapToGrid(w.x, w.y) : w;
    this.doc = { ...this.doc, texts: [...this.doc.texts, { id: nextId('t'), x: s.x, y: s.y, text: '标注', size: 12, align: 'left', color: 'ink', bold: false, rot: 0 }] };
    this.commit();
    this.setStatus('已加文本，可直接在右侧改内容');
  }

  // --------------------------------------------------------------------------
  // 选择
  // --------------------------------------------------------------------------

  private clearSelection(): void {
    this.sel = { comps: [], wires: [], texts: [] };
    this.renderAll();
  }

  private selectOne(id: string, additive: boolean): void {
    if (additive) {
      this.sel.comps = this.sel.comps.includes(id)
        ? this.sel.comps.filter((k) => k !== id)
        : [...this.sel.comps, id];
      this.sel.wires = [];
      this.sel.texts = [];
    } else {
      this.sel = { comps: [id], wires: [], texts: [] };
    }
    this.renderAll();
  }

  private selectWire(id: string, additive: boolean): void {
    if (additive) {
      this.sel.wires = this.sel.wires.includes(id)
        ? this.sel.wires.filter((k) => k !== id)
        : [...this.sel.wires, id];
      this.sel.comps = [];
      this.sel.texts = [];
    } else {
      this.sel = { comps: [], wires: [id], texts: [] };
    }
    this.renderAll();
  }

  private selectText(id: string, additive: boolean): void {
    if (additive) {
      this.sel.texts = this.sel.texts.includes(id)
        ? this.sel.texts.filter((k) => k !== id)
        : [...this.sel.texts, id];
    } else {
      this.sel = { comps: [], wires: [], texts: [id] };
    }
    this.renderAll();
  }

  private applyMarquee(r: Rect, additive: boolean): void {
    const hitComps = this.doc.components.filter((c) => {
      const b = compBBox(c);
      return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    }).map((c) => c.id);
    const hitWires = this.doc.wires.filter((wl) => {
      const pts = wirePts(this.doc, wl);
      return pts.some((p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    }).map((wl) => wl.id);
    this.sel = additive
      ? { comps: uniq([...this.sel.comps, ...hitComps]), wires: uniq([...this.sel.wires, ...hitWires]), texts: this.sel.texts }
      : { comps: hitComps, wires: hitWires, texts: [] };
  }

  // --------------------------------------------------------------------------
  // 键盘
  // --------------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }

    const mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space' && !mod) {
      this.spaceDown = true;
      this.root.classList.add('mc-space');
      e.preventDefault();
      return;
    }

    // ---- 旋转（用户明确要求 R / Ctrl+R） ----
    if ((e.key === 'r' || e.key === 'R') && this.sel.comps.length) {
      e.preventDefault();
      if (mod) return; // Ctrl+R 是浏览器刷新，不劫持
      this.beginHistory();
      this.doc = rotateComps(this.doc, new Set(this.sel.comps), 1);
      this.commit();
      this.setStatus('顺时针旋转 90°（Ctrl+Shift+R 反向）');
      return;
    }
    if (mod && (e.key === 'R' || e.key === 'r') && e.shiftKey && this.sel.comps.length) {
      e.preventDefault();
      this.beginHistory();
      this.doc = rotateComps(this.doc, new Set(this.sel.comps), -1);
      this.commit();
      this.setStatus('逆时针旋转 90°');
      return;
    }

    if ((e.key === 'x' || e.key === 'X') && !mod && this.sel.comps.length) {
      this.beginHistory();
      this.doc = flipComps(this.doc, new Set(this.sel.comps));
      this.commit();
      this.setStatus('水平镜像');
      return;
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        const n = redo(this.history, this.doc);
        if (n) {
          this.doc = n;
          this.commit();
          this.setStatus('已重做');
        }
      } else {
        const p = undo(this.history, this.doc);
        if (p) {
          this.doc = p;
          this.commit();
          this.setStatus('已撤销');
        } else {
          this.setStatus('没有可撤销的操作');
        }
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      const n = redo(this.history, this.doc);
      if (n) {
        this.doc = n;
        this.commit();
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.sel = {
        comps: this.doc.components.map((c) => c.id),
        wires: this.doc.wires.map((w) => w.id),
        texts: this.doc.texts.map((t) => t.id),
      };
      this.renderAll();
      this.setStatus('已全选');
      return;
    }

    if (mod && e.key.toLowerCase() === 'c') {
      this.clip = this.captureClip();
      this.setStatus(this.clip ? '已复制' : '没有选中内容');
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      if (this.clip) {
        this.beginHistory();
        const res = pasteClip(this.doc, this.clip);
        this.doc = res.doc;
        this.sel = res.sel;
        this.commit();
        this.setStatus('已粘贴');
      }
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
      if (this.clip) {
        const spec = prompt('阵列复制：行×列（例：2x3）', '2x3');
        if (spec) {
          const m = /^(\d+)\s*[x×*]\s*(\d+)$/.exec(spec.trim());
          if (m) {
            const rows = Math.min(20, Math.max(1, Number(m[1])));
            const cols = Math.min(20, Math.max(1, Number(m[2])));
            this.beginHistory();
            const res = arrayCopy(this.doc, this.clipSel(), rows, cols, GRID * 6, GRID * 5);
            this.doc = res.doc;
            this.sel = res.sel;
            this.commit();
            this.setStatus(`阵列复制 ${rows}×${cols}`);
          }
        }
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this.sel.comps.length && !this.sel.wires.length && !this.sel.texts.length) return;
      e.preventDefault();
      this.deleteSelection();
      return;
    }

    if (e.key === 'Escape') {
      this.clearSelection();
      this.setStatus('');
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      this.fitView();
      return;
    }

    // 方向键微调 1 格（Shift = 5 格）
    if (e.key.startsWith('Arrow') && (this.sel.comps.length || this.sel.texts.length)) {
      e.preventDefault();
      const step = e.shiftKey ? GRID * 5 : GRID;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.beginHistory();
      this.doc = moveComps(this.doc, new Set(this.sel.comps), dx, dy);
      this.doc = {
        ...this.doc,
        texts: this.doc.texts.map((t) => (this.sel.texts.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
      };
      this.commit();
      return;
    }

    if (e.key === '+' || e.key === '=') {
      this.zoomAtCenter(1.2);
      return;
    }
    if (e.key === '-' || e.key === '_') {
      this.zoomAtCenter(1 / 1.2);
      return;
    }
  }

  private deleteSelection(): void {
    this.beginHistory();
    const n = this.sel.comps.length + this.sel.wires.length + this.sel.texts.length;
    this.doc = removeComps(this.doc, new Set(this.sel.comps));
    this.doc = removeTexts(this.doc, new Set(this.sel.texts));
    for (const id of this.sel.wires) this.doc = removeWires(this.doc, id);
    this.sel = { comps: [], wires: [], texts: [] };
    this.commit();
    this.setStatus(`已删除 ${n} 个对象`);
  }

  private captureClip(): MosDoc | null {
    if (!this.sel.comps.length && !this.sel.wires.length && !this.sel.texts.length) return null;
    return {
      ...this.doc,
      components: this.doc.components.filter((c) => this.sel.comps.includes(c.id)),
      wires: this.doc.wires.filter((w) => this.sel.wires.includes(w.id)),
      texts: this.doc.texts.filter((t) => this.sel.texts.includes(t.id)),
    };
  }

  private clipSel(): Selection {
    return {
      comps: (this.clip?.components ?? []).map((c) => c.id),
      wires: (this.clip?.wires ?? []).map((w) => w.id),
      texts: (this.clip?.texts ?? []).map((t) => t.id),
    };
  }

  // --------------------------------------------------------------------------
  // 缩放与视图
  // --------------------------------------------------------------------------

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const r = this.viewportRect();
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * factor));
    const k = next / this.view.zoom - 1;
    // 以光标为锚点：保持光标下的世界坐标不动
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    this.view = { zoom: next, panX: this.view.panX - cx * k, panY: this.view.panY - cy * k };
    this.renderAll();
  }

  private zoomAtCenter(factor: number): void {
    const r = this.viewportRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  fitView(): void {
    const r = this.viewportRect();
    // 视口高度为 0 时会把缩放算成极小值，看起来像「缩放坏了」。直接跳过。
    if (r.width < 20 || r.height < 20) return;
    const b = ensureMinSize(boundsOf(this.doc, 30), 300, 220);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(r.width / b.w, r.height / b.h)));
    this.view = {
      zoom,
      panX: (r.width - b.w * zoom) / 2 - b.x * zoom,
      panY: (r.height - b.h * zoom) / 2 - b.y * zoom,
    };
    this.renderAll();
  }

  // --------------------------------------------------------------------------
  // 吸附参考线
  // --------------------------------------------------------------------------

  private updateGuide(): void {
    const d = this.drag;
    if ((d.kind !== 'comp' && d.kind !== 'wire') || !this.doc.snapTrack) {
      this.guide = null;
      return;
    }
    // 用「正在拖的落点」去找对齐目标，命中栅极列/电源轨时画参考线
    const ref: Pt | null =
      d.kind === 'wire'
        ? (this.pendingWire?.b ?? null)
        : d.ids.length
          ? (() => {
              const c = this.doc.components.find((k) => k.id === d.ids[0]);
              return c ? { x: c.x, y: c.y } : null;
            })()
          : null;
    if (!ref) {
      this.guide = null;
      return;
    }
    const s: SnapResult = snapPoint(this.doc, ref, { snapGrid: this.doc.snapGrid, snapTrack: true }, 0);
    this.guide = s.refLine ?? null;
  }

  private hoverAt(e: PointerEvent): void {
    const w = this.toWorld(e);
    const port = nearestPort(this.doc, w, 10);
    const onWire = port ? null : wireAt(this.doc, w, 7);
    this.els.viewport.style.cursor = port || onWire ? 'pointer' : '';
  }

  /**
   * 空闲帧。
   *
   * 只在确有需要时重绘 —— 全量 innerHTML 重建在拖拽时是浪费，
   * 而且会打断浏览器对当前 pointer 的捕获。
   */
  private rafId = 0;
  private loop(): void {
    this.rafId = requestAnimationFrame(() => this.loop());
  }
}

// ============================================================================
// 辅助
// ============================================================================

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}

function normRect(a: Pt, b: Pt): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function colorName(t: ColorToken): string {
  return { ink: '墨黑', muted: '灰', accent: '强调', red: '红', green: '绿', blue: '蓝', orange: '橙' }[t];
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function endpointPosOf(doc: MosDoc, e: Endpoint): Pt {
  if (e.kind === 'free') return { x: e.x, y: e.y };
  const c = doc.components.find((k) => k.id === e.ref.comp);
  return c ? portWorld(c, e.ref.port) : { x: 0, y: 0 };
}

function wireViaPointsOf(doc: MosDoc, w: Wire): Pt[] {
  return wirePts(doc, w).slice(1, -1);
}

/** 粘贴剪贴板（内部重分配 ID —— 不重分配会和原文撞号） */
function pasteClip(doc: MosDoc, clip: MosDoc): { doc: MosDoc; sel: Selection } {
  const idMap = new Map<string, string>();
  const comps = clip.components.map((c) => {
    const nid = nextId('c');
    idMap.set(c.id, nid);
    return { ...c, id: nid, x: c.x + GRID, y: c.y + GRID };
  });
  const remap = (e: Endpoint): Endpoint =>
    e.kind === 'free'
      ? { kind: 'free', x: e.x + GRID, y: e.y + GRID }
      : { kind: 'port', ref: { comp: idMap.get(e.ref.comp) ?? e.ref.comp, port: e.ref.port } };
  const wires = clip.wires.map((w) => ({
    ...w,
    id: nextId('w'),
    a: remap(w.a),
    b: remap(w.b),
    via: w.via.map((p) => ({ x: p.x + GRID, y: p.y + GRID })),
  }));
  const texts = clip.texts.map((t) => ({ ...t, id: nextId('t'), x: t.x + GRID, y: t.y + GRID }));
  return {
    doc: { ...doc, components: [...doc.components, ...comps], wires: [...doc.wires, ...wires], texts: [...doc.texts, ...texts] },
    sel: { comps: comps.map((c) => c.id), wires: wires.map((w) => w.id), texts: texts.map((t) => t.id) },
  };
}
