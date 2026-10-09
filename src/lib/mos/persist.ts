/**
 * MOS 管级电路图 —— 持久化（localStorage + JSON 文件）
 *
 * 设计：localStorage 只存「当前正在编辑的图纸」，
 * 多张图之间切换靠导出 JSON 文件。这样浏览器清缓存时最多丢一张正在画的图，
 * 已导出的文件永远安全。
 */

import type { MosDoc } from './types';
import { STORAGE_KEY } from './types';
import { bumpIdSeq, normalize } from './model';

export { STORAGE_KEY };

/** 存当前文档（存前先 normalize，防止把脏数据写进去占地方） */
export function save(doc: MosDoc): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(doc)));
  } catch {
    /* 隐私模式 / 配额满：静默降级，不打扰用户 */
  }
}

/** 读当前文档；没有或损坏则返回 null */
export function load(): MosDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = normalize(JSON.parse(raw));
    bumpIdSeq(doc);
    return doc;
  } catch {
    return null;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** 导出为 JSON 文件下载 */
export function downloadJSON(doc: MosDoc): void {
  const blob = new Blob([JSON.stringify(normalize(doc), null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${safeName(doc.title)}.mos.json`);
}

/** 从文件读回 */
export function readJSONFile(file: File): Promise<MosDoc> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('文件读取失败'));
    fr.onload = () => {
      try {
        const doc = normalize(JSON.parse(String(fr.result)));
        bumpIdSeq(doc);
        resolve(doc);
      } catch {
        reject(new Error('不是有效的电路图 JSON 文件'));
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
  const t = (s || 'circuit').replace(/[\\/:*?"<>|]+/g, '-').trim();
  return t.slice(0, 60) || 'circuit';
}
