/**
 * 时序波形图 —— 内置预设
 *
 * **DRAM 相关的预设是这里的重点**（DDR3 / DDR4 / LPDDR / SPI 模式寄存器），
 * 参数取自 JEDEC 标准里各时序参数的定义，按典型值填的。
 * 数值是「给个合理的起点」，改起来方便，别当 datasheet 用。
 *
 * 每个预设都是一份普通文档，载入后可以随便改 —— 不是只读的模板。
 */

// 接口必须带 type 修饰符：Vite dev 下 esbuild 逐文件转译，不带会留下无效运行时导入
import type { TimingDoc } from './types';

/**
 * 预设内的 ID 生成。
 *
 * 前缀用 `p`（ps/pm/pp）而不是 s/m/p：**预设的 ID 会和运行时新建信号的 ID 撞车**。
 * model.ts 的 nextId 计数器与这里的 seq 是两套独立计数器，
 * 载入预设后如果不同步（bumpIdSeq），下一次 addAnalog 可能拿到 s4 ——
 * 而预设里已经有一条 s4，于是 removeSignal(id) 会一次删掉两条信号。
 * 加前缀是最省事的根治办法，bumpIdSeq 是第二道保险。
 */
let seq = 0;
const uid = (p: string) => `${p}${(seq += 1)}`;

export interface Preset {
  key: string;
  name: string;
  group: string;
  hint: string;
  build: () => TimingDoc;
}

const C = {
  clk: '#185fa5',
  cmd: '#854f0b',
  data: '#3b6d11',
  ctrl: '#534ab7',
  other: '#993c1d',
  aux: '#0f6e56',
};

/** 建一个时钟信号 */
function clk(name: string, period: number, phase = 0, initial: 0 | 1 = 0) {
  return { kind: 'clock' as const, id: uid('ps'), name, period, duty: 0.5, initial, phase, color: C.clk };
}

/** 建一个数字信号 */
function dig(name: string, initial: 0 | 1, edges: number[], color: string) {
  return { kind: 'digital' as const, id: uid('ps'), name, initial, edges, color };
}

/** 建一个总线信号 */
function bus(name: string, width: number, segments: { t: number; v: number }[], color: string) {
  return { kind: 'bus' as const, id: uid('ps'), name, width, segments, color };
}

function mk(partial: Partial<TimingDoc> & { signals: TimingDoc['signals'] }): TimingDoc {
  return {
    title: '未命名',
    tickNs: 1,
    lengthTicks: 200,
    majorEvery: 20,
    markers: [],
    spans: [],
    ...partial,
  };
}

// ============================================================================
// DDR 读写
// ============================================================================

/**
 * DDR3 读突发（BL8）
 *
 * 时序链：ACT 打开行 → 等待 tRCD → 读DQS 前导 → 8拍数据 → 读后恢复 tRTP → PRE
 * 关键参数：
 *   tRCD  ACT 下降沿 → READ 上升沿
 *   tCL+2  READ 到第一个数据
 *   tRP   READ 到 PRE
 *   tRRD  两次 ACT 之间
 *   tRFC  刷新占用
 *
 * **DQS_t 相对 CK 偏移半周期**：DDR 里数据选通 DQS 是从 CK 分频出来的，
 * 与 CK 有固定的相位关系。若两者完全同相，就画不出 DQS 沿相对 CK 的偏移
 * 这个最要紧的时序信息。改 period 时请保持 phase = period/2。
 */
function ddr3ReadBurst(): TimingDoc {
  return mk({
    title: 'DDR3 读突发 BL8',
    tickNs: 0.25,
    lengthTicks: 240,
    majorEvery: 20,
    signals: [
      clk('CK', 10),
      // DQS_t 空闲高（与 DQS 反相），相位偏移半周期 = 5 tick
      clk('DQS_t', 10, 5, 1),
      bus('CMD', 6, [
        { t: 0, v: 0x3f }, // NOP
        { t: 10, v: 0x00 }, // ACT（A0-A10 + BA）
        { t: 40, v: 0x3f }, // NOP
        { t: 50, v: 0x04 }, // READ
        { t: 60, v: 0x3f },
        { t: 130, v: 0x06 }, // PRE
        { t: 140, v: 0x3f },
      ], C.cmd),
      dig('CS#', 0, [0, 140], C.ctrl),
      dig('CKE', 1, [], C.ctrl),
      dig('DQ[7:0]', 0, [], C.data),
      dig('DQS', 0, [60, 100], C.data),
    ],
    markers: [
      { id: uid('pm'), t: 10, label: 't0 ACT' },
      { id: uid('pm'), t: 50, label: 't1 READ' },
      { id: uid('pm'), t: 60, label: 't2 DQS' },
    ],
    spans: [
      { id: uid('pp'), t1: 10, t2: 50, label: 'tRCD', row: 2 },
      { id: uid('pp'), t1: 50, t2: 60, label: 'tCL', row: 2 },
      { id: uid('pp'), t1: 50, t2: 130, label: 'tRP', row: 2 },
      { id: uid('pp'), t1: 0, t2: 10, label: 'tRRD', row: -1 },
      // 数据窗口标在 DQS 那一行，读BL8 = 8 拍
      { id: uid('pp'), t1: 60, t2: 100, label: 'BL8', row: 6 },
    ],
  });
}

