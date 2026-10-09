import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { githubConfigured as authConfigured } from "@/auth";
import { AdminButton } from "@/components/admin/admin-button";
import { KeyCreator } from "@/components/admin/key-creator";
import { Card, CardHead, Chip, KV, Meter, PageHeader } from "@/components/ui/primitives";
import { ago, dateTime } from "@/lib/format";
import { agentName } from "@/lib/meta";
import { githubConfigured, tokenCheck } from "@/lib/server/github";
import { DAILY_CAPS, latestDay, usageByPurpose } from "@/lib/server/queries";
import { getStore } from "@/lib/server/store";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function isStale(iso: string | null) {
  return iso ? Date.now() - new Date(iso).getTime() > 36 * 3600_000 : true;
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      {ok == null ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" aria-label="not configured" /> : ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pass" aria-label="ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-accent" aria-label="failing" />}
      <div>
        <p className="text-[0.85rem] text-ink">{label}</p>
        <p className="font-mono text-[0.66rem] text-muted">{detail}</p>
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const store = getStore();
  const [keys, agents, usage, audit, size, lastNightly] = await Promise.all([
    store.apiKeys(),
    store.agents(),
    store.usage("2000-01-01"),
    store.audit(25),
    store.dbSizeBytes().catch(() => null),
    store.runs({ trigger: "nightly", limit: 1 }),
  ]);
  const gh = githubConfigured() ? await tokenCheck().catch(() => ({ ok: false, reason: "unreachable" })) : null;
  const day = latestDay(usage);
  const used = usageByPurpose(usage, day);
  const runnerOk = Boolean(process.env.RUNNER_KEY_HASH);
  const nightlyAt = lastNightly[0]?.created_at ?? null;
  const stale = isStale(nightlyAt);
  const limit = 1024 ** 3;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="System · 11"
        title={
          <>
            Set<span className="text-accent">tings</span>
          </>
        }
        subtitle="Keys, budgets, the agents registry and the health of every connection. Admin actions are confirmed and audit-logged."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rise p-6" style={{ animationDelay: "40ms" }}>
          <CardHead code="01" title="Connections" kicker="what this deployment can reach" />
          <ul className="mt-4">
            <Check ok={store.mode === "postgres"} label={store.mode === "postgres" ? "Neon Postgres" : "Demo snapshot (read-only)"} detail={store.mode === "postgres" ? `DATABASE_URL set${size != null ? ` · ${(size / 1024 ** 2).toFixed(1)} MB of 1 GB free plan` : ""}` : "Set DATABASE_URL (Neon project agentforge, pooled) and run pnpm db:migrate && pnpm db:seed"} />
            <Check ok={authConfigured || null} label="GitHub sign-in (Auth.js)" detail={authConfigured ? "AUTH_GITHUB_ID / AUTH_GITHUB_SECRET set" : "Create a GitHub OAuth App → callback /api/auth/callback/github"} />
            <Check ok={gh ? gh.ok : null} label="GitHub token (dispatch · statuses · PR comments)" detail={gh ? (gh.ok ? "GH_TOKEN valid for the AgentForge repo" : `GH_TOKEN check failed: ${gh.reason}`) : "GH_TOKEN not set — runs stay queued until dispatched"} />
            <Check ok={runnerOk || null} label="Runner key" detail={runnerOk ? "RUNNER_KEY_HASH set — GitHub Actions can post results" : "Set RUNNER_KEY_HASH = sha256(AF_RUNNER_KEY)"} />
            <Check ok={store.mode === "postgres" ? !stale : null} label="Nightly schedule" detail={nightlyAt ? `last nightly ${ago(nightlyAt)}${stale && store.mode === "postgres" ? " — over 36 h: GitHub disables schedules after 60 days without activity" : ""}` : "no nightly yet"} />
          </ul>
          {size != null && <div className="mt-4"><Meter label="database size" value={Math.round(size / 1024 ** 2)} max={Math.round(limit / 1024 ** 2)} /></div>}
        </Card>

        <Card className="rise p-6" style={{ animationDelay: "80ms" }}>
          <CardHead code="02" title="Daily LLM budgets" kicker={day ? `ledger · ${day}` : "no usage recorded"} />
          <div className="mt-5 flex flex-col gap-4">
            {DAILY_CAPS.map((c) => (
              <Meter key={c.purpose} label={c.label} value={used[c.purpose] ?? 0} max={c.cap} />
            ))}
          </div>
          <p className="mt-5 text-[0.78rem] leading-relaxed text-muted">
            The runner&apos;s ledger refuses calls past each cap and ends the run with <code className="font-mono">budget_exceeded</code> instead of a 429 storm. Groq budgets are shared with DataPilot and ReturnPilot per §S.1.
          </p>
        </Card>
      </div>

      <Card className="rise p-6" style={{ animationDelay: "120ms" }}>
        <CardHead code="03" title="API keys" kicker="afk_live_… · SHA-256 stored · shown once · scoped to one agent" right={<KeyCreator />} />
        <div className="mt-5 overflow-x-auto">
          <table className="table-af min-w-[760px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Agent</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="text-ink">{k.name}</td>
                  <td className="text-ink-2">{agentName(k.agent_id)}</td>
                  <td className="font-mono text-[0.7rem] text-muted">{k.prefix}…</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Chip key={s}>{s}</Chip>
                      ))}
                    </span>
                  </td>
                  <td className="font-mono text-[0.68rem] text-muted">{ago(k.last_used_at)}</td>
                  <td>{k.revoked_at ? <Chip tone="accent">revoked</Chip> : <Chip tone="pass">active</Chip>}</td>
                  <td className="text-right">{!k.revoked_at && <AdminButton action={{ kind: "revoke-key", id: k.id, name: k.name }} label="Revoke" className="!px-3 !py-1 !text-[0.7rem]" />}</td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-muted">No keys yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rise p-6" style={{ animationDelay: "160ms" }}>
          <CardHead code="04" title="Agents registry" kicker="targets under test · eval adapter contract §S.4" />
          <div className="mt-4 flex flex-col gap-4">
            {agents.map((a) => (
              <div key={a.id} className="rounded-2xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <p className="serif text-xl text-ink">{agentName(a.id)}</p>
                  <Chip>{a.judge_model ?? "judge: default"}</Chip>
                </div>
                <dl className="mt-2">
                  <KV k="repo" v={a.repo} mono />
                  <KV k="adapter" v={`python -m ${a.adapter_module} run …`} mono />
                  <KV k="workdir" v={a.config?.workdir ?? "—"} mono />
                  <KV k="locked" v={(a.locked_keys ?? []).join(", ")} mono />
                </dl>
              </div>
            ))}
          </div>
        </Card>
        <Card className="rise p-6" style={{ animationDelay: "200ms" }}>
          <CardHead code="05" title="Audit log" kicker="every promotion, rollback, key and review decision" />
          <ol className="mt-4 flex flex-col">
            {audit.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-line py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-[0.82rem] text-ink">
                    <span className="font-mono text-[0.72rem] text-accent-ink">{e.action}</span> · {e.object_type} {e.object_id ? <span className="font-mono text-[0.68rem] text-muted">{e.object_id.slice(0, 12)}</span> : null}
                  </p>
                  <p className="font-mono text-[0.62rem] text-muted">{e.actor}</p>
                </div>
                <span className="font-mono text-[0.62rem] text-muted">{dateTime(e.at)}</span>
              </li>
            ))}
            {audit.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
