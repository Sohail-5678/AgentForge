import "server-only";
import { databaseUrl } from "../db/client";
import { createPgStore } from "./pg";
import { createSnapshotStore } from "./snapshot";
import type { Store } from "./types";

export * from "./types";

let store: Store | null = null;

/** Neon when DATABASE_URL is set, otherwise the read-only demo snapshot (docs/CONTRACTS.md §0). */
export function getStore(): Store {
  if (!store) store = databaseUrl() ? createPgStore() : createSnapshotStore();
  return store;
}

/** Test hook. */
export function setStore(s: Store | null) {
  store = s;
}
