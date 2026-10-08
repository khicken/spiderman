export type CharacterId = "cadet" | "eren" | "mikasa" | "levi" | "armin";
export type HairStyle = "cadet" | "spiky" | "bob" | "undercut";

export type CharStats = {
  reel: number;
  maxSpeed: number;
  run: number;
  gasDrain: number;
  tank: number;
  refill: number;
  damage: number;
  chargeTime: number;
  wear: number;
};

export type ScoutLook = {
  hair: string;
  hairStyle: HairStyle;
  eyes: string;
  skin: string;
  scale: number;
  scarf?: string;
  cravat?: boolean;
};

export type Rank = "Trainee" | "Private" | "Squad Leader" | "Captain" | "Commander";

export type Character = {
  id: CharacterId;
  name: string;
  jp: string;
  role: string;
  unlock: Rank | null;
  stats: CharStats;
  look: ScoutLook;
};

const BASE: CharStats = { reel: 1, maxSpeed: 1, run: 1, gasDrain: 1, tank: 1, refill: 1, damage: 1, chargeTime: 1, wear: 1 };

export const CHARACTERS: Character[] = [
  {
    id: "cadet",
    name: "Cadet",
    jp: "訓練兵",
    role: "A new recruit. Even stats.",
    unlock: null,
    stats: BASE,
    look: { hair: "#2b2320", hairStyle: "cadet", eyes: "#20303a", skin: "#f2cfae", scale: 1 },
  },
  {
    id: "eren",
    name: "Eren",
    jp: "エレン",
    role: "Balanced fighter with a hard strike.",
    unlock: null,
    stats: { ...BASE, reel: 1.05, damage: 1.12, wear: 0.95 },
    look: { hair: "#4a2f1f", hairStyle: "spiky", eyes: "#2f9a62", skin: "#f2cfae", scale: 1 },
  },
  {
    id: "mikasa",
    name: "Mikasa",
    jp: "ミカサ",
    role: "Fast strikes and high damage.",
    unlock: "Private",
    stats: { ...BASE, reel: 1.1, maxSpeed: 1.05, damage: 1.35, chargeTime: 0.72, wear: 0.85 },
    look: { hair: "#16151a", hairStyle: "bob", eyes: "#3a3240", skin: "#f4d6bb", scale: 0.97, scarf: "#b3202a" },
  },
  {
    id: "levi",
    name: "Levi",
    jp: "リヴァイ",
    role: "Best ODM speed. Small gas tank.",
    unlock: "Squad Leader",
    stats: { ...BASE, reel: 1.32, maxSpeed: 1.2, run: 1.1, gasDrain: 1.1, tank: 0.72, damage: 1.3, chargeTime: 0.8, wear: 0.75 },
    look: { hair: "#141317", hairStyle: "undercut", eyes: "#4a5560", skin: "#f1d3b6", scale: 0.9, cravat: true },
  },
  {
    id: "armin",
    name: "Armin",
    jp: "アルミン",
    role: "Slow but gas efficient. Fast refill.",
    unlock: null,
    stats: { ...BASE, reel: 0.9, maxSpeed: 0.9, run: 0.95, gasDrain: 0.65, refill: 1.8, damage: 0.88, chargeTime: 1.1 },
    look: { hair: "#e6c56a", hairStyle: "bob", eyes: "#3b74c0", skin: "#f4d8bf", scale: 0.95 },
  },
];

export function getCharacter(id: string | undefined): Character {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export function statBars(s: CharStats) {
  return [
    { label: "ODM speed", v: (s.maxSpeed + s.reel) / 2 },
    { label: "Power", v: s.damage },
    { label: "Strike", v: 1 / s.chargeTime },
    { label: "Gas", v: s.tank / s.gasDrain },
    { label: "Blades", v: 1 / s.wear },
  ].map((b) => ({ label: b.label, v: Math.min(1, Math.max(0.08, (b.v - 0.55) / 1.05)) }));
}