/**
 * DDR4 单次写（BL16）
 *
 * 写路径和读路径的差别在于 tDQS 定位与 tWR：
 *   tWR  写 DQS 撤销 → PRE
 *   tCCD相邻列命令间隔
 *   tWTR 读后写间隔（防总线翻转冲突）
 */
function ddr4Write(): TimingDoc {
  return mk({
    title: 'DDR4 写突发 BL16',
    tickNs: 0.2,
    lengthTicks: 280,
    majorEvery: 20,
    signals: [
      clk('CK', 10),
      // 写路径同样有 DQS，与 CK 差半周期（DDR 的写入数据由 DQS 采样对齐）
      clk('DQS_t', 10, 5, 1),
      bus('CMD', 6, [
        { t: 0, v: 0x3f },
        { t: 10, v: 0x00 }, // ACT
        { t: 50, v: 0x3f },
        { t: 60, v: 0x05 }, // WRITE
        { t: 70, v: 0x3f },
        { t: 230, v: 0x06 }, // PRE
        { t: 240, v: 0x3f }, // 回 NOP：命令总线必须以空闲结束
      ], C.cmd),
      dig('CS#', 0, [0, 250], C.ctrl),
      dig('DQ[7:0]', 0, [70], C.data),
      dig('DQS', 0, [70, 230], C.data),
      dig('DM', 0, [], C.other),
    ],
    markers: [{ id: uid('pm'), t: 10, label: 'ACT' }],
    spans: [
      { id: uid('pp'), t1: 10, t2: 60, label: 'tRCD', row: 2 },
      { id: uid('pp'), t1: 60, t2: 230, label: 'tWR', row: 2 },
    ],
  });
}

/**
 * DRAM 刷新时序（tRC / tRFC / tREFI）
 *
 * 刷新会打断一切：行不能开着、总线不能有未完成的事务。
 * 画这张图主要是为了说明「为什么刷新会吃掉带宽」。
 */
function dramRefresh(): TimingDoc {
  return mk({
    title: 'DRAM 刷新占用（tRC / tRFC）',
    tickNs: 1,
    lengthTicks: 200,
    majorEvery: 40,
    signals: [
      clk('CK', 10),
      bus('CMD', 6, [
        { t: 0, v: 0x3f },
        { t: 20, v: 0x01 }, // REF
        { t: 60, v: 0x3f },
        { t: 80, v: 0x00 }, // ACT（刷新后重新开行）
        { t: 90, v: 0x3f }, // 回 NOP
      ], C.cmd),
      dig('CS#', 0, [0, 80], C.ctrl),
      bus('tRFC窗口', 1, [
        { t: 0, v: 0 },
        { t: 20, v: 1 },
        { t: 60, v: 0 },
      ], C.other),
    ],
    markers: [{ id: uid('pm'), t: 20, label: 'REF' }],
    spans: [
      { id: uid('pp'), t1: 20, t2: 60, label: 'tRFC', row: 1 },
      { id: uid('pp'), t1: 0, t2: 80, label: 'tRC', row: 1 },
      { id: uid('pp'), t1: 0, t2: 200, label: 'tREFI', row: -1 },
    ],
  });
}

/**
 * DRAM 页冲突与行缓冲
 *
 * ACT 开行 → 读写 → PRE 是「命中」；不等 PRE 就 ACT 同一行是「行冲突」，
 * 必须等 tRC 或 tRTP。多 bank 场景下换 bank 可以掩盖冲突 —— 这是 bank 的意义。
 *
 * 时间轴刻意这样安排，让「快」和「慢」在长度上就能一眼比出来：
 *   bank0：ACT(10) → PRE(50) → ACT(150)   ← 冲突，间隔 140 tick = 70ns
 *   bank1：ACT(70) → READ(110)            ← 命中，间隔 40 tick = 20ns
 */
