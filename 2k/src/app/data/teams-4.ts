import type { PlayerData, PlayerRatings, Position, TeamData } from "./types";

// Pacific division, 2026-27 rosters as of 2026-11-07.
// Season lines are 2025-26 per-game stats (approximate where noted in the research summary).
// Ratings array order:
// [overall, close, mid, three, ft, layup, dunk, passing, handle, postScoring,
//  perimeterD, interiorD, steal, block, offReb, defReb, speed, accel, strength, vertical, stamina, iq]

type Hair = PlayerData["hair"];
type R22 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type Line = [ppg: number, rpg: number, apg: number, fgPct: number, tpPct: number, ftPct: number];

function slug(first: string, last: string): string {
  return `${first}-${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ratings(r: R22): PlayerRatings {
  return {
    overall: r[0], close: r[1], mid: r[2], three: r[3], ft: r[4], layup: r[5], dunk: r[6],
    passing: r[7], handle: r[8], postScoring: r[9], perimeterD: r[10], interiorD: r[11],
    steal: r[12], block: r[13], offReb: r[14], defReb: r[15], speed: r[16], accel: r[17],
    strength: r[18], vertical: r[19], stamina: r[20], iq: r[21],
  };
}

function p(
  first: string, last: string, jersey: number, pos: Position, pos2: Position | null,
  heightIn: number, weightLb: number, age: number, hand: "R" | "L",
  skin: number, hair: Hair, beard: boolean, headband: boolean,
  archetype: string, starter: boolean, r: R22, s: Line,
): PlayerData {
  const out: PlayerData = {
    id: slug(first, last), first, last, jersey, pos, heightIn, weightLb, age, hand,
    skin, hair, beard, headband, archetype, starter, ratings: ratings(r),
    season: { ppg: s[0], rpg: s[1], apg: s[2], fgPct: s[3], tpPct: s[4], ftPct: s[5] },
  };
  if (pos2) out.pos2 = pos2;
  return out;
}

// Team overall/offense/defense from the top-8 rotation (first 8 listed), weighted toward starters.
function team(t: Omit<TeamData, "overall" | "offense" | "defense">): TeamData {
  const top = t.players.slice(0, 8);
  const w = [1.25, 1.25, 1.25, 1.25, 1.25, 0.85, 0.75, 0.65];
  let ws = 0, ov = 0, off = 0, def = 0;
  top.forEach((pl, i) => {
    const r = pl.ratings;
    const o = (r.close + r.mid + r.three + r.layup + r.passing + r.handle + r.iq) / 7;
    const d = (r.perimeterD + r.interiorD + r.steal + r.block + r.defReb + r.iq) / 6;
    ws += w[i]; ov += r.overall * w[i]; off += o * w[i]; def += d * w[i];
  });
  const star = Math.max(...top.map((pl) => pl.ratings.overall));
  const overall = Math.round(ov / ws + (star - 85) * 0.15);
  return { ...t, overall, offense: Math.round(off / ws + 4), defense: Math.round(def / ws + 9) };
}

export const TEAMS_4: TeamData[] = [
  // ───────────────────────── GOLDEN STATE ─────────────────────────
  team({
    abbr: "GSW", city: "Golden State", name: "Warriors", conf: "West", div: "Pacific",
    primary: "#1D428A", secondary: "#FFC72C", accent: "#FFFFFF",
    court: { wood: "#C99A62", paint: "#1D428A", line: "#FFFFFF" },
    coach: "Steve Kerr", arena: "",
    players: [
      p("Stephen", "Curry", 30, "PG", null, 74, 185, 38, "R", 0.42, "short", true, false, "Gravity Sniper", true,
        [93, 88, 92, 99, 96, 90, 40, 88, 95, 55, 66, 40, 72, 35, 35, 55, 82, 85, 55, 62, 82, 98],
        [26.6, 3.6, 4.7, 0.468, 0.393, 0.923]),
      p("Brandin", "Podziemski", 2, "SG", "PG", 76, 205, 23, "L", 0.05, "short", false, false, "Connector Combo Guard", true,
        [80, 78, 77, 79, 80, 80, 55, 80, 80, 50, 76, 52, 74, 40, 62, 72, 76, 78, 58, 62, 92, 85],
        [13.8, 5.1, 3.7, 0.455, 0.371, 0.797]),
      p("Yaxel", "Lendeborg", 1, "SF", "PF", 81, 241, 24, "R", 0.6, "short", false, false, "Point Forward Rookie", true,
        [79, 80, 76, 80, 76, 79, 75, 77, 72, 68, 76, 72, 72, 66, 68, 76, 72, 72, 74, 74, 86, 80],
        [21.0, 7.1, 4.1, 0.492, 0.396, 0.759]),
      p("Draymond", "Green", 23, "PF", "C", 78, 230, 36, "R", 0.85, "buzz", true, false, "Defensive Playmaker", true,
        [79, 70, 55, 62, 70, 66, 58, 90, 72, 62, 86, 88, 80, 72, 58, 78, 66, 68, 82, 58, 82, 97],
        [8.4, 5.5, 5.5, 0.418, 0.326, 0.702]),
      p("Kristaps", "Porzingis", 7, "C", "PF", 86, 240, 31, "R", 0.05, "short", false, false, "Stretch Rim Protector", true,
        [81, 84, 80, 80, 84, 72, 78, 58, 55, 78, 58, 84, 45, 87, 62, 78, 58, 60, 72, 62, 68, 80],
        [16.7, 5.2, 2.5, 0.446, 0.338, 0.842]),
      p("Jimmy", "Butler", 10, "SF", "PF", 78, 230, 37, "R", 0.7, "braids", true, false, "Two-Way Slasher", false,
        [84, 86, 78, 74, 88, 86, 68, 82, 80, 82, 84, 74, 82, 52, 62, 70, 70, 72, 80, 62, 76, 95],
        [20.0, 5.6, 4.9, 0.519, 0.376, 0.864]),
      p("Moses", "Moody", 4, "SG", "SF", 77, 211, 24, "R", 0.78, "short", false, false, "3-and-D Wing", false,
        [76, 70, 72, 82, 77, 72, 70, 60, 68, 42, 80, 52, 70, 48, 52, 62, 78, 78, 66, 74, 84, 74],
        [12.1, 3.3, 1.6, 0.440, 0.401, 0.770]),
      p("De'Anthony", "Melton", 8, "SG", "PG", 74, 200, 28, "R", 0.72, "buzz", true, false, "Pickpocket Guard", false,
        [75, 66, 66, 75, 80, 70, 62, 72, 74, 40, 85, 55, 86, 55, 60, 66, 82, 84, 60, 74, 82, 78],
        [12.3, 3.2, 2.6, 0.407, 0.294, 0.826]),
      p("Brandon", "Williams", 12, "PG", null, 73, 190, 26, "R", 0.8, "locs", false, false, "Microwave Scorer", false,
        [74, 70, 74, 68, 80, 76, 45, 76, 82, 38, 64, 40, 64, 30, 30, 52, 82, 85, 48, 62, 80, 72],
        [13.0, 2.9, 3.9, 0.472, 0.232, 0.793]),
      p("Al", "Horford", 20, "C", "PF", 80, 240, 40, "R", 0.55, "buzz", true, false, "Veteran Stretch Big", false,
        [74, 72, 68, 77, 84, 60, 55, 74, 58, 68, 72, 82, 62, 74, 55, 74, 48, 50, 78, 52, 62, 92],
        [8.3, 4.9, 2.6, 0.426, 0.361, 0.846]),
      p("Gui", "Santos", 15, "SF", "PF", 79, 185, 24, "R", 0.3, "short", false, false, "Energy Wing", false,
        [74, 76, 64, 72, 72, 76, 70, 72, 70, 52, 74, 64, 74, 50, 62, 68, 76, 76, 66, 72, 84, 80],
        [9.2, 3.9, 2.3, 0.500, 0.351, 0.725]),
      p("Gary", "Payton II", 0, "SG", "SF", 74, 195, 33, "R", 0.82, "buzz", false, false, "Lockdown Lob Threat", false,
        [73, 80, 48, 62, 64, 76, 86, 60, 60, 40, 86, 62, 82, 58, 74, 62, 86, 88, 74, 90, 74, 80],
        [7.5, 3.6, 1.7, 0.583, 0.291, 0.650]),
      p("Georges", "Niang", 32, "PF", null, 78, 230, 33, "R", 0.06, "short", true, false, "Stretch Four", false,
        [71, 68, 68, 78, 78, 62, 45, 64, 60, 52, 58, 56, 55, 35, 40, 60, 58, 58, 72, 48, 72, 78],
        [8.5, 3.4, 1.5, 0.440, 0.375, 0.800]),
    ],
  }),
  // ───────────────────────── LA LAKERS ─────────────────────────
  team({
    abbr: "LAL", city: "Los Angeles", name: "Lakers", conf: "West", div: "Pacific",
    primary: "#552583", secondary: "#FDB927", accent: "#000000",
    court: { wood: "#D2A26A", paint: "#FDB927", line: "#FFFFFF" },
    coach: "JJ Redick", arena: "",
    players: [
      p("Luka", "Doncic", 77, "PG", "SG", 80, 230, 27, "R", 0.06, "short", true, false, "Heliocentric Maestro", true,
        [97, 92, 92, 90, 82, 92, 62, 97, 97, 85, 66, 56, 76, 42, 58, 82, 74, 78, 82, 56, 88, 99],
        [33.5, 7.7, 8.3, 0.476, 0.366, 0.780]),
      p("Austin", "Reaves", 15, "SG", "PG", 77, 197, 28, "R", 0.04, "short", false, false, "Crafty Shot Creator", true,
        [88, 84, 84, 86, 88, 88, 52, 86, 88, 58, 70, 48, 66, 36, 40, 58, 78, 80, 60, 62, 92, 92],
        [23.3, 4.7, 5.5, 0.490, 0.360, 0.871]),
      p("Matisse", "Thybulle", 4, "SF", "SG", 77, 202, 29, "R", 0.6, "short", false, false, "Perimeter Lockdown", true,
        [74, 66, 58, 76, 82, 68, 70, 60, 60, 35, 90, 68, 90, 72, 55, 58, 80, 82, 64, 82, 80, 76],
        [5.5, 2.4, 1.1, 0.430, 0.360, 0.800]),
      p("Jake", "LaRavia", 12, "PF", "SF", 79, 235, 25, "R", 0.05, "short", true, false, "Glue Forward", true,
        [74, 72, 66, 73, 76, 72, 68, 68, 64, 55, 76, 70, 74, 55, 62, 72, 72, 72, 74, 70, 86, 80],
        [8.2, 4.0, 1.8, 0.459, 0.321, 0.763]),
      p("Walker", "Kessler", 14, "C", null, 86, 245, 25, "R", 0.05, "short", false, false, "Paint Protector", true,
        [82, 90, 40, 30, 58, 72, 88, 52, 40, 72, 62, 94, 52, 96, 88, 92, 62, 62, 84, 78, 80, 76],
        [14.4, 10.2, 1.1, 0.718, 0.000, 0.563]),
      p("Quentin", "Grimes", 5, "SG", "SF", 76, 210, 26, "R", 0.7, "short", false, false, "Two-Way Guard", false,
        [77, 72, 74, 77, 84, 74, 68, 68, 74, 40, 80, 52, 70, 40, 54, 62, 80, 82, 72, 74, 86, 76],
        [13.4, 3.6, 3.3, 0.450, 0.334, 0.840]),
      p("Collin", "Sexton", 10, "PG", "SG", 75, 190, 27, "R", 0.78, "short", false, false, "Downhill Scorer", false,
        [77, 78, 82, 80, 85, 82, 52, 70, 80, 38, 66, 40, 62, 25, 42, 46, 86, 90, 56, 72, 86, 74],
        [15.4, 2.3, 3.3, 0.485, 0.401, 0.855]),
      p("Ziaire", "Williams", 11, "SF", "PF", 81, 185, 25, "R", 0.78, "short", false, false, "Rangy Wing", false,
        [74, 70, 68, 76, 84, 72, 74, 58, 66, 45, 76, 62, 66, 52, 48, 60, 80, 80, 62, 80, 80, 70],
        [10.2, 2.4, 1.1, 0.425, 0.343, 0.850]),
      p("Sandro", "Mamukelashvili", 54, "PF", "C", 81, 240, 27, "R", 0.1, "short", true, false, "Stretch Big", false,
        [75, 78, 72, 77, 75, 70, 68, 68, 62, 64, 62, 72, 60, 56, 66, 74, 66, 66, 74, 66, 80, 76],
        [11.2, 4.9, 1.9, 0.523, 0.389, 0.747]),
      p("Jarred", "Vanderbilt", 2, "PF", "SF", 80, 214, 27, "R", 0.8, "short", false, false, "Rebounding Pest", false,
        [71, 70, 40, 35, 70, 66, 74, 62, 58, 45, 80, 80, 78, 62, 82, 82, 74, 76, 72, 82, 78, 75],
        [4.5, 5.0, 1.3, 0.500, 0.250, 0.700]),
      p("Kevon", "Looney", 55, "C", "PF", 81, 222, 30, "R", 0.82, "short", true, false, "Glass Cleaner", false,
        [70, 72, 40, 25, 62, 62, 62, 66, 45, 58, 58, 78, 52, 56, 88, 80, 52, 54, 82, 54, 78, 82],
        [4.0, 5.0, 1.3, 0.500, 0.000, 0.600]),
      p("Jaden", "Hardy", 7, "SG", "PG", 75, 198, 24, "R", 0.8, "short", false, false, "Bench Bucket", false,
        [68, 66, 70, 72, 85, 68, 55, 62, 74, 35, 58, 38, 55, 25, 32, 44, 82, 84, 50, 70, 76, 64],
        [6.0, 1.5, 1.0, 0.410, 0.340, 0.850]),
      p("Bronny", "James", 9, "PG", "SG", 74, 210, 22, "R", 0.75, "short", false, false, "Defensive Guard", false,
        [64, 60, 55, 64, 66, 62, 66, 60, 64, 30, 74, 48, 66, 40, 40, 46, 80, 82, 64, 82, 82, 64],
        [2.3, 0.9, 1.3, 0.380, 0.300, 0.650]),
    ],
  }),
  // ───────────────────────── LA CLIPPERS ─────────────────────────
  team({
    abbr: "LAC", city: "Los Angeles", name: "Clippers", conf: "West", div: "Pacific",
    primary: "#1D428A", secondary: "#C8102E", accent: "#BEC0C2",
    court: { wood: "#BF8D58", paint: "#1D428A", line: "#FFFFFF" },
    coach: "Tyronn Lue", arena: "",
    players: [
      p("Darius", "Garland", 10, "PG", null, 73, 192, 26, "R", 0.72, "short", false, false, "Floor General", true,
        [84, 80, 86, 86, 86, 84, 40, 88, 92, 40, 62, 36, 66, 30, 26, 44, 88, 90, 48, 60, 86, 88],
        [18.8, 2.4, 6.7, 0.460, 0.396, 0.861]),
      p("Kris", "Dunn", 8, "SG", "PG", 75, 205, 32, "R", 0.85, "buzz", true, false, "Lockdown Defender", true,
        [76, 70, 62, 74, 76, 70, 62, 78, 72, 42, 90, 64, 90, 60, 56, 64, 80, 80, 76, 74, 84, 84],
        [7.3, 3.3, 3.6, 0.476, 0.374, 0.765]),
      p("Brandon", "Ingram", 7, "SF", "PF", 80, 190, 29, "R", 0.8, "short", true, false, "Midrange Shot Maker", true,
        [85, 84, 90, 82, 82, 84, 68, 78, 84, 72, 72, 62, 62, 58, 40, 70, 72, 74, 62, 66, 82, 84],
        [21.5, 5.6, 3.7, 0.477, 0.382, 0.820]),
      p("Rui", "Hachimura", 28, "PF", "SF", 80, 230, 28, "R", 0.62, "short", true, false, "Spot-Up Power Forward", true,
        [78, 82, 80, 84, 70, 76, 76, 52, 62, 72, 68, 66, 52, 40, 56, 62, 72, 72, 80, 72, 80, 74],
        [11.5, 3.3, 0.8, 0.514, 0.443, 0.694]),
      p("Isaiah", "Jackson", 23, "C", "PF", 80, 205, 24, "R", 0.88, "short", false, false, "Rim-Running Shot Blocker", true,
        [73, 78, 40, 25, 62, 70, 88, 50, 45, 55, 62, 78, 62, 80, 78, 74, 74, 76, 70, 88, 78, 68],
        [6.7, 5.3, 0.9, 0.637, 0.000, 0.648]),
      p("Derrick", "Jones Jr.", 5, "SF", "PF", 78, 210, 29, "R", 0.85, "short", false, false, "High-Flying Stopper", false,
        [75, 74, 56, 74, 70, 74, 92, 54, 60, 42, 82, 66, 72, 64, 62, 58, 84, 84, 72, 95, 82, 72],
        [10.1, 3.5, 1.4, 0.499, 0.359, 0.763]),
      p("Brook", "Lopez", 11, "C", null, 85, 282, 38, "R", 0.1, "long", true, false, "Stretch Rim Protector", false,
        [75, 74, 62, 76, 76, 52, 58, 58, 40, 62, 52, 86, 42, 88, 48, 66, 40, 44, 86, 48, 66, 82],
        [8.5, 3.6, 1.3, 0.428, 0.360, 0.757]),
      p("Keaton", "Wagler", 1, "SG", "PG", 77, 188, 19, "R", 0.04, "short", false, false, "Rookie Combo Guard", false,
        [73, 64, 72, 76, 85, 68, 58, 72, 78, 35, 62, 48, 60, 40, 40, 58, 78, 80, 52, 68, 84, 72],
        [12.0, 4.1, 3.3, 0.309, 0.351, 0.854]),
      p("Max", "Strus", 31, "SF", "SG", 77, 215, 30, "R", 0.05, "short", true, false, "Movement Shooter", false,
        [75, 68, 70, 81, 78, 68, 60, 66, 66, 40, 72, 56, 64, 40, 50, 66, 72, 74, 68, 70, 86, 78],
        [11.2, 5.4, 2.0, 0.443, 0.402, 0.778]),
      p("Kobe", "Sanders", 4, "SG", "SF", 80, 207, 24, "R", 0.75, "short", false, false, "Big Guard Shooter", false,
        [72, 66, 66, 78, 83, 70, 60, 66, 70, 40, 70, 56, 62, 45, 42, 56, 72, 74, 60, 66, 84, 74],
        [7.3, 2.3, 1.6, 0.466, 0.408, 0.826]),
      p("Bradley", "Beal", 3, "SG", null, 76, 207, 33, "R", 0.78, "short", true, false, "Veteran Scorer", false,
        [76, 76, 80, 78, 80, 78, 55, 72, 80, 50, 60, 40, 62, 30, 32, 40, 72, 74, 64, 62, 70, 80],
        [8.2, 0.8, 1.7, 0.375, 0.368, 0.750]),
      p("Gradey", "Dick", 9, "SG", "SF", 79, 200, 22, "R", 0.03, "short", false, false, "Catch-and-Shoot Wing", false,
        [71, 66, 68, 76, 84, 68, 62, 58, 64, 38, 62, 50, 56, 40, 40, 52, 74, 74, 56, 68, 80, 68],
        [7.0, 2.5, 1.0, 0.430, 0.330, 0.820]),
      p("Baba", "Miller", 18, "PF", "SF", 83, 208, 22, "R", 0.82, "short", false, false, "Raw Athletic Forward", false,
        [66, 68, 48, 58, 70, 62, 72, 64, 60, 45, 68, 68, 64, 66, 60, 62, 72, 72, 58, 74, 80, 66],
        [2.3, 2.1, 0.7, 0.667, 0.500, 0.750]),
    ],
  }),
  // ───────────────────────── PHOENIX ─────────────────────────
  team({
    abbr: "PHX", city: "Phoenix", name: "Suns", conf: "West", div: "Pacific",
    primary: "#1D1160", secondary: "#E56020", accent: "#63727A",
    court: { wood: "#C48E57", paint: "#1D1160", line: "#FFFFFF" },
    coach: "Jordan Ott", arena: "",
    players: [
      p("Devin", "Booker", 15, "PG", "SG", 77, 206, 30, "R", 0.55, "short", true, false, "Three-Level Scorer", true,
        [90, 86, 92, 84, 88, 86, 60, 85, 88, 64, 64, 44, 62, 30, 32, 52, 78, 80, 66, 60, 88, 92],
        [26.1, 3.9, 6.0, 0.456, 0.330, 0.873]),
      p("Jalen", "Green", 4, "SG", null, 76, 186, 24, "R", 0.7, "short", false, false, "Explosive Slasher", true,
        [79, 76, 74, 74, 76, 84, 90, 62, 80, 40, 62, 42, 56, 35, 40, 50, 90, 92, 58, 90, 86, 68],
        [17.8, 3.6, 2.8, 0.422, 0.313, 0.747]),
      p("Dillon", "Brooks", 3, "SF", "SG", 79, 225, 30, "R", 0.72, "short", true, false, "Agitator Wing", true,
        [79, 76, 80, 78, 84, 74, 55, 58, 70, 58, 86, 62, 68, 40, 46, 56, 74, 76, 82, 62, 86, 78],
        [20.2, 3.6, 1.8, 0.435, 0.344, 0.842]),
      p("Miles", "Bridges", 22, "PF", "SF", 79, 225, 28, "R", 0.85, "short", true, false, "Athletic Combo Forward", true,
        [81, 80, 74, 74, 82, 80, 90, 70, 74, 66, 72, 70, 62, 56, 66, 74, 78, 78, 84, 86, 86, 76],
        [17.1, 5.8, 3.2, 0.460, 0.333, 0.822]),
      p("Khaman", "Maluach", 10, "C", null, 86, 250, 20, "R", 0.95, "short", false, false, "Developing Rim Protector", true,
        [73, 80, 40, 40, 72, 66, 84, 48, 38, 56, 52, 80, 48, 82, 76, 78, 62, 62, 74, 76, 78, 64],
        [7.3, 6.0, 1.3, 0.568, 0.250, 0.727]),
      p("Mark", "Williams", 25, "C", null, 85, 240, 24, "R", 0.85, "short", false, false, "Lob Finisher", false,
        [77, 88, 40, 25, 77, 70, 88, 52, 40, 64, 48, 82, 52, 80, 84, 84, 60, 62, 80, 74, 70, 70],
        [11.7, 8.0, 1.0, 0.644, 0.000, 0.771]),
      p("Collin", "Gillespie", 12, "PG", null, 73, 195, 27, "R", 0.04, "short", false, false, "Pick-and-Pop Point Guard", false,
        [77, 66, 76, 82, 87, 70, 40, 80, 80, 35, 66, 40, 66, 30, 32, 58, 76, 78, 54, 58, 88, 84],
        [12.7, 4.1, 4.6, 0.418, 0.401, 0.874]),
      p("Luke", "Kennard", 8, "SG", null, 77, 206, 30, "L", 0.03, "short", true, false, "Pure Shooter", false,
        [75, 64, 74, 88, 91, 66, 45, 72, 70, 40, 52, 40, 48, 25, 26, 50, 64, 66, 52, 52, 76, 80],
        [8.4, 2.3, 2.2, 0.533, 0.478, 0.913]),
      p("Jordan", "Goodwin", 23, "SG", "PG", 75, 215, 28, "R", 0.78, "buzz", true, false, "Hustle Guard", false,
        [73, 70, 58, 74, 70, 70, 72, 66, 68, 40, 82, 58, 78, 50, 74, 66, 80, 80, 74, 78, 86, 76],
        [8.7, 4.9, 2.2, 0.413, 0.371, 0.696]),
      p("Oso", "Ighodaro", 11, "PF", "C", 83, 235, 24, "R", 0.85, "short", false, false, "Short-Roll Playmaker", false,
        [72, 80, 48, 30, 55, 72, 80, 74, 58, 58, 64, 76, 62, 70, 66, 70, 72, 72, 70, 78, 80, 76],
        [6.5, 4.8, 1.8, 0.600, 0.000, 0.550]),
      p("Ryan", "Dunn", 0, "SF", "PF", 79, 216, 23, "R", 0.75, "short", false, false, "Defensive Specialist", false,
        [71, 66, 48, 66, 62, 68, 80, 52, 54, 40, 88, 70, 74, 72, 62, 62, 80, 80, 74, 86, 82, 72],
        [6.0, 4.0, 1.0, 0.440, 0.330, 0.620]),
      p("Duop", "Reath", 26, "C", "PF", 81, 245, 30, "R", 0.95, "short", false, false, "Stretch Backup Big", false,
        [68, 72, 58, 70, 78, 58, 62, 52, 40, 58, 52, 68, 44, 60, 56, 62, 52, 54, 70, 58, 70, 68],
        [3.4, 0.8, 0.0, 0.667, 0.500, 1.000]),
      p("Koa", "Peat", 18, "PF", "SF", 80, 245, 19, "R", 0.7, "short", false, false, "Rookie Power Forward", false,
        [67, 72, 58, 50, 66, 70, 80, 62, 62, 62, 62, 64, 56, 52, 64, 64, 74, 74, 78, 74, 80, 64],
        [1.5, 0.8, 0.0, 0.500, 0.000, 1.000]),
    ],
  }),
  // ───────────────────────── SACRAMENTO ─────────────────────────
  team({
    abbr: "SAC", city: "Sacramento", name: "Kings", conf: "West", div: "Pacific",
    primary: "#5A2D81", secondary: "#63727A", accent: "#000000",
    court: { wood: "#CFA06B", paint: "#5A2D81", line: "#FFFFFF" },
    coach: "Doug Christie", arena: "",
    players: [
      p("Darius", "Acuff Jr.", 5, "PG", null, 74, 186, 19, "R", 0.82, "short", false, false, "Rookie Scoring Guard", true,
        [79, 74, 80, 78, 84, 80, 52, 82, 88, 35, 62, 40, 66, 30, 32, 48, 88, 90, 50, 68, 90, 72],
        [25.6, 3.8, 7.0, 0.397, 0.308, 0.838]),
      p("Zach", "LaVine", 8, "SG", "SF", 77, 200, 31, "R", 0.7, "short", true, false, "Athletic Scorer", true,
        [83, 84, 84, 84, 86, 86, 88, 64, 82, 50, 60, 42, 58, 35, 36, 50, 86, 88, 62, 90, 82, 76],
        [19.2, 2.8, 2.3, 0.479, 0.390, 0.880]),
      p("De'Andre", "Hunter", 15, "SF", "PF", 79, 221, 28, "R", 0.8, "short", true, false, "Two-Way Wing", true,
        [77, 76, 74, 74, 84, 74, 70, 54, 66, 55, 76, 58, 58, 40, 46, 60, 72, 72, 72, 70, 80, 72],
        [13.7, 4.1, 2.0, 0.415, 0.305, 0.867]),
      p("Keegan", "Murray", 13, "PF", "SF", 80, 225, 26, "R", 0.75, "short", false, false, "3-and-D Forward", true,
        [78, 74, 68, 74, 78, 72, 74, 52, 58, 52, 80, 72, 62, 62, 58, 72, 72, 72, 74, 74, 86, 78],
        [14.0, 5.7, 1.7, 0.420, 0.277, 0.776]),
      p("Domantas", "Sabonis", 11, "C", "PF", 82, 240, 30, "L", 0.05, "short", false, false, "Hub Big", true,
        [86, 92, 70, 58, 74, 82, 72, 88, 72, 84, 52, 72, 56, 46, 95, 96, 62, 64, 90, 54, 90, 90],
        [15.8, 11.4, 4.1, 0.543, 0.185, 0.727]),
      p("Malik", "Monk", 0, "SG", "PG", 75, 200, 28, "R", 0.75, "short", false, false, "Sixth-Man Spark", false,
        [77, 74, 76, 80, 88, 76, 72, 74, 80, 40, 56, 40, 58, 30, 30, 42, 84, 86, 56, 82, 82, 76],
        [12.5, 1.9, 3.0, 0.438, 0.395, 0.879]),
      p("Precious", "Achiuwa", 9, "PF", "C", 80, 243, 27, "R", 0.92, "short", false, false, "Energy Big", false,
        [74, 74, 58, 52, 56, 70, 78, 48, 52, 56, 74, 74, 60, 62, 70, 74, 76, 76, 78, 78, 80, 70],
        [10.1, 6.7, 1.4, 0.528, 0.278, 0.554]),
      p("Maxime", "Raynaud", 42, "C", null, 85, 250, 23, "R", 0.08, "short", false, false, "Skilled Center", false,
        [74, 80, 66, 62, 78, 68, 72, 58, 52, 66, 54, 72, 48, 62, 74, 78, 60, 62, 74, 64, 82, 72],
        [12.5, 7.5, 1.4, 0.571, 0.324, 0.786]),
      p("Nique", "Clifford", 10, "SG", "SF", 77, 175, 24, "R", 0.7, "short", false, false, "Rebounding Wing", false,
        [70, 70, 62, 66, 72, 70, 70, 64, 66, 42, 74, 58, 66, 45, 56, 66, 76, 76, 66, 72, 84, 74],
        [8.6, 3.8, 2.4, 0.418, 0.333, 0.722]),
      p("Ben", "Simmons", 25, "PG", "PF", 82, 240, 30, "R", 0.55, "short", false, false, "Defensive Point Forward", false,
        [70, 76, 30, 25, 50, 74, 72, 86, 74, 50, 78, 74, 76, 58, 62, 72, 74, 76, 82, 64, 70, 82],
        [5.0, 4.9, 5.9, 0.530, 0.000, 0.500]),
      p("Jonathan", "Mogbo", 22, "PF", "C", 81, 225, 25, "R", 0.9, "short", false, false, "Switchable Forward", false,
        [67, 72, 40, 30, 60, 70, 76, 68, 58, 52, 68, 72, 66, 60, 66, 66, 74, 74, 72, 76, 80, 70],
        [4.0, 3.5, 1.3, 0.530, 0.200, 0.600]),
      p("Emanuel", "Sharp", 34, "SG", null, 75, 208, 22, "R", 0.78, "short", false, false, "Rookie Shooter", false,
        [66, 60, 64, 74, 85, 62, 50, 58, 64, 32, 62, 44, 58, 30, 30, 44, 76, 78, 58, 68, 78, 66],
        [4.4, 1.0, 0.9, 0.375, 0.391, 0.850]),
      p("Leaky", "Black", 19, "SF", "SG", 78, 209, 27, "R", 0.85, "short", false, false, "Perimeter Defender", false,
        [66, 62, 52, 62, 62, 64, 64, 60, 60, 35, 82, 62, 70, 52, 50, 56, 76, 76, 66, 72, 82, 72],
        [4.3, 2.5, 0.8, 0.429, 0.364, 0.500]),
    ],
  }),
];
