import { connection } from "next/server";
import { restoreNote } from "@/app/(app)/actions";
import { listTrash } from "@/db/notes";
import { getCurrentUserId } from "@/lib/auth";

export default async function TrashPage() {
  await connection();
  const deleted = await listTrash(await getCurrentUserId());

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Trash</h1>
      {deleted.length === 0 ? (
        <p className="text-sm text-stone-500">Trash is empty.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {deleted.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-4 py-3">
              <span className="font-medium">{n.title || "Untitled"}</span>
              <span className="text-xs text-stone-400">deleted {n.deletedAt?.toLocaleString()}</span>
              <form action={restoreNote.bind(null, n.id)} className="ml-auto">
                <button className="rounded-md border border-stone-300 px-3 py-1 text-sm hover:bg-stone-100">Restore</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
