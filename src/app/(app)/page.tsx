import Link from "next/link";
import { HIT_END, HIT_START, listNotes, listUserTags } from "@/db/notes";
import { getCurrentUserId } from "@/lib/auth";

const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function href(params: { q?: string; tag?: string; cursor?: string }) {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `/?${s}` : "/";
}

// Search snippets mark hits with private-use characters; split on them and render as <mark>, never as HTML.
function Snippet({ text }: { text: string }) {
  return text.split(new RegExp(`[${HIT_START}${HIT_END}]`)).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default async function NotesPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const q = one(sp.q);
  const tag = one(sp.tag);
  const userId = await getCurrentUserId();
  const [{ items, nextCursor }, allTags] = await Promise.all([
    listNotes(userId, { q, tag, cursor: one(sp.cursor) }),
    listUserTags(userId),
  ]);

  return (
    <div className="space-y-5">
      <form action="/" className="flex gap-2">
        {tag && <input type="hidden" name="tag" value={tag} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search notes"
          aria-label="Search notes"
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <button className="rounded-md border border-stone-300 bg-white px-3 text-sm hover:bg-stone-100">Search</button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={href({ q })} className={`rounded-full px-3 py-1 ${tag ? "bg-stone-200" : "bg-stone-900 text-white"}`}>
          All
        </Link>
        {allTags.map((t) => (
          <Link
            key={t.id}
            href={href({ q, tag: t.name })}
            className={`rounded-full px-3 py-1 ${tag === t.name ? "bg-stone-900 text-white" : "bg-stone-200"}`}
          >
            #{t.name}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-stone-500">{q || tag ? "No matching notes." : "No notes yet. Click New note."}</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="block px-4 py-3 hover:bg-stone-50">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium">{n.title || "Untitled"}</span>
                  <span className="ml-auto shrink-0 text-xs text-stone-400">{n.updatedAt.toLocaleString()}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-stone-600">
                  <Snippet text={n.snippet} />
                </p>
                {n.tags.length > 0 && (
                  <div className="mt-1 flex gap-2 text-xs text-stone-500">
                    {n.tags.map((t) => (
                      <span key={t}>#{t}</span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <Link href={href({ tag, cursor: nextCursor })} className="inline-block text-sm text-stone-600 underline">
          Older notes
        </Link>
      )}
    </div>
  );
}
