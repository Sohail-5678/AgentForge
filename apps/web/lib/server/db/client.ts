import "server-only";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import * as schema from "./schema";

/**
 * One Drizzle handle per server instance. Neon (production) uses the serverless driver over WebSockets so
 * multi-statement writes (promotion, rollback) run in real transactions; any other Postgres URL (docker compose,
 * CI) uses node-postgres. Both expose the same PgDatabase API.
 */
export type Db = NodePgDatabase<typeof schema>;

let cached: { url: string; db: Db } | null = null;

export function databaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

export function getDb(): Db {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  if (cached?.url === url) return cached.db;
  let db: Db;
  if (/\.neon\.tech|\.neon\.build/.test(url)) {
    if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
    const pool = new NeonPool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
    db = drizzleNeon({ client: pool, schema }) as unknown as Db;
  } else {
    const pool = new PgPool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
    db = drizzlePg({ client: pool, schema });
  }
  cached = { url, db };
  return db;
}
