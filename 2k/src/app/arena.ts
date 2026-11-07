import * as THREE from "three";
import type { Arena, Dir, GameEvent, Quality, Render, SimView, TeamData, TeamSide } from "./contracts";
import { QUALITY } from "./contracts";
import { createBoards, type RibbonTone, type ScoreboardInfo } from "./arena-boards";
import { createBowl } from "./arena-bowl";
import { createCourt } from "./arena-court";
import { createHoops } from "./arena-hoop";
import { createFloorReflection } from "./arena-reflect";
import { whenFontsReady } from "./arena-tex";
import { isRenderPlus } from "./render";
import { periodLabel } from "./state";

export type { ScoreboardInfo, RibbonTone };
export { bowlHeightAt } from "./arena-bowl";

/** Arena plus the extra hooks other modules (or the integrator) may call. All optional to use. */
export type ArenaPlus = Arena & {
  /** Sustained crowd excitement floor 0..1 (the sim's state.hype is used when higher). */
  setCrowdHype(h: number): void;
  /** Override the center-hung / scoreboard content (null = automatic from the sim, or idle in menus). */
  setScoreboard(info: ScoreboardInfo | null): void;
  /** Kick a net: swish snap / rim-in ripple / dunk yank. side = basket x sign. */
  netKick(side: Dir, strength: number, kind?: "swish" | "rim" | "dunk"): void;
  rimHit(side: Dir, strength: number): void;
  /** Takeover message on LED ribbons + the hung board. */
  ledMessage(text: string, tone?: RibbonTone, secs?: number): void;
  /** Crowd burst for a team's fans (0 home, 1 away). */
  crowdCheer(team: TeamSide, strength: number): void;
  readonly fanCount: number;
};

