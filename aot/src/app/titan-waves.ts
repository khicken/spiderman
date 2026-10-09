import type { TitanKind } from "./contracts";

export type BossKind = "female" | "armored" | "beast";

export const BOSS: Record<BossKind, { name: string; jp: string; height: number; text: string; points: number }> = {
  female: { name: "Female Titan", jp: "女型の巨人", height: 14, text: "Cut two limbs, then her nape", points: 1500 },
  armored: { name: "Armored Titan", jp: "鎧の巨人", height: 15, text: "Cut behind both knees, then the nape", points: 2000 },
  beast: { name: "Beast Titan", jp: "獣の巨人", height: 17, text: "Close in through the rocks. Cut his nape", points: 2500 },
};

const ROTATION: BossKind[] = ["female", "armored", "beast"];

export const isBoss = (k: TitanKind): k is BossKind => k === "female" || k === "armored" || k === "beast";

export function bossFor(n: number): BossKind | null {
  if (n === 4) return "female";
  if (n === 7) return "armored";
  if (n === 10) return "beast";
  if (n > 10 && (n - 10) % 3 === 0) return ROTATION[((n - 10) / 3 - 1) % 3];
  return null;
}

export const heat = (n: number) => Math.max(0, n - 10);
export const quotaFor = (n: number, boss: boolean) => (boss ? 8 + Math.min(n, 16) : 6 + 2 * Math.min(n, 17));
export const damageK = (n: number) => Math.min(1.8, 1 + heat(n) * 0.05);
export const speedK = (n: number) => Math.min(1.45, 1 + heat(n) * 0.03);

export function pickKind(n: number, r: number, R: (a: number, b: number) => number): [TitanKind, number] {
  const h = heat(n);
  const tall = Math.min(16, n >= 3 ? 15 + h * 0.1 : n === 2 ? 14 : 12);
  let c = 0;
  const band = (on: boolean, p: number) => on && r < (c += p);
  if (band(n >= 6, 0.07)) return ["climber", R(8, 12)];
  if (band(n >= 5, 0.08)) return ["runner", R(9, 13)];
  if (band(n >= 3, 0.05)) return ["smiler", R(12, 14)];
  if (band(n >= 3, 0.15)) return ["crawler", R(4, 7)];
  if (band(n >= 2, n >= 3 ? 0.27 + Math.min(0.15, h * 0.01) : 0.28)) return ["abnormal", R(10, 14)];
  if (band(true, 0.12)) return ["normal", R(4, 7)];
  return ["normal", R(8, tall)];
}
