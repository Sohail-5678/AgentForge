import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden px-4 text-center">
      <div aria-hidden className="dots dots-fade absolute inset-0" />
      <div className="relative">
        <p className="kicker">Error 404 — page not found</p>
        <p className="display grunge mt-4 text-[clamp(7rem,26vw,18rem)] leading-[0.8]">404</p>
        <p className="serif mt-4 text-2xl italic text-ink-2">This trace leads nowhere. The run may have been purged, or the link is wrong.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/overview" className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hi">Overview</Link>
          <Link href="/" className="rounded-full border border-line-strong px-5 py-2.5 text-sm text-ink-2 transition hover:border-accent hover:text-ink">Home</Link>
        </div>
      </div>
    </main>
  );
}
