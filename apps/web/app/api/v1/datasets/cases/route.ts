import { getStore } from "@/lib/server/store";
import { handle, json } from "@/lib/server/http";

export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  const items = await getStore().cases({
    suite: u.searchParams.get("suite") || undefined,
    split: u.searchParams.get("split") || undefined,
    tag: u.searchParams.get("tag") || undefined,
  });
  return json({ items });
});
