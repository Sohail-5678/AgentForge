// Loads the demo snapshot (data/demo-snapshot.json, written by `af-run demo`) into an EMPTY database so the dashboards
// have history from day one. Refuses to run if any agent rows exist. Usage: DATABASE_URL=… pnpm db:seed [--force]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const path = process.env.AF_SNAPSHOT_PATH ?? join(import.meta.dirname, "..", "data", "demo-snapshot.json");
const snap = JSON.parse(readFileSync(path, "utf8"));
// Parents before children (foreign keys).
const ORDER = [
  "agents", "profiles", "suites", "cases", "suite_versions", "runs", "results", "traces", "attacks",
  "optimizer_experiments", "optimizer_candidates", "promotions", "case_reviews", "judge_labels",
  "judge_calibration", "llm_usage", "api_keys", "audit_log", "alerts",
];
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query("SELECT count(*)::int AS n FROM agents");
  if (rows[0].n > 0 && !process.argv.includes("--force")) {
    console.log(`database already has ${rows[0].n} agents — skipping seed (pass --force to load anyway)`);
    process.exit(0);
  }
  await client.query("BEGIN");
  for (const table of ORDER) {
    const data = snap.tables[table] ?? [];
    if (!data.length) continue;
    const cols = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = current_schema()", [table])).rows.map((r) => r.column_name);
    const present = cols.filter((c) => c in data[0]);
    const list = present.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < data.length; i += 400) {
      const batch = data.slice(i, i + 400).map((r) => Object.fromEntries(present.map((c) => [c, r[c] ?? null])));
      await client.query(`INSERT INTO "${table}" (${list}) SELECT ${list} FROM json_populate_recordset(NULL::"${table}", $1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(batch)]);
    }
    console.log(`${table.padEnd(22)} ${data.length}`);
  }
  await client.query("SELECT setval(pg_get_serial_sequence('runs','seq'), COALESCE((SELECT max(seq) FROM runs), 1))");
  await client.query("SELECT setval(pg_get_serial_sequence('audit_log','id'), COALESCE((SELECT max(id) FROM audit_log), 1))");
  await client.query("COMMIT");
  console.log(`seeded from ${path} (generated ${snap.generated_at})`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
