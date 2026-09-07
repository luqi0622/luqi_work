import { db } from './db';
import { nowBeijing } from '../utils/time';
import { classifyText } from './classify';

export type CommentRole = 'guest' | 'admin';

export interface CommentItem {
  id: number;
  name: string;
  time: string;
  uin?: number;
  content: string;
  /** 被回复者昵称（用于「回复 @昵称」展示），可为 null */
  replyTo?: string | null;
  /** 父评论 id，用于多级楼中楼嵌套；顶层评论为 null */
  parentId?: number | null;
  /** 角色：游客 / 博主（管理员） */
  role?: CommentRole;
}

export interface Post {
  id: number;
  t: number;
  content: string;
  pics: number;
  rt: string | null;
  comments: CommentItem[];
  pinned: number;
  /** 1 = 私密（仅博主登录可见），0 = 公开 */
  isPrivate: number;
  deleted_at: number | null;
}

export interface TagWithCount {
  id: number;
  name: string;
  count: number;
}

/* ------------------------------------------------------------------ */
/* 表态（Reactions）：Emoji 快捷表情（Slack / 即刻 风格）                */
/* ------------------------------------------------------------------ */

/** 快捷表情面板里的常用表情（顺序即展示顺序）；点击任意表情即 +1 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '☕', '💡', '🚀', '🙏', '✨', '😮', '💯'];

/** 建表 + 旧数据迁移（幂等，进程内只跑一次） */
let reactionsReady: Promise<void> | null = null;
function ensureReactionsTable(): Promise<void> {
  if (!reactionsReady) {
    reactionsReady = (async () => {
      await db.batch(
        [
          {
            sql: `CREATE TABLE IF NOT EXISTS reactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    visitor TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                  )`,
            args: [],
          },
          {
            sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique ON reactions(post_id, kind, visitor)',
            args: [],
          },
          {
            sql: 'CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id)',
            args: [],
          },
        ],
        'write'
      );
      // 历史数据迁移：旧的 赞/踩/思考/共鸣 → emoji（保留已有计数）
      await db.batch(
        [
          { sql: `UPDATE reactions SET kind = '👍' WHERE kind = 'like'` },
          { sql: `UPDATE reactions SET kind = '👎' WHERE kind = 'dislike'` },
          { sql: `UPDATE reactions SET kind = '💡' WHERE kind = 'think'` },
          { sql: `UPDATE reactions SET kind = '❤️' WHERE kind = 'resonate'` },
        ],
        'write'
      );
    })().catch((e) => {
      reactionsReady = null;
      throw e;
    });
  }
  return reactionsReady;
}

/** 批量取多条说说的表态计数：Map<postId, {emoji: n, ...}>（仅含数量>0 的表情） */
export async function getReactionsMap(
  postIds: number[]
): Promise<Map<number, Record<string, number>>> {
  const out = new Map<number, Record<string, number>>();
  if (postIds.length === 0) return out;
  await ensureReactionsTable();
  const rs = await db.execute({
    sql: `SELECT post_id, kind, COUNT(*) AS n FROM reactions
          WHERE post_id IN (${postIds.map(() => '?').join(',')})
          GROUP BY post_id, kind`,
    args: postIds,
  });
  for (const r of rs.rows) {
    const pid = Number(r.post_id);
    const kind = String(r.kind);
    const rec = out.get(pid) ?? {};
    rec[kind] = Number(r.n);
    out.set(pid, rec);
  }
  return out;
}

/** 取某访客（匿名 vid）已表态的集合：Set<"postId:emoji"> */
export async function getMyReactions(vid: string | undefined): Promise<Set<string>> {
  if (!vid) return new Set();
  await ensureReactionsTable();
  const rs = await db.execute({
    sql: 'SELECT post_id, kind FROM reactions WHERE visitor = ?',
    args: [vid],
  });
  return new Set(rs.rows.map((r) => `${Number(r.post_id)}:${String(r.kind)}`));
}

