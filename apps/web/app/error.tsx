"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-[70dvh] place-items-center px-4 text-center">
      <div>
        <p className="kicker">Something broke</p>
        <h1 className="display mt-3 text-7xl text-accent">Unexpected error</h1>
        <p className="serif mt-3 text-xl italic text-ink-2">The control plane could not render this page. {error.digest ? `Reference ${error.digest}.` : ""}</p>
        <div className="mt-7 flex justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white">Try again</button>
          <Link href="/overview" className="rounded-full border border-line-strong px-5 py-2.5 text-sm text-ink-2 hover:text-ink">Overview</Link>
        </div>
      </div>
    </main>
  );
}
