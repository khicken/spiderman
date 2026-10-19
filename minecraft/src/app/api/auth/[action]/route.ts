import {
  COOKIE, LIMITS, PASSWORD_MAX, PASSWORD_MIN, USERNAME, burnHash, clientIp, createUser, endSession, loadUser, loginGate, loginPassed, rateLimited, readCookie,
  sessionCookie, sessionUser, startSession, verifyPassword,
} from "../../../../server/auth";
import { TooLarge, env, fail, json, offline, readJson, sameOrigin } from "../../../../server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ action: string }> };

export async function GET(req: Request, { params }: Ctx) {
  if ((await params).action !== "me") return fail(404, "Not found");
  const e = env();
  if (!e) return json({ user: null, available: false });
  try {
    const user = await sessionUser(e.kv, readCookie(req.headers.get("cookie"), COOKIE), e.secret);
    return json({ user: user ? { name: user.name } : null, available: true });
  } catch (err) {
    console.warn("auth: me failed", err);
    return offline();
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const action = (await params).action;
  if (action !== "signup" && action !== "login" && action !== "logout") return fail(404, "Not found");
  const e = env();
  if (!e) return offline();
  if (!sameOrigin(req)) return fail(403, "Bad origin");
  try {
    if (action === "logout") {
      await endSession(e.kv, readCookie(req.headers.get("cookie"), COOKIE), e.secret);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(null) });
    }
    const b = await readJson(req, 4096);
    const username = typeof b?.username === "string" ? b.username.trim() : "";
    const password = typeof b?.password === "string" ? b.password : "";
    if (!USERNAME.test(username)) return fail(400, "Name must be 3-16 letters, digits or _");
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return fail(400, `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`);
    const ip = clientIp(req);
    if (action === "signup") {
      if (await rateLimited(e.kv, `signup:ip:${ip}`, LIMITS.signupIp)) return fail(429, "Too many attempts, try later");
      const user = await createUser(e.kv, username, password);
      if (!user) return fail(409, "That name is taken");
      const cookie = await startSession(e.kv, user, e.secret);
      return json({ user: { name: user.name } }, 200, { "set-cookie": sessionCookie(cookie) });
    }
    const gate = await loginGate(e.kv, username, ip);
    if (gate.blocked) return fail(429, "Too many attempts, try later");
    if (gate.delayMs) await new Promise((r) => setTimeout(r, gate.delayMs));
    const user = await loadUser(e.kv, username);
    const ok = user ? await verifyPassword(password, user.hash) : await burnHash(password);
    if (!user || !ok) return fail(401, "Wrong name or password");
    await loginPassed(e.kv, username, ip);
    const cookie = await startSession(e.kv, user, e.secret);
    return json({ user: { name: user.name } }, 200, { "set-cookie": sessionCookie(cookie) });
  } catch (err) {
    if (err instanceof TooLarge) return fail(413, "Request too large");
    console.warn(`auth: ${action} failed`, err instanceof Error ? err.message : "error");
    return offline();
  }
}
