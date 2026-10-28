// Run with `npm test` (PGLITE_DATA_DIR=memory:// gives each run a fresh in-memory database).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getNoteForUser, getSharedNote, listNotes, saveNote, setShareToken } from "@/db/notes";
import { setupDatabase } from "@/db/setup";
import { DEMO_USER_ID } from "@/lib/auth";
import { parseDoc } from "@/lib/editor";

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const doc = (t: string) => parseDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

before(async () => {
  await setupDatabase();
  await db.insert(users).values({ id: OTHER_USER_ID, email: "other@example.com" });
});

test("optimistic concurrency: stale baseVersion gets a conflict", async () => {
  const id = randomUUID();
  assert.deepEqual(await saveNote(DEMO_USER_ID, id, { baseVersion: 0, title: "Buy milk", doc: doc("v1") }), {
    status: "ok",
    version: 1,
  });
  assert.deepEqual(await saveNote(DEMO_USER_ID, id, { baseVersion: 1, title: "Buy milk, eggs", doc: doc("laptop") }), {
    status: "ok",
    version: 2,
  });

  const stale = await saveNote(DEMO_USER_ID, id, { baseVersion: 1, title: "Buy milk, bread", doc: doc("phone") });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.status === "conflict" && stale.note.version, 2);
  assert.equal(stale.status === "conflict" && stale.note.title, "Buy milk, eggs");

  // A repeated lazy-create (baseVersion 0) on an existing row is also a conflict, not an overwrite.
  assert.equal((await saveNote(DEMO_USER_ID, id, { baseVersion: 0, title: "x", doc: doc("x") })).status, "conflict");
});

test("IDOR: another user's note is invisible and unwritable", async () => {
  const id = randomUUID();
  await saveNote(DEMO_USER_ID, id, { baseVersion: 0, title: "Private", doc: doc("secret") });

  assert.equal(await getNoteForUser(id, OTHER_USER_ID), null);
  assert.equal((await listNotes(OTHER_USER_ID)).items.length, 0);
  assert.equal((await listNotes(OTHER_USER_ID, { q: "secret" })).items.length, 0);
  for (const baseVersion of [0, 1]) {
    const res = await saveNote(OTHER_USER_ID, id, { baseVersion, title: "pwned", doc: doc("pwned") });
    assert.equal(res.status, "not_found");
  }
  assert.equal((await getNoteForUser(id, DEMO_USER_ID))?.title, "Private");
  await setShareToken(OTHER_USER_ID, id, "stolen-token");
  assert.equal(await getSharedNote("stolen-token"), null);
});

test("cursor pagination walks every note exactly once", async () => {
  const all = (await listNotes(DEMO_USER_ID, { limit: 1000 })).items.map((n) => n.id);
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await listNotes(DEMO_USER_ID, { limit: 2, cursor });
    seen.push(...page.items.map((n) => n.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, all);
});

test("full-text search matches stemmed words in content", async () => {
  const hits = await listNotes(DEMO_USER_ID, { q: "hiking" });
  assert.deepEqual(
    hits.items.map((n) => n.title),
    ["Weekend trip"],
  );
});

test("parseDoc rejects unknown node types", () => {
  assert.throws(() => parseDoc({ type: "doc", content: [{ type: "script", text: "alert(1)" }] }));
});

test("seed ids are fixed, so every in-memory instance agrees on note ids", async () => {
  const note = await getNoteForUser("00000000-0000-4000-8000-100000000000", DEMO_USER_ID);
  assert.equal(note?.title, "Groceries");
});
