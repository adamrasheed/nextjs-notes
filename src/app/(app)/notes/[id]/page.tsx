import { notFound } from "next/navigation";
import { addTagAction, deleteNote, removeTagAction, shareNote, unshareNote } from "@/app/(app)/actions";
import { getNoteForUser, isUuid } from "@/db/notes";
import { getCurrentUserId } from "@/lib/auth";
import { NoteEditor } from "./note-editor";

const button = "rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100";

export default async function NotePage({ params }: PageProps<"/notes/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  // No row yet means a lazily created new note (or someone else's id, which the first save will 404).
  const note = await getNoteForUser(id, await getCurrentUserId());

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_14rem]">
      <NoteEditor id={id} initialTitle={note?.title ?? ""} initialContent={note?.content ?? null} initialVersion={note?.version ?? 0} />

      {note && (
        <aside className="space-y-6 text-sm">
          <section className="space-y-2">
            <h2 className="font-medium">Tags</h2>
            <ul className="flex flex-wrap gap-2">
              {note.tags.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded-full bg-stone-200 py-0.5 pl-3 pr-1">
                  #{t.name}
                  <form action={removeTagAction.bind(null, id, t.id)}>
                    <button aria-label={`Remove tag ${t.name}`} className="rounded-full px-1.5 text-stone-500 hover:bg-stone-300">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addTagAction.bind(null, id)} className="flex gap-2">
              <input
                name="name"
                placeholder="Add tag"
                aria-label="Add tag"
                maxLength={40}
                className="w-full rounded-md border border-stone-300 bg-white px-2 py-1"
              />
              <button className={button}>Add</button>
            </form>
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Sharing</h2>
            {note.shareToken ? (
              <>
                <a href={`/s/${note.shareToken}`} target="_blank" className="block break-all text-blue-700 underline">
                  /s/{note.shareToken}
                </a>
                <form action={unshareNote.bind(null, id)}>
                  <button className={button}>Revoke link</button>
                </form>
              </>
            ) : (
              <form action={shareNote.bind(null, id)}>
                <button className={button}>Create share link</button>
              </form>
            )}
          </section>

          <form action={deleteNote.bind(null, id)}>
            <button className="text-red-700 hover:underline">Move to trash</button>
          </form>
        </aside>
      )}
    </div>
  );
}
