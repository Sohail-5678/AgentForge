import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { GithubIcon, LogoMark, Wordmark } from "@/components/brand/logo";
import { LoopRing } from "@/components/landing/loop-ring";
import { ThemeToggle } from "@/components/shell/theme";
import { landingStats } from "@/lib/server/queries";
import { pct } from "@/lib/format";

export const revalidate = 300;

const TICKER = ["Trace", "Case", "Run", "Grade", "Attack", "Attribute", "Reflect", "Pareto", "Gate", "Promote", "Rollback"];

const CHAPTERS = [
  {
    code: "01",
    title: "Evaluate",
    serif: "beyond “it looked fine”",
    body: "Deterministic end-state and trajectory graders, hard must-not safety properties, canary tokens, and an LLM judge that only counts once Cohen’s kappa against blind human labels reaches 0.6.",
    points: ["end_state · trajectory · must_not", "execution match (BIRD EX)", "rubric judge, calibrated"],
  },
  {
    code: "02",
    title: "Attack",
    serif: "guardrails proven, not assumed",
    body: "Ten OWASP-mapped attack categories, 60+ hand-written seeds, deterministic and LLM mutations, and per-layer attribution that shows which defence actually stopped each attack.",
    points: ["indirect injection via planted data", "per-run canary tokens", "block attribution by layer"],
  },
  {
    code: "03",
    title: "Improve",
    serif: "reflective prompt evolution",
    body: "A GEPA-style optimizer reads failed traces, rewrites one component at a time, and keeps a Pareto front — while locked safety fields, keep-blocks and a deny-list stop it from weakening the agent.",
    points: ["one component per step", "Pareto front on val", "cost–quality config search"],
  },
  {
    code: "04",
    title: "Gate",
    serif: "statistics, safety, then a human",
    body: "A candidate ships only if its test-split gain has a bootstrap interval above zero and McNemar p < 0.05 (or it is 20% cheaper at equal quality), the attack rate does not rise, and an admin approves the diff.",
    points: ["paired bootstrap + McNemar", "pass^2 reliability", "one-click rollback"],
  },
];