/** 切换表态：同一访客对同一说说的同一表情可反复切换；返回最新状态与计数 */
export async function toggleReaction(
  postId: number,
  kind: string,
  vid: string
): Promise<{ active: boolean; counts: Record<string, number> }> {
  await ensureReactionsTable();
  const now = Math.floor(Date.now() / 1000);
  const existed = await db.execute({
    sql: 'SELECT id FROM reactions WHERE post_id = ? AND kind = ? AND visitor = ?',
    args: [postId, kind, vid],
  });
  if (existed.rows.length > 0) {
    await db.execute({
      sql: 'DELETE FROM reactions WHERE post_id = ? AND kind = ? AND visitor = ?',
      args: [postId, kind, vid],
    });
  } else {
    await db.execute({
      sql: 'INSERT INTO reactions (post_id, kind, visitor, created_at) VALUES (?, ?, ?, ?)',
      args: [postId, kind, vid, now],
    });
  }
  const map = await getReactionsMap([postId]);
  return {
    active: existed.rows.length === 0,
    counts: map.get(postId) ?? {},
  };
}

interface PostRow {
  id: number;
  t: number;
  content: string;
  pics: number;
  rt: string | null;
  comments: string;
  pinned: number;
  deleted_at: number | null;
}

function rowToPost(r: PostRow): Post {
  let raw: any[] = [];
  try {
    raw = JSON.parse(r.comments || '[]');
  } catch {
    raw = [];
  }
  // 兼容旧数据：补全 parentId / role / replyTo（旧评论默认游客、顶层）
  const comments: CommentItem[] = raw.map((c, i) => ({
    id: typeof c.id === 'number' ? c.id : i + 1,
    name: String(c.name ?? '匿名'),
    time: String(c.time ?? ''),
    uin: c.uin,
    content: String(c.content ?? ''),
    replyTo: c.replyTo ?? null,
    parentId: c.parentId ?? null,
    role: (c.role === 'admin' ? 'admin' : 'guest') as CommentRole,
  }));
  return {
    id: r.id,
    t: r.t,
    content: r.content || '',
    pics: r.pics || 0,
    rt: r.rt,
    comments,
    pinned: r.pinned,
    isPrivate: r.is_private ? 1 : 0,
    deleted_at: r.deleted_at,
  };
}

const POST_COLUMNS = 'p.id, p.t, p.content, p.pics, p.rt, p.comments, p.pinned, p.is_private, p.deleted_at';

