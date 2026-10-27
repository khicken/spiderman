import { api } from "./api";

export interface AccountState {
  ready: boolean;
  available: boolean;
  user: string | null;
  error: string | null; // last cloud sync problem worth showing
}

let state: AccountState = { ready: false, available: false, user: null, error: null };
const subs = new Set<(s: AccountState) => void>();

export const account = () => state;

export function setAccount(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  for (const fn of subs) fn(state);
}

export function onAccount(fn: (s: AccountState) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export async function refreshAccount(): Promise<AccountState> {
  try {
    const r = await api<{ user: { name: string } | null; available: boolean }>("/auth/me");
    setAccount({ ready: true, available: r.available, user: r.user?.name ?? null });
  } catch {
    setAccount({ ready: true });
  }
  return state;
}

export async function signIn(username: string, password: string, create: boolean): Promise<void> {
  const r = await api<{ user: { name: string } }>(create ? "/auth/signup" : "/auth/login", { method: "POST", json: { username, password } });
  setAccount({ ready: true, user: r.user.name, error: null });
}

export async function signOut(): Promise<void> {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  setAccount({ user: null, error: null });
}

export function deviceName(): string {
  try {
    const saved = localStorage.getItem("mc-device");
    if (saved) return saved;
  } catch {}
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const name = `${browser}${os ? ` on ${os}` : ""} #${Math.floor(Math.random() * 9000 + 1000)}`;
  try {
    localStorage.setItem("mc-device", name);
  } catch {}
  return name;
}
