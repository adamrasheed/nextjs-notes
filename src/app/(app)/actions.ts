"use server";

// Server Actions for one-off mutations (DESIGN.md section 6). They are public HTTP endpoints,
// so each one resolves the user itself and validates its arguments.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addTag, isUuid, removeTag, setDeleted, setShareToken } from "@/db/notes";
import { getCurrentUserId } from "@/lib/auth";

function check(...ids: string[]) {
  if (!ids.every((id) => typeof id === "string" && isUuid(id))) throw new Error("invalid id");
}

export async function deleteNote(id: string) {
  check(id);
  await setDeleted(await getCurrentUserId(), id, true);
  revalidatePath("/");
  redirect("/");
}

export async function restoreNote(id: string) {
  check(id);
  await setDeleted(await getCurrentUserId(), id, false);
  revalidatePath("/trash");
  revalidatePath("/");
}

export async function addTagAction(noteId: string, formData: FormData) {
  check(noteId);
  const name = String(formData.get("name") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 40);
  if (!name) return;
  await addTag(await getCurrentUserId(), noteId, name);
  revalidatePath(`/notes/${noteId}`);
}

export async function removeTagAction(noteId: string, tagId: string) {
  check(noteId, tagId);
  await removeTag(await getCurrentUserId(), noteId, tagId);
  revalidatePath(`/notes/${noteId}`);
}

export async function shareNote(id: string) {
  check(id);
  // 256 bits from a CSPRNG (DESIGN.md section 12); the note id is never the share link.
  await setShareToken(await getCurrentUserId(), id, randomBytes(32).toString("base64url"));
  revalidatePath(`/notes/${id}`);
}

export async function unshareNote(id: string) {
  check(id);
  await setShareToken(await getCurrentUserId(), id, null);
  revalidatePath(`/notes/${id}`);
}