/** 确保 posts 表含 is_private 列（老库迁移；幂等，失败不影响其他逻辑） */
let postsReady: Promise<void> | null = null;
function ensurePostsTable(): Promise<void> {
  if (!postsReady) {
    postsReady = db
      .execute({ sql: `ALTER TABLE posts ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0` })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return postsReady;
}

/** 前台列表：正常说说，可按标签筛选、按时间/热度排序；未登录时隐藏私密说说 */
export async function listPosts(
  opts: {
    tag?: string;
    sort?: 'time' | 'hot';
    isAuthed?: boolean;
    /** 取前 n 条（配合 before 做游标分页） */
    limit?: number;
    /** 游标：只取 t < before 的更早期说说 */
    before?: number;
    /** 直接取某个自然年（北京时间） */
    year?: number;
  } = {}
): Promise<Post[]> {
  await ensurePostsTable();
  const sort = opts.sort === 'hot' ? 'hot' : 'time';
  let sql = `SELECT ${POST_COLUMNS} FROM posts p WHERE p.deleted_at IS NULL`;
  const args: unknown[] = [];
  if (!opts.isAuthed) {
    sql += ` AND (p.is_private IS NULL OR p.is_private = 0)`;
  }
  if (opts.tag) {
    sql += ` AND p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)`;
    args.push(opts.tag);
  }
  if (Number.isFinite(opts.before) && (opts.before as number) > 0) {
    sql += ` AND p.t < ?`;
    args.push(opts.before);
  }
  // 直接取某一自然年（按北京时间切分，中国无夏令时，固定 +8h）
  if (Number.isFinite(opts.year) && (opts.year as number) > 1900) {
    const y = opts.year as number;
    const start = Math.floor(Date.UTC(y, 0, 1, 0, 0, 0) / 1000) - 8 * 3600;
    const end = Math.floor(Date.UTC(y + 1, 0, 1, 0, 0, 0) / 1000) - 8 * 3600;
    sql += ` AND p.t >= ? AND p.t < ?`;
    args.push(start, end);
  }
  if (sort === 'hot') {
    // 最热：置顶优先，再按表态总数降序，同分按时间倒序（让博主置顶内容在热度视图仍靠前）
    sql += ` ORDER BY p.pinned DESC, (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) DESC, p.t DESC`;
  } else {
    sql += ` ORDER BY p.pinned DESC, p.t DESC`;
  }
  if (opts.limit && opts.limit > 0) {
    sql += ` LIMIT ?`;
    args.push(opts.limit);
  }
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows.map((r) => rowToPost(r as unknown as PostRow));
}

/** 各年份的说说数量（驱动迷你时光轴，按年份降序；不含置顶与私密） */
export async function listYearCounts(
  opts: { tag?: string; isAuthed?: boolean } = {}
): Promise<{ year: number; count: number }[]> {
  await ensurePostsTable();
  let sql = `SELECT CAST(strftime('%Y', p.t, 'unixepoch', '+8 hours') AS INTEGER) AS y, COUNT(*) AS n
             FROM posts p WHERE p.deleted_at IS NULL AND COALESCE(p.pinned, 0) = 0`;
  const args: unknown[] = [];
  if (!opts.isAuthed) {
    sql += ` AND (p.is_private IS NULL OR p.is_private = 0)`;
  }
  if (opts.tag) {
    sql += ` AND p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)`;
    args.push(opts.tag);
  }
  sql += ` GROUP BY y ORDER BY y DESC`;
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows.map((r) => ({ year: Number(r.y), count: Number(r.n) }));
}

/** 后台列表：全部（含已删除），按时间倒序 */
export async function listAllPosts(): Promise<Post[]> {
  const rs = await db.execute(`SELECT ${POST_COLUMNS} FROM posts p ORDER BY p.deleted_at IS NOT NULL, p.pinned DESC, p.t DESC`);
  return rs.rows.map((r) => rowToPost(r as unknown as PostRow));
}

/** 最新的 n 条说说（按创建时间倒序，忽略置顶），用于首页「最新随笔」（公开，排除私密） */
export async function listLatestPosts(n: number): Promise<Post[]> {
  await ensurePostsTable();
  const rs = await db.execute({
    sql: `SELECT ${POST_COLUMNS} FROM posts p WHERE p.deleted_at IS NULL AND (p.is_private IS NULL OR p.is_private = 0) ORDER BY p.t DESC LIMIT ?`,
    args: [n],
  });
  return rs.rows.map((r) => rowToPost(r as unknown as PostRow));
}

export async function getPostTags(postId: number): Promise<string[]> {
  const rs = await db.execute({
    sql: `SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ? ORDER BY t.name`,
    args: [postId],
  });
  return rs.rows.map((r) => String(r.name));
}

/** 取单条说说（comments 已解析为结构化数组），找不到或被删除返回 null —— 用于独立详情页 */
export async function getPost(id: number): Promise<Post | null> {
  const row = await getRawPost(id);
  if (!row || row.deleted_at != null) return null;
  return rowToPost(row);
}

/** 一次查出所有说说的标签映射（后台列表用，避免 N+1） */
export async function getPostTagsMap(): Promise<Map<number, string[]>> {
  const rs = await db.execute(
    `SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id ORDER BY t.name`
  );
  const map = new Map<number, string[]>();
  for (const r of rs.rows) {
    const pid = Number(r.post_id);
    const arr = map.get(pid) ?? [];
    arr.push(String(r.name));
    map.set(pid, arr);
  }
  return map;
}

export async function listTags(): Promise<TagWithCount[]> {
  const rs = await db.execute(
    `SELECT t.id, t.name, COUNT(pt.post_id) AS count
     FROM tags t LEFT JOIN post_tags pt ON pt.tag_id = t.id
     GROUP BY t.id ORDER BY COUNT(pt.post_id) DESC, t.name`
  );
  return rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name), count: Number(r.count) }));
}

