import type { PlayerData, PlayerRatings, Position, TeamData } from "./types";

// Southwest division, 2026-27 rosters as of 2026-11-07 (standard contracts; two-ways excluded).
// Season lines are 2025-26 per-game stats. Exceptions: Kyrie Irving and Fred VanVleet
// (missed 2025-26 with ACL tears) use 2024-25; 2026 rookies use early 2026-27 numbers.
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

export const TEAMS_5: TeamData[] = [
  team({
    abbr: "DAL", city: "Dallas", name: "Mavericks", conf: "West", div: "Southwest",
    primary: "#00538C", secondary: "#002B5E", accent: "#B8C4CA",
    court: { wood: "#C7955F", paint: "#00538C", line: "#FFFFFF" },
    coach: "Dusty May", arena: "",
    players: [
      p("Kyrie", "Irving", 11, "PG", "SG", 74, 195, 34, "R", 0.55, "short", true, false, "Elite Shot Creator", true,
        [87, 88, 88, 86, 92, 94, 55, 82, 98, 60, 66, 40, 66, 40, 35, 52, 82, 86, 50, 72, 80, 94],
        [24.7, 4.8, 4.6, 0.473, 0.401, 0.916]),
      p("Max", "Christie", 0, "SG", "SF", 77, 190, 23, "R", 0.55, "short", false, false, "3-and-D Wing", true,
        [76, 70, 74, 82, 88, 72, 60, 60, 68, 40, 78, 45, 62, 45, 30, 48, 76, 78, 52, 72, 85, 74],
        [12.3, 3.2, 2.0, 0.441, 0.404, 0.899]),
      p("Cooper", "Flagg", 32, "SF", "PF", 81, 205, 19, "R", 0.05, "short", false, false, "Two-Way Point Forward", true,
        [89, 84, 78, 70, 83, 86, 82, 80, 80, 68, 86, 76, 74, 72, 58, 72, 82, 82, 66, 80, 92, 86],
        [21.0, 6.7, 4.5, 0.468, 0.295, 0.827]),
      p("PJ", "Washington", 25, "PF", "C", 79, 230, 28, "R", 0.8, "short", true, false, "Stretch Glue Forward", true,
        [79, 74, 68, 74, 70, 70, 74, 55, 60, 62, 77, 75, 62, 68, 66, 78, 68, 68, 76, 68, 82, 75],
        [14.2, 7.0, 1.8, 0.450, 0.325, 0.687]),
      p("Daniel", "Gafford", 21, "C", null, 82, 265, 28, "R", 0.85, "short", true, false, "Rim-Running Lob Threat", true,
        [78, 90, 35, 25, 68, 70, 92, 45, 35, 58, 50, 82, 55, 85, 80, 76, 62, 62, 85, 86, 70, 70],
        [9.5, 6.9, 1.1, 0.655, 0.000, 0.683]),
      p("Naji", "Marshall", 3, "SF", "PF", 78, 220, 28, "R", 0.75, "short", true, false, "Slashing Playmaker", false,
        [78, 82, 74, 66, 76, 82, 68, 70, 74, 66, 74, 58, 66, 35, 50, 58, 72, 72, 72, 66, 84, 76],
        [15.2, 4.7, 3.3, 0.510, 0.291, 0.760]),
      p("Zaccharie", "Risacher", 10, "SF", "PF", 80, 200, 21, "L", 0.3, "short", false, false, "Developing 3-and-D Wing", false,
        [74, 70, 66, 76, 66, 72, 74, 52, 62, 45, 72, 55, 60, 52, 45, 55, 76, 76, 55, 76, 84, 70],
        [9.6, 3.8, 1.1, 0.455, 0.368, 0.644]),
      p("Santi", "Aldama", 7, "PF", "C", 84, 215, 25, "L", 0.1, "short", false, false, "Stretch Big", false,
        [77, 76, 72, 74, 68, 72, 66, 68, 62, 64, 66, 72, 58, 66, 64, 76, 62, 62, 62, 62, 80, 76],
        [14.0, 6.7, 2.9, 0.479, 0.350, 0.667]),
      p("Dereck", "Lively II", 2, "C", null, 85, 230, 22, "R", 0.8, "short", false, false, "Rim Protector", false,
        [76, 84, 35, 25, 70, 66, 88, 62, 35, 50, 55, 84, 58, 84, 78, 78, 64, 64, 72, 82, 70, 74],
        [4.3, 5.3, 1.9, 0.611, 0.000, 0.800]),
      p("Caleb", "Martin", 16, "SG", "SF", 77, 205, 31, "R", 0.7, "short", true, false, "Energy Wing", false,
        [71, 68, 66, 70, 66, 70, 70, 58, 64, 45, 74, 55, 66, 45, 45, 52, 76, 76, 64, 76, 80, 72],
        [3.9, 2.5, 1.4, 0.450, 0.351, 0.607]),
      p("Marcus", "Sasser", 8, "PG", null, 73, 195, 26, "R", 0.8, "short", false, false, "Spot-Up Guard", false,
        [70, 66, 72, 78, 85, 68, 40, 66, 76, 32, 66, 35, 60, 30, 25, 40, 82, 84, 55, 66, 78, 68],
        [6.1, 1.3, 2.1, 0.463, 0.391, 1.000]),
      p("Morez", "Johnson Jr.", 14, "C", "PF", 81, 250, 20, "R", 0.85, "short", false, false, "Athletic Rookie Big", false,
        [70, 78, 50, 50, 66, 66, 82, 50, 45, 58, 60, 74, 55, 70, 72, 70, 66, 66, 78, 80, 76, 64],
        [7.4, 3.1, 1.3, 0.561, 0.167, 0.667]),
      p("Sergio", "de Larrea", 55, "PG", "SG", 77, 175, 20, "R", 0.1, "short", false, false, "Rookie Playmaker", false,
        [67, 62, 66, 68, 75, 68, 45, 74, 76, 35, 58, 35, 55, 30, 25, 42, 72, 74, 40, 60, 74, 72],
        [5.3, 2.0, 1.3, 0.500, 0.600, 0.750]),
    ],
  }),
  team({
    abbr: "HOU", city: "Houston", name: "Rockets", conf: "West", div: "Southwest",
    primary: "#CE1141", secondary: "#000000", accent: "#C4CED4",
    court: { wood: "#C4915A", paint: "#CE1141", line: "#FFFFFF" },
    coach: "Ime Udoka", arena: "",
    players: [
      p("Fred", "VanVleet", 5, "PG", null, 72, 197, 32, "R", 0.8, "buzz", true, false, "Floor General", true,
        [81, 70, 74, 80, 85, 70, 35, 84, 84, 40, 82, 45, 82, 40, 30, 50, 76, 78, 66, 60, 84, 92],
        [14.1, 3.7, 5.6, 0.377, 0.345, 0.812]),
      p("Amen", "Thompson", 1, "SG", "SF", 79, 200, 23, "R", 0.8, "short", false, false, "Athletic Lockdown Slasher", true,
        [87, 88, 62, 52, 76, 88, 92, 74, 80, 55, 92, 74, 82, 64, 70, 76, 96, 96, 70, 95, 94, 78],
        [18.3, 7.8, 5.3, 0.534, 0.216, 0.779]),
      p("Kevin", "Durant", 7, "SF", "PF", 83, 240, 38, "R", 0.78, "short", true, false, "Three-Level Scorer", true,
        [91, 90, 98, 88, 88, 86, 68, 76, 82, 88, 70, 64, 55, 66, 35, 64, 66, 66, 58, 60, 82, 96],
        [26.0, 5.5, 4.8, 0.520, 0.413, 0.874]),
      p("Jabari", "Smith Jr.", 10, "PF", "C", 83, 220, 23, "R", 0.75, "short", false, false, "Stretch Defender", true,
        [80, 74, 76, 78, 78, 70, 74, 52, 58, 64, 82, 74, 55, 70, 62, 74, 70, 70, 66, 74, 88, 74],
        [15.8, 6.9, 1.9, 0.450, 0.363, 0.775]),
      p("Alperen", "Şengün", 28, "C", null, 83, 243, 24, "R", 0.15, "short", true, false, "Post Playmaker", true,
        [89, 92, 72, 62, 70, 86, 72, 90, 78, 94, 60, 80, 72, 72, 82, 84, 62, 64, 82, 64, 86, 90],
        [20.4, 8.9, 6.2, 0.519, 0.305, 0.691]),
      p("Tari", "Eason", 17, "PF", "SF", 80, 215, 25, "R", 0.8, "short", false, false, "Hustle Defender", false,
        [77, 76, 58, 70, 77, 74, 76, 50, 60, 50, 82, 74, 80, 60, 78, 70, 76, 78, 72, 78, 84, 70],
        [10.5, 6.3, 1.5, 0.416, 0.358, 0.776]),
      p("Reed", "Sheppard", 15, "PG", "SG", 74, 185, 22, "R", 0.05, "short", false, false, "Sharpshooting Guard", false,
        [76, 64, 72, 84, 80, 68, 40, 70, 76, 30, 72, 40, 82, 50, 30, 42, 84, 86, 40, 70, 82, 76],
        [13.5, 2.9, 3.4, 0.430, 0.394, 0.802]),
      p("Marcus", "Smart", 36, "PG", "SG", 75, 220, 32, "R", 0.75, "short", true, false, "Defensive Pest", false,
        [74, 66, 64, 70, 82, 66, 45, 74, 72, 50, 84, 60, 82, 45, 35, 45, 70, 72, 76, 60, 80, 86],
        [9.3, 2.8, 3.0, 0.395, 0.331, 0.822]),
      p("Clint", "Capela", 30, "C", null, 82, 256, 32, "R", 0.85, "short", true, false, "Rebounding Rim Runner", false,
        [71, 82, 30, 25, 58, 60, 82, 45, 30, 45, 45, 76, 50, 76, 85, 80, 58, 58, 78, 72, 66, 70],
        [3.8, 4.6, 0.7, 0.520, 0.000, 0.577]),
      p("Bogdan", "Bogdanović", 31, "SG", "SF", 77, 225, 34, "R", 0.08, "short", true, false, "Veteran Shooter", false,
        [72, 64, 72, 80, 84, 64, 40, 72, 70, 45, 58, 40, 52, 30, 25, 50, 62, 62, 60, 50, 72, 82],
        [7.4, 2.6, 2.2, 0.388, 0.347, 0.800]),
      p("Steven", "Adams", 12, "C", null, 83, 265, 33, "R", 0.4, "long", true, false, "Bruising Rebounder", false,
        [72, 78, 30, 25, 55, 56, 70, 58, 35, 55, 45, 78, 55, 62, 96, 82, 52, 52, 98, 55, 66, 78],
        [5.8, 8.6, 1.5, 0.504, 0.000, 0.580]),
      p("Jae'Sean", "Tate", 8, "SF", "PF", 76, 230, 31, "R", 0.75, "short", true, false, "Hustle Forward", false,
        [66, 72, 55, 55, 64, 70, 66, 58, 60, 50, 70, 60, 58, 40, 58, 52, 72, 72, 76, 68, 76, 68],
        [2.8, 1.6, 0.5, 0.514, 0.313, 0.636]),
      p("Isaiah", "Crawford", 27, "SF", null, 78, 220, 25, "R", 0.8, "short", false, false, "Athletic Wing", false,
        [64, 64, 55, 58, 74, 64, 64, 48, 54, 40, 66, 50, 55, 45, 45, 45, 72, 72, 64, 70, 72, 62],
        [2.0, 1.1, 0.4, 0.417, 0.231, 0.833]),
    ],
  }),
  team({
    abbr: "MEM", city: "Memphis", name: "Grizzlies", conf: "West", div: "Southwest",
    primary: "#5D76A9", secondary: "#12173F", accent: "#F5B112",
    court: { wood: "#C3925C", paint: "#12173F", line: "#FFFFFF" },
    coach: "Tuomas Iisalo", arena: "",
    players: [
      p("Ty", "Jerome", 2, "PG", "SG", 77, 195, 29, "R", 0.06, "short", true, false, "Crafty Shot Maker", true,
        [82, 80, 84, 84, 88, 80, 45, 80, 82, 50, 66, 40, 70, 35, 30, 45, 72, 74, 52, 56, 76, 86],
        [19.7, 2.8, 5.7, 0.474, 0.420, 0.875]),
      p("Jaylen", "Wells", 0, "SG", "SF", 79, 206, 23, "R", 0.75, "short", false, false, "3-and-D Wing", true,
        [75, 72, 72, 76, 78, 72, 66, 55, 64, 40, 78, 50, 64, 40, 35, 48, 74, 74, 58, 70, 86, 72],
        [12.5, 3.2, 1.6, 0.431, 0.353, 0.784]),
      p("Cedric", "Coward", 23, "SF", "SG", 77, 206, 23, "R", 0.8, "short", false, false, "Two-Way Wing", true,
        [78, 78, 72, 74, 84, 78, 76, 64, 68, 48, 74, 58, 62, 50, 60, 70, 76, 76, 60, 76, 84, 74],
        [13.6, 5.9, 2.8, 0.471, 0.338, 0.843]),
      p("Cameron", "Boozer", 27, "PF", "C", 82, 250, 19, "L", 0.7, "short", false, false, "Bully-Ball Point Forward", true,
        [80, 84, 70, 72, 78, 78, 74, 76, 66, 80, 64, 72, 64, 58, 80, 84, 66, 66, 84, 66, 86, 82],
        [16.5, 9.8, 5.4, 0.364, 0.367, 0.780]),
      p("Zach", "Edey", 14, "C", null, 87, 305, 24, "R", 0.05, "short", false, false, "Paint Beast", true,
        [76, 90, 35, 30, 74, 64, 84, 45, 30, 78, 35, 84, 45, 84, 92, 86, 42, 42, 99, 50, 66, 72],
        [13.6, 11.1, 1.1, 0.633, 0.200, 0.781]),
      p("Jerami", "Grant", 3, "PF", "SF", 79, 213, 32, "R", 0.8, "short", true, false, "Scoring Forward", false,
        [77, 74, 76, 78, 82, 74, 70, 55, 66, 55, 72, 60, 55, 56, 35, 50, 70, 70, 62, 72, 80, 74],
        [18.6, 3.5, 2.1, 0.453, 0.389, 0.814]),
      p("Cam", "Spencer", 24, "SG", "PG", 75, 205, 26, "R", 0.05, "short", false, false, "Sharpshooting Playmaker", false,
        [76, 66, 78, 86, 92, 66, 35, 80, 74, 35, 66, 38, 60, 30, 30, 45, 70, 72, 56, 55, 80, 84],
        [11.1, 2.5, 5.6, 0.473, 0.449, 0.940]),
      p("Isaiah", "Stewart", 28, "C", "PF", 80, 250, 25, "R", 0.85, "short", true, false, "Enforcer Big", false,
        [75, 78, 60, 66, 74, 66, 70, 48, 45, 58, 72, 82, 50, 80, 72, 70, 64, 64, 90, 66, 80, 72],
        [10.0, 5.0, 1.1, 0.550, 0.333, 0.756]),
      p("GG", "Jackson II", 45, "PF", "SF", 81, 210, 21, "R", 0.8, "short", false, false, "Scoring Forward", false,
        [72, 74, 70, 70, 72, 72, 74, 48, 64, 58, 60, 58, 52, 54, 45, 58, 72, 72, 60, 74, 78, 64],
        [12.5, 4.3, 1.5, 0.496, 0.332, 0.742]),
      p("Quinten", "Post", 41, "C", "PF", 84, 238, 26, "R", 0.05, "short", true, false, "Stretch Five", false,
        [70, 70, 70, 74, 78, 62, 58, 60, 45, 58, 48, 66, 45, 58, 55, 66, 54, 54, 66, 54, 74, 72],
        [7.7, 4.0, 1.4, 0.440, 0.336, 0.791]),
      p("Scotty", "Pippen Jr.", 1, "PG", null, 74, 170, 25, "R", 0.7, "short", false, false, "Pesky Speed Guard", false,
        [72, 70, 64, 66, 78, 74, 50, 76, 82, 30, 72, 35, 84, 40, 30, 42, 88, 90, 40, 70, 80, 72],
        [11.4, 2.2, 4.7, 0.448, 0.313, 0.783]),
      p("Kris", "Murray", 17, "SF", "PF", 80, 218, 26, "R", 0.8, "short", false, false, "Role Wing", false,
        [66, 66, 58, 62, 68, 64, 62, 52, 54, 45, 68, 58, 60, 48, 52, 58, 68, 68, 64, 64, 78, 68],
        [5.8, 3.6, 1.4, 0.467, 0.279, 0.684]),
      p("Taylor", "Hendricks", 22, "PF", "C", 81, 215, 22, "R", 0.8, "short", false, false, "Switchable Stretch Big", false,
        [68, 68, 60, 68, 64, 64, 70, 45, 52, 45, 68, 66, 66, 68, 50, 60, 72, 72, 60, 76, 76, 64],
        [10.6, 4.7, 1.2, 0.463, 0.342, 0.650]),
    ],
  }),
  team({
    abbr: "NOP", city: "New Orleans", name: "Pelicans", conf: "West", div: "Southwest",
    primary: "#0C2340", secondary: "#C8102E", accent: "#85714D",
    court: { wood: "#C08E58", paint: "#0C2340", line: "#FFFFFF" },
    coach: "Jamahl Mosley", arena: "",
    players: [
      p("Dejounte", "Murray", 5, "PG", "SG", 76, 180, 30, "R", 0.8, "braids", false, false, "Two-Way Playmaker", true,
        [80, 76, 80, 70, 86, 80, 50, 80, 84, 52, 78, 50, 90, 40, 50, 66, 78, 78, 50, 66, 84, 82],
        [16.7, 5.4, 6.4, 0.484, 0.306, 0.867]),
      p("Jeremiah", "Fears", 0, "SG", "PG", 75, 190, 20, "R", 0.75, "short", false, false, "Downhill Shot Creator", true,
        [76, 76, 66, 68, 78, 80, 55, 70, 86, 35, 66, 40, 72, 40, 35, 48, 88, 90, 48, 72, 84, 68],
        [14.3, 3.7, 3.4, 0.434, 0.330, 0.789]),
      p("Trey", "Murphy III", 25, "SF", "PF", 80, 206, 26, "R", 0.7, "short", false, false, "High-Flying Sniper", true,
        [84, 78, 80, 85, 88, 78, 82, 64, 70, 50, 78, 58, 78, 50, 45, 60, 80, 80, 58, 84, 86, 78],
        [21.5, 5.7, 3.8, 0.470, 0.379, 0.886]),
      p("Zion", "Williamson", 1, "PF", null, 78, 284, 26, "L", 0.85, "buzz", false, false, "Paint Bulldozer", true,
        [86, 96, 58, 40, 72, 92, 96, 72, 78, 82, 60, 62, 62, 50, 74, 64, 80, 84, 96, 86, 70, 80],
        [21.0, 5.7, 3.2, 0.600, 0.250, 0.716]),
      p("Karlo", "Matković", 17, "C", "PF", 82, 231, 25, "R", 0.08, "short", true, false, "Stretch Rim Runner", true,
        [69, 76, 58, 68, 72, 64, 70, 48, 40, 52, 52, 68, 48, 66, 64, 64, 60, 60, 68, 66, 72, 70],
        [5.7, 3.7, 0.8, 0.604, 0.422, 0.732]),
      p("Saddiq", "Bey", 41, "SF", "PF", 80, 215, 27, "R", 0.8, "short", true, false, "Scoring Wing", false,
        [79, 76, 72, 77, 84, 76, 66, 58, 66, 58, 66, 55, 58, 32, 52, 62, 70, 70, 68, 64, 82, 74],
        [17.7, 5.6, 2.5, 0.451, 0.367, 0.841]),
      p("Derik", "Queen", 22, "C", "PF", 81, 250, 21, "L", 0.85, "short", false, false, "Playmaking Big", false,
        [76, 82, 62, 52, 78, 78, 72, 74, 74, 78, 58, 70, 62, 64, 70, 76, 68, 70, 78, 66, 82, 74],
        [11.7, 7.1, 3.7, 0.473, 0.261, 0.795]),
      p("Herbert", "Jones", 2, "SF", "PF", 79, 206, 28, "R", 0.8, "short", true, false, "Lockdown Defender", false,
        [76, 68, 60, 68, 80, 66, 62, 62, 62, 40, 92, 66, 88, 62, 40, 52, 74, 74, 62, 70, 86, 80],
        [8.9, 3.4, 2.8, 0.383, 0.309, 0.806]),
      p("Bennedict", "Mathurin", 24, "SG", "SF", 77, 210, 24, "L", 0.75, "short", false, false, "Explosive Scorer", false,
        [78, 78, 70, 75, 88, 80, 80, 54, 70, 50, 60, 45, 50, 30, 50, 60, 80, 80, 68, 82, 80, 68],
        [17.8, 5.4, 2.3, 0.433, 0.372, 0.884]),
      p("Yves", "Missi", 21, "C", null, 83, 235, 22, "R", 0.9, "short", false, false, "Rim Protector", false,
        [71, 78, 35, 25, 56, 60, 84, 48, 35, 45, 55, 78, 45, 82, 74, 72, 70, 70, 74, 86, 74, 64],
        [5.7, 5.8, 1.3, 0.544, 0.000, 0.559]),
      p("Jordan", "Poole", 3, "SG", "PG", 76, 194, 27, "R", 0.65, "braids", false, false, "Microwave Scorer", false,
        [75, 70, 72, 76, 88, 76, 50, 70, 86, 35, 52, 35, 55, 40, 30, 40, 80, 82, 45, 66, 80, 64],
        [13.4, 2.0, 3.1, 0.372, 0.333, 0.860]),
      p("Trendon", "Watford", 9, "PF", "SF", 80, 244, 25, "R", 0.8, "short", false, false, "Point Forward", false,
        [70, 74, 62, 50, 76, 72, 64, 70, 66, 62, 58, 56, 45, 45, 55, 62, 64, 64, 72, 60, 72, 72],
        [6.5, 3.3, 2.5, 0.515, 0.200, 0.779]),
      p("DeAndre", "Jordan", 6, "C", null, 83, 265, 38, "R", 0.85, "short", true, false, "Veteran Rebounder", false,
        [64, 78, 25, 25, 60, 52, 76, 48, 30, 42, 35, 70, 40, 66, 76, 82, 45, 45, 85, 55, 55, 72],
        [4.4, 6.3, 0.9, 0.656, 0.000, 0.647]),
    ],
  }),
  team({
    abbr: "SAS", city: "San Antonio", name: "Spurs", conf: "West", div: "Southwest",
    primary: "#000000", secondary: "#C4CED4", accent: "#8A8D8F",
    court: { wood: "#C9975F", paint: "#1A1A1A", line: "#C4CED4" },
    coach: "Mitch Johnson", arena: "",
    players: [
      p("De'Aaron", "Fox", 4, "PG", null, 75, 185, 28, "R", 0.8, "short", true, false, "Blur Slasher", true,
        [86, 86, 78, 74, 78, 92, 66, 84, 90, 45, 74, 42, 78, 40, 35, 48, 96, 96, 50, 78, 86, 86],
        [18.6, 3.8, 6.2, 0.486, 0.332, 0.760]),
      p("Dylan", "Harper", 2, "SG", "PG", 77, 215, 20, "L", 0.7, "short", false, false, "Crafty Downhill Guard", true,
        [84, 86, 78, 76, 80, 90, 66, 80, 86, 55, 70, 48, 66, 45, 45, 58, 82, 84, 66, 70, 86, 84],
        [11.8, 3.4, 3.9, 0.505, 0.343, 0.756]),
      p("Devin", "Vassell", 24, "SF", "SG", 77, 200, 26, "R", 0.75, "short", false, false, "3-and-D Wing", true,
        [78, 70, 78, 80, 82, 72, 62, 62, 72, 45, 76, 48, 66, 45, 35, 52, 74, 76, 56, 70, 84, 76],
        [13.9, 4.0, 2.5, 0.437, 0.384, 0.815]),
      p("Stephon", "Castle", 5, "SF", "SG", 78, 215, 22, "R", 0.8, "short", false, false, "Two-Way Point Wing", true,
        [84, 84, 66, 70, 74, 86, 80, 82, 80, 60, 88, 64, 70, 45, 50, 62, 82, 82, 80, 76, 88, 80],
        [16.7, 5.3, 7.4, 0.471, 0.332, 0.734]),
      p("Victor", "Wembanyama", 1, "C", "PF", 88, 235, 22, "R", 0.8, "short", false, false, "Generational Unicorn", true,
        [97, 92, 80, 78, 82, 86, 94, 70, 72, 80, 86, 99, 70, 99, 76, 94, 74, 72, 70, 88, 84, 88],
        [25.0, 11.5, 3.1, 0.512, 0.349, 0.827]),
      p("Julian", "Champagnie", 30, "SF", "PF", 79, 217, 25, "R", 0.75, "short", false, false, "Spot-Up Wing", false,
        [75, 66, 68, 80, 84, 66, 62, 50, 56, 45, 72, 58, 58, 50, 55, 66, 68, 68, 62, 66, 86, 74],
        [11.1, 5.8, 1.5, 0.437, 0.381, 0.844]),
      p("Keldon", "Johnson", 3, "PF", "SF", 78, 220, 27, "R", 0.8, "short", false, false, "Downhill Energy Forward", false,
        [75, 82, 66, 72, 78, 80, 76, 52, 64, 55, 62, 55, 52, 30, 55, 64, 74, 76, 78, 72, 82, 70],
        [13.2, 5.4, 1.4, 0.519, 0.363, 0.794]),
      p("Luke", "Kornet", 7, "C", null, 85, 250, 31, "R", 0.05, "long", true, false, "Drop-Coverage Big", false,
        [72, 84, 40, 25, 80, 62, 70, 62, 35, 50, 50, 80, 45, 80, 72, 74, 54, 54, 70, 60, 72, 80],
        [6.5, 6.1, 1.9, 0.643, 0.000, 0.825]),
      p("Harrison", "Barnes", 40, "PF", "SF", 79, 225, 34, "R", 0.8, "short", true, false, "Veteran Stretch Forward", false,
        [73, 70, 74, 78, 84, 70, 58, 55, 58, 58, 64, 58, 50, 35, 40, 52, 62, 62, 70, 56, 86, 82],
        [9.9, 2.8, 1.9, 0.456, 0.388, 0.829]),
      p("Tobias", "Harris", 12, "PF", "SF", 80, 226, 34, "R", 0.75, "short", true, false, "Veteran Scoring Forward", false,
        [74, 74, 76, 74, 86, 72, 60, 62, 64, 64, 64, 60, 58, 44, 45, 62, 62, 62, 72, 58, 80, 80],
        [13.3, 5.1, 2.5, 0.469, 0.368, 0.866]),
      p("Carter", "Bryant", 11, "PF", "SF", 78, 220, 20, "L", 0.75, "short", false, false, "Athletic Defensive Forward", false,
        [67, 64, 55, 68, 68, 64, 70, 48, 54, 40, 72, 60, 58, 58, 45, 52, 74, 74, 64, 78, 76, 64],
        [4.2, 2.5, 0.7, 0.408, 0.335, 0.714]),
      p("Jordan", "McLaughlin", 0, "PG", null, 71, 185, 30, "R", 0.75, "short", false, false, "Backup Floor General", false,
        [64, 58, 62, 70, 80, 62, 30, 76, 74, 25, 64, 30, 70, 25, 25, 35, 78, 80, 40, 55, 72, 78],
        [2.0, 0.7, 0.9, 0.418, 0.425, 0.857]),
      p("Tarris", "Reed Jr.", 10, "C", null, 83, 265, 23, "R", 0.85, "short", false, false, "Rookie Interior Big", false,
        [67, 78, 40, 25, 62, 62, 80, 50, 35, 64, 50, 74, 50, 74, 76, 72, 58, 58, 84, 70, 72, 64],
        [2.5, 3.8, 0.0, 0.800, 0.000, 1.000]),
    ],
  }),
];
