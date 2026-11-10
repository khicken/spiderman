import type { CoachView, GameEvent, HudSnapshot, V3 } from "./contracts";
import { COURT } from "./contracts";
import type { Act } from "./ui-glyphs";
import type { DefBtn, Probe, ProbeBtn } from "./tutorial-input";

// v2 onboarding: the Learn to Play steps. Part 1 runs on the empty practice court (mode "practice"), part 2 is the
// defense drill (MatchSetup.drill "defense1v1", or a Rookie scrimmage when the sim ignores the drill).
// Each step owns a progress counter; it is done when progress reaches `goal`.

export type Part = "offense" | "defense";
export type PromptBit = string | { a: Act };

export type StepCtx = {
  h: HudSnapshot | null;
  coach: CoachView | undefined;
  probe: Probe;
  userSlot: number;
  userTeam: number;
  defense: boolean; // the other team has the ball
  attempts: number; // presses / tries counted by this step so far
};

/** Result of an input or event: progress to add, and an optional feedback line. */
export type Hit = { add?: number; say?: string; tone?: "good" | "bad" | "info"; attempt?: boolean } | null;

export type Step = {
  id: string;
  part: Part;
  title: string;
  prompt: PromptBit[];
  tip: string;
  goal: number;
  unit: "sec" | "count";
  spot?: V3; // tutorial floor target (Game.setCoachSpot), attack-relative: +x toward the basket the user attacks
  /** Give the ball back to the same user player here when the step starts (attack-relative, Game.practiceGive). */
  startAt?: V3;
  /** Prompt to use instead of `prompt` in this context (e.g. no floor spot without the game hook). */
  alt?(c: StepCtx): PromptBit[] | null;
  /** Called at HUD rate (10 Hz). Return seconds of progress to add. */
  tick?(c: StepCtx, dt: number): number;
  event?(e: GameEvent, c: StepCtx): Hit;
  press?(b: ProbeBtn, def: DefBtn | null, c: StepCtx): Hit;
  /** Shown instead of the prompt while the step cannot be done yet (e.g. waiting for the other team's ball). */
  wait?(c: StepCtx): PromptBit[] | null;
  done: string; // success line
};

let blockPressAt = -1e9;

const LAYUPS = new Set(["layup", "reverseLayup", "dunk", "floater", "alleyOopDunk", "alleyOopLayup", "hook", "putback", "tip"]);

const GRADE_SAY: Record<string, [string, "good" | "bad"]> = {
  early: ["Too early. Wait until the bar reaches the gold notch.", "bad"],
  late: ["Too late. Let go right as the bar hits the gold notch.", "bad"],
  slightlyEarly: ["Close. A touch early: hold a little longer.", "bad"],
  slightlyLate: ["Close. A touch late: let go a little sooner.", "bad"],
};

