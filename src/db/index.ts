import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

const migrationsFolder = "./drizzle";

function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const db = drizzlePg(url, { schema });
    return { db, migrate: () => migratePg(db, { migrationsFolder }), close: () => db.$client.end(), embedded: false };
  }
  const dir = process.env.PGLITE_DATA_DIR ?? "./.data/pglite";
  if (!dir.includes("://")) mkdirSync(dir, { recursive: true });
  const db = drizzlePglite(new PGlite(dir), { schema });
  return { db, migrate: () => migratePglite(db, { migrationsFolder }), close: () => db.$client.close(), embedded: true };
}

// Cached on globalThis so dev hot reload never opens the PGlite data dir twice.
const g = globalThis as typeof globalThis & { notesDb?: ReturnType<typeof connect> };
const conn = (g.notesDb ??= connect());

export const db: PgDatabase<PgQueryResultHKT, typeof schema> = conn.db;
export const { migrate, close, embedded } = conn;
