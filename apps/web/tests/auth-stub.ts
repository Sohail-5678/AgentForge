// next-auth pulls in next/server, which vitest's ESM resolver can't load; route handlers' helpers only need these.
export type Role = "user" | "admin";
export interface AppUser {
  sub: string;
  role: Role;
  name: string;
  login: string;
  image: string | null;
}
export const githubConfigured = false;
export async function getAppUser(): Promise<AppUser | null> {
  return null;
}
