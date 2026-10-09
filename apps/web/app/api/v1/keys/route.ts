import { z } from "zod";
import { getStore } from "@/lib/server/store";
import { handle, HttpError, json, newApiKey, readJson, requireAdmin } from "@/lib/server/http";

/** API keys (§10.1): created/revoked by admins; the plaintext is returned once and never stored. */
export const GET = handle(async () => {
  await requireAdmin();
  const keys = await getStore().apiKeys();
  return json({ items: keys.map((k) => ({ id: k.id, name: k.name, agent_id: k.agent_id, prefix: k.prefix, scopes: k.scopes, last_used_at: k.last_used_at, revoked_at: k.revoked_at, created_at: k.created_at })) });
});

const schema = z.object({
  name: z.string().min(2).max(80),
  agent_id: z.enum(["datapilot", "returnpilot", "toy"]),
  scopes: z.array(z.enum(["traces:write", "profiles:read", "gate:trigger"])).min(1),
});

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const body = await readJson(req, schema, 4096);
  const { key, hash, prefix } = newApiKey();
  const row = await getStore().insertApiKey({ name: body.name, agent_id: body.agent_id, key_hash: hash, prefix, scopes: body.scopes });
  await getStore().writeAudit({ actor: admin.login, action: "key.create", object_type: "api_key", object_id: row.id, details: { name: body.name, agent: body.agent_id, scopes: body.scopes } });
  return json({ id: row.id, key, prefix, note: "Shown once — store it as a secret now." }, 201);
});

export const DELETE = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "bad_request", "Pass ?id=<key id>.");
  const ok = await getStore().revokeApiKey(id);
  if (!ok) throw new HttpError(404, "not_found", "Key not found or already revoked.");
  await getStore().writeAudit({ actor: admin.login, action: "key.revoke", object_type: "api_key", object_id: id, details: null });
  return json({ ok: true });
});
