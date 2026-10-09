"use client";

import { createContext, useContext } from "react";

export interface Viewer {
  role: "visitor" | "user" | "admin";
  login: string | null;
  mode: "postgres" | "snapshot";
}

const Ctx = createContext<Viewer>({ role: "visitor", login: null, mode: "snapshot" });

export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  return <Ctx.Provider value={viewer}>{children}</Ctx.Provider>;
}

export function useViewer() {
  return useContext(Ctx);
}

/** Why an admin action is unavailable for this viewer, or null when it can run. */
export function blockedReason(v: Viewer): string | null {
  if (v.mode === "snapshot") return "This deployment serves the read-only demo snapshot. Connect Neon (DATABASE_URL) to enable admin actions.";
  if (v.role === "visitor") return "Admins only — sign in with GitHub. Visitors can explore everything read-only.";
  if (v.role !== "admin") return "Your GitHub account is not in ADMIN_GITHUB_USERS.";
  return null;
}
