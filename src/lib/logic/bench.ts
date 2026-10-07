import { gateDef, portName, portGroups, symbolFor } from './gates';
import { topoSort } from './topology';
import { MAX_ZOOM, MIN_ZOOM, WORLD_H, WORLD_W, uid } from './types';
import type { Circuit, Edge, GateKind, LogicNode } from './types';

/** 元件基础尺寸（端口多时纵向按 metric 拉高） */
const NODE_W = 84;
const NODE_H = 56;

/** 画成「门图形」而不是矩形的元件类型 */
/**
 * 这些元件的端口要内缩一点，因为它们的图形比元素盒子小
 * （IO 类是小圆角盒，SEG7 有额外内衬）
 */
const SHAPE_NODES = new Set<GateKind>(['INPUT', 'SWITCH', 'CONST', 'OUTPUT', 'PROBE']);

/** 画成小圆角端子的元件（不需要逻辑门那么大的盒子） */
const IO_NODES = new Set<GateKind>(['INPUT', 'SWITCH', 'CONST', 'OUTPUT', 'PROBE']);

export interface NodeMetric {
  w: number;
  h: number;
  inputs: number;
  outputs: number;
}

export interface Selection {
  kind: 'node' | 'edge' | null;
  id: string | null;
}

/**
 * 画布控制器
 *
 * 渲染策略：**SVG 画连线 + 绝对定位 HTML 画元件**
 * - 元件用 HTML → 直接套 Tailwind，亮暗模式与站点完全一致，文字排版简单
 * - 端口是真实 DOM → 命中测试就是普通事件，不用做「SVG 缩放后坐标换算」，
 *   这是交互式电路编辑器最容易踩的坑
 * - 连线用 SVG path → 描边/虚线/流动动画都好做，且z-index 在元件之下
 * - 二者放在同一个 world 容器里共享同一个 transform，天然对齐
 */
export class LogicBench {
  readonly root: HTMLElement;

  private viewport!: HTMLElement;
  private world!: HTMLElement;
  private wiresSvg!: SVGSVGElement;
  private nodeLayer!: HTMLElement;

  circuit: Circuit;

  /** 视口变换 */
  private panX = 40;
  private panY = 40;
  private zoom = 1;

  private selection: Selection = { kind: null, id: null };
  private nodeEls = new Map<string, HTMLElement>();
  private edgeEls = new Map<string, SVGPathElement>();
  private tempPath: SVGPathElement | null = null;

  /** playhead 高亮的节点值：nodeId → boolean[] */
  private liveValues: Map<string, boolean[]> | null = null;
  private cycleNodes = new Set<string>();
  private unconnectedPorts = new Set<string>();

  /** 交互临时状态 */
  private dragNode: { id: string; startX: number; startY: number; origX: number; origY: number } | null = null;
  private dragWire: { fromNode: string; fromPort: number } | null = null;
  private panDrag: { startX: number; startY: number; origPanX: number; origPanY: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;

  /** 监听器：供外部（页面）订阅变化 */
  private listeners = new Set<(reason: string) => void>();
  /** 撤销栈 */
  private undoStack: Circuit[] = [];
  private redoStack: Circuit[] = [];
  private snapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, circuit: Circuit) {
    this.root = root;
    this.circuit = circuit;
    this.buildDom();
    this.bindEvents();
    this.renderAll();
  }

  // ============================================================
  // DOM 骨架
  // ============================================================

