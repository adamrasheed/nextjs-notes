import Link from "next/link";
import { NewNoteButton } from "./new-note-button";

// App chrome for the signed-in pages. The public share page sits outside this group.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {process.env.PGLITE_DATA_DIR === "memory://" && (
        <p className="-mt-4 mb-6 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Live demo: the database runs in memory and resets often, so your edits will not stick around.
        </p>
      )}
      <nav className="-mt-2 mb-6 flex items-center gap-6 border-b border-stone-200 pb-3 text-sm">
        <Link href="/" className="font-semibold">
          Notes
        </Link>
        <Link href="/trash" className="text-stone-600 hover:text-stone-900">
          Trash
        </Link>
        <div className="ml-auto">
          <NewNoteButton />
        </div>
      </nav>
      {children}
    </>
  );
}
