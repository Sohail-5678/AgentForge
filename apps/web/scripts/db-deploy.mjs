// Runs on every Vercel build (vercel.json buildCommand): apply pending migrations, then load the demo snapshot only
// if the database is empty (seed.mjs refuses otherwise). No DATABASE_URL (CI, previews) → nothing to do.
// Vercel production env vars are write-only, so the build is the one place that can reach the database.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (!process.env.DATABASE_URL) {
  console.log("db-deploy: DATABASE_URL not set — serving the read-only demo snapshot; skipping migrations");
  process.exit(0);
}
for (const script of ["migrate.mjs", "seed.mjs"]) {
  const r = spawnSync(process.execPath, [join(import.meta.dirname, script)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`db-deploy: ${script} failed`);
    process.exit(r.status ?? 1);
  }
}
