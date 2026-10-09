import type { Saveable } from "./contracts";

const KEY = "spiderman-save";

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
      for (const [k, part] of Object.entries(parts)) {
        if (!(k in data)) continue;
        try {
          part.restore(data[k]);
        } catch (err) {
          console.warn(`Save part "${k}" failed to restore`, err);
        }
      }
    },
    write() {
      const data: Record<string, unknown> = {};
      for (const [k, part] of Object.entries(parts)) data[k] = part.snapshot();
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (err) {
        console.warn("Save failed", err);
      }
    },
  };
}
