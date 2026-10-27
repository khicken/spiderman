import { account, onAccount } from "./account";
import { api } from "./api";

const KEYS = { settings: "mc-settings", packs: "mc.resourcePacks", name: "mc-player-name" };
const AT_KEY = "mc-profile-at";
const CHECK_MS = 3000;
const PUSH_DELAY = 1500;

interface Profile {
  settings: Record<string, unknown> | null;
  packs: string[];
  playerName: string;
  updatedAt: number;
}

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const parse = <T>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

function snapshot(): Omit<Profile, "updatedAt"> {
  const packs = parse<unknown>(get(KEYS.packs), []);
  const name = parse<unknown>(get(KEYS.name), "");
  return {
    settings: parse<Record<string, unknown> | null>(get(KEYS.settings), null),
    packs: Array.isArray(packs) ? packs.filter((p): p is string => typeof p === "string").slice(0, 64) : [],
    playerName: typeof name === "string" && /^[A-Za-z0-9_]{0,16}$/.test(name) ? name : "",
  };
}

let seen = "";
let timer: ReturnType<typeof setInterval> | null = null;
let pushT: ReturnType<typeof setTimeout> | null = null;
let started = false;
const applied = new Set<() => void>();

export const onProfileApplied = (fn: () => void) => {
  applied.add(fn);
  return () => applied.delete(fn);
};

const localAt = () => Number(get(AT_KEY)) || 0;

async function push() {
  if (!account().user) return;
  const body: Profile = { ...snapshot(), updatedAt: localAt() || Date.now() };
  try {
    const r = await api<{ profile: Profile }>("/cloud/profile", { method: "PUT", json: body });
    if (r.profile.updatedAt > body.updatedAt) await apply(r.profile);
  } catch (e) {
    console.warn("cloud: settings upload failed", e);
  }
}

async function apply(p: Profile) {
  const before = snapshot();
  if (p.settings) put(KEYS.settings, JSON.stringify(p.settings));
  put(KEYS.packs, JSON.stringify(p.packs));
  if (p.playerName.length >= 3) put(KEYS.name, JSON.stringify(p.playerName));
  put(AT_KEY, String(p.updatedAt));
  seen = JSON.stringify(snapshot());
  if (JSON.stringify(before.packs) !== JSON.stringify(p.packs)) {
    const { setSelectedPacks } = await import("../packs");
    await setSelectedPacks(p.packs).catch((e) => console.warn("cloud: pack selection failed", e));
  }
  for (const fn of applied) fn();
}

export async function pullProfile() {
  if (!account().user) return;
  try {
    const r = await api<{ profile: Profile | null }>("/cloud/profile");
    if (r.profile && r.profile.updatedAt > localAt()) await apply(r.profile);
    else if (!r.profile || localAt() > r.profile.updatedAt) await push();
  } catch (e) {
    console.warn("cloud: settings download failed", e);
  }
}

export function profileChanged() {
  const s = JSON.stringify(snapshot());
  if (s === seen) return;
  seen = s;
  put(AT_KEY, String(Date.now()));
  if (pushT) clearTimeout(pushT);
  pushT = setTimeout(() => void push(), PUSH_DELAY);
}

export function startProfileSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  seen = JSON.stringify(snapshot());
  const run = (user: string | null) => {
    if (timer) clearInterval(timer);
    timer = null;
    if (!user) return;
    void pullProfile().then(() => {
      if (account().user) timer ??= setInterval(profileChanged, CHECK_MS);
    });
  };
  let last: string | null = account().user;
  onAccount((s) => {
    if (s.user !== last) run((last = s.user));
  });
  window.addEventListener("focus", () => void pullProfile());
  run(last);
}
