import { getStore } from "@/lib/server/store";
import { handle, HttpError, requireApiKey } from "@/lib/server/http";

/** GET /profiles/{agent}/active (§12.1): ETag = body hash; If-None-Match → 304. Agents cache it for 5 minutes. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ agent: string }> }) => {
  const { agent } = await ctx.params;
  await requireApiKey(req, "profiles:read", agent);
  const profile = await getStore().activeProfile(agent);
  if (!profile) throw new HttpError(404, "not_found", `No active profile for ${agent}.`);
  const etag = `"${profile.body_hash}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(JSON.stringify(profile.body), {
    status: 200,
    headers: { "content-type": "application/json", etag, "cache-control": "private, max-age=300", "x-profile-version": String(profile.version) },
  });
});
