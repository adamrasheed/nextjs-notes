"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { extensions } from "@/lib/editor";

const IDLE_MS = 1000;
const MAX_WAIT_MS = 5000;
const MAX_RETRY_MS = 30000;

type Status = "new" | "unsaved" | "saving" | "saved" | "offline" | "conflict" | "error";
type SaveBody = { baseVersion: number; title: string; content: JSONContent };
type ServerNote = { title: string; content: JSONContent; version: number };

const statusLabel: Record<Status, string> = {
  new: "Not saved yet",
  unsaved: "Unsaved changes",
  saving: "Saving...",
  saved: "Saved",
  offline: "Offline, will retry",
  conflict: "Conflict",
  error: "Save failed",
};

const patch = (id: string, body: SaveBody, signal?: AbortSignal) =>
  fetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

// Autosave per DESIGN.md sections 6, 8 and 9: debounce with max-wait, skip when not dirty,
// abort superseded saves, send baseVersion for optimistic concurrency, handle 409.
export function NoteEditor(props: {
  id: string;
  initialTitle: string;
  initialContent: JSONContent | null;
  initialVersion: number;
}) {
  const { id } = props;
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [status, setStatus] = useState<Status>(props.initialVersion ? "saved" : "new");
  const [errorText, setErrorText] = useState("");
  const [conflict, setConflict] = useState<ServerNote | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);

  const version = useRef(props.initialVersion);
  const titleRef = useRef(props.initialTitle);
  const dirty = useRef(false);
  const paused = useRef(false); // true while a conflict is unresolved
  const inFlight = useRef<{ controller: AbortController; body: SaveBody } | null>(null);
  const aborted = useRef<SaveBody[]>([]);
  const timers = useRef<{ idle?: number; maxWait?: number; retry?: number }>({});
  const retryDelay = useRef(1000);
  const editorRef = useRef<Editor | null>(null);

  function schedule() {
    dirty.current = true;
    if (paused.current) return;
    setStatus("unsaved");
    const t = timers.current;
    window.clearTimeout(t.idle);
    t.idle = window.setTimeout(save, IDLE_MS);
    t.maxWait ??= window.setTimeout(save, MAX_WAIT_MS);
  }

  // An aborted request may still have committed on the server. If the 409 shows exactly the
  // content we sent in it, the conflict is with ourselves: adopt that version and resend.
  function isOwnWrite(note: ServerNote) {
    const schema = editorRef.current?.schema;
    return aborted.current.some(
      (b) =>
        schema &&
        b.baseVersion === note.version - 1 &&
        b.title === note.title &&
        schema.nodeFromJSON(b.content).eq(schema.nodeFromJSON(note.content)),
    );
  }

  async function save() {
    const t = timers.current;
    window.clearTimeout(t.idle);
    window.clearTimeout(t.maxWait);
    window.clearTimeout(t.retry);
    t.maxWait = undefined;
    const editor = editorRef.current;
    if (!dirty.current || paused.current || !editor) return;

    if (inFlight.current) {
      inFlight.current.controller.abort();
      aborted.current.push(inFlight.current.body);
    }
    const controller = new AbortController();
    const body: SaveBody = { baseVersion: version.current, title: titleRef.current, content: editor.getJSON() };
    inFlight.current = { controller, body };
    dirty.current = false;
    setStatus("saving");

    try {
      const res = await patch(id, body, controller.signal);
      const data = await res.json();
      if (res.ok) {
        version.current = data.version;
        aborted.current = [];
        retryDelay.current = 1000;
        // First save created the row: refresh the server shell so tags and sharing appear.
        if (body.baseVersion === 0) router.refresh();
        setStatus(dirty.current ? "unsaved" : "saved");
      } else if (res.status === 409 && isOwnWrite(data.note)) {
        version.current = data.note.version;
        aborted.current = [];
        dirty.current = true;
        save();
      } else if (res.status === 409) {
        dirty.current = true;
        paused.current = true;
        setConflict(data.note);
        setStatus("conflict");
      } else {
        dirty.current = true;
        setErrorText(data.error ?? `HTTP ${res.status}`);
        setStatus("error");
      }
    } catch {
      if (controller.signal.aborted) return; // superseded by a newer save
      dirty.current = true;
      setStatus("offline");
      t.retry = window.setTimeout(save, retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_MS);
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
    }
  }

  const editor = useEditor({
    extensions,
    content: props.initialContent ?? "",
    immediatelyRender: false,
    autofocus: props.initialVersion === 0 ? "start" : false,
    editorProps: { attributes: { class: "note-content min-h-[50vh] py-2" } },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    onUpdate: schedule,
  });

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function applyServer(note: ServerNote) {
    editor?.commands.setContent(note.content, { emitUpdate: false });
    titleRef.current = note.title;
    setTitle(note.title);
    version.current = note.version;
    dirty.current = false;
    paused.current = false;
    aborted.current = [];
    setConflict(null);
    setStatus("saved");
  }

  // "Keep both": save the local copy as a brand new note, then show the server version here.
  async function keepBoth() {
    if (!editor || !conflict) return;
    const newId = crypto.randomUUID();
    const res = await patch(newId, {
      baseVersion: 0,
      title: `${titleRef.current || "Untitled"} (conflict copy)`,
      content: editor.getJSON(),
    });
    if (!res.ok) {
      setErrorText("Could not save the copy");
      return;
    }
    setCopyId(newId);
    applyServer(conflict);
  }

  return (
    <div className="min-w-0 space-y-3">
      {conflict && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">This note was changed on another device.</p>
          <p className="mt-1 text-stone-600">Your edits are kept here until you choose.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => applyServer(conflict)} className="rounded-md border border-stone-300 bg-white px-3 py-1">
              Reload latest
            </button>
            <button onClick={keepBoth} className="rounded-md bg-stone-900 px-3 py-1 text-white">
              Keep both
            </button>
          </div>
        </div>
      )}
      {copyId && (
        <p className="rounded-md bg-green-50 p-3 text-sm">
          Your version was saved as a new note.{" "}
          <Link href={`/notes/${copyId}`} className="underline">
            Open the copy
          </Link>
        </p>
      )}

      <div className="flex items-center gap-3">
        <input
          value={title}
          onChange={(e) => {
            titleRef.current = e.target.value;
            setTitle(e.target.value);
            schedule();
          }}
          placeholder="Untitled"
          aria-label="Title"
          maxLength={500}
          className="w-full bg-transparent text-2xl font-semibold outline-none"
        />
        <span aria-live="polite" className="shrink-0 text-xs text-stone-500">
          {statusLabel[status]}
          {status === "error" && errorText ? `: ${errorText}` : ""}
        </span>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white px-4">
        <div className="-mx-4 flex gap-1 border-b border-stone-200 px-2 py-1 text-sm">
          {(
            [
              ["Bold", (e: Editor) => e.chain().focus().toggleBold().run()],
              ["Heading", (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run()],
              ["Bullets", (e: Editor) => e.chain().focus().toggleBulletList().run()],
              ["Checklist", (e: Editor) => e.chain().focus().toggleTaskList().run()],
            ] as const
          ).map(([label, run]) => (
            <button
              key={label}
              type="button"
              onClick={() => editor && run(editor)}
              className="rounded px-2 py-0.5 text-stone-600 hover:bg-stone-100"
            >
              {label}
            </button>
          ))}
        </div>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