export default async function Landing() {
  const s = await landingStats();
  return (
    <div className="relative overflow-x-clip">
      {/* masthead */}
      <header className="relative z-20 mx-auto flex max-w-[1480px] items-center justify-between px-4 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="AgentForge home">
          <LogoMark />
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {[
            ["Loop", "#loop"],
            ["Capabilities", "#capabilities"],
            ["Architecture", "#architecture"],
            ["Limits", "#limits"],
          ].map(([l, h]) => (
            <a key={h} href={h} className="kicker !text-[0.64rem] transition hover:!text-ink">
              {l}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/overview"
            className="group inline-flex items-center gap-2 rounded-full bg-accent-solid px-4 py-2 text-[0.8rem] font-medium text-white shadow-[0_10px_30px_-10px_var(--accent-glow)] transition hover:bg-accent-solid-hi"
          >
            Live dashboard <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative mx-auto max-w-[1480px] px-4 pt-6 sm:px-8 sm:pt-10">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] h-[680px] w-[680px] rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_65%)] blur-2xl" />
        <div className="rise flex items-center justify-between border-y border-line py-2.5 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-muted">
          <span>Issue 03 — October 2026</span>
          <span className="hidden sm:inline">Agent quality · after dark</span>
          <span>The night edition</span>
        </div>

        <h1 className="sr-only">AgentForge — evaluate, red-team and optimize AI agents</h1>
        <div aria-hidden className="display grunge rise mt-6 select-none whitespace-nowrap text-[min(calc((100vw-64px)/4.6),19.5rem)] leading-[0.8] tracking-[-0.01em]" style={{ animationDelay: "80ms" }}>
          AgentForge
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
          <div className="rise" style={{ animationDelay: "160ms" }}>
            <p className="display text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.92] text-accent">
              Evaluate / Attack /
              <br />
              Improve / Gate
            </p>
            <p className="mt-6 max-w-md font-mono text-[0.72rem] uppercase leading-relaxed tracking-[0.08em] text-muted">
              Traces, graders, attacks and prompts shaping the agents that ship after dark — every improvement proven with
              statistics before a human lets it go live.
            </p>
            <p className="serif mt-8 max-w-xl text-[clamp(1.4rem,2.4vw,2rem)] italic leading-snug text-ink-2">
              Most portfolios build an agent. This is the harness around two of them — the part companies actually struggle with.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/overview"
                className="group inline-flex items-center gap-2 rounded-full bg-accent-solid px-6 py-3 text-sm font-medium text-white shadow-[0_18px_44px_-14px_var(--accent-glow)] transition duration-300 hover:-translate-y-0.5 hover:bg-accent-solid-hi"
              >
                Open the live dashboard <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </Link>
              <Link href="/redteam" className="inline-flex items-center gap-2 rounded-full border border-line-strong px-6 py-3 text-sm text-ink-2 transition hover:border-accent hover:text-ink">
                See the red-team heatmap
              </Link>
              <a
                href="https://github.com/Sohail-5678/AgentForge"
                className="inline-flex items-center gap-2 rounded-full px-3 py-3 text-sm text-muted transition hover:text-ink"
              >
                <GithubIcon /> Source
              </a>
            </div>
          </div>

          {/* swatch cards — the reference's numbered colour cards, carrying live numbers instead */}
          <div className="rise grid grid-cols-2 gap-4" style={{ animationDelay: "240ms" }}>
            <Swatch code="07" name="Cases under test" value={s.cases.toLocaleString()} hex={`${s.suites} suites`} dark />
            <Swatch code="08" name="Attack seeds" value={s.seeds.toLocaleString()} hex={`${s.categories} OWASP categories`} red />
            <Swatch code="09" name={`Judge agreement (Cohen’s κ)${s.synthetic ? " *" : ""}`} value={s.kappa != null ? s.kappa.toFixed(2) : "—"} hex={s.kappaN ? `n=${s.kappaN} blind labels` : "not calibrated"} />
            <Swatch code="10" name={`Gated promotions${s.synthetic ? " *" : ""}`} value={String(s.promotions)} hex={`${s.runs.toLocaleString()} runs graded`} />
            {s.synthetic && (
              <p className="col-span-2 font-mono text-[0.6rem] leading-relaxed tracking-wide text-muted">
                * from the demo history: simulated DataPilot/ReturnPilot behaviour scored by AgentForge&apos;s real graders, statistics and gate — not measurements of the live apps.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ticker */}
      <div className="relative mt-20 border-y border-line bg-surface/50 py-4" aria-hidden>
        <div className="marquee flex w-max gap-10 whitespace-nowrap">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="display flex items-center gap-10 text-3xl text-ink/80">
              {t}
              <span className="text-accent">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* loop */}
      <section id="loop" className="relative mx-auto grid max-w-[1480px] scroll-mt-10 items-center gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="kicker flex items-center gap-2"><span className="h-px w-6 bg-accent" />Chapter 00 — the loop</p>
          <h2 className="display mt-4 text-[clamp(2.8rem,6vw,5.2rem)] text-ink">Every night,<br />the agents get <span className="text-accent">tested.</span></h2>
          <p className="mt-6 max-w-xl text-[0.95rem] leading-relaxed text-ink-2">
            DataPilot and ReturnPilot send redacted traces to the control plane. Failures become draft test cases a human reviews.
            GitHub Actions runs the suites and attacks in throwaway containers, graders score every case, and the optimizer proposes
            better prompts — which go live only through the gate.
          </p>
          <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
            <Fact k="Test-split gain" v={s.bestGain != null ? `${s.bestGain > 0 ? "+" : ""}${(s.bestGain * 100).toFixed(0)} pts` : "—"} sub={`best promoted candidate${s.synthetic ? " · demo *" : ""}`} />
            <Fact k="Attack success" v={s.asr != null ? pct(s.asr, 1) : "—"} sub={`ReturnPilot, last nightly${s.synthetic ? " · demo *" : ""}`} />
            <Fact k="List-price cost" v={s.costPerCase != null ? `$${s.costPerCase.toFixed(4)}` : "—"} sub={`per case · actual spend $0${s.synthetic ? " · demo *" : ""}`} />
          </dl>
        </div>
        <div className="relative mx-auto w-full max-w-[640px]">
          <div aria-hidden className="dots dots-fade absolute inset-0" />
          <LoopRing className="relative w-full" />
        </div>
      </section>

      {/* chapters */}
      <section id="capabilities" className="relative mx-auto max-w-[1480px] scroll-mt-10 px-4 pb-24 sm:px-8">
        <div className="grid gap-px overflow-hidden rounded-[28px] border border-line bg-line md:grid-cols-2">
          {CHAPTERS.map((c) => (
            <article key={c.code} className="group relative bg-bg p-8 transition duration-500 hover:bg-surface sm:p-10">
              <div className="flex items-start justify-between">
                <span className="font-mono text-xs text-accent">{c.code}</span>
                <ArrowUpRight className="size-5 text-muted transition duration-500 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-accent" />
              </div>
              <h3 className="display mt-8 text-6xl text-ink transition duration-500 group-hover:text-accent">{c.title}</h3>
              <p className="serif mt-2 text-2xl italic text-ink-2">{c.serif}</p>
              <p className="mt-5 max-w-lg text-[0.92rem] leading-relaxed text-muted">{c.body}</p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {c.points.map((p) => (
                  <li key={p} className="rounded-full border border-line-strong px-3 py-1 font-mono text-[0.62rem] uppercase tracking-wider text-ink-2">
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* architecture */}
      <section id="architecture" className="relative mx-auto max-w-[1480px] scroll-mt-10 px-4 pb-24 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="kicker flex items-center gap-2"><span className="h-px w-6 bg-accent" />How it was built</p>
            <h2 className="display mt-4 text-[clamp(2.6rem,5vw,4.4rem)] text-ink">Control plane.<br /><span className="text-accent">Execution plane.</span></h2>
            <p className="mt-6 max-w-lg text-[0.95rem] leading-relaxed text-ink-2">
              The always-on part is light: Next.js route handlers on Vercel and Neon Postgres store traces, profiles and results. The heavy part is
              bursty: GitHub Actions runs the Python runner image with a throwaway Postgres per job — reproducible by image tag, target commit,
              profile version and suite hash. Total cost: $0.
            </p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {["Next.js 16", "Auth.js", "Neon + Drizzle", "Python 3.12", "SciPy", "GitHub Actions", "GHCR", "Gemini Flash", "Groq gpt-oss-20b", "Prompt Guard 2"].map((t) => (
                <li key={t} className="rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[0.64rem] text-ink-2">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <ArchDiagram />
        </div>
      </section>

      {/* limits */}
      <section id="limits" className="relative mx-auto max-w-[1480px] scroll-mt-10 px-4 pb-28 sm:px-8">
        <div className="card relative overflow-hidden !rounded-[28px] p-8 sm:p-12">
          <div aria-hidden className="dots dots-fade absolute inset-0 opacity-60" />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="kicker">Honest limitations</p>
              <p className="serif mt-4 text-[clamp(1.8rem,3vw,2.6rem)] italic leading-tight text-ink">
                With 50 test cases you can only prove large gains — so the gate says <span className="text-accent not-italic">“not proven”</span>, never “no effect”.
              </p>
            </div>
            <ul className="grid gap-4 text-[0.9rem] text-ink-2 sm:grid-cols-2">
              {[
                "Test splits are small; many real improvements read “not proven”.",
                "Free-tier quotas make optimization slow — days, not minutes.",
                "Judge reliability is measured, not guaranteed; recalibrate per prompt or model change.",
                "Hosted runners cannot enforce outbound network isolation.",
                "The public dashboard shows synthetic demo history generated by af-run demo; live runs replace it once connected.",
                "Synthetic data only — results describe these demos, not production traffic.",
              ].map((l, i) => (
                <li key={l} className="flex gap-3">
                  <span className="font-mono text-[0.65rem] text-accent">{String(i + 1).padStart(2, "0")}</span>
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <LogoMark className="size-7" />
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted">AgentForge · built by Ameer Sohail Shaik · $0 stack</p>
          </div>
          <div className="flex flex-wrap gap-5 font-mono text-[0.65rem] uppercase tracking-[0.16em]">
            <a className="text-muted hover:text-ink" href="https://datapilot-analyst.vercel.app">DataPilot ↗</a>
            <a className="text-muted hover:text-ink" href="https://returnpilot-ai.vercel.app">ReturnPilot ↗</a>
            <a className="text-muted hover:text-ink" href="https://github.com/Sohail-5678/AgentForge">GitHub ↗</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Swatch({ code, name, value, hex, dark, red }: { code: string; name: string; value: string; hex: string; dark?: boolean; red?: boolean }) {
  return (
    <div
      className={
        "group relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-[6px] p-5 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.8)] ring-1 transition duration-500 hover:-translate-y-1.5 hover:rotate-[-0.6deg] " +
        (red
          ? "bg-accent-solid text-white ring-white/30"
          : dark
            ? "bg-black text-bone ring-white/25"
            : "bg-surface text-ink ring-line-strong")
      }
    >
      <span className={"serif text-sm italic " + (red ? "text-white" : "text-muted")}>{code}</span>
      <div>
        <p className="display num text-[clamp(2.2rem,3.6vw,3.4rem)] leading-none">{value}</p>
        <p className="serif mt-3 text-[1.3rem] leading-tight">{name}</p>
        <div className={"my-3 h-px " + (red ? "bg-white/40" : "bg-current/20")} />
        <p className={"font-mono text-[0.6rem] uppercase tracking-[0.2em] " + (red ? "text-white" : "text-muted")}>{hex}</p>
      </div>
    </div>
  );
}

function Fact({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div>
      <dt className="kicker">{k}</dt>
      <dd className="display num mt-2 text-4xl text-ink">{v}</dd>
      <dd className="mt-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted">{sub}</dd>
    </div>
  );
}

function ArchDiagram() {
  const box = "rounded-2xl border border-line-strong bg-surface/80 p-4 backdrop-blur";
  return (
    <div className="card relative overflow-hidden !rounded-[28px] p-5 sm:p-7">
      <div aria-hidden className="dots absolute inset-0 opacity-50" />
      <div className="relative grid gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] md:items-stretch">
        <div className="flex flex-col gap-3">
          <p className="kicker">Targets · Render</p>
          {["DataPilot API", "ReturnPilot API"].map((t) => (
            <div key={t} className={box}>
              <p className="text-sm text-ink">{t}</p>
              <p className="mt-1 font-mono text-[0.6rem] text-muted">trace.v1 → · ← profile.v1</p>
            </div>
          ))}
        </div>
        <Arrow />
        <div className="flex flex-col gap-3">
          <p className="kicker !text-accent">Control plane · Vercel</p>
          <div className={box + " glow-red"}>
            <p className="text-sm text-ink">Next.js dashboard + /api/v1</p>
            <p className="mt-1 font-mono text-[0.6rem] text-muted">ingest · profiles · runs · reviews · gate</p>
          </div>
          <div className={box}>
            <p className="text-sm text-ink">Neon Postgres</p>
            <p className="mt-1 font-mono text-[0.6rem] text-muted">traces · cases · runs · results · profiles</p>
          </div>
        </div>
        <Arrow label="workflow_dispatch" />
        <div className="flex flex-col gap-3">
          <p className="kicker">Execution plane · Actions</p>
          <div className={box}>
            <p className="text-sm text-ink">agentforge-runner image</p>
            <p className="mt-1 font-mono text-[0.6rem] text-muted">graders · red team · optimizer</p>
          </div>
          <div className={box}>
            <p className="text-sm text-ink">Throwaway Postgres</p>
            <p className="mt-1 font-mono text-[0.6rem] text-muted">target eval adapter @ commit</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center md:flex-col" aria-hidden>
      <svg width="64" height="24" viewBox="0 0 64 24" className="rotate-90 md:rotate-0">
        <path d="M2 12h56" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" style={{ animation: "dash 6s linear infinite" }} />
        <path d="M54 6l6 6-6 6" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
      </svg>
      {label && <span className="mt-1 hidden font-mono text-[0.55rem] uppercase tracking-wider text-muted md:block">{label}</span>}
    </div>
  );
}
