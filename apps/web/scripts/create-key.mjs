// Creates an API key and prints it ONCE. Usage:
//   DATABASE_URL=… pnpm keys:create --name returnpilot-render --agent returnpilot --scopes traces:write,profiles:read
//   pnpm keys:create --runner        (prints a new AF_RUNNER_KEY and the RUNNER_KEY_HASH for Vercel; no database needed)
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";

const { values } = parseArgs({ options: { name: { type: "string" }, agent: { type: "string" }, scopes: { type: "string" }, runner: { type: "boolean" } } });
const sha = (s) => createHash("sha256").update(s).digest("hex");

if (values.runner) {
  const key = `afr_${randomBytes(32).toString("base64url")}`;
  console.log(`AF_RUNNER_KEY   = ${key}   → GitHub Actions secret`);
  console.log(`RUNNER_KEY_HASH = ${sha(key)}   → Vercel env`);
  process.exit(0);
}
if (!values.name || !values.agent || !values.scopes) {
  console.error("need --name, --agent and --scopes (comma-separated)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const key = `afk_live_${randomBytes(32).toString("base64url")}`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("INSERT INTO api_keys (name, agent_id, key_hash, prefix, scopes) VALUES ($1, $2, $3, $4, $5)", [values.name, values.agent, sha(key), key.slice(0, 13), values.scopes.split(",")]);
await client.query("INSERT INTO audit_log (actor, action, object_type, details) VALUES ('cli', 'key.create', 'api_key', $1)", [JSON.stringify({ name: values.name, agent: values.agent })]);
await client.end();
console.log(`${values.name}: ${key}`);
console.log("Shown once — store it as a secret now.");
