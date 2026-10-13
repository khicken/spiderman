import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { isProd, type Kv } from "./kv";

export const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const COOKIE = "mc_session";
export const COOKIE_PATH = "/minecraft";
export const SESSION_DAYS = 30;
const SESSION_S = SESSION_DAYS * 86400;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const DEV_SECRET = "dev-only-minecraft-session-secret";

export const LIMITS = {
  loginUser: { max: 10, windowS: 15 * 60 },
  loginIp: { max: 50, windowS: 15 * 60 },
  signupIp: { max: 10, windowS: 60 * 60 },
};

export interface User {
  id: string;
  name: string;
  hash: string;
  created: number;
}

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) => scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

let dummyHash: Promise<string> | null = null;
// Unknown names still pay one scrypt so response time does not reveal which names exist.
export const burnHash = (password: string) => (dummyHash ??= hashPassword("not-a-real-password")).then((h) => verifyPassword(password, h)).then(() => false);

export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  return isProd() ? null : DEV_SECRET;
}

const mac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url");

export function signValue(value: string, secret: string): string {
  return `${value}.${mac(secret, value)}`;
}

export function unsignValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const got = Buffer.from(signed.slice(dot + 1));
  const want = Buffer.from(mac(secret, value));
  return got.length === want.length && timingSafeEqual(got, want) ? value : null;
}

export function sessionCookie(signed: string | null): string {
  const parts = [`${COOKIE}=${signed ?? ""}`, `Path=${COOKIE_PATH}`, "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${signed ? SESSION_S : 0}`];
  return parts.join("; ");
}

export function readCookie(header: string | null, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

const userKey = (name: string) => `mc:user:${name.toLowerCase()}`;
const sessKey = (sid: string) => `mc:sess:${sid}`;

export async function loadUser(kv: Kv, name: string): Promise<User | null> {
  const raw = await kv.get(userKey(name));
  return raw ? (JSON.parse(raw) as User) : null;
}

export async function createUser(kv: Kv, name: string, password: string): Promise<User | null> {
  const user: User = { id: `u${randomBytes(12).toString("hex")}`, name, hash: await hashPassword(password), created: Date.now() };
  return (await kv.set(userKey(name), JSON.stringify(user), { nx: true })) ? user : null;
}

export async function startSession(kv: Kv, user: User, secret: string): Promise<string> {
  const sid = randomBytes(24).toString("base64url");
  await kv.set(sessKey(sid), JSON.stringify({ id: user.id, name: user.name }), { ex: SESSION_S });
  return signValue(sid, secret);
}

export async function endSession(kv: Kv, cookie: string | null, secret: string) {
  const sid = cookie && unsignValue(cookie, secret);
  if (sid) await kv.del([sessKey(sid)]);
}

export async function sessionUser(kv: Kv, cookie: string | null, secret: string): Promise<{ id: string; name: string } | null> {
  const sid = cookie && unsignValue(cookie, secret);
  if (!sid) return null;
  const raw = await kv.get(sessKey(sid));
  return raw ? (JSON.parse(raw) as { id: string; name: string }) : null;
}

export async function rateLimited(kv: Kv, key: string, limit: { max: number; windowS: number }): Promise<boolean> {
  return (await kv.incr(`mc:rl:${key}`, limit.windowS)) > limit.max;
}

export const clearRate = (kv: Kv, key: string) => kv.del([`mc:rl:${key}`]);

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