/** 编辑正文 / 置顶切换 / 私密 */
export async function updatePost(
  id: number,
  patch: { content?: string; pinned?: number; isPrivate?: number }
): Promise<boolean> {
  const sets: string[] = ['updated_at = ?'];
  const args: unknown[] = [Math.floor(Date.now() / 1000)];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    args.push(patch.content);
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?');
    args.push(patch.pinned ? 1 : 0);
  }
  if (patch.isPrivate !== undefined) {
    sets.push('is_private = ?');
    args.push(patch.isPrivate ? 1 : 0);
  }
  args.push(id);
  const rs = await db.execute({ sql: `UPDATE posts SET ${sets.join(', ')} WHERE id = ?`, args: args as never });
  return rs.rowsAffected > 0;
}

export async function softDeletePost(id: number): Promise<boolean> {
  const rs = await db.execute({
    sql: `UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    args: [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), id],
  });
  return rs.rowsAffected > 0;
}

export async function restorePost(id: number): Promise<boolean> {
  const rs = await db.execute({
    sql: `UPDATE posts SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    args: [Math.floor(Date.now() / 1000), id],
  });
  return rs.rowsAffected > 0;
}

/** 全量替换某条说说的标签（隐式创建新标签） */
export async function setPostTags(postId: number, names: string[]): Promise<void> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  await db.batch(
    [{ sql: 'DELETE FROM post_tags WHERE post_id = ?', args: [postId] }],
    'write'
  );
  if (clean.length > 0) {
    await db.batch(
      clean.map((name) => ({ sql: 'INSERT OR IGNORE INTO tags (name) VALUES (?)', args: [name] })),
      'write'
    );
    const rs = await db.execute({
      sql: `SELECT id, name FROM tags WHERE name IN (${clean.map(() => '?').join(',')})`,
      args: clean,
    });
    const idRows = rs.rows.map((r) => Number(r.id));
    if (idRows.length > 0) {
      await db.batch(
        idRows.map((tagId) => ({
          sql: 'INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          args: [postId, tagId],
        })),
        'write'
      );
    }
  }
  // 清理无关联的孤立标签
  await db.execute(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM post_tags)`);
}

export async function deleteTag(id: number): Promise<void> {
  await db.batch(
    [
      { sql: 'DELETE FROM post_tags WHERE tag_id = ?', args: [id] },
      { sql: 'DELETE FROM tags WHERE id = ?', args: [id] },
    ],
    'write'
  );
}

/** 取全部未删除说说的 id + 正文（用于批量自动归类） */
async function getAllPostTexts(): Promise<{ id: number; content: string }[]> {
  const rs = await db.execute({
    sql: `SELECT id, content FROM posts WHERE deleted_at IS NULL`,
    args: [],
  });
  return rs.rows.map((r) => ({ id: Number(r.id), content: String(r.content || '') }));
}

/**
 * 给全部说说按关键词自动归类（幂等）：每条说说打一个主分类标签。
 * 与 scripts/import-qq-shuoshuo.mjs 使用同一套分类规则，保证随笔栏目与历史导入一致。
 * 采用批量写入（清空旧 post_tags 后一次性插入），避免逐条写造成的超时。
 * 返回统计信息，便于后台确认归类分布。
 */
export async function autoTagAllPosts(): Promise<{ total: number; stat: Record<string, number> }> {
  const posts = await getAllPostTexts();
  const stat: Record<string, number> = {};
  const rows = posts.map((p) => {
    const cat = classifyText(p.content);
    stat[cat] = (stat[cat] ?? 0) + 1;
    return { id: p.id, cat };
  });

  // 1) 确保分类标签行存在
  const cats = [...new Set(rows.map((r) => r.cat))];
  if (cats.length > 0) {
    await db.batch(
      cats.map((c) => ({ sql: 'INSERT OR IGNORE INTO tags (name) VALUES (?)', args: [c] })),
      'write'
    );
  }
  const tagRows = await db.execute({
    sql: `SELECT id, name FROM tags WHERE name IN (${cats.map(() => '?').join(',')})`,
    args: cats,
  });
  const tagId = new Map<string, number>();
  for (const r of tagRows.rows) tagId.set(String(r.name), Number(r.id));

  // 2) 清空旧关联，批量插入（避免逐条 DELETE + 孤儿清理带来的超时）
  await db.batch([{ sql: 'DELETE FROM post_tags', args: [] }], 'write');
  const inserts = rows
    .filter((r) => tagId.has(r.cat))
    .map((r) => ({
      sql: 'INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
      args: [r.id, tagId.get(r.cat)!],
    }));
  if (inserts.length > 0) await db.batch(inserts, 'write');

  return { total: posts.length, stat };
}

/** 取单条原始记录（含 comments 文本），找不到返回 null */
async function getRawPost(id: number): Promise<PostRow | null> {
  await ensurePostsTable();
  const rs = await db.execute({ sql: `SELECT ${POST_COLUMNS} FROM posts p WHERE id = ?`, args: [id] });
  if (rs.rows.length === 0) return null;
  return rs.rows[0] as unknown as PostRow;
}

/** 主人新建一条文字说说，返回新 id */
export async function createPost(content: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const rs = await db.execute({
    sql: `INSERT INTO posts (t, content, pics, rt, comments, pinned, deleted_at, created_at, updated_at)
          VALUES (?, ?, 0, NULL, '[]', 0, NULL, ?, ?)`,
    args: [now, content, now, now],
  });
  return Number(rs.lastInsertRowid);
}

export interface AddCommentInput {
  name: string;
  content: string;
  parentId?: number | null;
  role?: CommentRole;
  replyTo?: string | null;
}

/** 追加一条评论（支持楼中楼 parentId 与角色 role），返回是否成功 */
export async function addComment(postId: number, input: AddCommentInput): Promise<boolean> {
  const post = await getRawPost(postId);
  if (!post) return false;
  let comments: CommentItem[] = [];
  try {
    comments = JSON.parse(post.comments || '[]');
  } catch {
    comments = [];
  }
  const maxId = comments.reduce((m, c) => Math.max(m, c.id ?? 0), 0);
  comments.push({
    id: maxId + 1,
    // 游客评论一律匿名（前端不再收集昵称）
    name: (input.name || '匿名').slice(0, 20),
    time: nowBeijing(),
    uin: 0,
    content: input.content,
    replyTo: input.replyTo ?? null,
    parentId: input.parentId ?? null,
    role: input.role === 'admin' ? 'admin' : 'guest',
  });
  const rs = await db.execute({
    sql: `UPDATE posts SET comments = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(comments), Math.floor(Date.now() / 1000), postId],
  });
  return rs.rowsAffected > 0;
}

