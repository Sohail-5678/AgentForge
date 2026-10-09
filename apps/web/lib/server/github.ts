import "server-only";

/**
 * Control plane → GitHub with a fine-grained PAT (GH_TOKEN, §10.1): dispatch run-suite.yml in the AgentForge repo,
 * cancel a job, set the `agentforge/quality` commit status and keep one PR comment updated on target repos.
 * Every call is a no-op that returns { ok: false, reason } when GH_TOKEN is not configured.
 */

const API = "https://api.github.com";

function cfg() {
  return {
    token: process.env.GH_TOKEN?.trim() || null,
    owner: process.env.GH_OWNER?.trim() || "Sohail-5678",
    repo: process.env.GH_AGENTFORGE_REPO?.trim() || "AgentForge",
  };
}

export function githubConfigured() {
  return Boolean(cfg().token);
}

async function gh(path: string, init: RequestInit = {}) {
  const { token } = cfg();
  if (!token) return { ok: false as const, status: 0, reason: "GH_TOKEN not configured", data: null };
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  return { ok: res.ok, status: res.status, reason: res.ok ? null : `GitHub ${res.status}`, data };
}

/** The only dispatch input is run_id (§10.2): the runner fetches everything else with its own key. */
export async function dispatchRun(runId: string) {
  const { owner, repo } = cfg();
  return gh(`/repos/${owner}/${repo}/actions/workflows/run-suite.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { run_id: runId } }),
  });
}

export async function cancelWorkflowRun(ghRunId: number) {
  const { owner, repo } = cfg();
  return gh(`/repos/${owner}/${repo}/actions/runs/${ghRunId}/cancel`, { method: "POST" });
}

export async function workflowRunStatus(ghRunId: number) {
  const { owner, repo } = cfg();
  const r = await gh(`/repos/${owner}/${repo}/actions/runs/${ghRunId}`);
  const d = (r.data ?? {}) as { status?: string; conclusion?: string | null; html_url?: string };
  return { ok: r.ok, status: d.status ?? null, conclusion: d.conclusion ?? null, url: d.html_url ?? null };
}

export async function tokenCheck() {
  const { owner, repo } = cfg();
  const r = await gh(`/repos/${owner}/${repo}`);
  return { ok: r.ok, reason: r.reason };
}

export async function setCommitStatus(repoFull: string, sha: string, state: "pending" | "success" | "failure" | "error", description: string, targetUrl: string) {
  return gh(`/repos/${repoFull}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({ state, description: description.slice(0, 140), context: "agentforge/quality", target_url: targetUrl }),
  });
}

const MARKER = "<!-- agentforge:quality -->";

/** One comment per PR, updated in place on re-runs (§4.6 step 4). */
export async function upsertPrComment(repoFull: string, pr: number, body: string) {
  const list = await gh(`/repos/${repoFull}/issues/${pr}/comments?per_page=100`);
  const existing = Array.isArray(list.data) ? (list.data as { id: number; body?: string }[]).find((c) => c.body?.includes(MARKER)) : undefined;
  const payload = JSON.stringify({ body: `${MARKER}\n${body}` });
  return existing
    ? gh(`/repos/${repoFull}/issues/comments/${existing.id}`, { method: "PATCH", body: payload })
    : gh(`/repos/${repoFull}/issues/${pr}/comments`, { method: "POST", body: payload });
}
