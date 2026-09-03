import { db } from './db';
import { nowBeijing } from '../utils/time';

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
  deleted_at: number | null;
}

export interface TagWithCount {
  id: number;
  name: string;
  count: number;
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
    deleted_at: r.deleted_at,
  };
}

const POST_COLUMNS = 'p.id, p.t, p.content, p.pics, p.rt, p.comments, p.pinned, p.deleted_at';

/** 前台列表：正常说说，置顶在前，其余按时间倒序；可按标签筛选 */
export async function listPosts(opts: { tag?: string } = {}): Promise<Post[]> {
  let sql = `SELECT ${POST_COLUMNS} FROM posts p WHERE p.deleted_at IS NULL`;
  const args: unknown[] = [];
  if (opts.tag) {
    sql += ` AND p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?)`;
    args.push(opts.tag);
  }
  sql += ` ORDER BY p.pinned DESC, p.t DESC`;
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows.map((r) => rowToPost(r as unknown as PostRow));
}

/** 后台列表：全部（含已删除），按时间倒序 */
export async function listAllPosts(): Promise<Post[]> {
  const rs = await db.execute(`SELECT ${POST_COLUMNS} FROM posts p ORDER BY p.deleted_at IS NOT NULL, p.pinned DESC, p.t DESC`);
  return rs.rows.map((r) => rowToPost(r as unknown as PostRow));
}

export async function getPostTags(postId: number): Promise<string[]> {
  const rs = await db.execute({
    sql: `SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = ? ORDER BY t.name`,
    args: [postId],
  });
  return rs.rows.map((r) => String(r.name));
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

/** 编辑正文 / 置顶切换 */
export async function updatePost(
  id: number,
  patch: { content?: string; pinned?: number }
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

/** 取单条原始记录（含 comments 文本），找不到返回 null */
async function getRawPost(id: number): Promise<PostRow | null> {
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
    name: input.name,
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
