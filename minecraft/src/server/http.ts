import { getBlobs, type BlobStore } from "./blobs";
import { COOKIE, readCookie, sessionSecret, sessionUser } from "./auth";
import { getKv, type Kv } from "./kv";

export const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export const fail = (status: number, error: string, extra?: Record<string, unknown>) => json({ error, ...extra }, status);

export class TooLarge extends Error {}

export async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new TooLarge();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function readJson(req: Request, max: number): Promise<Record<string, unknown> | null> {
  const body = await readBody(req, max);
  try {
    const v = JSON.parse(new TextDecoder().decode(body)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface Env {
  kv: Kv;
  blobs: BlobStore;
  secret: string;
}

export function env(): Env | null {
  const kv = getKv();
  const blobs = getBlobs();
  const secret = sessionSecret();
  return kv && blobs && secret ? { kv, blobs, secret } : null;
}

export const offline = () => fail(503, "Accounts are not available");

export async function authed(req: Request): Promise<{ e: Env; user: { id: string; name: string } } | Response> {
  const e = env();
  if (!e) return offline();
  if (!sameOrigin(req)) return fail(403, "Bad origin");
  try {
    const user = await sessionUser(e.kv, readCookie(req.headers.get("cookie"), COOKIE), e.secret);
    return user ? { e, user } : fail(401, "Not signed in");
  } catch (err) {
    console.warn("cloud: session lookup failed", err);
    return offline();
  }
}

// SameSite=Lax still sends the cookie on top-level cross-site POSTs. A form cannot set a custom header, and a cross-site fetch with one needs a CORS preflight that this app never grants.
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  return req.headers.get("x-mc-client") === "1";
}
