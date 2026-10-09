"use client";

import { CornerDownLeft, Moon, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { NAV } from "./nav-items";

interface Cmd {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/** ⌘K / Ctrl-K: jump to any page or flip the theme without leaving the keyboard. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cmds = useMemo<Cmd[]>(
    () => [
      ...NAV.flatMap((g) => g.items.map((it) => ({ id: it.href, label: it.label, hint: g.group, icon: it.icon, run: () => router.push(it.href) }))),
      { id: "/agents/datapilot", label: "DataPilot agent", hint: "Agents", icon: NAV[0].items[1].icon, run: () => router.push("/agents/datapilot") },
      {
        id: "theme",
        label: "Toggle light / dark",
        hint: "Theme",
        icon: Moon,
        run: () => {
          const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
          document.documentElement.dataset.theme = next;
          try {
            localStorage.setItem("af-theme", next);
          } catch {
            /* private mode */
          }
        },
      },
    ],
    [router],
  );
  const list = cmds.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q.trim().toLowerCase()));
  const choose = (c?: Cmd) => {
    if (!c) return;
    setOpen(false);
    setQ("");
    setI(0);
    c.run();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-[0.78rem] text-muted transition hover:border-line-strong hover:text-ink"
        aria-label="Open command palette"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Jump to…</span>
        <kbd className="rounded-md border border-line-strong px-1.5 font-mono text-[0.6rem]">⌘K</kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="card fixed left-1/2 top-[18vh] z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden !rounded-2xl outline-none"
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                >
                  <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                    <Search className="size-4 text-muted" />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setI(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setI((x) => Math.min(list.length - 1, x + 1));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setI((x) => Math.max(0, x - 1));
                        } else if (e.key === "Enter") choose(list[i]);
                      }}
                      placeholder="Go to a page…"
                      aria-label="Search commands"
                      className="flex-1 bg-transparent text-[0.92rem] text-ink outline-none placeholder:text-muted"
                    />
                    <kbd className="rounded-md border border-line-strong px-1.5 font-mono text-[0.6rem] text-muted">esc</kbd>
                  </div>
                  <ul className="max-h-[46vh] overflow-y-auto p-1.5" role="listbox" aria-label="Commands">
                    {list.map((c, idx) => (
                      <li key={c.id} role="option" aria-selected={idx === i}>
                        <button
                          type="button"
                          onMouseEnter={() => setI(idx)}
                          onClick={() => choose(c)}
                          className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.86rem] transition", idx === i ? "bg-surface-3 text-ink" : "text-ink-2")}
                        >
                          <c.icon className={cn("size-4", idx === i ? "text-accent" : "text-muted")} />
                          <span className="flex-1">{c.label}</span>
                          <span className="kicker !text-[0.56rem]">{c.hint}</span>
                          {idx === i && <CornerDownLeft className="size-3.5 text-muted" />}
                        </button>
                      </li>
                    ))}
                    {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches.</li>}
                  </ul>
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  );
}
