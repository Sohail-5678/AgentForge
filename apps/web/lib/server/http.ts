import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { getAppUser, type AppUser } from "@/auth";
import type { ApiKey } from "@/lib/types";
import { getStore, ReadOnlyError } from "./store";

/** Route-handler plumbing for /api/v1 (SPEC §12): error envelope, auth by caller type, validation, limits. */

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: e.headers });
  if (e instanceof ReadOnlyError) return NextResponse.json({ error: { code: "read_only_demo", message: e.message } }, { status: 503 });
  console.error("api error", e);
  return NextResponse.json({ error: { code: "internal", message: "Unexpected server error." } }, { status: 500 });
}

/** Wrap a handler so thrown HttpErrors / ReadOnlyErrors become the standard envelope. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson<T>(req: Request, schema: ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "payload_too_large", `Body exceeds ${Math.round(maxBytes / 1024)} KB.`);
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", `Body exceeds ${Math.round(maxBytes / 1024)} KB.`);
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "invalid_json", "Body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(422, "validation_failed", `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** `afk_live_<43 chars>` — 32 random bytes; only the SHA-256 is stored (§10.1). */
export function newApiKey() {
  const key = `afk_live_${randomBytes(32).toString("base64url")}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 13) };
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ callers */

export type Scope = "traces:write" | "profiles:read" | "gate:trigger";

/** Target agents & target CI: X-AgentForge-Key with a scope, bound to one agent. */
export async function requireApiKey(req: Request, scope: Scope, agent?: string): Promise<ApiKey> {
  const raw = req.headers.get("x-agentforge-key") ?? "";
  if (!raw.startsWith("afk_")) throw new HttpError(401, "unauthorized", "Missing or malformed X-AgentForge-Key.");
  const store = getStore();
  const key = await store.apiKeyByHash(sha256(raw));
  if (!key || key.revoked_at) throw new HttpError(401, "unauthorized", "Unknown or revoked key.");
  if (!key.scopes.includes(scope)) throw new HttpError(403, "forbidden", `Key lacks scope ${scope}.`);
  if (agent && key.agent_id && key.agent_id !== agent) throw new HttpError(403, "forbidden", `Key is bound to agent ${key.agent_id}.`);
  void store.touchApiKey(key.id).catch(() => undefined);
  return key;
}

/** GitHub Actions runner: Authorization: Bearer <AF_RUNNER_KEY>, compared to RUNNER_KEY_HASH. */
export function requireRunner(req: Request) {
  const expected = process.env.RUNNER_KEY_HASH?.trim().toLowerCase();
  if (!expected) throw new HttpError(503, "runner_not_configured", "RUNNER_KEY_HASH is not set on the control plane.");
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !safeEqualHex(sha256(token), expected)) throw new HttpError(401, "unauthorized", "Invalid runner key.");
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) throw new HttpError(401, "unauthorized", "Sign in with GitHub first.");
  if (user.role !== "admin") throw new HttpError(403, "forbidden", "Admins only (ADMIN_GITHUB_USERS).");
  if (getStore().readonly) throw new ReadOnlyError();
  return user;
}

export async function requireUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) throw new HttpError(401, "unauthorized", "Sign in with GitHub first.");
  return user;
}

/* ------------------------------------------------------------------ rate limits (§10.6) */

const PER_MIN = Number(process.env.INGEST_PER_MIN ?? 600);
const PER_DAY = Number(process.env.INGEST_PER_DAY ?? 20_000);

export async function rateLimit(keyId: string, add: number) {
  const store = getStore();
  const now = new Date();
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const day = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  // Daily windows are stored with a marker second so they never collide with a minute window.
  const dayKey = new Date(new Date(day).getTime() + 1).toISOString();
  const [m, d] = await Promise.all([store.rateLimitHit(keyId, minute, add), store.rateLimitHit(keyId, dayKey, add)]);
  if (m > PER_MIN || d > PER_DAY) {
    throw new HttpError(429, "rate_limited", `Ingest limit is ${PER_MIN}/min and ${PER_DAY}/day per key.`, { "retry-after": "60" });
  }
}

/* ------------------------------------------------------------------ redaction & truncation */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g;
const CARD = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

/** Defence in depth (§10.5): targets redact before export; ingest redacts again. */
export function redactDeep<T>(v: T): T {
  if (typeof v === "string") return v.replace(EMAIL, "[redacted]").replace(CARD, "[redacted]").replace(PHONE, "[redacted]") as T;
  if (Array.isArray(v)) return v.map(redactDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) as T;
  return v;
}

/** Span payloads are capped at 4 KB each (§4.1). */
export function truncatePayload(v: unknown, max = 4096): unknown {
  if (v == null) return v;
  const s = JSON.stringify(v);
  if (s.length <= max) return v;
  return { truncated: true, bytes: s.length, preview: s.slice(0, max - 64) };
}

/** Deterministic sampling: keep every non-success / thumbs-down trace and ~20 % of successes (§4.1). */
export function keepTrace(t: { trace_id: string; status: string; feedback?: { thumbs?: number | null } | null }, rate = Number(process.env.TRACE_SAMPLE_SUCCESS ?? 0.2)) {
  if (t.status !== "success" || (t.feedback?.thumbs ?? 0) < 0) return true;
  const bucket = parseInt(sha256(t.trace_id).slice(0, 8), 16) / 0xffffffff;
  return bucket < rate;
}
