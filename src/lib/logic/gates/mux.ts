/**
 * 选择器与译码器
 *
 * 端口约定：**末尾 selBits 个输入端口是选择位**，其余是数据位。
 * 例 MUX4：端口 0..3 = D0..D3，端口 4..5 = S0..S1，选择值 sel = S1·2 + S0。
 */

export interface MuxSpec {
  /** 数据位数量 */
  data: number;
  /** 输出位数（DEMUX 才有，>1） */
  outs?: number;
}

/**
 * 从输入端口数组里取出数据位与选择位
 *
 * 端口约定：末 selBits 个端口是选择位，**第一个（靠前）是最低位 S0**，
 * 即 ins[n-3]=S0、ins[n-2]=S1、ins[n-1]=S2。
 * 于是 sel = S0·1 + S1·2 + S2·4。
 */
export function splitInputs(ins: boolean[], selBits: number): { data: boolean[]; sel: number } {
  if (selBits <= 0) return { data: ins.slice(), sel: 0 };
  const selArr = ins.slice(ins.length - selBits);
  const data = ins.slice(0, ins.length - selBits);
  // selArr[0] 是 S0（最低位），所以按正序权重累加
  let selIdx = 0;
  for (let i = 0; i < selArr.length; i += 1) {
    if (selArr[i]) selIdx |= 1 << i;
  }
  return { data, sel: selIdx };
}

/**
 * 多路选择器
 * @param spec.data 数据位数量（4 → 4:1 MUX；8 → 8:1）
 */
export function evalMux(ins: boolean[], selBits: number, data: number): boolean[] {
  const { data: d, sel } = splitInputs(ins, selBits);
  if (sel < 0 || sel >= d.length) return [false];
  return [d[sel]];
}

/**
 * 反多路选择器（一进多出，one-hot）
 * @param spec.outs 输出路数（4 → 1:4 DEMUX）
 */
export function evalDemux(ins: boolean[], selBits: number, outs: number): boolean[] {
  const { data: d, sel } = splitInputs(ins, selBits);
  const v = d[0] ?? false;
  const out: boolean[] = [];
  for (let i = 0; i < outs; i += 1) out.push(v && i === sel);
  return out;
}

/**
 * 译码器（地址 → one-hot 输出）
 * 例3:8 译码器：输入 ABC=010 → Y2=1，其余 0
 */
export function evalDecoder(ins: boolean[], outs: number): boolean[] {
  let idx = 0;
  for (const b of ins) idx = (idx << 1) | (b ? 1 : 0);
  const out: boolean[] = [];
  for (let i = 0; i < outs; i += 1) out.push(i === idx);
  return out;
}

/** 数据端位数对应的选择位宽度（4 个数据 → 2 位） */
export function selBitsFor(dataCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(1, dataCount))));
}