function dramBankConflict(): TimingDoc {
  return mk({
    title: 'DRAM Bank 冲突与行命中',
    tickNs: 0.5,
    lengthTicks: 240,
    majorEvery: 20,
    signals: [
      clk('CK', 10),
      bus('BA[1:0]', 2, [
        { t: 0, v: 0 },
        { t: 70, v: 1 },
        { t: 150, v: 0 },
      ], C.aux),
      bus('CMD', 6, [
        { t: 0, v: 0x3f },
        { t: 10, v: 0x00 }, // ACT bank0
        { t: 50, v: 0x06 }, // PRE bank0
        { t: 70, v: 0x00 }, // ACT bank1 —— 刚开过的行，命中
        { t: 110, v: 0x04 }, // READ
        { t: 120, v: 0x3f },
        { t: 150, v: 0x00 }, // ACT bank0 —— 距上次 PRE(50) 已过 100 tick(50ns) > tRC
        { t: 190, v: 0x04 }, // READ
        { t: 200, v: 0x3f },
      ], C.cmd),
      dig('CS#', 0, [0, 220], C.ctrl),
      dig('命中', 0, [70, 110, 150, 190], C.data),
    ],
    markers: [
      { id: uid('pm'), t: 70, label: '命中' },
      { id: uid('pm'), t: 150, label: 'tRC 已满足' },
    ],
    spans: [
      { id: uid('pp'), t1: 10, t2: 50, label: '开行→预充', row: 2 },
      { id: uid('pp'), t1: 70, t2: 110, label: '行命中 tRCD=20ns', row: 4 },
      // tRC 从上次 PRE 起算，必须严格长于行命中的 tRCD，否则语义就反了
      { id: uid('pp'), t1: 50, t2: 170, label: '同bank 需等 tRC=60ns', row: 4 },
      { id: uid('pp'), t1: 0, t2: 70, label: '换 bank 可掩盖冲突', row: 2 },
    ],
  });
}

// ============================================================================
// 通用总线协议
// ============================================================================

function spiMode(): TimingDoc {
  return mk({
    title: 'SPI Mode寄存器写（CPOL=0 CPHA=0）',
    tickNs: 20,
    lengthTicks: 240,
    majorEvery: 40,
    signals: [
      clk('SCK', 20),
      dig('CS#', 0, [0, 220], C.ctrl),
      dig('MOSI', 0, [], C.data),
      dig('MISO', 0, [100], C.other),
    ],
    markers: [
      { id: uid('pm'), t: 20, label: 'bit0' },
      { id: uid('pm'), t: 220, label: 'CS# 拉高' },
    ],
    spans: [{ id: uid('pp'), t1: 0, t2: 40, label: '地址字节', row: -1 }],
  });
}

function i2cWrite(): TimingDoc {
  return mk({
    title: 'I²C 写事务',
    tickNs: 100,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      clk('SCL', 20),
      dig('SDA', 1, [0, 20, 40, 60, 80], C.data),
      dig('ACK#', 1, [], C.other),
    ],
    markers: [
      { id: uid('pm'), t: 20, label: 'START' },
      { id: uid('pm'), t: 80, label: 'STOP' },
    ],
    spans: [{ id: uid('pp'), t1: 20, t2: 80, label: '9 bit帧', row: -1 }],
  });
}

function uartByte(): TimingDoc {
  return mk({
    title: 'UART 字节帧（115200 8N1）',
    tickNs: 8.68,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      dig('TXD', 1, [0, 8.68, 26, 43.5], C.data),
      dig('RXD', 1, [], C.other),
    ],
    markers: [{ id: uid('pm'), t: 8.68, label: '起始位' }],
    spans: [{ id: uid('pp'), t1: 0, t2: 95.5, label: '1 字节', row: -1 }],
  });
}

function jtagIr(): TimingDoc {
  return mk({
    title: 'JTAG 指令寄存器移位',
    tickNs: 40,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      clk('TCK', 20),
      dig('TMS', 0, [], C.ctrl),
      dig('TDI', 0, [], C.data),
      dig('TDO', 0, [40], C.other),
    ],
    markers: [{ id: uid('pm'), t: 20, label: 'TAP 复位' }],
    spans: [{ id: uid('pp'), t1: 0, t2: 60, label: '3 位 IR', row: -1 }],
  });
}

