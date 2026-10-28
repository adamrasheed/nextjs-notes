// The only data-access layer for notes. Every function takes userId from the session,
// never from the request, and scopes its query by it (DESIGN.md section 12, IDOR).
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { notes, noteTags, tags } from "@/db/schema";
import type { ParsedDoc } from "@/lib/editor";

export const PAGE_SIZE = 50;
// Private-use characters mark search hits so the UI can highlight them without rendering HTML.
export const HIT_START = "";
export const HIT_END = "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

const live = (userId: string) => and(eq(notes.userId, userId), isNull(notes.deletedAt));

export type NoteSummary = { id: string; title: string; snippet: string; updatedAt: Date; tags: string[] };

// Cursor is the (updated_at, id) of the last row, opaque to the client. updated_at travels as
// Postgres text so microseconds survive the round trip (a JS Date would truncate to ms).
const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString("base64url");
function decodeCursor(cursor: string): [string, string] | null {
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return typeof ts === "string" && !Number.isNaN(Date.parse(ts)) && isUuid(id) ? [ts, id] : null;
  } catch {
    return null;
  }
}

export async function listNotes(
  userId: string,
  opts: { q?: string; tag?: string; cursor?: string; limit?: number } = {},
): Promise<{ items: NoteSummary[]; nextCursor: string | null }> {
  const limit = opts.limit ?? PAGE_SIZE;
  const filters: (SQL | undefined)[] = [live(userId)];
  if (opts.tag) {
    filters.push(sql`exists (select 1 from ${noteTags} join ${tags} on ${tags.id} = ${noteTags.tagId}
      where ${noteTags.noteId} = ${notes.id} and ${tags.userId} = ${userId} and ${tags.name} = ${opts.tag})`);
  }

  let rows: { id: string; title: string; snippet: string; updatedAt: Date; ts: string }[];
  const base = { id: notes.id, title: notes.title, updatedAt: notes.updatedAt, ts: sql<string>`${notes.updatedAt}::text` };

  if (opts.q) {
    // Search results are ranked, not time ordered, so they are a single page (DESIGN.md section 11).
    const query = sql`websearch_to_tsquery('english', ${opts.q})`;
    rows = await db
      .select({
        ...base,
        snippet: sql<string>`ts_headline('english', ${notes.contentText}, ${query}, ${`StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=25, MinWords=10`})`,
      })
      .from(notes)
      .where(and(...filters, sql`${notes.search} @@ ${query}`))
      .orderBy(sql`ts_rank(${notes.search}, ${query}) desc`)
      .limit(limit);
    return { items: await withTags(rows), nextCursor: null };
  }

  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (after) filters.push(sql`(${notes.updatedAt}, ${notes.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`);
  rows = await db
    .select({ ...base, snippet: sql<string>`left(${notes.contentText}, 150)` })
    .from(notes)
    .where(and(...filters))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: await withTags(page), nextCursor: rows.length > limit && last ? encodeCursor(last.ts, last.id) : null };
}

async function withTags<T extends { id: string; title: string; snippet: string; updatedAt: Date }>(rows: T[]) {
  if (rows.length === 0) return [];
  const links = await db
    .select({ noteId: noteTags.noteId, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(inArray(noteTags.noteId, rows.map((r) => r.id)))
    .orderBy(tags.name);
  return rows.map(({ id, title, snippet, updatedAt }) => ({
    id,
    title,
    snippet,
    updatedAt,
    tags: links.filter((l) => l.noteId === id).map((l) => l.name),
  }));
}

export async function getNoteForUser(id: string, userId: string) {
  const [note] = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      version: notes.version,
      shareToken: notes.shareToken,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(eq(notes.id, id), live(userId)));
  if (!note) return null;
  const noteTagRows = await db
    .select({ id: tags.id, name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(eq(noteTags.noteId, id))
    .orderBy(tags.name);
  return { ...note, tags: noteTagRows };
}

export type Note = NonNullable<Awaited<ReturnType<typeof getNoteForUser>>>;

export type SaveResult =
  | { status: "ok"; version: number }
  | { status: "conflict"; note: Note }
  | { status: "not_found" };

// Lazy create + optimistic concurrency control (DESIGN.md sections 6 and 8).
export async function saveNote(
  userId: string,
  id: string,
  input: { baseVersion: number; title: string; doc: ParsedDoc },
): Promise<SaveResult> {
  const values = { title: input.title, content: input.doc.content, contentText: input.doc.text };

  if (input.baseVersion === 0) {
    const inserted = await db
      .insert(notes)
      .values({ id, userId, ...values, version: 1 })
      .onConflictDoNothing({ target: notes.id })
      .returning({ version: notes.version });
    if (inserted.length) return { status: "ok", version: 1 };
    // Row already exists: fall through to the versioned update, which will 409 or 404.
  }

  const updated = await db
    .update(notes)
    .set({ ...values, version: sql`${notes.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(notes.id, id), eq(notes.version, input.baseVersion), live(userId)))
    .returning({ version: notes.version });
  if (updated.length) return { status: "ok", version: updated[0].version };

  // 0 rows: either someone saved first (conflict) or the note is not ours (404, never 403).
  const latest = await getNoteForUser(id, userId);
  return latest ? { status: "conflict", note: latest } : { status: "not_found" };
}

export async function setDeleted(userId: string, id: string, deleted: boolean) {
  await db
    .update(notes)
    .set({ deletedAt: deleted ? sql`now()` : null })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)));
}

export function listTrash(userId: string) {
  return db
    .select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), isNotNull(notes.deletedAt)))
    .orderBy(desc(notes.deletedAt));
}

export function listUserTags(userId: string) {
  return db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId)).orderBy(tags.name);
}

export async function addTag(userId: string, noteId: string, name: string) {
  if (!(await getNoteForUser(noteId, userId))) return;
  const [tag] = await db
    .insert(tags)
    .values({ userId, name })
    .onConflictDoUpdate({ target: [tags.userId, tags.name], set: { name } })
    .returning({ id: tags.id });
  await db.insert(noteTags).values({ noteId, tagId: tag.id }).onConflictDoNothing();
}

export async function removeTag(userId: string, noteId: string, tagId: string) {
  // note_tags rows only ever link a user's own notes to their own tags (see addTag),
  // so scoping the tag to the user is enough.
  const ownTags = db.select({ id: tags.id }).from(tags).where(eq(tags.userId, userId));
  await db
    .delete(noteTags)
    .where(and(eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId), inArray(noteTags.tagId, ownTags)));
}

export async function setShareToken(userId: string, id: string, token: string | null) {
  await db
    .update(notes)
    .set({ shareToken: token === null ? null : sql`coalesce(${notes.shareToken}, ${token})` })
    .where(and(eq(notes.id, id), live(userId)));
}

// Public read: returns only what the share page renders, never user_id or other private fields.
export async function getSharedNote(token: string) {
  const [note] = await db
    .select({ title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.shareToken, token), isNull(notes.deletedAt)));
  return note ?? null;
}
