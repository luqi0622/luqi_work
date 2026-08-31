/**
 * QQ 空间说说导入脚本
 * 解析根目录的「QQ空间说说备份.md」，生成 src/content/blog/ 下的随笔 Markdown 文件。
 *
 * 规则：
 * - 保留所有有文字内容（或有历史评论）的说说
 * - 纯图片、无文字且无评论的条目跳过
 * - 清理 [em]表情码，保留历史评论作为正文附录
 * - 按关键词规则做初步分类
 *
 * 用法：node scripts/import-qq-shuoshuo.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'QQ空间说说备份.md');
const OUT_DIR = resolve(root, 'src/content/blog');

// ---------------- 分类规则（按优先级，命中即停） ----------------
const RULES = [
  ['读书观影', /《|电影|电视剧|小说|读书|看书|读后|观影|影评|编剧|追剧|纪录片/],
  ['校园青春', /学校|考试|作业|同学|开学|老师|高考|考研|上学|大学|高中|初中|小学|复习|上课|毕业|图书馆|校园|学习|成绩|青春|学长/],
  ['梦想奋斗', /梦想|理想|奋斗|努力|加油|坚持|成功|失败|改变|勇气|勇敢|拼搏|信念|强者|改变自己/],
  ['亲情爱情', /奶奶|外婆|妈妈|母亲|爸爸|父亲|父母|爱情|恋爱|喜欢|表白|情书|玫瑰|婚姻|结婚|相亲|分手|暗恋|想念|想你|温柔/],
  ['生活日常', /吃饭|回家|放假|旅游|天气|下雨|好冷|好热|累|睡觉|晚安|过年|中秋|国庆|节日|生病|拉肚子|吃|喝|玩/],
];
const FALLBACK_TAG = '心情随笔';

// ---------------- 解析 ----------------
const raw = readFileSync(SRC, 'utf-8');
const lines = raw.split(/\r?\n/);

const entries = [];
let cur = null;
for (const line of lines) {
  const m = line.match(/^## (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (m) {
    if (cur) entries.push(cur);
    cur = { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}${m[5]}`, content: [], comments: [], images: 0 };
    continue;
  }
  if (!cur) continue;
  if (line.trim() === '---') continue; // 条目分隔线
  if (line.trim() === '**评论：**') {
    cur.inComments = true;
    continue;
  }
  if (cur.inComments) {
    const cm = line.match(/^- \*\*(.+?)\*\*（(\d{4}年\d{2}月\d{2}日)）：(.*)$/);
    if (cm) cur.comments.push({ name: cm[1], date: cm[2], text: cm[3] });
    continue;
  }
  const im = line.match(/^\*（配图 (\d+) 张）\*$/);
  if (im) {
    cur.images += Number(im[1]);
    continue;
  }
  cur.content.push(line);
}

if (cur) entries.push(cur);

// ---------------- 清洗 ----------------
function cleanText(s) {
  return s
    .replace(/\[em\][^\[]*?\[\/em\]/g, '')
    .replace(/\[em\]e\d+\[\/em\]/g, '')
    .trim();
}

function buildBody(entry) {
  const contentLines = entry.content.map((l) => l.replace(/\[em\][^\[]*?\[\/em\]/g, '')).map((l) => l.trimEnd());
  // 去掉首尾空行
  while (contentLines.length && !contentLines[0].trim()) contentLines.shift();
  while (contentLines.length && !contentLines[contentLines.length - 1].trim()) contentLines.pop();

  // 话题标签 #xxx# 转为加粗，避免被渲染成标题
  const fixed = contentLines.map((l) => {
    const t = l.trim();
    if (/^#[^#]+#$/.test(t)) return `**${t.replace(/^#|#$/g, '')}**`;
    if (/^#{1,6}\s/.test(t)) return `**${t.replace(/^#+\s*/, '')}**`;
    return l;
  });

  let body = '';
  if (fixed.length) {
    body += fixed.join('\n\n');
  } else if (entry.images > 0) {
    body += `*（这是一条带图片的说说，图片未随文字一起导出）*`;
  }

  // 备注
  const notes = [];
  if (entry.images > 0) notes.push(`原说说配有 ${entry.images} 张图片`);
  notes.push('本条来自 QQ 空间说说存档');
  body += `\n\n> [!NOTE]\n> ${notes.join('，')}。`;

  // 历史评论
  if (entry.comments.length) {
    body += `\n\n## 当时朋友们的评论\n\n`;
    body += entry.comments
      .map((c) => `- **${c.name}**（${c.date}）：${c.text.replace(/\[em\][^\[]*?\[\/em\]/g, '')}`)
      .join('\n');
  }
  return { body, hasText: fixed.length > 0 };
}

function classify(text) {
  for (const [tag, re] of RULES) {
    if (re.test(text)) return tag;
  }
  return FALLBACK_TAG;
}

function makeTitle(entry, hasText) {
  if (!hasText) {
    const [, m, d] = entry.date.split('-');
    return `一张图片的回忆 · ${Number(m)}月${Number(d)}日`;
  }
  const first = entry.content
    .map((l) => cleanText(l))
    .find((l) => l.length > 0) ?? '';
  let t = first.replace(/^#+\s*/, '').replace(/^#|#$/g, '');
  t = t.replace(/^(《[^》]+》)$/, '$1');
  if (t.length > 16) t = t.slice(0, 16) + '…';
  return t || `那年今日 · ${entry.date}`;
}

function makeDescription(entry, hasText) {
  if (!hasText) return entry.comments.length ? '一条图片说说，留下了朋友们的评论。' : '一条图片说说。';
  const joined = entry.content
    .map((l) => cleanText(l))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  return joined.length > 60 ? joined.slice(0, 60) + '…' : joined;
}

// ---------------- 生成 ----------------
mkdirSync(OUT_DIR, { recursive: true });

// 清空旧的生成文件与示例文章（保留目录）
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith('.md') || f.endsWith('.mdx')) rmSync(resolve(OUT_DIR, f));
}

let count = 0;
const stat = {};
const slugCount = {};
for (const e of entries) {
  const { body, hasText } = buildBody(e);
  if (!hasText && e.comments.length === 0) continue; // 纯图片且无评论 → 跳过
  if (!hasText && e.comments.length === 0) continue;

  const allText = e.content.join(' ') + ' ' + e.comments.map((c) => c.text).join(' ');
  const tag = classify(allText);
  stat[tag] = (stat[tag] ?? 0) + 1;

  const title = makeTitle(e, hasText);
  const description = makeDescription(e, hasText);
  const pubDate = `${e.date}T${e.time.slice(0, 2)}:${e.time.slice(2)}:00`;
  // 同一分钟的多条说说加序号避免覆盖
  const base = `qq-${e.date}-${e.time}`;
  slugCount[base] = (slugCount[base] ?? 0) + 1;
  const slug = slugCount[base] > 1 ? `${base}-${slugCount[base]}` : base;

  const frontmatter = `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
pubDate: ${pubDate}
tags:
  - ${tag}
---`;

  writeFileSync(resolve(OUT_DIR, `${slug}.md`), `${frontmatter}\n\n${body.trim()}\n`, 'utf-8');
  count++;
}

console.log(`已生成 ${count} 篇随笔`);
console.log('分类统计：', stat);
