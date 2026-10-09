import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Clock3, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { cn, pct } from "@/lib/format";
import { TRIGGER_LABEL } from "@/lib/meta";

/* ------------------------------------------------------------------ page header */

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
  className,
}: {
  kicker: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("rise flex flex-col gap-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        <p className="kicker flex items-center gap-2">
          <span className="inline-block h-px w-6 bg-accent" />
          {kicker}
        </p>
        <h1 className="display mt-3 text-[clamp(2.6rem,6vw,4.6rem)] text-ink">{title}</h1>
        {subtitle && <p className="serif mt-2 max-w-2xl text-[1.35rem] italic leading-snug text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ cards */

export function Card({
  children,
  className,
  hover,
  as: As = "section",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cn("card", hover && "card-hover", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHead({
  code,
  title,
  kicker,
  right,
  className,
}: {
  code?: string;
  title: React.ReactNode;
  kicker?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          {code && <span className="font-mono text-[0.62rem] text-accent">{code}</span>}
          <h2 className="serif truncate text-[1.45rem] leading-tight text-ink">{title}</h2>
        </div>
        {kicker && <p className="kicker mt-1">{kicker}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ stats */

export function Stat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "accent" | "pass" | "warn" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="kicker">{label}</p>
      <p
        className={cn(
          "display num mt-2 text-[2.4rem] leading-none normal-case",
          tone === "accent" && "text-accent",
          tone === "pass" && "text-pass",
          tone === "warn" && "text-warn",
          tone === "muted" && "text-muted",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 font-mono text-[0.68rem] text-muted num">{sub}</p>}
    </div>
  );
}

/** Interval bar: the CI as a soft band, the point estimate as a tick. */
export function CiBar({
  rate,
  ci,
  className,
  tone = "accent",
}: {
  rate: number;
  ci?: [number, number] | null;
  className?: string;
  tone?: "accent" | "pass" | "info";
}) {
  const color = tone === "pass" ? "var(--pass)" : tone === "info" ? "var(--info)" : "var(--accent)";
  return (
    <div className={cn("relative h-2 w-full rounded-full bg-surface-3", className)} aria-hidden>
      {ci && (
        <div
          className="absolute inset-y-0 rounded-full opacity-35"
          style={{ left: `${ci[0] * 100}%`, width: `${Math.max(1, (ci[1] - ci[0]) * 100)}%`, background: color }}
        />
      )}
      <div className="absolute inset-y-0 left-0 rounded-full opacity-90" style={{ width: `${rate * 100}%`, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <div className="absolute -top-1 h-4 w-[2px] rounded-full" style={{ left: `calc(${rate * 100}% - 1px)`, background: color, boxShadow: `0 0 10px ${color}` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ chips */

const chip = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.08em] whitespace-nowrap";

export function PassChip({ passed, status }: { passed: boolean | null; status?: string }) {
  if (status === "error" || status === "budget_exceeded")
    return (
      <span className={cn(chip, "border-warn/30 bg-warn-soft text-warn")}>
        <AlertTriangle className="size-3" aria-hidden />
        {status === "error" ? "Error" : "Budget"}
      </span>
    );
  if (passed == null)
    return (
      <span className={cn(chip, "border-line-strong text-muted")}>
        <CircleDashed className="size-3" aria-hidden />
        N/A
      </span>
    );
  return passed ? (
    <span className={cn(chip, "border-pass/30 bg-pass-soft text-pass")}>
      <CheckCircle2 className="size-3" aria-hidden />
      Pass
    </span>
  ) : (
    <span className={cn(chip, "border-accent/35 bg-accent-soft text-accent-ink")}>
      <XCircle className="size-3" aria-hidden />
      Fail
    </span>
  );
}

const RUN_STATUS: Record<string, { cls: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  done: { cls: "border-pass/30 bg-pass-soft text-pass", icon: CheckCircle2, label: "Done" },
  running: { cls: "border-info/30 bg-info-soft text-info", icon: Loader2, label: "Running" },
  queued: { cls: "border-line-strong text-ink-2", icon: Clock3, label: "Queued" },
  stalled: { cls: "border-warn/30 bg-warn-soft text-warn", icon: AlertTriangle, label: "Stalled" },
  failed: { cls: "border-accent/35 bg-accent-soft text-accent-ink", icon: XCircle, label: "Failed" },
  cancelled: { cls: "border-line-strong text-muted", icon: CircleSlash, label: "Cancelled" },
};

export function RunStatusChip({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? RUN_STATUS.queued;
  return (
    <span className={cn(chip, s.cls)}>
      <s.icon className={cn("size-3", status === "running" && "animate-spin")} aria-hidden />
      {s.label}
    </span>
  );
}

const TRACE_STATUS: Record<string, string> = {
  success: "border-pass/30 bg-pass-soft text-pass",
  failure: "border-accent/35 bg-accent-soft text-accent-ink",
  error: "border-warn/30 bg-warn-soft text-warn",
  blocked: "border-violet/30 text-violet",
  needs_human: "border-info/30 bg-info-soft text-info",
  budget_exceeded: "border-warn/30 bg-warn-soft text-warn",
};

export function TraceStatusChip({ status }: { status: string }) {
  return <span className={cn(chip, TRACE_STATUS[status] ?? "border-line-strong text-muted")}>{status.replace("_", " ")}</span>;
}

export function TriggerChip({ trigger, pr }: { trigger: string; pr?: number | null }) {
  return (
    <span className={cn(chip, "border-line-strong text-ink-2", trigger === "pr" && "border-info/30 text-info", trigger === "gate" && "border-accent/30 text-accent-ink")}>
      {TRIGGER_LABEL[trigger] ?? trigger}
      {pr ? ` #${pr}` : ""}
    </span>
  );
}

export function Chip({ children, tone, className }: { children: React.ReactNode; tone?: "accent" | "pass" | "warn" | "info" | "violet"; className?: string }) {
  return (
    <span
      className={cn(
        chip,
        "border-line-strong text-ink-2",
        tone === "accent" && "border-accent/35 bg-accent-soft text-accent-ink",
        tone === "pass" && "border-pass/30 bg-pass-soft text-pass",
        tone === "warn" && "border-warn/30 bg-warn-soft text-warn",
        tone === "info" && "border-info/30 bg-info-soft text-info",
        tone === "violet" && "border-violet/30 text-violet",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SeverityChip({ severity }: { severity?: string | null }) {
  if (!severity) return null;
  return <Chip tone={severity === "high" ? "accent" : severity === "medium" ? "warn" : undefined}>{severity}</Chip>;
}

export function SplitChip({ split }: { split: string }) {
  return <Chip tone={split === "test" ? "accent" : split === "val" ? "info" : undefined}>{split}</Chip>;
}

/* ------------------------------------------------------------------ misc */

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="dots relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="serif text-2xl text-ink">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "ghost",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "ghost";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.8rem] font-medium transition duration-300",
        variant === "solid"
          ? "bg-accent-solid text-white shadow-[0_10px_30px_-10px_var(--accent-glow)] hover:bg-accent-solid-hi hover:shadow-[0_14px_40px_-10px_var(--accent-glow)]"
          : "border border-line-strong text-ink-2 hover:border-accent hover:text-ink",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Meter({ value, max, label, tone }: { value: number; max: number; label?: string; tone?: "accent" | "pass" | "warn" }) {
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  const color = tone === "pass" ? "var(--pass)" : tone === "warn" || frac > 0.85 ? "var(--warn)" : "var(--accent)";
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex flex-wrap justify-between gap-x-3 font-mono text-[0.66rem] text-muted num">
          <span className="min-w-0">{label}</span>
          <span className="whitespace-nowrap">
            {value.toLocaleString()} / {max.toLocaleString()} · {pct(frac)}
          </span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${frac * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="kicker !text-[0.6rem]">{k}</dt>
      <dd className={cn("text-right text-[0.82rem] text-ink-2", mono && "font-mono text-[0.75rem]")}>{v}</dd>
    </div>
  );
}
