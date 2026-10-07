import { MAX_GATE_INPUTS } from './types';
import type { Circuit } from './types';

const DRAFT_KEY = 'logic-circuit:draft';

// ============================================================
// 结构校验
// ============================================================

/**
 * 校验电路结构是否合法
 * 同时也用来校验从localStorage / 导入文件读出来的脏数据
 */
export function isValidCircuit(c: unknown): c is Circuit {
  if (!c || typeof c !== 'object') return false;
  const o = c as Partial<Circuit>;
  if (o.schema !== 'logic-circuit') return false;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return false;

  const ids = new Set<string>();
  for (const n of o.nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') return false;
    if (ids.has(n.id)) return false;
    ids.add(n.id);
    if (typeof n.type !== 'string') return false;
    if (typeof n.x !== 'number' || !Number.isFinite(n.x)) return false;
    if (typeof n.y !== 'number' || !Number.isFinite(n.y)) return false;
    if (!Number.isInteger(n.inputs) || n.inputs < 0 || n.inputs > MAX_GATE_INPUTS) return false;
    if (!Number.isInteger(n.outputs) || n.outputs < 0 || n.outputs > 2) return false;
  }

  const edgeIds = new Set<string>();
  for (const e of o.edges) {
    if (!e || typeof e.id !== 'string') return false;
    if (edgeIds.has(e.id)) return false;
    edgeIds.add(e.id);
    if (!e.from || !e.to) return false;
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) return false;
    if (!Number.isInteger(e.from.port) || !Number.isInteger(e.to.port)) return false;
    if (e.from.port < 0 || e.to.port < 0) return false;
  }

  return true;
}

/** 补齐缺失字段并夹紧到合法范围（老草稿兼容用） */
export function normalizeCircuit(c: Circuit): Circuit {
  return {
    schema: 'logic-circuit',
    version: 1,
    nodes: c.nodes.map((n) => ({
      ...n,
      inputs: Math.max(0, Math.min(MAX_GATE_INPUTS, Number(n.inputs) || 0)),
      outputs: Math.max(0, Math.min(2, Number(n.outputs) || 0)),
    })),
    edges: c.edges.filter((e) => e.from?.node !== e.to?.node || e.from?.port !== e.to?.port),
  };
}

// ============================================================
// 草稿持久化
// ============================================================

export function loadDraft(): Circuit | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidCircuit(parsed)) return null;
    return normalizeCircuit(parsed);
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * debounce 400ms 自动保存草稿
 * 拖动节点时每帧都会调用，不 debounce 会把 localStorage 写爆
 */
export function saveDraft(circuit: Circuit): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushDraft(circuit);
  }, 400);
}

/** 立刻写盘（页面卸载时调用） */
export function flushDraft(circuit: Circuit): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(circuit));
  } catch {
    /* 超出配额时静默失败，不打断用户操作 */
  }
}

export function clearDraft(): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  localStorage.removeItem(DRAFT_KEY);
}

// ============================================================
// 导入导出
// ============================================================

export interface CircuitFile {
  schema: 'logic-circuit';
  version: 1;
  nodes: Circuit['nodes'];
  edges: Circuit['edges'];
}

export function exportCircuit(circuit: Circuit): string {
  const file: CircuitFile = {
    schema: 'logic-circuit',
    version: 1,
    nodes: circuit.nodes,
    edges: circuit.edges,
  };
  return JSON.stringify(file, null, 2);
}

export function importCircuit(json: string): { ok: boolean; circuit?: Circuit; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (!isValidCircuit(parsed)) {
    return { ok: false, error: '这个文件不是有效的电路数据（schema/version 或字段不对）' };
  }
  return { ok: true, circuit: normalizeCircuit(parsed) };
}

/** 触发浏览器下载一个文本文件 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 弹出文件选择框并读出文本内容；用户取消返回 null */
export function pickTextFile(accept = 'application/json,.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    // 用户取消时 change 不触发，这里不做超时兜底，靠 GC 回收
    input.click();
  });
}

/** 时间戳文件名，如 logic-circuit-20261007-1430.json */
export function stampFilename(prefix: string): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}