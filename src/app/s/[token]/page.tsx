import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { getSharedNote } from "@/db/notes";
import { extensions } from "@/lib/editor";

export const metadata: Metadata = { robots: { index: false } };

// Public read-only view. Rendered from the stored Tiptap JSON into React elements on the
// server: no editor JS and no raw HTML injection (DESIGN.md section 12, XSS).
export default async function SharedNotePage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const note = await getSharedNote(token);
  if (!note) notFound();

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-6">
      <h1 className="mb-1 text-2xl font-semibold">{note.title || "Untitled"}</h1>
      <p className="mb-6 text-xs text-stone-400">Shared note, read only. Updated {note.updatedAt.toLocaleString()}</p>
      <div className="note-content read-only">{renderToReactElement({ content: note.content, extensions })}</div>
    </article>
  );
}
