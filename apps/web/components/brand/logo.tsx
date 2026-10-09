import { cn } from "@/lib/format";

/** Monogram: an anvil-shaped "A" cut from a neon slab — the forge mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <defs>
        <linearGradient id="af-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5960" />
          <stop offset="1" stopColor="#c8141b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="url(#af-mark)" />
      <path d="M11 29.5 18.4 9.5h3.2L29 29.5h-4.3l-1.5-4.4h-6.4l-1.5 4.4H11Zm7-8.1h4.1L20 15.2l-2 6.2Z" fill="#08070b" />
      <path d="M8 31.5h24" stroke="#08070b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("display text-[1.35rem] leading-none tracking-wide text-ink", className)}>
      Agent<span className="text-accent">Forge</span>
    </span>
  );
}

/** GitHub mark (lucide no longer ships brand icons). */
export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
