/**
 * 算术与比较元件（全部是基本门的组合，纯组合逻辑）
 *
 * 输出端口顺序统一「主结果在前、辅助在后」：
 *   HA  → [S, Cout]
 *   FA  → [S, Cout]
 *   CMPEQ → [EQ, NEQ]
 *   CMP → [EQ, LT, GT]
 */

/** 半加器：S = A⊕B，Cout = A·B */
export function evalHalfAdder(ins: boolean[]): boolean[] {
  const a = ins[0] ?? false;
  const b = ins[1] ?? false;
  return [a !== b, a && b];
}

/** 全加器：S = A⊕B⊕Cin，Cout = 多数表决 */
export function evalFullAdder(ins: boolean[]): boolean[] {
  const a = ins[0] ?? false;
  const b = ins[1] ?? false;
  const cin = ins[2] ?? false;
  const s = a !== b;
  return [s !== cin, (a && b) || (cin && (a !== b))];
}

/** 一位比较器：[EQ, NEQ] */
export function evalCompareEq(ins: boolean[]): boolean[] {
  const a = ins[0] ?? false;
  const b = ins[1] ?? false;
  return [a === b, a !== b];
}

/** 比较器：[EQ, LT, GT]（无符号一位比较） */
export function evalCompare(ins: boolean[]): boolean[] {
  const a = ins[0] ?? false;
  const b = ins[1] ?? false;
  return [a === b, !a && b, a && !b];
}

/**
 * 7 段数码管段码表
 * 索引 = 4 位输入值（a 为最高位），值为 7 个段的开关 [A,B,C,D,E,F,G]
 * 10~15 用全亮（§）表示「非法值」，符合常见数码管的行为
 */
const SEG7_TABLE: boolean[][] = [
  // a b c d e f g
  [true, true, true, true, true, true, false], // 0
  [false, true, true, false, false, false, false], // 1
  [true, true, false, true, true, false, true], // 2
  [true, true, true, true, false, false, true], // 3
  [false, true, true, false, false, true, true], // 4
  [true, false, true, true, false, true, true], // 5
  [true, false, true, true, true, true, true], // 6
  [true, true, true, false, false, false, false], // 7
  [true, true, true, true, true, true, true], // 8
  [true, true, true, true, false, true, true], // 9
  [true, true, true, true, true, true, true], // 10 (§)
  [true, true, true, true, true, true, true], // 11
  [true, true, true, true, true, true, true], // 12
  [true, true, true, true, true, true, true], // 13
  [true, true, true, true, true, true, true], // 14
  [false, false, false, false, false, false, false], // 15（暗）
];

/** 7 段数码管：输入 a,b,c,d → 输出 A..G 七段 */
export function evalSeg7(ins: boolean[]): boolean[] {
  let idx = 0;
  for (let i = 0; i < 4; i += 1) idx = (idx << 1) | (ins[i] ? 1 : 0);
  return [...SEG7_TABLE[idx]];
}

/** 某个数字点亮哪些段（供 UI 画静态预览用） */
export function seg7Pattern(digit: number): boolean[] {
  const i = Math.max(0, Math.min(15, Math.floor(digit)));
  return [...SEG7_TABLE[i]];
}