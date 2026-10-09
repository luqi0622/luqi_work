/**
 * MOS 管级电路图 —— 类型定义与约束常量
 *
 * 纪律：本文件以及 geometry / symbols / model / netlist / render / presets
 * **不允许出现 document / window / DOM API**。这样它们能被 esbuild bundle
 * 后交给 node 直接跑断言测试，出错时读断言比在页面上猜快得多。
 */

/** 世界坐标栅格步长（px）。所有坐标落栅格，导出 SVG 才不会出现 17.999999 */
export const GRID = 10;

/** 视口缩放范围 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** 端口吸附半径（世界 px） */
export const SNAP_PORT = 12;
/** 栅极列 / 电源轨吸附半径（世界 px） */
export const SNAP_TRACK = 9;
/** 栅格吸附容差（世界 px） */
export const SNAP_GRID_TOL = GRID / 2;

/** 端口先沿出线方向直出的长度，然后才拐弯（原理图标准画法） */
export const STUB = 20;

/** 撤销栈深度 */
export const HISTORY_LIMIT = 100;

/** 文档 / 元件数量上限（normalize 时截断，防止脏数据撑爆页面） */
export const MAX_COMPS = 400;
export const MAX_WIRES = 600;
export const MAX_TEXT = 200;
export const MAX_VIA = 24;

/** localStorage key */
export const STORAGE_KEY = 'mos-doc-v1';

// ============================================================================
// 端口与端点
// ============================================================================

/**
 * 端口引用。
 *
 * 关键设计：**连线只存端口名，不存世界坐标**。
 * 端口世界坐标由 `portWorld(comp, portName)` 实时算出来，
 * 所以元件旋转 / 镜像 / 移动后，所有连线自动跟随，结构上不可能失配。
 */
export interface PortRef {
  comp: string;
  /** 端口名。MOS: 'g'|'d'|'s'|'b'；无源/电源: 'p'|'n'；net/junction: 'p' */
  port: string;
}

/** 连线端点：接元件端口，或自由点（拖到空白处待续） */
export type Endpoint =
  | { kind: 'port'; ref: PortRef }
  | { kind: 'free'; x: number; y: number };

// ============================================================================
// 样式
// ============================================================================

export type DashStyle = 'solid' | 'dashed' | 'dotted';

/** 线型 token → stroke-dasharray。导出 SVG 时用，不依赖 CSS */
export const DASH_PATTERNS: Record<DashStyle, string> = {
  solid: '',
  dashed: '7 5',
  dotted: '1.5 4',
};