export const STEPS: Step[] = [
  {
    id: "move",
    part: "offense",
    title: "Move",
    prompt: [{ a: "move" }, " Move to the cyan circle on the floor"],
    alt: (c) => (c.coach && c.coach.spotDist >= 0 ? null : [{ a: "move" }, " Move your player around"]),
    tip: "You are the player under the gold YOU arrow. You keep this player for the whole offense drill.",
    goal: 2,
    unit: "sec",
    startAt: { x: COURT.rimX - 11, y: 0, z: -1.5 }, // just over half court
    spot: { x: COURT.rimX - 5.5, y: 0, z: 3.5 }, // the right wing, inside the arc: where the jumper drill shoots from
    tick(c, dt) {
      const moving = c.probe.moving || (c.coach?.speed ?? 0) > 1;
      // the spot finishes it at once; plain movement finishes it too (slower) in case the spot is off screen
      if (c.coach && c.coach.spotDist >= 0) return c.coach.spotDist < 1.6 ? 9 : moving ? dt * 0.5 : 0;
      return moving ? dt : 0;
    },
    done: "That's your player. Wherever you go, the YOU arrow goes.",
  },
  {
    id: "sprint",
    part: "offense",
    title: "Sprint",
    prompt: ["Hold ", { a: "sprint" }, " while moving with ", { a: "move" }],
    tip: "Sprinting is faster but drains stamina. Save it for fast breaks and drives.",
    goal: 1.5,
    unit: "sec",
    tick(c, dt) {
      return c.probe.sprinting || c.coach?.sprinting ? dt : 0;
    },
    done: "Turbo on. Watch the energy bar on your player card.",
  },
  {
    id: "jumper",
    part: "offense",
    title: "Shoot",
    prompt: ["Hold ", { a: "shoot" }, " to rise, let go at the gold notch"],
    startAt: { x: COURT.rimX - 5.5, y: 0, z: 3.5 }, // a normal midrange jumper on the wing
    tip: "The meter fills while you hold. Release on the gold notch for a green release: in practice, green always goes in.",
    goal: 1,
    unit: "count",
    event(e, c) {
      if (e.type !== "meter" || e.slot !== c.userSlot) return null;
      if (e.grade === "perfect") return { add: 1, say: "Green release!", tone: "good", attempt: true };
      if ((e.grade === "slightlyEarly" || e.grade === "slightlyLate") && c.attempts >= 4)
        return { add: 1, say: "Good release. Keep chasing green in practice.", tone: "good", attempt: true };
      const g = GRADE_SAY[e.grade];
      return g ? { say: g[0], tone: g[1], attempt: true } : null;
    },
    done: "Green means perfect timing. Open shots plus green releases win games.",
  },
  {
    id: "layup",
    part: "offense",
    title: "Layup or dunk",
    prompt: ["Drive at the rim, then hold ", { a: "shoot" }, " close to it"],
    startAt: { x: COURT.rimX - 7.6, y: 0, z: 0 }, // top of the key, a real drive away
    alt: (c) => {
      const x = c.coach?.attackScreenX ?? 0;
      if (Math.abs(x) < 0.15) return null;
      return [`Drive at the ${x < 0 ? "◀ left" : "right ▶"} rim, then hold `, { a: "shoot" }, " close to it"];
    },
    tip: "Same button, different shot: near the basket your player lays it up or dunks. Add sprint to attack harder.",
    goal: 1,
    unit: "count",
    event(e, c) {
      if (e.type !== "shot" || e.slot !== c.userSlot) return null;
      if (LAYUPS.has(e.kind)) return { add: 1, say: e.kind === "dunk" ? "Slam!" : "Off the glass!", tone: "good" };
      return { say: "That was a jump shot. Get inside the painted lane first, then hold shoot.", tone: "bad" };
    },
    done: "Attack the rim when the lane is open: it's the best shot in the game.",
  },
  {
    id: "pass",
    part: "offense",
    title: "Pass",
    prompt: ["Point ", { a: "move" }, " at a teammate and press ", { a: "pass" }],
    startAt: { x: COURT.rimX - 7.6, y: 0, z: 0 },
    tip: "The pass goes to the teammate in the direction you push. Hold the icon button to pick a man by his button.",
    goal: 2,
    unit: "count",
    event(e, c) {
      if (e.type === "pass" && e.from === c.userSlot) return { add: 1, say: "Good pass. He'll kick it back.", tone: "good" };
      return null;
    },
    done: "Ball movement finds open shots. Look for the most open man.",
  },
  {
    id: "dribble",
    part: "offense",
    title: "Dribble move",
    prompt: ["Flick ", { a: "dribble" }, " to cross over, spin or step back"],
    tip: "Flick across your body for a crossover, toward the rim for a spin, away from it for a step-back.",
    goal: 2,
    unit: "count",
    event(e, c) {
      if (e.type === "dribbleMove" && e.slot === c.userSlot) {
        const n: Record<string, string> = { crossover: "Crossover!", behindBack: "Behind the back!", spin: "Spin move!", stepBack: "Step-back!", hesitation: "Hesi!", between: "Between the legs!" };
        return { add: 1, say: n[e.move] ?? "Nice move!", tone: "good" };
      }
      return null;
    },
    done: "Moves shake defenders. Chain one into a drive or a step-back jumper.",
  },
  {
    id: "switch",
    part: "defense",
    title: "Switch player",
    prompt: ["Press ", { a: "switch" }, " to switch to the man guarding the ball"],
    tip: "On defense you pick who you control. The ring under your feet shows him; the red ring marks YOUR MAN.",
    goal: 1,
    unit: "count",
    wait: (c) => (c.defense ? null : ["They inbound. Get ready to press ", { a: "switch" }]),
    event(e, c) {
      if (e.type === "userSwitch" && c.defense) return { add: 1, say: "Switched. Your ring moved to the new man.", tone: "good" };
      return null;
    },
    press(_b, def, c) {
      if (def === "switch" && c.defense) return { add: 1, say: "Switched. Now guard the ball.", tone: "good" };
      return null;
    },
    done: "Always know who you control: look for the gold ring.",
  },
  {
    id: "front",
    part: "defense",
    title: "Stay in front",
    prompt: ["Hold ", { a: "intense" }, " for intense D, slide with ", { a: "move" }, " to stay in front"],
    tip: "Stay between YOUR MAN (red ring) and the rim. Don't chase the ball: keep your body in his path.",
    goal: 6,
    unit: "sec",
    wait: (c) => (c.defense ? null : ["Next time they have it: hold ", { a: "intense" }]),
    tick(c, dt) {
      if (!c.defense || c.h?.phase !== "live") return 0;
      if (c.coach && c.coach.markDist >= 0) return c.coach.markDist < 2.4 ? dt : 0;
      return c.probe.moving ? dt : dt * 0.5;
    },
    done: "Good position stops most drives before they start.",
  },
  {
    id: "steal",
    part: "defense",
    title: "Steal",
    prompt: ["Get close to the dribbler and press ", { a: "steal" }, " to steal"],
    tip: "Reach when the dribbler is in front of you. Reaching from behind is a foul.",
    goal: 1,
    unit: "count",
    wait: (c) => (c.defense ? null : ["Next time they have it: ", { a: "steal" }, " steals"]),
    event(e, c) {
      if ((e.type === "steal" || e.type === "deflection") && e.by === c.userSlot) return { add: 1, say: e.type === "steal" ? "Picked clean!" : "Deflected!", tone: "good" };
      if (e.type === "foul" && e.by === c.userSlot && e.kind === "reach") return { say: "Reach-in foul. Time it when he's in front of you.", tone: "bad" };
      return null;
    },
    press(_b, def, c) {
      if (def !== "steal" || !c.defense) return null;
      if (c.attempts >= 3) return { add: 1, say: "That's the move. Steals are about timing, not spamming.", tone: "good", attempt: true };
      const far = c.coach && c.coach.ballDist > 1.8;
      return { say: far ? "Too far. Get closer to the ball first." : "Missed the reach. Try again.", tone: "info", attempt: true };
    },
    done: "Gamble less, steal more: reach only when you're in front.",
  },
  {
    id: "stop",
    part: "defense",
    title: "Block and contest",
    prompt: ["When he rises to shoot, press ", { a: "block" }, " to block or contest"],
    tip: "Contest every shot. Even without a block, a hand in his face lowers his chance.",
    goal: 1,
    unit: "count",
    wait: (c) => (c.defense ? null : ["Next time they have it: ", { a: "block" }, " contests"]),
    press(_b, def, c) {
      if (def === "block" && c.defense) blockPressAt = performance.now();
      return null;
    },
    event(e, c) {
      if (e.type === "block" && e.by === c.userSlot) return { add: 1, say: "Rejected!", tone: "good" };
      // a contest in the window is the lesson, whatever the shot does after
      if (e.type === "shot" && e.team !== c.userTeam && e.contest > 0.3 && performance.now() - blockPressAt < 1300)
        return { add: 1, say: "Good contest! Hand in his face.", tone: "good" };
      if (e.type === "miss" && e.team !== c.userTeam) return { add: 1, say: "Stop! Your contest forced a miss.", tone: "good" };
      if (e.type === "turnover" && e.team !== c.userTeam) return { add: 1, say: "Stop! They turned it over.", tone: "good" };
      if (e.type === "make" && e.team !== c.userTeam) return { say: "He scored. Jump earlier, right as he rises.", tone: "bad" };
      return null;
    },
    done: "That's a stop. Now you know both ends of the floor.",
  },
];

export const OFFENSE_STEPS = STEPS.filter((s) => s.part === "offense").length;
