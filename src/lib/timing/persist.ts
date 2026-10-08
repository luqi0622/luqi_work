/**
 * 时序波形图 —— 持久化（localStorage + JSON 文件）
 *
 * 设计：localStorage 只存「当前正在编辑的文档」，
 * 多个图之间的切换靠导出 JSON 文件。这样浏览器被清缓存时
 * 最多丢一张正在画的图，已导出的文件永远安全。
 */

// 接口必须带 type 修饰符：Vite dev 下 esbuild 逐文件转译，不带会留下无效运行时导入
import type { TimingDoc } from './types';
import { cloneDoc, normalize } from './model';

const KEY = 'timing-doc-v1';
const LAST_KEY = 'timing-last-v1';
const NAMEW_KEY = 'timing-namew-v1';

/** 信号名列宽的下限/上限：太窄名字全被截断，太宽挤掉波形 */
export const NAME_W_MIN = 72;
export const NAME_W_MAX = 320;

/** 读列宽，非法或越界一律回落到默认值 */
export function loadNameWidth(fallback: number): number {
  try {
    const raw = localStorage.getItem(NAMEW_KEY);
    if (!raw) return fallback;
    const v = Number(raw);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(NAME_W_MIN, Math.min(NAME_W_MAX, Math.round(v)));
  } catch {
    return fallback;
  }
}

export function saveNameWidth(w: number): void {
  try {
    localStorage.setItem(NAMEW_KEY, String(Math.round(w)));
  } catch {
    /* 隐私模式：静默降级 */
  }
}

/** 存当前文档（存前先normalize，防止把脏数据写进去占地方） */
export function save(doc: TimingDoc): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalize(doc)));
  } catch {
    /* 隐私模式 / 配额满：静默降级，不打扰用户 */
  }
}

/** 读当前文档；没有或损坏则返回 null */
export function load(): TimingDoc | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* noop */
  }
}

/** 导出为 JSON 文件下载 */
export function downloadJSON(doc: TimingDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeName(doc.title)}.timing.json`);
}

/** 从文件读回（Promise 包装 FileReader） */
export function readJSONFile(file: File): Promise<TimingDoc> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.onload = () => {
      try {
        resolve(normalize(JSON.parse(String(fr.result))));
      } catch {
        reject(new Error('不是有效的时序图 JSON 文件'));
      }
    };
    fr.readAsText(file);
  });
}

/** 通用：把 Blob 变成下载 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 会让部分浏览器来不及开始下载，延迟一拍
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 文件名安全化：去掉路径分隔符和 Windows 非法字符 */
export function safeName(s: string): string {
  const t = (s || 'timing').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return t.slice(0, 60) || 'timing';
}

/** 复制到剪贴板（优先异步 API，旧浏览器回退到 execCommand） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 深拷贝（对外暴露给 UI 用，避免各处都 import model） */
export { cloneDoc };