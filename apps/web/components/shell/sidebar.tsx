"use client";

import { LogIn, LogOut, Menu, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/format";
import { NAV, isActive } from "./nav-items";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme";

export interface ShellInfo {
  mode: "postgres" | "snapshot";
  generatedAt: string | null;
  user: { name: string; login: string; role: "user" | "admin"; image: string | null } | null;
  githubConfigured: boolean;
  badges: Record<string, number>;
}

function NavList({ info, onNavigate }: { info: ShellInfo; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="kicker mb-2 px-3 !text-[0.6rem]">{g.group}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badge = info.badges[item.href];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[0.84rem] transition-colors duration-300",
                      active ? "text-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-xl border border-line-strong bg-surface-2"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      />
                    )}
                    {active && (
                      <motion.span
                        layoutId="nav-bar"
                        className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_14px_var(--accent-glow)]"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      />
                    )}
                    <item.icon className={cn("relative size-4 shrink-0 transition-colors", active ? "text-accent" : "group-hover:text-ink-2")} />
                    <span className="relative flex-1">{item.label}</span>
                    {badge ? (
                      <span className="relative rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[0.6rem] text-accent-ink num">{badge}</span>
                    ) : (
                      <span aria-hidden className="relative font-mono text-[0.58rem] text-muted/50 opacity-0 transition group-hover:opacity-100">{item.code}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Footer({ info }: { info: ShellInfo }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="card !rounded-2xl p-3.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full pulse-dot", info.mode === "postgres" ? "bg-pass" : "bg-warn")} />
          <span className="kicker !text-[0.58rem] !text-ink-2">{info.mode === "postgres" ? "Live · Postgres" : "Demo snapshot"}</span>
        </div>
        <p className="mt-1.5 text-[0.72rem] leading-snug text-muted">
          {info.mode === "postgres"
            ? "Control plane connected to Postgres. Runs execute in GitHub Actions."
            : "Read-only synthetic history produced by af-run demo. Live runs appear once the database is connected."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {info.user ? (
          <>
            {info.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.user.image} alt="" className="size-8 rounded-full border border-line-strong" />
            ) : (
              <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-xs">{info.user.login[0]}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-ink">{info.user.login}</p>
              <p className="kicker !text-[0.55rem]">{info.user.role}</p>
            </div>
            <form action={signOutAction}>
              <button type="submit" className="grid size-9 place-items-center rounded-full border border-line-strong text-muted transition hover:border-accent hover:text-ink" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/login"
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-line-strong px-3 py-2 text-xs text-ink-2 transition hover:border-accent hover:text-ink"
          >
            <LogIn className="size-3.5" /> Sign in
          </Link>
        )}
        <ThemeToggle />
      </div>
    </div>
  );
}

export function Sidebar({ info }: { info: ShellInfo }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col justify-between border-r border-line bg-bg-2/80 px-5 py-6 backdrop-blur-xl lg:flex">
        <div className="flex min-h-0 flex-col gap-8">
          <div className="flex flex-col gap-5">
            <Link href="/" className="flex items-center gap-2.5 px-1" aria-label="AgentForge home">
              <LogoMark />
              <Wordmark />
            </Link>
            <CommandPalette />
          </div>
          <div className="-mr-3 min-h-0 overflow-y-auto pr-3">
            <NavList info={info} />
          </div>
        </div>
        <Footer info={info} />
      </aside>

      {/* Mobile bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-bg/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href="/" className="flex items-center gap-2" aria-label="AgentForge home">
          <LogoMark className="size-8" />
          <Wordmark className="text-lg" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid size-10 place-items-center rounded-full border border-line-strong"
          aria-label="Open navigation"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col justify-between overflow-y-auto border-r border-line bg-bg-2 px-5 py-5"
          >
            <div className="flex flex-col gap-7">
              <div className="flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
                  <LogoMark className="size-8" />
                  <Wordmark className="text-lg" />
                </Link>
                <button type="button" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full border border-line-strong" aria-label="Close navigation">
                  <X className="size-4" />
                </button>
              </div>
              <NavList info={info} onNavigate={() => setOpen(false)} />
            </div>
            <div className="mt-8">
              <Footer info={info} />
            </div>
          </motion.aside>
        </div>
      )}
    </>
  );
}