/** 复位上电时序 —— 数字设计里最常画的一张 */
function powerOnReset(): TimingDoc {
  return mk({
    title: '上电复位时序',
    tickNs: 1,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      { kind: 'analog', id: uid('ps'), name: 'VDD', color: C.aux, points: [{ t: 0, v: 0.05 }, { t: 20, v: 0.9 }, { t: 40, v: 1 }, { t: 200, v: 1 }] },
      clk('CLK', 10),
      dig('/RESET#', 0, [40], C.ctrl),
      dig('PORN', 0, [10], C.other),
      dig('READY', 0, [45], C.data),
    ],
    markers: [
      { id: uid('pm'), t: 10, label: 'POR 释放' },
      { id: uid('pm'), t: 40, label: 'RESET 释放' },
    ],
    spans: [{ id: uid('pp'), t1: 10, t2: 45, label: '复位保持', row: -1 }],
  });
}

/** 同步 FIFO 读写 */
function syncFifo(): TimingDoc {
  return mk({
    title: '同步 FIFO 写满触发',
    tickNs: 1,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      clk('CLK', 10),
      dig('wr_en', 0, [10, 20, 50, 60, 90], C.data),
      dig('full', 0, [80], C.other),
      clk('rd_ptr[2:0]', 10, 0),
      dig('empty', 1, [120], C.other),
    ],
    markers: [{ id: uid('pm'), t: 80, label: '写满' }],
    spans: [{ id: uid('pp'), t1: 80, t2: 120, label: '满→阻塞', row: -1 }],
  });
}

export const PRESETS: Preset[] = [
  { key: 'ddr3-read', name: 'DDR3 读突发 BL8', group: 'DRAM / DDR', hint: 'ACT→tRCD→READ→tCL→tRP→PRE 全链', build: ddr3ReadBurst },
  { key: 'ddr4-write', name: 'DDR4 写突发 BL16', group: 'DRAM / DDR', hint: '写 DQS 定位与 tWR 恢复窗口', build: ddr4Write },
  { key: 'dram-refresh', name: 'DRAM 刷新占用', group: 'DRAM / DDR', hint: 'tRC / tRFC / tREFI 为什么吃带宽', build: dramRefresh },
  { key: 'dram-bank', name: 'Bank 冲突与行命中', group: 'DRAM / DDR', hint: '行缓冲命中与否的代价对比', build: dramBankConflict },
  { key: 'por', name: '上电复位时序', group: '通用数字设计', hint: 'POR / RESET / 模拟电源轨', build: powerOnReset },
  { key: 'sync-fifo', name: '同步 FIFO 写满', group: '通用数字设计', hint: '流控信号的典型画法', build: syncFifo },
  { key: 'spi', name: 'SPI 事务', group: '通用协议', hint: 'CPOL=0 CPHA=0 时序', build: spiMode },
  { key: 'i2c', name: 'I²C 写事务', group: '通用协议', hint: 'START/STOP 与 9 bit 帧', build: i2cWrite },
  { key: 'uart', name: 'UART 字节帧', group: '通用协议', hint: '8N1 起始位与位时间', build: uartByte },
  { key: 'jtag', name: 'JTAG 移位', group: '通用协议', hint: 'TCK/TMS 状态机跳转', build: jtagIr },
];

/** 载入预设（每次调用重置 id 序列，保证同预设重复载入 id 一致、不会撞已保存的数据） */
export function loadPreset(key: string): TimingDoc | null {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return null;
  seq = 0;
  return p.build();
}

/** 分组后的预设列表，给下拉框用 */
export function presetGroups(): { group: string; items: Preset[] }[] {
  const map = new Map<string, Preset[]>();
  for (const p of PRESETS) {
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group)!.push(p);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

/** 空文档 —— 新建时的起手式 */
export function emptyDoc(): TimingDoc {
  return {
    title: '未命名时序图',
    tickNs: 1,
    lengthTicks: 200,
    majorEvery: 20,
    signals: [
      clk('CLK', 10),
      dig('RESET#', 0, [20], '#854f0b'),
      bus('DATA[7:0]', 8, [{ t: 0, v: 0 }, { t: 40, v: 0x5a }, { t: 120, v: 0xa5 }], '#3b6d11'),
    ],
    markers: [],
    spans: [],
  };
}