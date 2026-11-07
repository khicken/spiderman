import type { PlayerData, PlayerRatings, Position, TeamData } from "./types";

// Atlantic division, 2026-27 rosters as of 2026-11-07.
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

export const TEAMS_0: TeamData[] = [
  // ───────────────────────── BOSTON ─────────────────────────
  team({
    abbr: "BOS", city: "Boston", name: "Celtics", conf: "East", div: "Atlantic",
    primary: "#007A33", secondary: "#BA9653", accent: "#FFFFFF",
    court: { wood: "#C9935B", paint: "#007A33", line: "#FFFFFF" },
    coach: "Joe Mazzulla", arena: "",
    players: [
      p("Payton", "Pritchard", 11, "PG", "SG", 73, 195, 28, "R", 0.08, "short", true, false, "Shot-Creating Sniper", true,
        [80, 74, 78, 86, 88, 76, 45, 76, 84, 40, 72, 40, 70, 30, 52, 55, 85, 87, 55, 66, 92, 84],
        [17.0, 4.3, 5.2, 0.462, 0.382, 0.874]),
      p("Derrick", "White", 9, "SG", "PG", 76, 190, 32, "R", 0.06, "bald", false, false, "Two-Way Combo Guard", true,
        [84, 76, 78, 82, 89, 80, 62, 78, 80, 45, 88, 62, 80, 74, 45, 58, 80, 82, 60, 72, 88, 90],
        [17.6, 4.5, 5.0, 0.433, 0.360, 0.900]),
      p("Paul", "George", 13, "SF", "PF", 80, 220, 36, "R", 0.72, "buzz", true, false, "Veteran Two-Way Wing", true,
        [81, 74, 82, 82, 86, 74, 55, 74, 79, 60, 80, 62, 76, 50, 35, 70, 70, 70, 66, 62, 74, 86],
        [16.2, 5.0, 3.6, 0.430, 0.380, 0.860]),
      p("Jayson", "Tatum", 0, "PF", "SF", 80, 210, 28, "R", 0.66, "braids", true, false, "Two-Way Scoring Machine", true,
        [92, 84, 85, 84, 85, 86, 74, 82, 85, 74, 84, 72, 75, 62, 62, 85, 78, 78, 72, 74, 90, 91],
        [22.4, 9.0, 5.8, 0.442, 0.345, 0.840]),
      p("Neemias", "Queta", 88, "C", null, 84, 248, 27, "R", 0.42, "short", true, false, "Rim-Running Big", true,
        [77, 82, 40, 25, 66, 66, 86, 55, 38, 64, 52, 82, 52, 82, 86, 82, 58, 56, 80, 76, 76, 74],
        [10.2, 8.4, 1.4, 0.640, 0.000, 0.680]),
      p("Mitchell", "Robinson", 4, "C", null, 85, 240, 28, "R", 0.82, "short", true, false, "Glass-Cleaning Rim Protector", false,
        [76, 80, 25, 20, 50, 60, 88, 40, 30, 50, 58, 84, 58, 84, 96, 84, 60, 60, 82, 84, 66, 68],
        [5.8, 8.4, 1.0, 0.590, 0.000, 0.470]),
      p("Mike", "Conley", 45, "PG", null, 73, 175, 39, "R", 0.70, "short", true, false, "Veteran Floor General", false,
        [72, 62, 70, 80, 88, 66, 35, 82, 78, 30, 66, 36, 70, 25, 28, 48, 66, 66, 48, 52, 66, 92],
        [6.5, 2.2, 3.6, 0.400, 0.370, 0.880]),
      p("Sam", "Hauser", 30, "SF", "PF", 79, 217, 28, "R", 0.06, "short", true, false, "Spot-Up Sniper", false,
        [74, 66, 70, 88, 86, 62, 55, 52, 54, 40, 68, 52, 52, 40, 30, 62, 62, 62, 62, 60, 80, 78],
        [9.0, 4.0, 1.3, 0.445, 0.400, 0.860]),
      p("Baylor", "Scheierman", 55, "SG", "SF", 78, 205, 26, "R", 0.05, "short", false, false, "3-and-D Wing", false,
        [72, 64, 64, 80, 80, 64, 55, 66, 66, 38, 72, 50, 64, 40, 50, 62, 70, 70, 60, 64, 82, 76],
        [7.5, 4.4, 2.0, 0.430, 0.360, 0.780]),
      p("Hugo", "González", 28, "SF", "SG", 78, 205, 20, "R", 0.15, "short", false, false, "Defensive Hustle Wing", false,
        [70, 66, 52, 68, 70, 66, 62, 56, 60, 35, 78, 56, 72, 46, 60, 58, 76, 78, 60, 72, 84, 70],
        [5.0, 3.6, 1.0, 0.440, 0.320, 0.700]),
      p("Jordan", "Walsh", 27, "SF", "SG", 78, 205, 22, "R", 0.78, "short", false, false, "Perimeter Stopper", false,
        [69, 64, 50, 66, 66, 64, 66, 50, 56, 35, 80, 56, 72, 46, 56, 56, 78, 78, 62, 76, 82, 68],
        [4.8, 3.3, 1.0, 0.460, 0.340, 0.680]),
      p("Luka", "Garza", 52, "C", null, 82, 243, 27, "L", 0.08, "short", true, false, "Stretch Post Scorer", false,
        [68, 80, 62, 70, 74, 70, 50, 46, 40, 74, 38, 60, 40, 48, 68, 66, 44, 46, 78, 48, 68, 70],
        [5.5, 3.2, 0.8, 0.560, 0.380, 0.740]),
      p("Dillon", "Mitchell", 20, "PF", "SF", 78, 205, 23, "R", 0.80, "short", false, false, "Athletic Slasher", false,
        [66, 70, 38, 36, 56, 70, 80, 48, 52, 40, 72, 60, 64, 58, 62, 64, 82, 82, 62, 88, 78, 62],
        [3.5, 3.4, 0.8, 0.520, 0.220, 0.560]),
    ],
  }),

  // ───────────────────────── BROOKLYN ─────────────────────────
  team({
    abbr: "BKN", city: "Brooklyn", name: "Nets", conf: "East", div: "Atlantic",
    primary: "#000000", secondary: "#FFFFFF", accent: "#777D84",
    court: { wood: "#B98A5E", paint: "#2B2B2B", line: "#FFFFFF" },
    coach: "Jordi Fernández", arena: "",
    players: [
      p("Nolan", "Traoré", 10, "PG", null, 75, 185, 20, "R", 0.80, "short", false, false, "Downhill Speed Guard", true,
        [70, 70, 56, 64, 72, 72, 58, 72, 78, 30, 62, 40, 62, 34, 32, 42, 88, 90, 48, 72, 78, 64],
        [9.0, 2.4, 4.0, 0.400, 0.300, 0.760]),
      p("Egor", "Demin", 8, "SG", "PG", 80, 199, 20, "R", 0.06, "short", false, false, "Big Playmaking Guard", true,
        [73, 66, 60, 74, 72, 68, 55, 80, 76, 35, 66, 46, 64, 44, 40, 56, 74, 74, 54, 64, 80, 72],
        [10.5, 3.8, 3.4, 0.410, 0.360, 0.750]),
      p("Michael", "Porter Jr.", 17, "SF", "PF", 82, 218, 28, "R", 0.68, "short", true, false, "Big Shot-Making Wing", true,
        [83, 82, 80, 84, 82, 80, 70, 62, 68, 60, 62, 58, 56, 52, 58, 76, 64, 64, 64, 70, 80, 80],
        [24.2, 7.1, 3.1, 0.470, 0.380, 0.820]),
      p("Julius", "Randle", 30, "PF", "C", 81, 250, 31, "L", 0.82, "buzz", true, false, "Bully-Ball Point Forward", true,
        [83, 86, 74, 72, 80, 82, 72, 76, 76, 82, 66, 66, 60, 42, 58, 78, 68, 70, 90, 66, 86, 80],
        [21.2, 6.7, 5.0, 0.480, 0.340, 0.810]),
      p("Day'Ron", "Sharpe", 20, "C", "PF", 81, 265, 25, "R", 0.85, "short", true, false, "Bruising Rebounder", true,
        [73, 78, 42, 34, 64, 64, 74, 62, 46, 66, 50, 74, 64, 64, 94, 80, 54, 54, 86, 60, 70, 70],
        [8.5, 7.6, 2.2, 0.540, 0.300, 0.650]),
      p("Mikel", "Brown Jr.", 0, "PG", "SG", 76, 190, 20, "R", 0.72, "short", false, false, "Shot-Creating Rookie Guard", false,
        [72, 66, 68, 74, 80, 68, 55, 74, 80, 30, 58, 36, 60, 30, 28, 40, 82, 84, 46, 70, 78, 66],
        [12.0, 3.0, 4.5, 0.410, 0.340, 0.800]),
      p("Noah", "Clowney", 21, "PF", "C", 82, 210, 22, "R", 0.78, "short", false, false, "Stretch Big", false,
        [71, 70, 56, 72, 70, 66, 70, 46, 48, 50, 60, 68, 50, 66, 52, 64, 66, 66, 62, 72, 78, 64],
        [11.0, 5.2, 1.4, 0.420, 0.350, 0.700]),
      p("Terance", "Mann", 14, "SG", "SF", 77, 215, 30, "L", 0.82, "short", true, false, "Glue Wing", false,
        [71, 72, 62, 66, 78, 72, 62, 64, 62, 44, 72, 52, 62, 38, 44, 54, 72, 72, 66, 66, 82, 74],
        [7.0, 3.2, 2.4, 0.470, 0.340, 0.780]),
      p("Danny", "Wolf", 2, "PF", "C", 83, 250, 22, "L", 0.08, "short", false, false, "Point Center", false,
        [69, 72, 56, 66, 68, 66, 56, 74, 70, 56, 48, 60, 50, 56, 66, 70, 58, 60, 72, 56, 74, 66],
        [8.0, 5.4, 2.5, 0.450, 0.330, 0.690]),
      p("Keon", "Ellis", 1, "SG", null, 75, 175, 26, "R", 0.82, "short", false, false, "3-and-D Pest", false,
        [70, 64, 52, 76, 80, 64, 62, 54, 60, 30, 80, 46, 86, 56, 38, 46, 80, 82, 52, 76, 82, 72],
        [7.0, 2.4, 1.6, 0.440, 0.380, 0.800]),
      p("Drake", "Powell", 4, "SG", "SF", 77, 195, 21, "R", 0.80, "short", false, false, "Athletic Defensive Wing", false,
        [66, 64, 48, 64, 68, 64, 72, 48, 54, 30, 74, 50, 64, 46, 42, 48, 82, 82, 56, 84, 78, 60],
        [5.0, 2.4, 1.0, 0.420, 0.330, 0.680]),
      p("Josh", "Minott", 0, "PF", "SF", 80, 205, 23, "R", 0.80, "short", false, false, "Energy Forward", false,
        [65, 68, 44, 56, 64, 66, 74, 42, 48, 38, 66, 62, 58, 64, 58, 60, 74, 74, 60, 82, 76, 58],
        [5.0, 3.6, 0.9, 0.480, 0.330, 0.680]),
      p("Moritz", "Wagner", 13, "C", "PF", 83, 245, 29, "R", 0.05, "short", true, false, "Crafty Stretch Big", false,
        [67, 76, 58, 64, 80, 72, 56, 50, 50, 64, 40, 56, 50, 40, 58, 62, 54, 56, 68, 52, 64, 68],
        [8.0, 4.0, 1.2, 0.500, 0.330, 0.820]),
    ],
  }),

  // ───────────────────────── NEW YORK ─────────────────────────
  team({
    abbr: "NYK", city: "New York", name: "Knicks", conf: "East", div: "Atlantic",
    primary: "#006BB6", secondary: "#F58426", accent: "#BEC0C2",
    court: { wood: "#C08B57", paint: "#006BB6", line: "#FFFFFF" },
    coach: "Mike Brown", arena: "",
    players: [
      p("Jalen", "Brunson", 11, "PG", null, 74, 190, 30, "L", 0.70, "short", true, false, "Crafty Shot Creator", true,
        [92, 92, 92, 84, 86, 92, 45, 82, 92, 82, 62, 40, 60, 25, 38, 52, 80, 84, 70, 58, 90, 96],
        [26.0, 3.4, 6.8, 0.484, 0.375, 0.830]),
      p("Mikal", "Bridges", 25, "SG", "SF", 78, 209, 30, "R", 0.80, "short", false, false, "Iron-Man Two-Way Wing", true,
        [81, 76, 82, 76, 82, 76, 62, 64, 70, 54, 84, 58, 74, 50, 38, 54, 74, 74, 60, 66, 99, 82],
        [15.4, 4.1, 3.6, 0.500, 0.360, 0.820]),
      p("OG", "Anunoby", 8, "SF", "PF", 79, 240, 29, "R", 0.88, "short", true, false, "Lockdown 3-and-D Forward", true,
        [84, 76, 72, 80, 78, 74, 76, 54, 64, 50, 92, 72, 84, 60, 50, 64, 74, 76, 86, 76, 84, 84],
        [16.5, 5.4, 2.0, 0.480, 0.380, 0.790]),
      p("Josh", "Hart", 3, "PF", "SG", 77, 215, 31, "R", 0.78, "buzz", false, false, "Rebounding Glue Guy", true,
        [80, 78, 56, 66, 74, 76, 62, 76, 70, 50, 78, 62, 74, 40, 84, 90, 76, 76, 74, 68, 96, 84],
        [11.0, 8.4, 4.8, 0.510, 0.340, 0.740]),
      p("Karl-Anthony", "Towns", 32, "C", "PF", 84, 248, 30, "R", 0.50, "short", true, false, "Stretch Five Scorer", true,
        [89, 88, 86, 88, 86, 82, 72, 70, 70, 84, 46, 66, 56, 56, 82, 92, 58, 60, 80, 62, 84, 86],
        [20.5, 11.8, 3.0, 0.500, 0.380, 0.850]),
      p("Miles", "McBride", 2, "PG", "SG", 74, 200, 26, "R", 0.80, "short", false, false, "Pesky Combo Guard", false,
        [75, 68, 66, 80, 82, 66, 52, 64, 72, 30, 84, 44, 76, 36, 36, 46, 82, 84, 66, 72, 88, 76],
        [9.5, 2.5, 2.5, 0.430, 0.380, 0.840]),
      p("Andre", "Drummond", 0, "C", null, 82, 279, 33, "R", 0.82, "short", true, false, "Rebounding Machine", false,
        [73, 82, 30, 25, 56, 60, 80, 54, 40, 60, 50, 74, 74, 62, 94, 92, 50, 52, 92, 62, 62, 66],
        [7.0, 8.6, 1.4, 0.540, 0.150, 0.580]),
      p("Jordan", "Clarkson", 0, "SG", "PG", 77, 194, 34, "R", 0.40, "short", true, false, "Microwave Scorer", false,
        [72, 70, 74, 74, 82, 74, 55, 60, 78, 40, 54, 36, 56, 28, 32, 44, 74, 76, 56, 64, 74, 70],
        [8.5, 2.2, 1.8, 0.420, 0.340, 0.860]),
      p("Landry", "Shamet", 44, "SG", null, 77, 190, 29, "R", 0.10, "short", true, false, "Movement Shooter", false,
        [69, 60, 66, 84, 88, 58, 40, 52, 58, 30, 62, 36, 54, 24, 22, 40, 70, 70, 50, 54, 72, 72],
        [5.5, 1.6, 1.0, 0.420, 0.400, 0.880]),
      p("Jose", "Alvarado", 5, "PG", null, 72, 179, 28, "R", 0.25, "short", true, false, "Defensive Pest", false,
        [70, 64, 62, 72, 78, 64, 30, 68, 74, 28, 80, 36, 88, 20, 30, 40, 84, 86, 56, 58, 82, 76],
        [6.5, 2.0, 3.0, 0.420, 0.350, 0.760]),
      p("Tyler", "Kolek", 13, "PG", null, 75, 195, 25, "L", 0.06, "short", false, false, "Pass-First Point", false,
        [67, 60, 60, 70, 82, 60, 30, 78, 72, 28, 60, 34, 60, 20, 26, 42, 72, 74, 50, 52, 76, 74],
        [3.5, 1.6, 2.6, 0.420, 0.360, 0.800]),
      p("James", "Wiseman", 35, "C", null, 85, 240, 25, "L", 0.85, "short", false, false, "Athletic Backup Big", false,
        [64, 74, 46, 30, 66, 62, 80, 32, 38, 58, 40, 64, 40, 66, 66, 66, 62, 62, 74, 72, 64, 52],
        [4.5, 3.8, 0.4, 0.560, 0.200, 0.680]),
      p("Mohamed", "Diawara", 51, "SF", "PF", 81, 225, 21, "R", 0.88, "short", false, false, "Long Developmental Forward", false,
        [62, 62, 48, 60, 66, 60, 64, 52, 50, 36, 66, 58, 56, 52, 50, 56, 68, 68, 62, 68, 74, 58],
        [3.0, 2.0, 0.6, 0.420, 0.330, 0.700]),
    ],
  }),

  // ───────────────────────── PHILADELPHIA ─────────────────────────
  team({
    abbr: "PHI", city: "Philadelphia", name: "76ers", conf: "East", div: "Atlantic",
    primary: "#006BB6", secondary: "#ED174C", accent: "#002B5C",
    court: { wood: "#C4915E", paint: "#006BB6", line: "#FFFFFF" },
    coach: "Nick Nurse", arena: "",
    players: [
      p("Tyrese", "Maxey", 0, "PG", "SG", 74, 200, 26, "R", 0.78, "short", false, false, "Speed Demon Scorer", true,
        [90, 88, 82, 86, 90, 90, 55, 80, 90, 40, 70, 40, 76, 40, 30, 50, 98, 98, 58, 76, 96, 86],
        [28.6, 4.2, 6.7, 0.457, 0.373, 0.880]),
      p("VJ", "Edgecombe", 77, "SG", "SF", 77, 180, 21, "R", 0.82, "short", false, false, "High-Flying Two-Way Guard", true,
        [79, 78, 66, 74, 80, 80, 88, 66, 74, 36, 78, 52, 76, 54, 50, 62, 88, 90, 58, 95, 88, 74],
        [15.8, 5.6, 4.2, 0.430, 0.350, 0.800]),
      p("Jaylen", "Brown", 7, "SF", "SG", 78, 223, 30, "R", 0.80, "short", true, false, "Explosive Slashing Scorer", true,
        [91, 92, 84, 76, 80, 92, 92, 74, 84, 72, 80, 60, 70, 46, 50, 70, 84, 86, 82, 86, 88, 86],
        [28.7, 6.9, 5.0, 0.480, 0.340, 0.780]),
      p("LeBron", "James", 23, "PF", "SF", 81, 250, 41, "R", 0.84, "buzz", true, true, "Point Forward Legend", true,
        [88, 90, 78, 76, 74, 90, 82, 94, 86, 80, 62, 60, 62, 46, 40, 72, 70, 72, 92, 68, 68, 99],
        [21.0, 5.8, 7.2, 0.500, 0.340, 0.750]),
      p("Joel", "Embiid", 21, "C", null, 84, 280, 32, "R", 0.85, "short", false, false, "Dominant Inside-Out Big", true,
        [89, 92, 86, 72, 86, 82, 72, 72, 66, 94, 50, 84, 60, 74, 66, 84, 50, 52, 94, 56, 60, 88],
        [24.0, 7.6, 4.0, 0.470, 0.330, 0.850]),
      p("Anfernee", "Simons", 5, "SG", "PG", 76, 181, 27, "R", 0.80, "short", false, false, "Bucket-Getting Sixth Man", false,
        [78, 74, 76, 84, 90, 76, 58, 70, 84, 30, 56, 34, 56, 26, 26, 42, 84, 86, 48, 78, 84, 74],
        [15.0, 2.6, 3.2, 0.430, 0.380, 0.900]),
      p("Kentavious", "Caldwell-Pope", 1, "SG", "SF", 77, 204, 33, "R", 0.80, "short", true, false, "Veteran 3-and-D", false,
        [72, 66, 62, 78, 82, 64, 50, 54, 58, 30, 80, 44, 72, 34, 28, 44, 72, 72, 58, 60, 80, 80],
        [7.5, 2.4, 1.8, 0.450, 0.370, 0.820]),
      p("Dean", "Wade", 45, "PF", "C", 81, 228, 29, "R", 0.06, "short", true, false, "Switchable Stretch Forward", false,
        [70, 62, 56, 76, 72, 60, 56, 54, 50, 40, 74, 64, 56, 52, 40, 62, 64, 64, 68, 60, 78, 76],
        [5.0, 4.0, 1.4, 0.420, 0.360, 0.740]),
      p("Adem", "Bona", 30, "C", "PF", 82, 235, 23, "R", 0.85, "short", false, false, "Vertical Rim Protector", false,
        [69, 74, 30, 25, 62, 62, 84, 40, 36, 46, 52, 76, 50, 82, 72, 68, 70, 70, 74, 88, 72, 60],
        [6.0, 5.2, 0.8, 0.600, 0.000, 0.650]),
      p("Justin", "Edwards", 11, "SF", "SG", 79, 203, 22, "L", 0.82, "short", false, false, "Athletic Wing", false,
        [66, 66, 56, 66, 72, 66, 70, 48, 56, 36, 68, 52, 58, 44, 46, 54, 74, 74, 60, 78, 76, 60],
        [6.0, 3.0, 1.0, 0.450, 0.350, 0.760]),
      p("Jabari", "Walker", 33, "PF", "SF", 79, 214, 24, "L", 0.82, "locs", false, false, "Hustle Forward", false,
        [65, 68, 48, 62, 72, 64, 66, 42, 46, 40, 64, 58, 54, 40, 70, 66, 66, 66, 66, 70, 74, 60],
        [5.0, 3.8, 0.8, 0.440, 0.340, 0.760]),
      p("Labaron", "Philon Jr.", 0, "PG", null, 75, 177, 20, "R", 0.82, "short", false, false, "Rookie Shot-Creator", false,
        [64, 62, 60, 66, 76, 64, 50, 66, 74, 28, 60, 32, 60, 24, 26, 36, 80, 82, 44, 66, 74, 58],
        [4.0, 1.4, 1.8, 0.410, 0.330, 0.780]),
      p("Rayan", "Rupert", 12, "SG", "SF", 78, 193, 22, "L", 0.70, "short", false, false, "Long Perimeter Defender", false,
        [62, 58, 46, 58, 66, 58, 56, 50, 54, 28, 72, 46, 60, 40, 32, 46, 74, 74, 52, 68, 74, 58],
        [2.5, 1.6, 0.8, 0.380, 0.310, 0.700]),
    ],
  }),

  // ───────────────────────── TORONTO ─────────────────────────
  team({
    abbr: "TOR", city: "Toronto", name: "Raptors", conf: "East", div: "Atlantic",
    primary: "#CE1141", secondary: "#000000", accent: "#A1A1A4",
    court: { wood: "#C38E5C", paint: "#CE1141", line: "#FFFFFF" },
    coach: "Darko Rajaković", arena: "",
    players: [
      p("Immanuel", "Quickley", 5, "PG", "SG", 75, 190, 27, "R", 0.82, "short", false, false, "Floater-Heavy Combo Guard", true,
        [80, 76, 76, 82, 88, 78, 50, 76, 80, 32, 70, 38, 66, 26, 38, 54, 82, 84, 54, 64, 88, 80],
        [16.5, 4.4, 5.8, 0.440, 0.370, 0.880]),
      p("RJ", "Barrett", 9, "SG", "SF", 78, 214, 26, "L", 0.86, "short", true, false, "Downhill Slashing Wing", true,
        [81, 84, 70, 74, 70, 84, 78, 70, 76, 56, 62, 50, 54, 32, 46, 62, 76, 78, 76, 72, 86, 76],
        [19.2, 5.6, 4.6, 0.480, 0.360, 0.700]),
      p("Kawhi", "Leonard", 2, "SF", "PF", 79, 225, 35, "R", 0.82, "short", true, false, "Two-Way Midrange Assassin", true,
        [91, 88, 95, 86, 90, 86, 74, 72, 82, 82, 84, 66, 84, 50, 40, 70, 70, 70, 90, 68, 72, 94],
        [27.2, 6.4, 3.6, 0.500, 0.390, 0.900]),
      p("Scottie", "Barnes", 4, "PF", "SF", 79, 237, 25, "R", 0.86, "short", false, false, "All-Around Point Forward", true,
        [88, 86, 72, 68, 76, 86, 82, 84, 80, 66, 84, 76, 84, 76, 70, 80, 80, 82, 82, 80, 90, 86],
        [19.4, 7.6, 5.9, 0.500, 0.320, 0.790]),
      p("Jakob", "Poeltl", 19, "C", null, 84, 245, 31, "R", 0.06, "short", false, false, "Screening Rim Protector", true,
        [77, 84, 40, 20, 56, 70, 72, 66, 40, 70, 46, 82, 56, 78, 86, 82, 52, 52, 84, 58, 72, 82],
        [11.0, 8.2, 2.6, 0.630, 0.000, 0.580]),
      p("Ja'Kobe", "Walter", 14, "SG", "SF", 77, 195, 22, "R", 0.82, "short", false, false, "3-and-D Wing", false,
        [71, 66, 58, 74, 80, 66, 60, 52, 60, 32, 74, 46, 68, 40, 34, 48, 76, 78, 58, 70, 80, 66],
        [9.0, 2.6, 1.4, 0.430, 0.370, 0.810]),
      p("Collin", "Murray-Boyles", 30, "PF", "C", 79, 245, 21, "R", 0.86, "short", false, false, "Defensive Swiss Army Knife", false,
        [72, 76, 40, 44, 62, 72, 68, 62, 52, 60, 76, 76, 70, 64, 66, 66, 68, 68, 84, 70, 78, 74],
        [8.0, 5.4, 1.8, 0.530, 0.280, 0.640]),
      p("Jamal", "Shead", 1, "PG", null, 73, 200, 24, "R", 0.84, "short", false, false, "Bulldog Point of Attack", false,
        [70, 62, 52, 66, 74, 62, 40, 74, 70, 28, 82, 42, 74, 28, 30, 44, 78, 80, 70, 60, 84, 74],
        [6.5, 2.4, 4.6, 0.400, 0.340, 0.760]),
      p("Kyle", "Anderson", 13, "SF", "PF", 81, 230, 33, "L", 0.82, "short", true, false, "Slow-Mo Playmaker", false,
        [68, 74, 58, 58, 72, 70, 44, 74, 64, 56, 64, 60, 62, 56, 40, 62, 50, 50, 66, 48, 66, 84],
        [4.5, 3.2, 2.2, 0.480, 0.330, 0.740]),
      p("Trayce", "Jackson-Davis", 32, "C", "PF", 81, 245, 26, "L", 0.82, "short", false, false, "Lob-Catching Big", false,
        [68, 78, 36, 20, 56, 70, 84, 58, 40, 60, 46, 70, 50, 70, 66, 64, 66, 66, 74, 80, 70, 66],
        [5.0, 4.2, 1.4, 0.640, 0.000, 0.560]),
      p("Jamison", "Battle", 77, "SF", "PF", 79, 220, 25, "R", 0.06, "short", false, false, "Spot-Up Shooter", false,
        [66, 60, 62, 80, 82, 58, 50, 44, 48, 36, 56, 46, 44, 36, 30, 50, 62, 62, 62, 56, 72, 64],
        [5.5, 2.2, 0.6, 0.440, 0.380, 0.830]),
      p("Alijah", "Martin", 55, "SG", null, 74, 210, 24, "R", 0.84, "short", false, false, "Athletic Combo Guard", false,
        [62, 62, 50, 64, 74, 62, 66, 52, 60, 28, 66, 40, 60, 32, 36, 42, 78, 80, 64, 82, 74, 58],
        [3.0, 1.4, 0.8, 0.410, 0.340, 0.740]),
      p("Allen", "Graves", 22, "PF", "SF", 80, 225, 20, "R", 0.06, "short", false, false, "Rookie Stretch Forward", false,
        [62, 64, 52, 66, 70, 62, 58, 54, 52, 40, 60, 58, 58, 52, 52, 58, 66, 66, 62, 66, 72, 62],
        [3.0, 2.2, 0.8, 0.440, 0.350, 0.720]),
    ],
  }),
];
