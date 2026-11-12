// Client block edits apply at once and go to the host. Until the host has had a round trip to answer, its
// updates for that block may predate the edit (the echo of an earlier edit), and applying them would flicker
// the block back. Such updates are held; the newest one applies when the window ends, so a rejected edit
// still rolls back to the host's state.
const MIN_WINDOW_MS = 250;
const MAX_WINDOW_MS = 1500;
const UNKNOWN_RTT_MS = 400;
// Room for the host tick and block flush on top of the round trip.
const SLACK_MS = 150;

export function editWindow(rtt: number): number {
  const r = rtt >= 0 ? rtt : UNKNOWN_RTT_MS;
  return Math.max(MIN_WINDOW_MS, Math.min(MAX_WINDOW_MS, r + SLACK_MS));
}

export interface BlockPredictions {
  local(x: number, y: number, z: number, now: number, rtt: number): void;
  // True when the host's state should apply now; otherwise it is held.
  host(x: number, y: number, z: number, s: number, now: number): boolean;
  // Held host states whose window ended, as x, y, z, state quads.
  due(now: number, out: number[]): number[];
  clear(): void;
  readonly size: number;
}

export function createBlockPredictions(): BlockPredictions {
  type Edit = { x: number; y: number; z: number; until: number; held: number | null };
  const edits = new Map<string, Edit>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    get size() {
      return edits.size;
    },
    local(x, y, z, now, rtt) {
      const k = key(x, y, z);
      const e = edits.get(k);
      const until = now + editWindow(rtt);
      if (e) e.until = until;
      else edits.set(k, { x, y, z, until, held: null });
    },
    host(x, y, z, s, now) {
      const k = key(x, y, z);
      const e = edits.get(k);
      if (!e) return true;
      if (now >= e.until) {
        edits.delete(k);
        return true;
      }
      e.held = s;
      return false;
    },
    due(now, out) {
      out.length = 0;
      for (const [k, e] of edits) {
        if (now < e.until) continue;
        edits.delete(k);
        if (e.held !== null) out.push(e.x, e.y, e.z, e.held);
      }
      return out;
    },
    clear() {
      edits.clear();
    },
  };
}
