import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Kv {
  readonly kind: "upstash" | "file";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(keys: string[]): Promise<void>;
  incr(key: string, exSeconds: number): Promise<number>;
  mget(keys: string[]): Promise<(string | null)[]>;
}

type Fetch = typeof fetch;

export function upstashKv(url: string, token: string, fetcher: Fetch = fetch): Kv {
  const base = url.replace(/\/+$/, "");
  const call = async (body: unknown, suffix = ""): Promise<unknown> => {
    const res = await fetcher(base + suffix, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const out = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | { result?: unknown; error?: string }[] | null;
    if (!res.ok || !out || (!Array.isArray(out) && out.error)) throw new Error(`kv ${res.status} ${Array.isArray(out) ? "" : out?.error ?? ""}`);
    return Array.isArray(out) ? out.map((o) => { if (o.error) throw new Error(`kv ${o.error}`); return o.result; }) : out.result;
  };
  return {
    kind: "upstash",
    async get(key) {
      const r = await call(["GET", key]);
      return r == null ? null : String(r);
    },
    async set(key, value, opts = {}) {
      const cmd: (string | number)[] = ["SET", key, value];
      if (opts.ex) cmd.push("EX", opts.ex);
      if (opts.nx) cmd.push("NX");
      return (await call(cmd)) === "OK";
    },
    async del(keys) {
      for (let i = 0; i < keys.length; i += 500) await call(["DEL", ...keys.slice(i, i + 500)]);
    },
    async incr(key, exSeconds) {
      const [n] = (await call([["INCR", key], ["EXPIRE", key, exSeconds, "NX"]], "/pipeline")) as [number, number];
      return Number(n);
    },
    async mget(keys) {
      if (!keys.length) return [];
      const r = (await call(["MGET", ...keys])) as (string | null)[];
      return r.map((v) => (v == null ? null : String(v)));
    },
  };
}

interface FileRow {
  v: string;
  exp: number;
}

// Dev only: one JSON file per key. A single dev server process owns the folder.
export function fileKv(dir: string): Kv {
  const file = (key: string) => path.join(dir, `${Buffer.from(key).toString("base64url")}.json`);
  const read = async (key: string): Promise<FileRow | null> => {
    try {
      const row = JSON.parse(await readFile(file(key), "utf8")) as FileRow;
      if (row.exp && row.exp < Date.now()) {
        await rm(file(key), { force: true });
        return null;
      }
      return row;
    } catch {
      return null;
    }
  };
  const write = async (key: string, row: FileRow) => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(key), JSON.stringify(row));
  };
  return {
    kind: "file",
    async get(key) {
      return (await read(key))?.v ?? null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && (await read(key))) return false;
      await write(key, { v: value, exp: opts.ex ? Date.now() + opts.ex * 1000 : 0 });
      return true;
    },
    async del(keys) {
      await Promise.all(keys.map((k) => rm(file(k), { force: true })));
    },
    async incr(key, exSeconds) {
      const row = await read(key);
      const n = (row ? Number(row.v) || 0 : 0) + 1;
      await write(key, { v: String(n), exp: row?.exp || Date.now() + exSeconds * 1000 });
      return n;
    },
    async mget(keys) {
      return Promise.all(keys.map(async (k) => (await read(k))?.v ?? null));
    },
  };
}

export const DATA_DIR = path.join(process.cwd(), ".data");
export const isProd = () => process.env.NODE_ENV === "production";

let cached: Kv | null | undefined;

export function getKv(): Kv | null {
  if (cached !== undefined) return cached;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cached = url && token ? upstashKv(url, token) : isProd() ? null : fileKv(path.join(DATA_DIR, "kv"));
  return cached;
}
