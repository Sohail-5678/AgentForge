import { handle, json } from "@/lib/server/http";
import { redteamSummary } from "@/lib/server/redteam";

/** GET /redteam/summary?agent= — heatmap + attribution from each agent's latest red-team results. */
export const GET = handle(async (req: Request) => {
  const agent = new URL(req.url).searchParams.get("agent") || undefined;
  return json(await redteamSummary(agent));
});
