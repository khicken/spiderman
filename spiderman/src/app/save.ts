import type { Saveable } from "./contracts";

const KEY = "spiderman-save";
const VERSION = 2;
// Saves before the v2 map hold lists that match old positions by index.
const STALE: Record<string, string[]> = {
  missions: ["items", "hideouts"],
  activities: ["caches", "requests", "flocks", "pigeons"],
};

export function createSave(parts: Record<string, Saveable>) {
  const read = (): Record<string, unknown> => {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      console.warn("Save data unreadable, starting fresh", err);
      return {};
    }
  };
  return {
    load() {
      const data = read();
      const stale = data.version !== VERSION;
      for (const [k, part] of Object.entries(parts)) {
        if (!(k in data)) continue;
        let v = data[k];
        if (stale && v && typeof v === "object" && STALE[k]) {
          v = { ...(v as Record<string, unknown>) };
          for (const f of STALE[k]) delete (v as Record<string, unknown>)[f];
        }
        try {
          part.restore(v);
        } catch (err) {
          console.warn(`Save part "${k}" failed to restore`, err);
        }
      }
    },
    write() {
      const data: Record<string, unknown> = { version: VERSION };
      for (const [k, part] of Object.entries(parts)) data[k] = part.snapshot();
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (err) {
        console.warn("Save failed", err);
      }
    },
  };
}
