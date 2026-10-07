import { MAX_CUSTOM_IN, MAX_CUSTOM_OUT } from './types';
import type { CustomBox } from './types';

const KEY = 'logic-circuit:customs';

export interface CustomsFile {
  schema: 'logic-circuit-customs';
  version: 1;
  boxes: CustomBox[];
}

/** 读出全部自定义元件；数据损坏时返回空数组而不是抛错 */
export function listCustoms(): CustomBox[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidBox);
  } catch {
    return [];
  }
}

function save(boxes: CustomBox[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(boxes));
}

export function isValidBox(b: unknown): b is CustomBox {
  if (!b || typeof b !== 'object') return false;
  const o = b as Partial<CustomBox>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return false;
  if (!Number.isInteger(o.inputs) || !Number.isInteger(o.outputs)) return false;
  if (o.inputs! < 1 || o.inputs! > MAX_CUSTOM_IN) return false;
  if (o.outputs! < 1 || o.outputs! > MAX_CUSTOM_OUT) return false;
  if (!Array.isArray(o.table)) return false;
  if (o.table.length !== 2 ** o.inputs!) return false;
  return o.table.every((row) => Array.isArray(row) && row.length === o.outputs!);
}

/** 生成一张全 0 的真值表作为编辑起点 */
export function blankTable(inputs: number, outputs: number): boolean[][] {
  return Array.from({ length: 2 ** inputs }, () => new Array<boolean>(outputs).fill(false));
}

/** 校验表单输入，返回错误信息或 null */
export function validateBox(name: string, inputs: number, outputs: number, table: boolean[][]): string | null {
  if (!name.trim()) return '请给元件起个名字';
  if (!Number.isInteger(inputs) || inputs < 1 || inputs > MAX_CUSTOM_IN) {
    return `输入端口数要在 1 ~ ${MAX_CUSTOM_IN} 之间`;
  }
  if (!Number.isInteger(outputs) || outputs < 1 || outputs > MAX_CUSTOM_OUT) {
    return `输出端口数要在 1 ~ ${MAX_CUSTOM_OUT} 之间`;
  }
  if (table.length !== 2 ** inputs) return '真值表行数不对，请重新生成';
  if (table.some((r) => r.length !== outputs)) return '真值表列数不对，请重新生成';
  return null;
}

/**
 * 保存（新增或按 id 覆盖）
 * 返回 false 表示 id 已存在且force=false，避免误覆盖同名元件
 */
export function saveCustom(box: CustomBox, force = false): boolean {
  const all = listCustoms();
  const i = all.findIndex((b) => b.id === box.id);
  if (i >= 0) {
    all[i] = box;
  } else {
    all.push(box);
  }
  save(all);
  void force;
  return true;
}

/** 名字是否被占用（排除自己） */
export function nameTaken(name: string, exceptId?: string): boolean {
  const k = name.trim().toLowerCase();
  return listCustoms().some((b) => b.name.trim().toLowerCase() === k && b.id !== exceptId);
}

/** 生成不冲突的 id */
export function newCustomId(): string {
  return `cx${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export function deleteCustom(id: string): void {
  save(listCustoms().filter((b) => b.id !== id));
}

export function getCustom(id: string): CustomBox | undefined {
  return listCustoms().find((b) => b.id === id);
}

/** id → Map，供 evaluate 快速查表 */
export function customsMap(): Map<string, CustomBox> {
  return new Map(listCustoms().map((b) => [b.id, b]));
}

export function exportCustoms(): string {
  const file: CustomsFile = { schema: 'logic-circuit-customs', version: 1, boxes: listCustoms() };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  ok: boolean;
  added: number;
  renamed: number;
  error?: string;
}

/**
 * 导入元件库
 * 同名但 id 不同 → 自动改名后并入，不覆盖已有元件
 */
export function importCustoms(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, added: 0, renamed: 0, error: '不是合法的 JSON 文件' };
  }

  const file = parsed as Partial<CustomsFile>;
  // 兼容两种格式：整个库文件，或单个元件对象
  const incoming: unknown[] = Array.isArray(file.boxes)
    ? file.boxes
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : parsed && typeof parsed === 'object'
        ? [parsed]
        : [];

  if (incoming.length === 0) {
    return { ok: false, added: 0, renamed: 0, error: '文件里没有可导入的元件' };
  }
  if (file.schema && file.schema !== 'logic-circuit-customs') {
    return { ok: false, added: 0, renamed: 0, error: `不识别的文件类型：${String(file.schema)}` };
  }

  const all = listCustoms();
  let added = 0;
  let renamed = 0;

  for (const raw of incoming) {
    if (!isValidBox(raw)) continue;
    const box: CustomBox = { ...raw };
    const idClash = all.some((b) => b.id === box.id);
    if (idClash) box.id = newCustomId();
    if (nameTaken(box.name, box.id)) {
      renamed += 1;
      box.name = `${box.name} 副本`;
      let k = 2;
      while (nameTaken(box.name, box.id)) box.name = `${box.name.replace(/\s副本(\s\d+)?$/, '')} 副本${k++}`;
    }
    all.push(box);
    added += 1;
  }

  save(all);
  if (added === 0) return { ok: false, added: 0, renamed: 0, error: '文件里的元件格式都不合法' };
  return { ok: true, added, renamed };
}