// Autosave endpoint (DESIGN.md sections 6, 8, 9). A Route Handler rather than a Server Action
// so the client can abort superseded saves and get precise 409/413 status codes.
import { NextResponse, type NextRequest } from "next/server";
import { isUuid, saveNote } from "@/db/notes";
import { getCurrentUserId } from "@/lib/auth";
import { parseDoc, type ParsedDoc } from "@/lib/editor";

const MAX_BODY_BYTES = 2_000_000;
const MAX_TITLE_LENGTH = 500;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/notes/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "not found" }, 404);
  const userId = await getCurrentUserId();
  // shortcut: no per-user rate limit (DESIGN.md wants ~2 saves/s via Redis), add @upstash/ratelimit here before launch

  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json({ error: "too large" }, 413);

  let body: { baseVersion?: unknown; title?: unknown; content?: unknown };
  try {
    body = JSON.parse(raw) ?? {};
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const { baseVersion, title, content } = body;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return json({ error: "baseVersion must be a non-negative integer" }, 400);
  }
  if (typeof title !== "string" || title.length > MAX_TITLE_LENGTH) {
    return json({ error: `title must be a string of at most ${MAX_TITLE_LENGTH} characters` }, 400);
  }
  let doc: ParsedDoc;
  try {
    doc = parseDoc(content);
  } catch {
    return json({ error: "content does not match the editor schema" }, 400);
  }

  const result = await saveNote(userId, id, { baseVersion, title, doc });
  if (result.status === "ok") return json({ version: result.version });
  if (result.status === "conflict") return json({ error: "conflict", note: result.note }, 409);
  return json({ error: "not found" }, 404);
}
