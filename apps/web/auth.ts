import NextAuth, { type NextAuthConfig, type Session } from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Auth.js v5 (SPEC §2.1, §10.1): GitHub OAuth, JWT session in an httpOnly cookie.
 * Visitors (no session) get the read-only dashboards; signed-in users may label calibration items;
 * admins (GitHub logins in ADMIN_GITHUB_USERS) trigger runs, review cases, promote/rollback and manage keys.
 */
export type Role = "user" | "admin";

export interface AppUser {
  sub: string;
  role: Role;
  name: string;
  login: string;
  image: string | null;
}

function csv(v: string | undefined) {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function roleForGithubLogin(login: string): Role {
  return csv(process.env.ADMIN_GITHUB_USERS).includes(login.toLowerCase()) ? "admin" : "user";
}

export const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login", error: "/login" },
  providers: githubConfigured
    ? [GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET })]
    : [],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.provider === "github") {
        const gh = (profile ?? {}) as { id?: number | string; login?: string; name?: string; avatar_url?: string };
        const login = String(gh.login ?? "");
        token.sub = `github:${gh.id ?? account.providerAccountId}`;
        token.login = login;
        token.name = gh.name || login;
        token.picture = gh.avatar_url ?? token.picture;
      }
      // Re-derive the role on every request so removing someone from ADMIN_GITHUB_USERS takes effect immediately.
      if (typeof token.login === "string") token.role = roleForGithubLogin(token.login);
      return token;
    },
    async session({ session, token }) {
      const app: AppUser | null =
        typeof token.login === "string" && token.login
          ? {
              sub: String(token.sub ?? ""),
              role: token.role === "admin" ? "admin" : "user",
              name: typeof token.name === "string" ? token.name : token.login,
              login: token.login,
              image: typeof token.picture === "string" ? token.picture : null,
            }
          : null;
      return { ...session, app } as Session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export function appUserFrom(session: Session | null | undefined): AppUser | null {
  const app = (session as (Session & { app?: AppUser | null }) | null | undefined)?.app;
  return app?.login ? app : null;
}

export async function getAppUser(): Promise<AppUser | null> {
  if (!process.env.AUTH_SECRET) return null;
  try {
    return appUserFrom(await auth());
  } catch {
    return null;
  }
}
