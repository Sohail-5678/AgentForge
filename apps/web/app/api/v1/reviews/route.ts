import { getStore } from "@/lib/server/store";
import { handle, json } from "@/lib/server/http";

export const GET = handle(async (req: Request) => {
  const status = new URL(req.url).searchParams.get("status") || undefined;
  return json({ items: await getStore().reviews(status) });
});