  private buildDom() {
    this.root.innerHTML = '';
    this.root.classList.add('lc-viewport');

    this.viewport = document.createElement('div');
    this.viewport.className = 'lc-vp';

    this.world = document.createElement('div');
    this.world.className = 'lc-world';

    this.wiresSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.wiresSvg.setAttribute('class', 'lc-wires');
    this.wiresSvg.setAttribute('viewBox', `0 0 ${WORLD_W} ${WORLD_H}`);
    this.wiresSvg.setAttribute('width', String(WORLD_W));
    this.wiresSvg.setAttribute('height', String(WORLD_H));

    this.nodeLayer = document.createElement('div');
    this.nodeLayer.className = 'lc-nodes';

    this.world.appendChild(this.wiresSvg);
    this.world.appendChild(this.nodeLayer);
    this.viewport.appendChild(this.world);
    this.root.appendChild(this.viewport);
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  private bindEvents() {
    const vp = this.viewport;

    vp.addEventListener('pointerdown', this.onPointerDown);
    vp.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    vp.addEventListener('wheel', this.onWheel, { passive: false });
    vp.addEventListener('dragover', this.onDragOver);
    vp.addEventListener('drop', this.onDrop);
    vp.addEventListener('contextmenu', this.onContextMenu);
  }

  destroy() {
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  /** 订阅变化通知 */
  onChange(fn: (reason: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: string) {
    this.listeners.forEach((fn) => fn(reason));
  }

  // ============================================================
  // 渲染
  // ============================================================

  /**
   * 元件尺寸
   *
   * 三类元件分别对待：
   * - IO 类（输入/输出/常量/开关/探针）是「端子」，画成小圆角盒就够了
   * - 端口多的复合元件（MUX8 有 11 个输入）要纵向拉高才排得开
   * - 普通逻辑门用基线尺寸
   */
  private metric(node: LogicNode): NodeMetric {
    const ports = Math.max(node.inputs, node.outputs, 1);
    if (IO_NODES.has(node.type)) {
      // 端子：横向短一点，竖向按端口数
      return { w: 64, h: Math.max(34, ports * 18 + 16), inputs: node.inputs, outputs: node.outputs };
    }
    // 端口多时纵向拉高：11 个输入需要 11*18+22 = 220px
    const h = Math.max(NODE_H, ports * 18 + 22);
    // 端口多时略微加宽，框内限定符才放得下（MUX / DEC）
    const w = ports > 4 ? NODE_W + 18 : NODE_W;
    return { w, h, inputs: node.inputs, outputs: node.outputs };
  }

  /**
   * 端口相对节点左上角的位置
   *
   * 门图形元件（AND/OR/NOT/…、DFF、CUSTOM）的图形有 6px 内边距，
   * 端口要贴在图形边缘上，而不是外层盒子的边缘；
   * 输入 / 输出 / 常量仍是矩形盒子，端口贴盒子边缘。
   */
  private inPort(node: LogicNode, port: number): { x: number; y: number } {
    const m = this.metric(node);
    const n = Math.max(1, node.inputs);
    const span = m.h - 20;
    const step = n === 1 ? 0 : span / (n - 1);
    return { x: node.x + this.shapeInset(node), y: node.y + 10 + step * port };
  }

  private outPort(node: LogicNode, port: number): { x: number; y: number } {
    const m = this.metric(node);
    const n = Math.max(1, node.outputs);
    const span = m.h - 20;
    const step = n === 1 ? 0 : span / (n - 1);
    return { x: node.x + m.w - this.shapeInset(node), y: node.y + 10 + step * port };
  }

  /** 图形内缩距离：与 CSS 里 .lc-node[data-glyph]::before 的 inset 5px 保持一致 */
  private shapeInset(node: LogicNode): number {
    return SHAPE_NODES.has(node.type) ? 5 : 0;
  }

  renderAll() {
    this.applyTransform();
    // 顺序要紧：refreshDiagnostics 算出环路/未连接端口，
    // renderNodes/renderWires 再把这些状态映射成 CSS class。反了就慢一拍。
    this.refreshDiagnostics();
    this.renderNodes();
    this.renderWires();
  }

  private applyTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    // 网格随缩放走，保持视觉密度恒定
    const g = 24 * this.zoom;
    this.viewport.style.setProperty('--lc-grid', `${g}px`);
    this.viewport.style.setProperty('--lc-grid2', `${g * 5}px`);
  }

  private renderNodes() {
    const keep = new Set(this.circuit.nodes.map((n) => n.id));
    // 移除已删节点
    for (const [id, el] of this.nodeEls) {
      if (!keep.has(id)) {
        el.remove();
        this.nodeEls.delete(id);
      }
    }

    for (const node of this.circuit.nodes) {
      let el = this.nodeEls.get(node.id);
      if (!el) {
        el = this.createNodeEl(node);
        this.nodeLayer.appendChild(el);
        this.nodeEls.set(node.id, el);
      }
      this.updateNodeEl(node, el);
    }
  }

  private createNodeEl(node: LogicNode): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lc-node';
    el.dataset.id = node.id;
    el.classList.add(`lc-node-${node.type.toLowerCase()}`);

    // 拖动把手（整块都是，保留一个透明层接收指针）
    const grab = document.createElement('div');
    grab.className = 'lc-node-grab';
    el.appendChild(grab);

    // IEC 方框的框内限定符（& ≥1 = 1 XOR Σ MUX …）
    const qual = document.createElement('div');
    qual.className = 'lc-sym-qual';
    el.appendChild(qual);

    // 用户自定义名（显示在框下方，不挤占框内）
    const cap = document.createElement('div');
    cap.className = 'lc-sym-caption';
    el.appendChild(cap);

    // 值徽标（playhead / 波形显示当前 0/1）
    const badge = document.createElement('span');
    badge.className = 'lc-node-val';
    el.appendChild(badge);

    // 输入端口（带端口标签，如 D0 / S0）
    for (let p = 0; p < node.inputs; p += 1) {
      const port = document.createElement('div');
      port.className = 'lc-port lc-port-in';
      port.dataset.node = node.id;
      port.dataset.port = String(p);
      port.dataset.kind = 'in';
      port.title = portName(node, p, 'in');
      el.appendChild(port);

      const nm = portName(node, p, 'in');
      if (nm) {
        const lab = document.createElement('i');
        lab.className = 'lc-port-label lc-port-label-in';
        lab.dataset.node = node.id;
        lab.dataset.port = String(p);
        lab.textContent = nm;
        el.appendChild(lab);
      }
    }

    // 输出端口
    for (let p = 0; p < node.outputs; p += 1) {
      const port = document.createElement('div');
      port.className = 'lc-port lc-port-out';
      port.dataset.node = node.id;
      port.dataset.port = String(p);
      port.dataset.kind = 'out';
      port.title = portName(node, p, 'out');
      el.appendChild(port);

      const onm = portName(node, p, 'out');
      if (onm) {
        const lab = document.createElement('i');
        lab.className = 'lc-port-label lc-port-label-out';
        lab.dataset.node = node.id;
        lab.dataset.port = String(p);
        lab.textContent = onm;
        el.appendChild(lab);
      }
    }

    // 节点拖动 / 选中统一在 onPointerDown 里处理（那里能拿到 closest('.lc-node')），
    // 这里只负责停止事件冒泡到端口逻辑之外
    return el;
  }

  private renderWires() {
    const byId = new Map(this.circuit.nodes.map((n) => [n.id, n]));
    const keep = new Set(this.circuit.edges.map((e) => e.id));

    for (const [id, el] of this.edgeEls) {
      if (!keep.has(id)) {
        el.remove();
        this.edgeEls.delete(id);
      }
    }

    for (const edge of this.circuit.edges) {
      let el = this.edgeEls.get(edge.id);
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('class', 'lc-wire');
        el.dataset.id = edge.id;
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.select('edge', edge.id);
        });
        this.wiresSvg.appendChild(el);
        this.edgeEls.set(edge.id, el);
      }
      this.updateWireEl(edge, el, byId);
    }
  }

  private updateWireEl(
    edge: Edge,
    el: SVGPathElement,
    byId: Map<string, LogicNode>
  ) {
    const from = byId.get(edge.from.node);
    const to = byId.get(edge.to.node);
    if (!from || !to) {
      el.setAttribute('d', '');
      return;
    }
    const p1 = this.outPort(from, edge.from.port);
    const p2 = this.inPort(to, edge.to.port);
    el.setAttribute('d', bezier(p1.x, p1.y, p2.x, p2.y));

    // 命中区域：一条粗的透明path 盖在上面，方便点中细线
    if (!el.nextElementSibling || !el.nextElementSibling.classList.contains('lc-wire-hit')) {
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('class', 'lc-wire-hit');
      hit.dataset.id = edge.id;
      hit.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select('edge', edge.id);
      });
      el.after(hit);
      this.edgeEls.set(edge.id, el);
    }

    const selected = this.selection.kind === 'edge' && this.selection.id === edge.id;
    el.classList.toggle('is-selected', selected);

    // 值高亮：playhead 播放时为 1 的线流动
    const srcVal = this.liveValues?.get(from.id)?.[edge.from.port];
    el.classList.toggle('is-hot', this.liveValues !== null && srcVal === true);
  }
  /** 重新计算环路与未连接端口标记 */
  refreshDiagnostics() {
    const topo = topoSort(this.circuit);
    this.cycleNodes = new Set(topo.cycleNodes);

    // 未连接输入端口 → 灰色虚线提示
    this.unconnectedPorts.clear();
    const linked = new Set<string>();
    for (const e of this.circuit.edges) linked.add(`${e.to.node}:${e.to.port}`);
    for (const n of this.circuit.nodes) {
      for (let p = 0; p < n.inputs; p += 1) {
        if (!linked.has(`${n.id}:${p}`)) this.unconnectedPorts.add(`${n.id}:${p}`);
      }
    }

    this.nodeEls.forEach((el, id) => {
      el.querySelectorAll<HTMLElement>('.lc-port-in').forEach((p) => {
        p.classList.toggle('is-open', this.unconnectedPorts.has(`${id}:${p.dataset.port}`));
      });
    });
  }

  /**
   * 元件下方的小字说明（用户自定义名）
   * 框内已经有 IEC 限定符了，所以名字放框外，避免和 & ≥1 这类符号挤在一起
   */
  private nodeCaption(node: LogicNode): string {
    if (node.type === 'INPUT' || node.type === 'OUTPUT') return node.name ?? '';
    if (node.type === 'CUSTOM') return node.name ?? '';
    if (node.type === 'PROBE') return node.name ?? '';
    return '';
  }

  private updateNodeEl(node: LogicNode, el: HTMLElement) {
    const m = this.metric(node);
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${m.w}px`;
    el.style.height = `${m.h}px`;

    // 符号规格：驱动 CSS 画框内限定符与形状
    const spec = symbolFor(node);
    el.dataset.shape = spec.shape;
    el.dataset.bubble = spec.bubble ?? '';

    const qual = el.querySelector('.lc-sym-qual') as HTMLElement | null;
    if (qual) qual.textContent = spec.qualifier;

    const cap = el.querySelector('.lc-sym-caption') as HTMLElement | null;
    if (cap) {
      const name = this.nodeCaption(node);
      cap.textContent = name;
      cap.style.display = name ? '' : 'none';
    }

    // 开关 / 常量的框内直接显示当前值
    if (node.type === 'SWITCH' || node.type === 'CONST') {
      const v = node.type === 'SWITCH' ? (node.switchValue ?? false) : (node.constValue ?? false);
      if (qual) qual.textContent = v ? '1' : '0';
      el.classList.toggle('is-on', v);
    }

    // 端口数量变化时重建
    const ins = el.querySelectorAll('.lc-port-in').length;
    const outs = el.querySelectorAll('.lc-port-out').length;
    if (ins !== node.inputs || outs !== node.outputs) {
      el.remove();
      this.nodeEls.delete(node.id);
      const fresh = this.createNodeEl(node);
      this.nodeLayer.appendChild(fresh);
      this.nodeEls.set(node.id, fresh);
      this.updateNodeEl(node, fresh);
      return;
    }

    // 端口定位 + 端口标签定位
    el.querySelectorAll<HTMLElement>('.lc-port-in').forEach((p) => {
      const idx = Number(p.dataset.port);
      const pos = this.inPort(node, idx);
      p.style.left = `${pos.x - node.x}px`;
      p.style.top = `${pos.y - node.y}px`;

      const lab = el.querySelector<HTMLElement>(
        `.lc-port-label-in[data-port="${idx}"]`
      );
      if (lab) {
        // 锚在端口圆心，由 CSS 的 transform 决定往哪边让开
        lab.style.left = `${pos.x - node.x}px`;
        lab.style.top = `${pos.y - node.y}px`;
        // 选择位用不同颜色区分（末 selBits 个）
        const { data, sel } = portGroups(node);
        lab.classList.toggle('is-sel', sel > 0 && idx >= data);
      }
    });
    el.querySelectorAll<HTMLElement>('.lc-port-out').forEach((p) => {
      const idx = Number(p.dataset.port);
      const pos = this.outPort(node, idx);
      p.style.left = `${pos.x - node.x}px`;
      p.style.top = `${pos.y - node.y}px`;

      const lab = el.querySelector<HTMLElement>(
        `.lc-port-label-out[data-port="${idx}"]`
      );
      if (lab) {
        lab.style.left = `${pos.x - node.x}px`;
        lab.style.top = `${pos.y - node.y}px`;
      }
    });

    // 状态类
    el.classList.toggle('is-selected', this.selection.kind === 'node' && this.selection.id === node.id);
    el.classList.toggle('is-cycle', this.cycleNodes.has(node.id));

    // 值徽标
    const badge = el.querySelector('.lc-node-val') as HTMLElement;
    if (badge) {
      const v = this.liveValues?.get(node.id);
      if (this.liveValues && v && v.length > 0) {
        badge.textContent = v.map(Number).join('');
        badge.className = `lc-node-val is-on${v[0] ? ' v1' : ' v0'}`;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // 常量节点高亮 0/1
    el.classList.toggle('is-const-1', node.type === 'CONST' && node.constValue);
    el.classList.toggle('is-const-0', node.type === 'CONST' && !node.constValue);
    // 输入被 pin 时灰显
    el.classList.toggle('is-pinned', node.type === 'INPUT' && !!node.pinned);
  }

  // ============================================================
  // 选择
  // ============================================================

  select(kind: 'node' | 'edge' | null, id: string | null) {
    this.selection = { kind, id };
    this.renderNodes();
    this.renderWires();
    this.emit('select');
  }

  getSelection(): Selection {
    return this.selection;
  }

  private onContextMenu = (e: MouseEvent) => {
    // 右键空白处：清空选择
    if (e.target === this.viewport || (e.target as HTMLElement).classList.contains('lc-world')) {
      this.select(null, null);
    }
  };

  // ============================================================
  // 指针交互
  // ============================================================

  private onPointerDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement;

    // 记录所有指针（用于双指缩放）
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      this.dragNode = null;
      this.dragWire = null;
      this.panDrag = null;
      return;
    }

    // 点端口 → 开始连线
    if (target.classList.contains('lc-port')) {
      e.stopPropagation();
      const nodeId = target.dataset.node!;
      const port = Number(target.dataset.port);
      const kind = target.dataset.kind;
      const node = this.circuit.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      if (kind === 'out') {
        this.dragWire = { fromNode: nodeId, fromPort: port };
        this.startTempWire(node, port);
      } else {
        // 输入端口：先选中该节点（移动端靠这个完成连线）
        this.select('node', nodeId);
        this.pendingInput = { nodeId, port };
      }
      return;
    }

    // 点元件 → 选中 + 准备拖动
    const nodeEl = target.closest('.lc-node') as HTMLElement | null;
    if (nodeEl) {
      const id = nodeEl.dataset.id!;
      this.select('node', id);
      // 移动端「点输出 → 点输入」模式：第一次点输出端口会设 pendingOutput
      if (this.pendingOutput && this.pendingOutput.nodeId === id) {
        this.pendingOutput = null;
        return;
      }
      const node = this.circuit.nodes.find((n) => n.id === id);
      if (!node) return;
      this.dragNode = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        origX: node.x,
        origY: node.y,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.stopPropagation();
      return;
    }

    // 点空白 → 平移 + 清选择
    this.select(null, null);
    this.panDrag = {
      startX: e.clientX,
      startY: e.clientY,
      origPanX: this.panX,
      origPanY: this.panY,
    };
  };

  /** 移动端点选连线用 */
  pendingInput: { nodeId: string; port: number } | null = null;
  pendingOutput: { nodeId: string; port: number } | null = null;

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 双指缩放
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch.dist > 0) {
        this.setZoom(this.pinch.zoom * (d / this.pinch.dist), a.x, a.y);
      }
      return;
    }

    // 拖动节点
    if (this.dragNode) {
      const node = this.circuit.nodes.find((n) => n.id === this.dragNode!.id);
      if (node) {
        const dx = (e.clientX - this.dragNode.startX) / this.zoom;
        const dy = (e.clientY - this.dragNode.startY) / this.zoom;
        node.x = Math.round(this.dragNode.origX + dx);
        node.y = Math.round(this.dragNode.origY + dy);
        this.renderNodes();
        this.renderWires();
      }
      return;
    }

    // 拖线
    if (this.dragWire && this.tempPath) {
      const rect = this.viewport.getBoundingClientRect();
      const wx = (e.clientX - rect.left - this.panX) / this.zoom;
      const wy = (e.clientY - rect.top - this.panY) / this.zoom;
      const from = this.circuit.nodes.find((n) => n.id === this.dragWire!.fromNode);
      if (from) {
        const p1 = this.outPort(from, this.dragWire.fromPort);
        this.tempPath.setAttribute('d', bezier(p1.x, p1.y, wx, wy));
      }
      return;
    }

    // 平移画布
    if (this.panDrag) {
      this.panX = this.panDrag.origPanX + (e.clientX - this.panDrag.startX);
      this.panY = this.panDrag.origPanY + (e.clientY - this.panDrag.startY);
      this.applyTransform();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;

    // 结束拖动节点
    if (this.dragNode) {
      this.dragNode = null;
      this.emit('move');
    }

    // 结束连线：看有没有落在输入端口上
    if (this.dragWire) {
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (target?.classList.contains('lc-port-in')) {
        this.connect(this.dragWire.fromNode, this.dragWire.fromPort, target.dataset.node!, Number(target.dataset.port));
      }
      this.dragWire = null;
      this.clearTempWire();
    }

    // 移动端点选模式：落点如果在别的输出端口上，记为 pendingOutput
    if (this.pendingInput) {
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (target?.classList.contains('lc-port-out')) {
        this.connect(
          target.dataset.node!,
          Number(target.dataset.port),
          this.pendingInput.nodeId,
          this.pendingInput.port
        );
        this.pendingInput = null;
      }
    }

    this.panDrag = null;
  };

  // ============================================================
  // 缩放平移
  // ============================================================

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.setZoom(this.zoom * factor, cx, cy);
  };

  /** 以视口内某点为锚点缩放 */
  setZoom(next: number, anchorX?: number, anchorY?: number) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (z === this.zoom) return;
    if (anchorX === undefined || anchorY === undefined) {
      this.zoom = z;
    } else {
      // 保持锚点下的世界坐标不动
      const k = z / this.zoom - 1;
      this.panX -= (anchorX - this.panX) * k;
      this.panY -= (anchorY - this.panY) * k;
      this.zoom = z;
    }
    this.applyTransform();
    this.emit('view');
  }

  zoomBy(factor: number) {
    const rect = this.viewport.getBoundingClientRect();
    this.setZoom(this.zoom * factor, rect.width / 2, rect.height / 2);
  }

  resetView() {
    this.panX = 40;
    this.panY = 40;
    this.zoom = 1;
    this.applyTransform();
    this.emit('view');
  }

  /** 取当前平移量（把元件放到视口中心时需要） */
  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  /** 直接放置一个节点（点击元件库时用，比拖拽更适合触屏） */
  placeNode(node: LogicNode, x: number, y: number) {
    node.x = x;
    node.y = y;
    this.pushSnapshot();
    this.circuit.nodes.push(node);
    this.commit('add');
    this.select('node', node.id);
  }

  getZoom() {
    return this.zoom;
  }

  /** 缩放到刚好装下所有节点 */
  fitToView() {
    const nodes = this.circuit.nodes;
    const rect = this.viewport.getBoundingClientRect();
    if (nodes.length === 0 || rect.width === 0) {
      this.resetView();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const m = this.metric(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + m.w);
      maxY = Math.max(maxY, n.y + m.h);
    }
    const pad = 48;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const z = Math.max(MIN_ZOOM, Math.min(1.4, Math.min(rect.width / w, rect.height / h)));
    this.zoom = z;
    this.panX = (rect.width - (maxX - minX) * z) / 2 - minX * z;
    this.panY = (rect.height - (maxY - minY) * z) / 2 - minY * z;
    this.applyTransform();
    this.emit('view');
  }

  // ============================================================
  // 拖放新建
  // ============================================================

  private onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  private onDrop = (e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/x-logic-gate');
    const kind = raw as GateKind | '';
    if (!kind) return;

    const rect = this.viewport.getBoundingClientRect();
    const wx = (e.clientX - rect.left - this.panX) / this.zoom;
    const wy = (e.clientY - rect.top - this.panY) / this.zoom;

    // 让元件中心落在落点上
    const node = this.makeNode(kind, Math.round(wx - NODE_W / 2), Math.round(wy - NODE_H / 2));
    this.addNode(node);
  };

  /** 按类型创建一个新元件（带合理默认输入数） */
  makeNode(kind: GateKind, x: number, y: number): LogicNode {
    const def = gateDef(kind);
    const id = uid(kind.toLowerCase().slice(0, 3));
    const base: LogicNode = {
      id,
      type: kind,
      x,
      y,
      inputs: def.inputs,
      outputs: def.outputs,
    };
    switch (kind) {
      case 'INPUT':
        // 输入名自动按现有数量往后排
        return { ...base, name: this.nextInputName() };
      case 'OUTPUT':
        return { ...base, name: this.nextOutputName() };
      case 'CONST':
        return { ...base, constValue: false };
      case 'CUSTOM': {
        const box = this.customLookup?.(this.pendingCustomId ?? '');
        return {
          ...base,
          inputs: box?.inputs ?? 2,
          outputs: box?.outputs ?? 1,
          customId: box?.id,
          name: box?.name ?? '黑盒',
        };
      }
      default:
        return base;
    }
  }

  /** 由页面注入的自定义元件查找函数 */
  customLookup: ((id: string) => { id: string; name: string; inputs: number; outputs: number } | undefined) | null =
    null;
  pendingCustomId = '';

  private nextInputName(): string {
    const used = new Set(
      this.circuit.nodes.filter((n) => n.type === 'INPUT').map((n) => (n.name ?? '').toUpperCase())
    );
    for (const c of 'ABCDEFGH') if (!used.has(c)) return c;
    return `IN${this.circuit.nodes.filter((n) => n.type === 'INPUT').length + 1}`;
  }

  private nextOutputName(): string {
    const used = new Set(
      this.circuit.nodes.filter((n) => n.type === 'OUTPUT').map((n) => (n.name ?? '').toUpperCase())
    );
    for (const c of 'YZWR') if (!used.has(c)) return c;
    return `Y${this.circuit.nodes.filter((n) => n.type === 'OUTPUT').length + 1}`;
  }

  // ============================================================
  // 电路修改（全部走这里，保证触发渲染 + 存快照）
  // ============================================================

  private addNode(node: LogicNode) {
    this.pushSnapshot();
    this.circuit.nodes.push(node);
    this.commit('add');
  }

  /** 连线；同一输入端口只能接一根线，接新的会替换旧的 */
  connect(fromNode: string, fromPort: number, toNode: string, toPort: number) {
    if (fromNode === toNode) return; // 不允许自环
    const from = this.circuit.nodes.find((n) => n.id === fromNode);
    const to = this.circuit.nodes.find((n) => n.id === toNode);
    if (!from || !to) return;
    if (fromPort >= from.outputs || toPort >= to.inputs) return;

    this.pushSnapshot();
    // 覆盖该输入端口原有的边
    this.circuit.edges = this.circuit.edges.filter(
      (e) => !(e.to.node === toNode && e.to.port === toPort)
    );
    this.circuit.edges.push({
      id: uid('w'),
      from: { node: fromNode, port: fromPort },
      to: { node: toNode, port: toPort },
    });
    this.commit('connect');
  }

  deleteSelection() {
    const sel = this.selection;
    if (!sel.kind || !sel.id) return;
    this.pushSnapshot();
    if (sel.kind === 'node') {
      this.circuit.nodes = this.circuit.nodes.filter((n) => n.id !== sel.id);
      this.circuit.edges = this.circuit.edges.filter(
        (e) => e.from.node !== sel.id && e.to.node !== sel.id
      );
    } else {
      this.circuit.edges = this.circuit.edges.filter((e) => e.id !== sel.id);
    }
    this.selection = { kind: null, id: null };
    this.commit('delete');
  }

  /** 改动某个节点的属性（检视面板用） */
  updateNode(id: string, patch: Partial<LogicNode>, withSnapshot = true) {
    const node = this.circuit.nodes.find((n) => n.id === id);
    if (!node) return;
    if (withSnapshot) this.pushSnapshot();
    Object.assign(node, patch);
    // 输入端口数收缩时，删掉越界的边
    if (patch.inputs !== undefined) {
      this.circuit.edges = this.circuit.edges.filter(
        (e) => !(e.to.node === id && e.to.port >= patch.inputs!)
      );
    }
    if (patch.outputs !== undefined) {
      this.circuit.edges = this.circuit.edges.filter(
        (e) => !(e.from.node === id && e.from.port >= patch.outputs!)
      );
    }
    this.commit('update');
  }

  /** 整体替换电路（载入示例 / 导入文件） */
  replaceCircuit(next: Circuit, clearHistory = true) {
    if (clearHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.circuit = next;
    this.selection = { kind: null, id: null };
    this.liveValues = null;
    this.commit('replace');
    this.fitToView();
  }

  clearAll() {
    this.pushSnapshot();
    this.circuit = { schema: 'logic-circuit', version: 1, nodes: [], edges: [] };
    this.selection = { kind: null, id: null };
    this.liveValues = null;
    this.commit('clear');
  }

  /** 改动后统一：重渲染 + 存草稿 + 通知外部 */
  private commit(reason: string) {
    this.refreshDiagnostics();
    this.renderNodes();
    this.renderWires();
    this.emit(reason);
  }

  // ============================================================
  // 撤销重做
  // ============================================================

  /** 快照合并：400ms 内的连续同类操作只压一次栈（拖节点时不刷栈） */
  private pushSnapshot() {
    if (this.snapTimer) return;
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null;
    }, 400);
    this.undoStack.push(structuredClone(this.circuit));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 拖动节点这类连续操作用：只在开始时压一次 */
  snapshotForDrag() {
    if (this.snapTimer) return;
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null;
    }, 400);
    this.undoStack.push(structuredClone(this.circuit));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.circuit));
    this.circuit = prev;
    this.selection = { kind: null, id: null };
    this.commit('undo');
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.circuit));
    this.circuit = next;
    this.selection = { kind: null, id: null };
    this.commit('redo');
  }

  // ============================================================
  // 临时连线
  // ============================================================

  private startTempWire(from: LogicNode, port: number) {
    this.clearTempWire();
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'lc-wire is-temp');
    const pos = this.outPort(from, port);
    p.setAttribute('d', `M ${pos.x} ${pos.y}`);
    this.wiresSvg.appendChild(p);
    this.tempPath = p;
  }

  private clearTempWire() {
    if (this.tempPath) {
      this.tempPath.remove();
      this.tempPath = null;
    }
  }

  // ============================================================
  // playhead 数据
  // ============================================================

  /** 设置每个节点当前的值；传 null 清除 */
  setLiveValues(values: Map<string, boolean[]> | null) {
    this.liveValues = values;
    this.renderNodes();
    this.renderWires();
  }

  hasCycle() {
    return this.cycleNodes.size > 0;
  }

  getCycleNodes() {
    return [...this.cycleNodes];
  }

  /** 供外部（如检视面板）查询节点 */
  findNode(id: string): LogicNode | undefined {
    return this.circuit.nodes.find((n) => n.id === id);
  }
}

/** 三次贝塞尔：水平控制点，控制点间距随水平距离伸缩 */
function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const c = Math.max(36, Math.min(dx * 0.6, 160));
  // 往回绕的线（左端出口在右侧、右端入口在左侧，但x2 < x1）也能正确显示
  const dir = x2 >= x1 ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + c * dir} ${y1}, ${x2 - c * dir} ${y2}, ${x2} ${y2}`;
}

type LogicKindSafe = LogicNode;