"use client";

import { useRouter } from "next/navigation";

// Lazy create (DESIGN.md section 6): the id is generated here and no row exists until the first save.
export function NewNoteButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(`/notes/${crypto.randomUUID()}`)}
      className="rounded-md bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-700"
    >
      New note
    </button>
  );
}
