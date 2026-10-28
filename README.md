# Notes app demo

A working demo of the design in [`DESIGN.md`](DESIGN.md): Next.js App Router, Drizzle on Postgres, a Tiptap editor with debounced autosave and optimistic concurrency, tags, full-text search, share links and a trash.

## Run it

```bash
npm install && npm run dev
```

Open http://localhost:3000. On first start the app creates an embedded Postgres (PGlite) in `.data/pglite`, applies migrations and seeds a demo user with a few tagged notes. No database to install.

Other scripts:

| Script | What it does |
|---|---|
| `npm run db:setup` | Apply migrations and seed (idempotent). Required for real Postgres. |
| `npm run db:generate` | Generate a new migration after editing `src/db/schema.ts`. |
| `npm test` | Conflict, IDOR, pagination and search tests against an in-memory PGlite. |
| `npm run build && npm start` | Production build. |

Stop the dev server before running `db:setup` against PGlite: only one process can open the data dir at a time.

## Database switch

`src/db/index.ts` is the only file that knows which driver is in use.

- `DATABASE_URL` unset: PGlite, persisted to `.data/pglite`, migrated and seeded on boot by `src/instrumentation.ts`.
- `DATABASE_URL` set (for example in `.env.local`): `node-postgres`. Run `npm run db:setup` once to migrate and seed; app servers never migrate a real database on their own.

Both use the same schema (`src/db/schema.ts`) and the same migrations (`drizzle/`).

The live demo on Vercel sets `PGLITE_DATA_DIR=memory://`: each serverless instance boots its own seeded in-memory database, so edits reset when instances recycle. Set `DATABASE_URL` to a hosted Postgres (Neon, Supabase) for data that sticks.

## Where the design lives in code

| Design (DESIGN.md section) | Code |
|---|---|
| Pages and the client/server split (6) | `src/app/(app)/page.tsx`, `src/app/(app)/notes/[id]/page.tsx`, `src/app/s/[token]/page.tsx` |
| Autosave as a Route Handler, not a Server Action (6) | `src/app/api/notes/[id]/route.ts` |
| Debounce 1s, max wait 5s, skip if not dirty, abort superseded saves, status, retry with backoff (6, 9) | `src/app/(app)/notes/[id]/note-editor.tsx` |
| Lazy create with a client UUID, no orphan rows (6) | `src/app/(app)/new-note-button.tsx`, `saveNote` in `src/db/notes.ts` |
| Server Actions for delete, restore, tags, sharing (6) | `src/app/(app)/actions.ts` |
| Data model, `(user_id, updated_at desc)` index, soft delete, tags join table (7) | `src/db/schema.ts`, `drizzle/0000_init.sql` |
| Optimistic concurrency, 409 with the latest note (8) | `saveNote` in `src/db/notes.ts` |
| Conflict banner with Reload latest and Keep both (8) | `src/app/(app)/notes/[id]/note-editor.tsx` |
| Body size cap (413), input validation, `private, no-store` (9, 10) | `src/app/api/notes/[id]/route.ts` |
| Cursor pagination on `(updated_at, id)` (10) | `listNotes` in `src/db/notes.ts` |
| Share links, `noindex` (10, 12) | `src/app/s/[token]/page.tsx`, `next.config.ts` |
| Full-text search: generated tsvector, GIN index, `websearch_to_tsquery`, `ts_headline` (11) | `src/db/schema.ts`, `listNotes` in `src/db/notes.ts` |
| Every query scoped by `user_id`, 404 not 403 (12) | `src/db/notes.ts` (single data-access layer), `src/lib/auth.ts` |
| Share tokens from a CSPRNG, revocable (12) | `shareNote` / `unshareNote` in `src/app/(app)/actions.ts` |
| Rich text stored as JSON, validated against the editor schema, rendered without raw HTML (12) | `src/lib/editor.ts`, `src/app/s/[token]/page.tsx` |

Two details worth knowing:

- The server validates every save with the editor's ProseMirror schema (`parseDoc`) and extracts `content_text` itself, so it never trusts client HTML or client-computed text. Links are disabled in the editor, so there are no `href` values to sanitize.
- Aborting a fetch does not roll back the server. If an aborted save already committed, the next save gets a 409 against itself. The editor detects that case (the 409 body equals what the aborted request sent) and rebases silently instead of showing a false conflict.

## Shortcuts in this demo

- One hard-coded demo user (`getCurrentUserId` in `src/lib/auth.ts`). Queries are still scoped by `user_id`.
- The share page is rendered per request. DESIGN.md's CDN caching (`s-maxage=60` plus revalidation) needs a CDN; without one, dynamic rendering keeps revocation instant.
- Search results are a single ranked page (no cursor), as in DESIGN.md section 11.
- No refetch on `visibilitychange` and no `GET /api/notes/[id]`; the 409 body carries the latest note instead.

## Out of scope (next steps)

- Image uploads with presigned URLs and the `attachments` table
- Real auth (Auth.js or Clerk) and the `sessions` table
- Redis (read cache, write coalescing)
- Rate limiting (per-user autosave limit returning 429)
- Offline support with IndexedDB
- CRDTs for real-time co-editing
- Sending diffs instead of full documents, and request compression
- Sharding by `user_id`
