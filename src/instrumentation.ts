export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { embedded } = await import("@/db");
  // Zero-setup demo: migrate and seed the embedded PGlite DB on boot. Real Postgres is
  // migrated explicitly with `npm run db:setup`, never implicitly by app servers.
  if (embedded) await (await import("@/db/setup")).setupDatabase();
}
