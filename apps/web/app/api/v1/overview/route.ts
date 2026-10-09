import { handle, json } from "@/lib/server/http";
import { agentCards, openAlerts } from "@/lib/server/queries";

/** GET /overview (§12.3): agent cards + open alerts. */
export const GET = handle(async () => {
  const [cards, alerts] = await Promise.all([agentCards(), openAlerts()]);
  return json({
    agents: cards.map((c) => ({
      agent: c.agent.id,
      active_profile: c.active ? { id: c.active.id, version: c.active.version } : null,
      last_nightly: c.lastNightly ? { id: c.lastNightly.id, seq: c.lastNightly.seq, created_at: c.lastNightly.created_at, summary: c.lastNightly.summary } : null,
      trend: c.trend,
    })),
    alerts,
  });
});