export function createArena(render: Render, home: TeamData, away: TeamData, quality: Quality): ArenaPlus {
  const group = new THREE.Group();
  group.name = "arena";
  const plus = isRenderPlus(render) ? render : null;
  let q = quality;
  let teams: [TeamData, TeamData] = [home, away];

  const reflection = createFloorReflection();
  const court = createCourt(render.renderer, home, away, q, reflection);
  const hoops = createHoops(home, away);
  const boards = createBoards(home, away);
  const bowl = createBowl(home, away, QUALITY[q].crowd, QUALITY[q].crowdAnim, boards.ribbonMat);
  group.add(court.mesh, court.surround, hoops.group, boards.group, bowl.group);
  render.scene.add(group);

  const unhook = render.onBeforeRender((r, s, c) => {
    if (reflection.enabled) reflection.render(r, s, c, court.mesh);
  });

  function applyQuality() {
    const p = QUALITY[q];
    reflection.enabled = p.floorReflection === "planar";
    reflection.scale = Math.max(0.25, p.floorReflectionScale);
    court.setQuality(q, reflection);
    bowl.setDensity(p.crowd, p.crowdAnim);
    bowl.setHaze(p.bloom && p.shadow >= 2048);
  }
  applyQuality();

  const offFonts = whenFontsReady(() => {
    court.paint(teams[0], teams[1]);
    boards.setTeams(teams[0], teams[1]);
    hoops.setTeams(teams[0], teams[1]);
  });

  let time = 0;
  let manualHype = 0;
  let override: ScoreboardInfo | null = null;
  let lastPeriod = -1;
  let periodStr = "";
  const auto: ScoreboardInfo = {
    home, away, score: [0, 0], period: "1ST", clock: 0, shotClock: 24, shotClockOn: true,
    fouls: [0, 0], timeouts: [0, 0], bonus: [false, false], possession: -1,
  };
  let fanBoost = 0;
  let chantBoost = 0;

  function toneOf(team: TeamSide): RibbonTone {
    return team === 0 ? "home" : "away";
  }

  const arena: ArenaPlus = {
    group,
    get fanCount() {
      return bowl.fans;
    },
    setTeams(h, a) {
      teams = [h, a];
      court.paint(h, a);
      hoops.setTeams(h, a);
      bowl.setTeams(h, a);
      boards.setTeams(h, a);
      auto.home = h;
      auto.away = a;
    },
    update(dt, view: SimView | null) {
      time += dt;
      manualHype = Math.max(0, manualHype - dt * 0.02);
      fanBoost = Math.max(0, fanBoost - dt * 0.15);
      const st = view?.state;
      const hype = Math.min(1, Math.max(st ? st.hype : 0.28, manualHype) + fanBoost);
      bowl.hype = hype;
      chantBoost = Math.max(0, chantBoost - dt);
      bowl.chant = st && st.phase === "live" && st.possession === 1 && (hype > 0.3 || chantBoost > 0) ? Math.min(1, 0.4 + hype) : 0;
      bowl.update(dt, time, view ? view.ball.pos : null);
      hoops.update(dt, view, time);
      if (override) boards.setScoreboard(override);
      else if (st && view) {
        if (st.period !== lastPeriod) {
          lastPeriod = st.period;
          periodStr = periodLabel(st.period);
        }
        auto.score[0] = st.score[0];
        auto.score[1] = st.score[1];
        auto.period = st.phase === "final" ? "FINAL" : periodStr;
        auto.clock = st.clock;
        auto.shotClock = st.shotClock;
        auto.shotClockOn = st.shotClockOn;
        auto.fouls[0] = st.teamFouls[0];
        auto.fouls[1] = st.teamFouls[1];
        auto.timeouts[0] = st.timeouts[0];
        auto.timeouts[1] = st.timeouts[1];
        auto.bonus[0] = st.bonus[0];
        auto.bonus[1] = st.bonus[1];
        auto.possession = st.possession;
        boards.setScoreboard(auto);
      } else boards.setScoreboard(null);
      boards.update(dt, time, hype);
    },
    handle(events: readonly GameEvent[]) {
      hoops.handle(events);
      for (const e of events) {
        switch (e.type) {
          case "make": {
            const big = e.points === 3 ? 0.85 : e.kind === "dunk" || e.kind === "alleyOopDunk" ? 1 : 0.55;
            bowl.cheer(e.team, big + (e.andOne ? 0.2 : 0));
            if (e.team === 1) bowl.groan(0.4);
            if (e.andOne) boards.flash("AND ONE", toneOf(e.team), 2.5);
            else if (e.points === 3) boards.flash("3 POINTER", toneOf(e.team), 2.5);
            else if (e.kind === "alleyOopDunk" || e.kind === "alleyOopLayup") boards.flash("ALLEY-OOP", toneOf(e.team), 2.5);
            break;
          }
          case "dunk":
            bowl.cheer(e.slot < 5 ? 0 : 1, 1.1);
            boards.flash("SLAM", e.slot < 5 ? "home" : "away", 2.5);
            plus?.flash("#ffffff", 0.18);
            break;
          case "block":
            bowl.cheer(e.by < 5 ? 0 : 1, 0.9);
            boards.flash("REJECTED", e.by < 5 ? "home" : "away", 2.2);
            break;
          case "steal":
            bowl.cheer(e.by < 5 ? 0 : 1, 0.6);
            break;
          case "ankleBreaker":
            bowl.cheer(e.by < 5 ? 0 : 1, 1);
            boards.flash("OHHHH", "hot", 2);
            break;
          case "miss":
            if (e.team === 0) bowl.groan(e.airball ? 0.8 : 0.35);
            else bowl.cheer(0, 0.25);
            if (e.airball && e.team === 1) boards.flash("AIRBALL", "home", 2);
            break;
          case "streak":
            if (e.level >= 1) boards.flash("ON FIRE", "hot", 3);
            break;
          case "timeout":
            boards.flash("TIMEOUT", toneOf(e.team), 4);
            break;
          case "periodEnd":
            boards.flash(e.period === 2 ? "HALFTIME" : `END OF ${periodLabel(e.period)}`, "neutral", 4);
            break;
          case "gameEnd":
            boards.flash("FINAL", toneOf(e.winner), 8);
            bowl.cheer(e.winner, 1.2);
            break;
          case "crowdHype":
            fanBoost = Math.max(fanBoost, e.level * 0.2);
            break;
          case "crowd":
            if (e.reaction === "defense") chantBoost = 4;
            else if (e.reaction === "boo" || e.reaction === "groan" || e.reaction === "aww") bowl.groan(e.strength);
            else bowl.cheer(0, e.strength * 0.8);
            break;
          case "tipoff":
            bowl.cheer(e.winner, 0.5);
            break;
        }
      }
    },
    setQuality(nq) {
      q = nq;
      applyQuality();
    },
    setCrowdHype(h) {
      manualHype = Math.min(1, Math.max(0, h));
    },
    setScoreboard(info) {
      override = info;
    },
    netKick(side, strength, kind) {
      hoops.netKick(side, strength, kind);
    },
    rimHit(side, strength) {
      hoops.rimHit(side, strength);
    },
    ledMessage(text, tone = "neutral", secs = 3) {
      boards.flash(text, tone, secs);
    },
    crowdCheer(team, strength) {
      bowl.cheer(team, strength);
    },
    dispose() {
      offFonts();
      unhook();
      render.scene.remove(group);
      reflection.dispose();
      court.dispose();
      hoops.dispose();
      boards.dispose();
      bowl.dispose();
    },
  };
  return arena;
}
