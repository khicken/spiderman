// Hit marks for the HUD: combat writes screen positions, ui-hud reads them by seq.
export type HitMark = { seq: number; x: number; y: number; text: string; kind: "hit" | "heavy" | "block" | "ko" };

export const HIT_MARKS = 8;
export const hitMarks = { seq: 0, list: Array.from({ length: HIT_MARKS }, (): HitMark => ({ seq: 0, x: 0, y: 0, text: "", kind: "hit" })) };

export const pushHitMark = (x: number, y: number, text: string, kind: HitMark["kind"]) => {
  const m = hitMarks.list[hitMarks.seq % HIT_MARKS];
  m.seq = ++hitMarks.seq;
  m.x = x;
  m.y = y;
  m.text = text;
  m.kind = kind;
};
