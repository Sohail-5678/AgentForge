import type { Metadata } from "next";
import Link from "next/link";
import { githubConfigured, signIn } from "@/auth";
import { GithubIcon, LogoMark } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div aria-hidden className="dots dots-fade absolute inset-0" />
      <div aria-hidden className="absolute left-1/2 top-1/3 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)]" />
      <div className="card rise relative w-full max-w-md !rounded-[28px] p-8 sm:p-10">
        <LogoMark className="size-11" />
        <p className="kicker mt-8">Control plane access</p>
        <h1 className="display mt-2 text-6xl text-ink">
          Sign <span className="text-accent">in</span>
        </h1>
        <p className="serif mt-3 text-xl italic leading-snug text-ink-2">Everything is readable without an account. Admins (ADMIN_GITHUB_USERS) can trigger runs, review cases and promote profiles.</p>
        {error && <p className="mt-5 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">Sign-in failed ({error}). Try again.</p>}
        {githubConfigured ? (
          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: target });
            }}
          >
            <button type="submit" className="flex w-full items-center justify-center gap-2.5 rounded-full bg-ink px-5 py-3 text-sm font-medium text-bg transition hover:opacity-90">
              <GithubIcon /> Continue with GitHub
            </button>
          </form>
        ) : (
          <p className="mt-8 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">GitHub OAuth is not configured on this deployment yet (AUTH_GITHUB_ID / AUTH_GITHUB_SECRET).</p>
        )}
        <Link href={target} className="mt-5 block text-center font-mono text-[0.68rem] uppercase tracking-wider text-muted hover:text-ink">
          Continue as visitor →
        </Link>
      </div>
    </main>
  );
}
