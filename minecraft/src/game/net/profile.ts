import { cleanName, validCode } from "./protocol";

const NAME_KEY = "mc-player-name";
const SERVERS_KEY = "mc-servers";

export interface ServerEntry {
  name: string;
  code: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function playerName(): string {
  const n = cleanName(String(read<string>(NAME_KEY, "")));
  if (n.length >= 3) return n;
  const made = `Player${Math.floor(100 + Math.random() * 900)}`;
  write(NAME_KEY, made);
  return made;
}

export function setPlayerNameStored(n: string) {
  const c = cleanName(n);
  if (c.length >= 3) write(NAME_KEY, c);
}

export function servers(): ServerEntry[] {
  const list = read<ServerEntry[]>(SERVERS_KEY, []);
  return Array.isArray(list) ? list.filter((s) => s && typeof s.code === "string" && validCode(s.code)).slice(0, 20) : [];
}

export function rememberServer(code: string, name: string) {
  const list = servers().filter((s) => s.code !== code);
  list.unshift({ code, name: name || "Minecraft Server", at: Date.now() });
  write(SERVERS_KEY, list.slice(0, 20));
}

export function forgetServer(code: string) {
  write(SERVERS_KEY, servers().filter((s) => s.code !== code));
}

// Vanilla picks the default skin from the player UUID; a name hash stands in for it.
export function skinOf(name: string): 0 | 1 {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (h & 1) as 0 | 1;
}
