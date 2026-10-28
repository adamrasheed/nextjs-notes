import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, migrate } from "@/db";
import { notes, noteTags, tags, users } from "@/db/schema";
import { DEMO_USER_ID } from "@/lib/auth";
import { parseDoc } from "@/lib/editor";

const text = (t: string) => ({ type: "text", text: t });
const p = (t: string) => ({ type: "paragraph", content: [text(t)] });
const h = (t: string) => ({ type: "heading", attrs: { level: 2 }, content: [text(t)] });
const task = (t: string, checked = false) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] });
const doc = (...content: object[]) => ({ type: "doc", content });

const samples = [
  {
    title: "Groceries",
    tags: ["home"],
    doc: doc({ type: "taskList", content: [task("Buy milk", true), task("Eggs"), task("Sourdough bread")] }),
  },
  {
    title: "Design notes: autosave",
    tags: ["ideas"],
    doc: doc(
      h("Key ideas"),
      p("Optimistic concurrency control with a version column beats a write queue for lost updates."),
      p("Lazy create with a client generated UUID avoids orphan empty notes."),
    ),
  },
  {
    title: "Book list",
    tags: ["reading"],
    doc: doc({
      type: "bulletList",
      content: ["Designing Data-Intensive Applications", "The Pragmatic Programmer", "A Philosophy of Software Design"].map(
        (t) => ({ type: "listItem", content: [p(t)] }),
      ),
    }),
  },
  {
    title: "Weekend trip",
    tags: ["home", "ideas"],
    doc: doc(p("Drive up the coast Saturday morning, camp near the redwoods, hike the fern canyon trail on Sunday.")),
  },
  {
    title: "Standup",
    tags: ["work"],
    doc: doc(p("Yesterday: shipped the autosave status indicator."), p("Today: tag filters and full-text search.")),
  },
];

// Idempotent: safe to run on every boot. Notes are seeded only when the demo user is first created.
export async function setupDatabase() {
  await migrate();
  const created = await db
    .insert(users)
    .values({ id: DEMO_USER_ID, email: "demo@example.com", name: "Demo User" })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!created.length) return;

  for (const [i, s] of samples.entries()) {
    const id = randomUUID();
    const parsed = parseDoc(s.doc);
    await db.insert(notes).values({
      id,
      userId: DEMO_USER_ID,
      title: s.title,
      content: parsed.content,
      contentText: parsed.text,
      updatedAt: sql`now() - make_interval(hours => ${i})`,
    });
    for (const name of s.tags) {
      const [tag] = await db
        .insert(tags)
        .values({ userId: DEMO_USER_ID, name })
        .onConflictDoUpdate({ target: [tags.userId, tags.name], set: { name } })
        .returning({ id: tags.id });
      await db.insert(noteTags).values({ noteId: id, tagId: tag.id });
    }
  }
}