/** 颜色 token → 实际色值。导出时解析成 hex，屏幕上读 CSS 变量 */
export const COLOR_TOKENS = ['ink', 'muted', 'accent', 'red', 'green', 'blue', 'orange'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export interface StrokeStyle {
  /** 线宽（世界 px） */
  width: number;
  color: ColorToken;
  dash: DashStyle;
}

export const DEFAULT_WIRE_STYLE: StrokeStyle = { width: 2, color: 'ink', dash: 'solid' };

// ============================================================================
// 元件
// ============================================================================

export type Rot = 0 | 90 | 180 | 270;
export const ROTS: Rot[] = [0, 90, 180, 270];

/** 出线方向：端口的引线朝哪边走，决定正交布线的第一段 */
export type Dir = 'L' | 'R' | 'U' | 'D';

export type CompKind =
  | 'nmos'
  | 'pmos'
  | 'resistor'
  | 'capacitor'
  | 'capPol'
  | 'diode'
  | 'zener'
  | 'vsrc'
  | 'isrc'
  | 'vdd'
  | 'gnd'
  | 'port'
  | 'junction'
  | 'jump';

/**
 * 元件库里的可放置项。
 *
 * 比CompKind 多一个 `'note'`：文本不是元件（不占CompKind、不进
 * components 数组、没有端口），它进的是 `doc.texts`。
 * 用联合类型而不是硬塞进 CompKind，是为了不给「文本」凭空造出
 * 端口表、包围盒、符号 path 这些它用不到的东西。
 */
export type PaletteKind = CompKind | 'note';

interface CompBase {
  id: string;
  kind: CompKind;
  /** 锚点（世界坐标），也是旋转中心。已吸附栅格 */
  x: number;
  y: number;
  rot: Rot;
  /** 水平镜像（沿锚点竖轴）。PMOS 左右翻转为常见画法 */
  flip: boolean;
  /** 实例名，如 M1 / R1 / C1 */
  label: string;
  /** 引线颜色，null= 用全局默认 */
  color: ColorToken | null;
}

/**
 * MOS 晶体管 —— **三端**（栅 / 漏 / 源）。
 *
 * 曾经有 `bodyTied`（四端/三端变体）。现在固定三端：画电路时衬底几乎总是
 * 接全局 VDD/VSS，逐管引一个用不上的 body 脚只会让布线多出必接的虚线。
 * 沟道类型靠栅极气泡区分（N 无气泡 / P 有气泡），标准画法，语义不丢。
 */
export interface MosFet extends CompBase {
  kind: 'nmos' | 'pmos';
  model?: string;
  w?: string;
  l?: string;
  vth?: string;
}

export interface Resistor extends CompBase {
  kind: 'resistor';
  value?: string;
}
export interface Capacitor extends CompBase {
  kind: 'capacitor' | 'capPol';
  value?: string;
}
export interface Diode extends CompBase {
  kind: 'diode' | 'zener';
  value?: string;
}
export interface Vsrc extends CompBase {
  kind: 'vsrc';
  value?: string;
  level?: string;
}
export interface Isrc extends CompBase {
  kind: 'isrc';
  value?: string;
}
export interface Rail extends CompBase {
  kind: 'vdd' | 'gnd';
  /** 网络名，默认 VDD / VSS */
  net: string;
  level?: string;
}
export interface Port extends CompBase {
  kind: 'port';
  /** 信号名，如 IN / OUT / CLK */
  net: string;
  level?: string;
}
export interface Junction extends CompBase {
  kind: 'junction';
}
export interface Jump extends CompBase {
  kind: 'jump';
}

export type MosComp =
  | MosFet
  | Resistor
  | Capacitor
  | Diode
  | Vsrc
  | Isrc
  | Rail
  | Port
  | Junction
  | Jump;

/** 有两个引出端的元件（用于连线端口校验） */
export const TWO_TERM_KINDS: CompKind[] = [
  'resistor',
  'capacitor',
  'capPol',
  'diode',
  'zener',
  'vsrc',
  'isrc',
];

export function isMos(c: MosComp): c is MosFet {
  return c.kind === 'nmos' || c.kind === 'pmos';
}

/** 元件可编辑的「属性字段」，属性面板据此生成表单 */
export const COMP_LABEL: Record<CompKind, string> = {
  nmos: 'N 管',
  pmos: 'P 管',
  resistor: '电阻',
  capacitor: '电容',
  capPol: '极性电容',
  diode: '二极管',
  zener: '稳压管',
  vsrc: '电压源',
  isrc: '电流源',
  vdd: 'VDD',
  gnd: 'VSS',
  port: '信号引出',
  junction: '接点',
  jump: '跨线',
};

/** 元件库按钮文案。`'note'` 不在 COMP_LABEL 里（它不是元件） */
export const PALETTE_LABEL: Record<PaletteKind, string> = {
  ...COMP_LABEL,
  note: '文本',
};

// ============================================================================
// 连线
// ============================================================================

/**
 * 连线 = 两端 + 中间拐点数组。
 *
 * 拐点存**绝对世界坐标**。渲染时经 `orthoFix` 强制正交化，
 * 保证「任何时刻每段都水平或垂直」这条硬不变量 ——
 * 元件移动后拐点不再构成直角时，自动补成 Z 形。
 */
export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  via: Pt[];
  style: StrokeStyle;
  /** 线标注，如 'I_D=1.2mA' */
  label?: string;
}

export interface Pt {
  x: number;
  y: number;
}

// ============================================================================
// 文本
// ============================================================================

export interface TextNote {
  id: string;
  x: number;
  y: number;
  text: string;
  /** 字号（世界 px） */
  size: number;
  align: 'left' | 'center' | 'right';
  color: ColorToken;
  bold: boolean;
  /** 旋转角（文本一般 0，但允许 90 让竖排标注贴竖线） */
  rot: Rot;
}

// ============================================================================
// 整图文档
// ============================================================================

export interface MosDoc {
  version: 1;
  title: string;
  showGrid: boolean;
  snapGrid: boolean;
  snapTrack: boolean;
  components: MosComp[];
  wires: Wire[];
  texts: TextNote[];
}

export function emptyDoc(title = '未命名电路'): MosDoc {
  return {
    version: 1,
    title,
    showGrid: true,
    snapGrid: true,
    snapTrack: true,
    components: [],
    wires: [],
    texts: [],
  };
}

// ============================================================================
// 视图与渲染选项
// ============================================================================

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 悬空诊断结果。由 netlist 算出，作为渲染的**输入**（诊断必须先于渲染） */
export interface DiagResult {
  /** 悬空端口：key = `${compId}#${port}` */
  floating: Set<string>;
  /** 只挂了一根线的网络（没有回路），netKey → wireId 列表 */
  stubNets: Map<string, string[]>;
  /** 网络表：netKey → compId 列表 */
  nets: Map<string, string[]>;
}

export function emptyDiag(): DiagResult {
  return { floating: new Set(), stubNets: new Map(), nets: new Map() };
}