/** 收集以 rootId 为根的全部评论 id（含自身），用于删除子树 */
function collectSubtree(comments: CommentItem[], rootId: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const c of comments) {
    if (c.parentId != null) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentId, arr);
    }
  }
  const out = new Set<number>();
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    for (const child of childrenOf.get(cur) ?? []) stack.push(child);
  }
  return out;
}

/** 删除某说说下的一条评论及其全部子回复（管理员） */
export async function deleteComment(
  postId: number,
  opts: { commentId?: number; commentIndex?: number }
): Promise<boolean> {
  const post = await getRawPost(postId);
  if (!post) return false;
  let comments: CommentItem[] = [];
  try {
    comments = JSON.parse(post.comments || '[]');
  } catch {
    comments = [];
  }
  let targetId: number | undefined;
  if (opts.commentId !== undefined) {
    const found = comments.find((c) => c.id === opts.commentId);
    if (!found) return false;
    targetId = found.id;
  } else if (opts.commentIndex !== undefined) {
    const found = comments[opts.commentIndex];
    if (!found) return false;
    targetId = found.id;
  }
  if (targetId === undefined) return false;

  const toRemove = collectSubtree(comments, targetId);
  const next = comments.filter((c) => !toRemove.has(c.id));
  const rs = await db.execute({
    sql: `UPDATE posts SET comments = ?, updated_at = ? WHERE id = ?`,
    args: [JSON.stringify(next), Math.floor(Date.now() / 1000), postId],
  });
  return rs.rowsAffected > 0;
}
