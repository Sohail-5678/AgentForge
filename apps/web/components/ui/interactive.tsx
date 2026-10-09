"use client";

import { Check, ChevronRight, Copy, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/format";

/* ------------------------------------------------------------------ spotlight card */

/** Card whose border glows where the cursor is (CSS vars --mx/--my drive .spotlight::before). */
export function SpotlightCard({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
  return (
    <div ref={ref} onMouseMove={onMove} className={cn("card card-hover spotlight", className)} {...rest}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ copy */

export function CopyButton({ text, className, label = "Copy" }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:bg-surface-3 hover:text-ink", className)}
      aria-label={label}
    >
      {done ? <Check className="size-3 text-pass" /> : <Copy className="size-3" />}
      {done ? "Copied" : label}
    </button>
  );
}

/* ------------------------------------------------------------------ JSON viewer */

/** Collapsed by default (SPEC §2.4), copy button, `[redacted]` values highlighted. */
export function JsonView({ value, label = "JSON", defaultOpen = false, maxHeight = 360 }: { value: unknown; label?: string; defaultOpen?: boolean; maxHeight?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const text = JSON.stringify(value, null, 2) ?? "null";
  const html = escape(text)
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="text-info">$1</span>$2')
    .replace(/:\s(&quot;.*?&quot;)/g, ': <span class="text-ink-2">$1</span>')
    .replace(/\[redacted\]/g, '<span class="rounded bg-accent-soft px-1 text-accent-ink">[redacted]</span>')
    .replace(/:\s(-?\d+\.?\d*(e-?\d+)?)/g, ': <span class="text-warn">$1</span>')
    .replace(/:\s(true|false|null)/g, ': <span class="text-violet">$1</span>');
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[var(--code-bg)]">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-wider text-[#c9c3bb] hover:text-white" aria-expanded={open}>
          <ChevronRight className={cn("size-3.5 transition-transform duration-300", open && "rotate-90")} />
          {label}
          <span className="text-[#8f8982] normal-case tracking-normal">· {text.length.toLocaleString()} chars</span>
        </button>
        <CopyButton text={text} className="text-[#8f8982] hover:bg-white/5 hover:text-white" />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <pre className="overflow-auto border-t border-white/5 px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-[#e9e4dc]" style={{ maxHeight }} dangerouslySetInnerHTML={{ __html: html }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function escape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ drawer */

export function Drawer({
  open,
  onOpenChange,
  title,
  kicker,
  children,
  width = "min(860px, 96vw)",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  kicker?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-line-strong bg-bg shadow-2xl outline-none"
                style={{ width }}
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ type: "spring", stiffness: 340, damping: 38 }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
                  <div className="min-w-0">
                    {kicker && <p className="kicker">{kicker}</p>}
                    <Dialog.Title className="serif mt-1 truncate text-2xl text-ink">{title}</Dialog.Title>
                  </div>
                  <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition hover:border-accent hover:text-ink" aria-label="Close">
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ modal */

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="card fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(720px,94vw)] flex-col !rounded-3xl outline-none"
                initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-46%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.97, x: "-50%", y: "-48%" }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              >
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <Dialog.Title className="serif text-2xl text-ink">{title}</Dialog.Title>
                  <Dialog.Close className="grid size-8 place-items-center rounded-full border border-line-strong text-muted hover:text-ink" aria-label="Close">
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
