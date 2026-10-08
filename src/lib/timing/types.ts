/**
 * 时序波形图 —— 类型定义与约束常量
 *
 * 设计原则：**用「边沿 + 时段」描述波形，而不是用一串采样点**。
 *
 * 为什么不用采样点：时序图里每一段电平都代表一个确定的状态区间，
 * 采样点会在「这一段持续很久」和「这一段很短」两种情况下产生完全不同的
 * 数据量，但表达的信息量一样。用边沿描述则天然稀疏——10 条信号 30 个跳变点，
 * 和 10 条信号 300 个跳变点，前者的数据规模是一样的。
 *
 * 时间单位：**所有时刻都是整数 tick**，不存浮点秒。
 * 避免 0.1+0.2 问题，也避免导出 SVG 时出现17.999999 这样的坐标。
 * 真实时间由 doc.tickNs 换算（1 tick = 多少 ns）。
 */

/** 信号类型 */
export type SignalKind =
  /** 数字方波：0/1，由边沿列表决定跳变 */
  | 'digital'
  /** 时钟：自动按周期生成方波，支持占空比 */
  | 'clock'
  /** 总线：按时段显示十六进制值，段间画标准 X 交叉 */
  | 'bus'
  /** 模拟：连续波形（斜坡 / 三角 / 阶跃），用于电源、模拟前端的时序关系 */
  | 'analog';

/** 数字信号：边沿位置（tick），升序 */
export interface DigitalSeg {
  kind: 'digital';
  id: string;
  name: string;
  /** 起始电平 */
  initial: 0 | 1;
  /** 跳变位置，tick，升序。相邻两个边沿之间电平保持不变 */
  edges: number[];
  color: string;
}

/** 时钟信号 */
export interface ClockSeg {
  kind: 'clock';
  id: string;
  name: string;
  /** 周期（tick），必须 >= 2 */
  period: number;
  /** 占空比 0~1，高电平占比 */
  duty: number;
  /** 起始电平（1 = 空闲高，SPI 常见的 CPOL=0就是 0） */
  initial: 0 | 1;
  /** 相位偏移（tick），整个波形右移多少 */
  phase: number;
  color: string;
}

/** 总线信号：一个时段一个值 */
export interface BusSeg {
  kind: 'bus';
  id: string;
  name: string;
  /** 位宽，决定显示几位十六进制 */
  width: number;
  /** 时段列表，按 t 升序。t 为该段开始的 tick */
  segments: { t: number; v: number }[];
  color: string;
}

/** 模拟信号：关键点列表（线性插值） */
export interface AnalogSeg {
  kind: 'analog';
  id: string;
  name: string;
  /** 关键点，t 升序，v 归一化到 0~1（0 = 底，1 = 顶） */
  points: { t: number; v: number }[];
  color: string;
}

export type Signal = DigitalSeg | ClockSeg | BusSeg | AnalogSeg;

/** 竖直虚线游标 */
export interface Marker {
  id: string;
  /** 位置（tick） */
  t: number;
  /** 标注文字，如 t0 / tCAS */
  label: string;
}

/** 双向箭头区间标注（tSETUP / tHOLD / tRCD 这类参数） */
export interface Span {
  id: string;
  /** 起点（tick） */
  t1: number;
  /** 终点（tick） */
  t2: number;
  /** 标注文字，如 t_SETUP */
  label: string;
  /** 画在哪一行（信号索引）；-1 表示画在信号区上方 */
  row: number;
}

/** 整张图的文档 */
export interface TimingDoc {
  title: string;
  /** 一个 tick 等于多少纳秒 */
  tickNs: number;
  /** 图的总长度（tick） */
  lengthTicks: number;
  /** 主网格线间隔（tick），次网格线是它的 1/5 */
  majorEvery: number;
  signals: Signal[];
  markers: Marker[];
  spans: Span[];
}

// ============================================================================
// 约束常量
// ============================================================================

/** 最多几条信号——再多就该分图了 */
export const MAX_SIGNALS = 24;
/** 最多多少个标注区间 */
export const MAX_SPANS = 16;
/** tick 值的绝对上限，防止手滑输入天文数字把画布撑爆 */
export const MAX_TICKS = 100_000;
/** 一个 tick 的最小 ns 数（0.001 ns = 1 ps） */
export const MIN_TICK_NS = 0.001;
/** 一个 tick 的最大 ns 数（1 ms） */
export const MAX_TICK_NS = 1e6;

/** 固定配色（浅色/深色下都能看清），按序分配给信号 */
export const SIGNAL_COLORS = [
  '#185fa5', // 蓝
  '#3b6d11', // 绿
  '#854f0b', // 琥珀
  '#534ab7', // 紫
  '#993c1d', // 珊瑚
  '#0f6e56', // 青
  '#993556', // 粉
  '#5f5e5a', // 石墨
] as const;

/** 标注统一用红色系，视觉上与信号区分开 */
export const MARKER_COLOR = '#a32d2d';

/** 时间单位下拉的可选项（表示 1 tick = 多少该单位） */
export const TIME_UNITS = [
  { label: 'ps', ns: 0.001 },
  { label: 'ns', ns: 1 },
  { label: 'μs', ns: 1000 },
  { label: 'ms', ns: 1_000_000 },
] as const;

/** 时钟类型默认参数 */
export const DEFAULT_CLOCK = { period: 10, duty: 0.5, initial: 0 as const, phase: 0 };

/** 新建数字信号的默认边沿 */
export const DEFAULT_EDGES = [10, 20];