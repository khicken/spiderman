"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type {
  BroadcastCue, GameEvent, HudHandle, HudPlayer, HudSnapshot, HudTeam, MeterGrade, MeterView, ScreenTag, ShotKind, ShotQuality, TeamData,
  TeamSide,
} from "./contracts";
import { BroadcastLayer, NO_CUES, applyCue, expireCues, type CueState } from "./ui-broadcast";
import { Face, type PadFamily } from "./ui-glyphs";
import { alpha, cx, fmtClock, fmtShot, inkOn, mix, vivid } from "./ui-kit";
import { ActionBar, AttackFlash, CoachChip, ControlsCard, EdgeArrow, IntroCard, PossessionChip, attackSide } from "./ui-coach";
import { acquireProbe, defenseOf, type DefBtn } from "./tutorial-input";
import { FOUL_TITLE, FOUL_WHY, TOV_TITLE, TOV_WHY, newPromptMemo, pickPrompt, type Prompt } from "./tutorial-prompts";
import { readOnboarding, writeOnboarding } from "./tutorial-store";

// In-game HUD. React renders at HUD_HZ from the snapshot; the meter and floating tags are written per frame via refs.
// v2 onboarding: whistle cards say why play stopped, the user marker is a YOU tag, the meter teaches timing, and a
// coach layer (action bar, prompts, possession chip, attack arrows) runs while hints are on.

type Banner = { id: number; text: string; sub?: string; color: string; big?: boolean; tag?: string; why?: string; fix?: string; ms?: number };
type Feed = { id: number; text: string; color: string; pts?: number };
type Chip = { id: number; text: string; tone: "good" | "bad" | "info" };

const QUIET = new Set<GameEvent["type"]>([
  "dribble", "squeak", "bump", "catch", "pass", "bounce", "rim", "backboard", "net", "swish", "rumble", "shake", "crowd",
  "shotStart", "shot", "deflection", "dribbleMove", "screen", "screenCall", "whistle", "userSwitch", "meter", "inbound",
  "possession", "freeThrowStart", "buzzer",
]);

const KIND: Record<ShotKind, string> = {
  jumper: "jumper", pullUp: "pull-up", stepBack: "step-back", fadeaway: "fadeaway", three: "three", layup: "layup",
  reverseLayup: "reverse layup", floater: "floater", hook: "hook shot", dunk: "dunk", alleyOopDunk: "alley-oop slam",
  alleyOopLayup: "alley-oop layup", putback: "putback", freeThrow: "free throw", tip: "tip-in",
};

const STOPPAGE = new Set(["outOfBounds", "travel", "shotClock", "backcourt", "eightSeconds", "threeSeconds", "fiveSeconds"]);

const SLAMS = ["SLAM", "HAMMERED HOME", "THROWN DOWN", "RIM ROCKER"];

const GRADE: Record<Exclude<MeterGrade, "none">, [string, string, string]> = {
  perfect: ["EXCELLENT", "GREEN RELEASE", "var(--color-good)"],
  slightlyEarly: ["GOOD", "SLIGHTLY EARLY", "var(--color-gold)"],
  slightlyLate: ["GOOD", "SLIGHTLY LATE", "var(--color-gold)"],
  early: ["EARLY", "BAD RELEASE", "var(--color-bad)"],
  late: ["LATE", "BAD RELEASE", "var(--color-bad)"],
};

const QUALITY_LABEL: Record<ShotQuality, string> = { wideOpen: "WIDE OPEN", open: "OPEN", contested: "CONTESTED", smothered: "SMOTHERED" };

const ARC_D = "M25 103.3 A50 50 0 0 0 25 16.7"; // 120 degree arc, bottom to top, bulging right
const GHOST_SHOTS = 10; // the RELEASE cue shows for the player's first shots

export type HudProps = {
  h: HudSnapshot | null;
  home: TeamData;
  away: TeamData;
  family: PadFamily;
  shotMeter?: boolean;
  /** v2 onboarding: coach layer on (action bar, prompts, explanations). */
  coach?: boolean;
  /** v2 onboarding: hide prompts (the tutorial card is teaching) but keep the action bar. */
  quiet?: boolean;
  /** v2 onboarding: practice court, no clocks or scorebug. */
  practice?: boolean;
  onEvent?: (e: GameEvent) => void;
  /** v2 onboarding: every event, including the quiet ones (tutorial checks). */
  onRaw?: (e: GameEvent) => void;
  ref?: Ref<HudHandle>;
};

export function Hud({ h, home, away, family, shotMeter = true, coach = false, quiet = false, practice = false, onEvent, onRaw, ref }: HudProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 1, h: 1 });
  const hRef = useRef(h);
  hRef.current = h;
  const teamsRef = useRef<[TeamData, TeamData]>([home, away]);
  teamsRef.current = [home, away];
  const evRef = useRef(onEvent);
  evRef.current = onEvent;
  const rawRef = useRef(onRaw);
  rawRef.current = onRaw;
  const coachRef = useRef(coach);
  coachRef.current = coach;

  // meter refs
  const mEl = useRef<HTMLDivElement>(null);
  const mFill = useRef<SVGPathElement>(null);
  const mWin = useRef<SVGPathElement>(null);
  const mTick = useRef<SVGLineElement>(null);
  const mArc = useRef<SVGSVGElement>(null);
  const mGrade = useRef<HTMLDivElement>(null);
  const mTxt = useRef<HTMLSpanElement>(null);
  const mSub = useRef<HTMLSpanElement>(null);
  const mMs = useRef<HTMLSpanElement>(null);
  const mTip = useRef<HTMLSpanElement>(null);
  const mGhost = useRef<HTMLSpanElement>(null);
  const mLast = useRef({ on: false, x: -1, y: -1, fill: -1, target: -1, win: -1, grade: "", fade: -1, ghost: false });
  const mRate = useRef({ fill: -1, t: 0, rate: 0 });
  const meterOn = useRef(shotMeter);
  meterOn.current = shotMeter;

  // tag refs
  const tagEls = useRef<(HTMLDivElement | null)[]>([]);
  const tagName = useRef<(HTMLSpanElement | null)[]>([]);
  const tagBar = useRef<(HTMLSpanElement | null)[]>([]);
  const tagIcon = useRef<(HTMLSpanElement | null)[]>([]);
  const tagKey = useRef<(HTMLSpanElement | null)[]>([]);
  const tagLast = useRef(Array.from({ length: 5 }, () => ({ on: false, x: -1, y: -1, text: "", kind: "", color: "" })));

  const [banners, setBanners] = useState<Banner[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [flash, setFlash] = useState<{ side: TeamSide; id: number } | null>(null);
  const [userTagOn, setUserTagOn] = useState(false);
  const [switchId, setSwitchId] = useState(0);
  const [poss, setPoss] = useState<{ id: number; offense: boolean; side: TeamSide } | null>(null);
  const [attack, setAttack] = useState<{ id: number; text: string; dir: -1 | 0 | 1 } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [chip, setChip] = useState<Chip | null>(null);
  const [tabHeld, setTabHeld] = useState(false);
  const [cues, setCues] = useState<CueState>(NO_CUES);
  const [introAt, setIntroAt] = useState(0);
  // instant replay: the HUD is hidden outright (not faded) from the moment the wipe covers the frame
  const [replayHide, setReplayHide] = useState(false);
  const cueDir = useRef<-1 | 0 | 1>(0);
  // screen side of the attacked basket, only read while the gameplay camera is up (cinematic angles flip it)
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const dirRef = useRef<-1 | 0 | 1>(0);
  dirRef.current = dir;
  useEffect(() => {
    if (!h || h.cinematic || h.replay) return;
    const d = attackSide(h, cueDir.current);
    if (d !== 0 && d !== dir) setDir(d);
  }, [h, dir]);
  const lastAttackCue = useRef(0);
  const seq = useRef(0);
  const timers = useRef(new Set<number>());
  const memo = useRef(newPromptMemo());
  const pState = useRef({ since: 0, seen: 0, hidAt: -1e9, counts: new Map<string, number>() });
  const halfSeen = useRef(new Set<number>());
  const oobPending = useRef(0);
  const whiff = useRef<{ kind: DefBtn; t: number } | null>(null);
  const lastFront = useRef<boolean | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current.w = el.clientWidth || 1;
      size.current.h = el.clientHeight || 1;
      mLast.current.x = -1;
      for (const t of tagLast.current) t.x = -1;
    });
    ro.observe(el);
    size.current.w = el.clientWidth || 1;
    size.current.h = el.clientHeight || 1;
    const tm = timers.current;
    return () => {
      ro.disconnect();
      for (const t of tm) clearTimeout(t);
      tm.clear();
    };
  }, []);

  useEffect(() => {
    if (!banners.length) return;
    // during live play a banner only flashes (it sits over the action); dead balls get the full show
    const live = hRef.current?.phase === "live";
    const b = banners[0];
    const t = window.setTimeout(() => setBanners((q) => q.slice(1)), b.ms ?? (live ? 1100 : b.big ? 2300 : 1900));
    return () => clearTimeout(t);
  }, [banners]);

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };

  const showChip = (text: string, tone: Chip["tone"], ms = 1300) => {
    const id = ++seq.current;
    setChip({ id, text, tone });
    later(() => setChip((c) => (c?.id === id ? null : c)), ms);
  };

  // input probe: hold Tab for the full controls card; whiffed steals / blocks get a "too far" tag while coaching
  useEffect(() => {
    const probe = acquireProbe();
    const off = probe.on((b, dev) => {
      if (b === "tab") return;
      const snap = hRef.current;
      if (!snap || !coachRef.current || snap.userTeam === -1 || snap.possession === snap.userTeam || snap.phase !== "live") return;
      const d = defenseOf(b, dev);
      if (d !== "steal" && d !== "block") return;
      const w = { kind: d, t: performance.now() };
      whiff.current = w;
      later(() => {
        if (whiff.current !== w) return;
        whiff.current = null;
        const c = hRef.current?.coach;
        if (d === "steal") showChip(c && c.ballDist > 1.8 ? "Too far to reach" : "Missed the reach", "bad");
        else showChip(c && c.markDist > 3 ? "Too far to block" : "No block", "bad");
      }, 650);
    });
    const iv = window.setInterval(() => setTabHeld(probe.tabHeld), 120);
    return () => {
      off();
      clearInterval(iv);
      probe.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the "you play as" card: once, when the tip-off starts (after any matchup / lineup cards)
  useEffect(() => {
    if (!introAt && h?.phase === "tipoff" && !cues.matchup && !cues.lineup) setIntroAt(performance.now());
  }, [h, introAt, cues.matchup, cues.lineup]);
  const [introOn, setIntroOn] = useState(false);
  useEffect(() => {
    if (!introAt) return;
    setIntroOn(true);
    const t = window.setTimeout(() => setIntroOn(false), 6500);
    return () => clearTimeout(t);
  }, [introAt]);

  useEffect(() => {
    if (!cues.matchup && !cues.lineup && !cues.lower && !cues.compare) return;
    const iv = window.setInterval(() => setCues((c) => expireCues(c, performance.now())), 250);
    return () => clearInterval(iv);
  }, [cues]);

  // coach prompt: one at a time, held at least 2.2 s, 3 s between different prompts, at most 5 of each per game
  useEffect(() => {
    if (!h || !coach || quiet) {
      if (prompt) setPrompt(null);
      return;
    }
    const now = performance.now();
    const ps = pState.current;
    const cand = pickPrompt(h, h.coach, memo.current, now);
    if (prompt && cand?.id === prompt.id) {
      ps.seen = now;
      return;
    }
    if (prompt && now - ps.since < 2200 && !cand?.urgent) return;
    if (!cand) {
      if (prompt && now - ps.seen > 500) {
        setPrompt(null);
        ps.hidAt = now;
      }
      return;
    }
    if (!prompt && now - ps.hidAt < 3000 && !cand.urgent) return;
    const n = ps.counts.get(cand.id) ?? 0;
    if (n >= 5) return;
    ps.counts.set(cand.id, n + 1);
    ps.since = ps.seen = now;
    setPrompt(cand);
  }, [h, coach, quiet, prompt]);

  // frontcourt reminder: the first few times the user brings the ball across half court
  useEffect(() => {
    const c = h?.coach;
    if (!h || !c || !coach || practice || !c.hasBall || h.phase !== "live") {
      if (h?.possession !== h?.userTeam) lastFront.current = null;
      return;
    }
    if (lastFront.current === false && c.frontcourt) {
      const ob = readOnboarding();
      if (ob.frontcourtTips < 3) {
        writeOnboarding({ frontcourtTips: ob.frontcourtTips + 1 });
        showChip("Frontcourt: don't go back over the half-court line", "info", 2600);
      }
    }
    lastFront.current = c.frontcourt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, coach, practice]);

  const sideColor = (side: TeamSide) => vivid(teamsRef.current[side]);
  const slotName = (slot: number) => {
    const snap = hRef.current;
    if (slot < 0) return "";
    const p = snap?.onCourt[slot < 5 ? 0 : 1]?.[slot % 5];
    return p ? p.name : "";
  };
  const idName = (side: TeamSide, id: string) => {
    const p = teamsRef.current[side].players.find((q) => q.id === id);
    return p ? `${p.first.charAt(0)}. ${p.last}` : id;
  };
  const userTeam = () => hRef.current?.userTeam ?? -1;
  const userSlot = () => hRef.current?.user?.slot ?? -1;

  const norm = (t: string) => t.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const pushBanner = (b: Omit<Banner, "id">) =>
    setBanners((q) => {
      // the same call often arrives twice (turnover event + sim toast): show it once
      if (q.some((x) => norm(x.text) === norm(b.text))) return q;
      return q.length >= 2 ? [...q.slice(0, 1), { ...b, id: ++seq.current }] : [...q, { ...b, id: ++seq.current }];
    });
  // play-by-play: at most two lines, each up for ~2.5 s (it is a ticker, not a log)
  const pushFeed = (f: Omit<Feed, "id">, ms = 2600) => {
    const id = ++seq.current;
    setFeed((q) => [...q.slice(-1), { ...f, id }]);
    later(() => setFeed((q) => q.filter((x) => x.id !== id)), ms);
  };

  function onQuiet(e: GameEvent) {
    switch (e.type) {
      case "userSwitch": {
        // on offense control follows the ball on every pass: the card updates quietly. On defense (or a new
        // possession) the change is news: flash NOW CONTROLLING and pulse the YOU arrow.
        const snap = hRef.current;
        const ut = userTeam();
        if (snap && ut !== -1 && snap.possession === ut && snap.phase === "live") break;
        setSwitchId(++seq.current);
        tagEls.current[0]?.animate(
          [{ transform: tagEls.current[0].style.transform + " scale(1.5)" }, { transform: tagEls.current[0].style.transform + " scale(1)" }],
          { duration: 380, easing: "cubic-bezier(0.16,1,0.3,1)" },
        );
        break;
      }
      case "possession": {
        const ut = userTeam();
        if (ut === -1 || practice) break;
        const offense = e.team === ut;
        setPoss({ id: ++seq.current, offense, side: e.team });
        const id = seq.current;
        later(() => setPoss((p) => (p?.id === id ? null : p)), 2000);
        const snap = hRef.current;
        if (offense && snap && coachRef.current && performance.now() - lastAttackCue.current > 600) {
          const d = snap.cinematic ? dirRef.current : attackSide(snap, cueDir.current) || dirRef.current;
          const half = snap.period <= 2 ? 1 : snap.period <= 4 ? 2 : snap.period;
          const first = !halfSeen.current.has(half);
          halfSeen.current.add(half);
          if (d !== 0) {
            const aid = ++seq.current;
            setAttack({ id: aid, text: first ? `You attack the ${d < 0 ? "left" : "right"} basket` : "Attack", dir: d });
            later(() => setAttack((a) => (a?.id === aid ? null : a)), first ? 2400 : 1500);
            lastAttackCue.current = performance.now();
          }
        }
        break;
      }
      case "whistle":
        if (e.reason === "outOfBounds") oobPending.current = performance.now();
        break;
      case "inbound":
        if (oobPending.current && performance.now() - oobPending.current < 2500) {
          oobPending.current = 0;
          const t = teamsRef.current[e.team];
          pushBanner({ text: "OUT OF BOUNDS", sub: `${t.abbr} ball`, color: sideColor(e.team), tag: "Whistle", why: "Last touched by the other team.", ms: 2200 });
        }
        break;
      case "shot":
        if (coachRef.current && e.team !== userTeam() && e.slot === hRef.current?.coach?.markSlot && e.contest > 0.55) showChip("Good contest", "good");
        break;
      case "deflection":
        if (e.by === userSlot()) whiff.current = null;
        break;
    }
  }

  function onGameEvent(e: GameEvent) {
    rawRef.current?.(e);
    if (QUIET.has(e.type)) {
      onQuiet(e);
      return;
    }
    evRef.current?.(e);
    const side = (s: number): TeamSide => (s < 5 ? 0 : 1);
    const ut = userTeam();
    const teach = coachRef.current;
    switch (e.type) {
      case "make": {
        const c = sideColor(e.team);
        const who = slotName(e.slot);
        const ast = e.assist >= 0 ? ` · ast ${slotName(e.assist)}` : "";
        setFlash({ side: e.team, id: ++seq.current });
        pushFeed({ text: `${who} ${e.points === 3 ? "three" : KIND[e.kind]}${ast}`, color: c, pts: e.points });
        const dunk = e.kind === "dunk" || e.kind === "alleyOopDunk" || (e.kind === "putback" && e.dist < 1.2);
        if (e.andOne) pushBanner({ text: "AND ONE", sub: who, color: c, big: true });
        else if (e.kind === "alleyOopDunk" || e.kind === "alleyOopLayup") pushBanner({ text: "ALLEY-OOP", sub: who, color: c, big: true });
        else if (dunk) pushBanner({ text: SLAMS[seq.current % SLAMS.length], sub: who, color: c, big: true });
        else if (e.points === 3 && (e.swish || e.dist > 8.2)) pushBanner({ text: e.dist > 8.2 ? "FROM WAY DOWNTOWN" : "SPLASH", sub: who, color: c });
        break;
      }
      case "miss":
        if (e.airball) pushFeed({ text: `${slotName(e.slot)} airball`, color: "var(--color-mute)" });
        break;
      case "block":
        if (e.by === userSlot()) whiff.current = null;
        pushBanner({ text: e.goaltend ? "GOALTENDING" : "REJECTED", sub: slotName(e.by), color: sideColor(side(e.by)) });
        pushFeed({ text: `${slotName(e.by)} ${e.goaltend ? "goaltend" : "block"} on ${slotName(e.on)}`, color: sideColor(side(e.by)) });
        break;
      case "steal":
        if (e.by === userSlot()) whiff.current = null;
        pushBanner({ text: "PICKED CLEAN", sub: slotName(e.by), color: sideColor(side(e.by)) });
        pushFeed({ text: `${slotName(e.by)} steal`, color: sideColor(side(e.by)) });
        break;
      case "ankleBreaker":
        pushBanner({ text: "ANKLES!", sub: `${slotName(e.by)} drops ${slotName(e.victim)}`, color: "var(--color-hot)", big: true });
        break;
      case "foul": {
        if (e.by === userSlot()) whiff.current = null;
        const fs = side(e.by);
        const mine = fs === ut;
        const k = e.kind === "shooting" ? "shooting foul" : e.kind === "charge" ? "charge" : e.kind === "offensive" ? "offensive foul" : "foul";
        pushFeed({ text: `${k} · ${slotName(e.by)} (${e.personal} PF)`, color: "var(--color-warn)" });
        const why = FOUL_WHY[e.kind];
        const shots = e.shots > 0 ? ` · ${e.shots} free throw${e.shots > 1 ? "s" : ""}` : e.bonus ? " · bonus" : "";
        pushBanner({
          text: FOUL_TITLE[e.kind],
          sub: `${slotName(e.by)} · ${teamsRef.current[fs].abbr} · ${e.personal} PF${shots}`,
          color: sideColor(fs),
          tag: ut === -1 ? "Whistle" : mine ? "Foul on you" : `Foul on ${teamsRef.current[fs].abbr}`,
          why: why[0],
          fix: mine && teach ? why[1] : undefined,
          ms: mine && teach ? 3400 : 2400,
        });
        if (e.fouledOut) pushBanner({ text: "FOULED OUT", sub: slotName(e.by), color: "var(--color-bad)" });
        break;
      }
      case "turnover":
        if (e.kind === "outOfBounds") oobPending.current = 0;
        if (e.kind === "steal") break;
        pushFeed({ text: `${TOV_TITLE[e.kind].toLowerCase()} · ${slotName(e.slot)}`, color: "var(--color-mute)" });
        if (STOPPAGE.has(e.kind)) {
          const mine = e.team === ut;
          const why = TOV_WHY[e.kind];
          pushBanner({
            text: TOV_TITLE[e.kind],
            sub: e.slot >= 0 ? `${slotName(e.slot)} · ${teamsRef.current[e.team].abbr}` : teamsRef.current[e.team].abbr,
            color: "var(--color-warn)",
            tag: ut === -1 ? "Turnover" : mine ? "Your turnover" : `${teamsRef.current[e.team].abbr} turnover`,
            why: why[0],
            fix: mine && teach ? why[1] : undefined,
            ms: mine && teach ? 3400 : 2400,
          });
        } else if (e.kind === "badPass" && e.team === ut && teach) showChip("Bad pass: aim at an open teammate", "bad", 1800);
        break;
      case "rebound":
        if (e.offensive) pushFeed({ text: `${slotName(e.slot)} offensive board`, color: sideColor(e.team) });
        break;
      case "streak":
        if (e.level >= 2) pushBanner({ text: "ON FIRE", sub: slotName(e.slot), color: "var(--color-hot)", big: true });
        else if (e.level === 1) pushBanner({ text: "HEATING UP", sub: slotName(e.slot), color: "var(--color-warn)" });
        else if (e.level <= -1) pushBanner({ text: "ICE COLD", sub: slotName(e.slot), color: "var(--color-ice)" });
        break;
      case "tipoff":
        pushFeed({ text: `${teamsRef.current[e.winner].name} win the tip`, color: sideColor(e.winner) }, 2000);
        break;
      case "timeout": {
        const t = teamsRef.current[e.team];
        pushBanner({ text: "TIMEOUT", sub: `${t.city} ${t.name} · ${e.remaining} left`, color: sideColor(e.team) });
        break;
      }
      case "substitution":
        pushFeed({ text: `In ${idName(e.team, e.inId)} · out ${idName(e.team, e.outId)}`, color: sideColor(e.team) });
        break;
      case "periodStart":
        if (e.period > 1) pushFeed({ text: `Start of the ${e.period > 4 ? "overtime" : ["", "1st", "2nd", "3rd", "4th"][e.period] + " quarter"}`, color: "var(--color-ink)" });
        if (e.period === 3 && teach && ut !== -1) pushBanner({ text: "TEAMS SWITCH BASKETS", sub: "Second half", color: "var(--color-gold)", why: "Watch the arrow: you now attack the other end.", ms: 3000 });
        break;
      case "periodEnd":
        pushFeed({ text: `End of period ${e.period}: ${e.score[1]}-${e.score[0]}`, color: "var(--color-ink)" });
        break;
      case "overtime":
        pushBanner({ text: e.n > 1 ? `${e.n}X OVERTIME` : "OVERTIME", color: "var(--color-hot)", big: true });
        break;
      case "halftime":
        pushBanner({ text: "HALFTIME", color: "var(--color-ice)" });
        break;
      case "gameEnd":
        pushBanner({ text: "FINAL", sub: `${teamsRef.current[e.winner].name} win`, color: sideColor(e.winner), big: true });
        break;
      case "crowdHype":
        if (e.reason === "buzzerBeater") pushBanner({ text: "BUZZER BEATER", color: "var(--color-gold)", big: true });
        break;
      case "toast": {
        const c = e.tone === "home" ? sideColor(0) : e.tone === "away" ? sideColor(1) : e.tone === "hot" ? "var(--color-hot)" : "#ffffff";
        pushBanner({ text: e.text.toUpperCase(), sub: e.sub, color: c });
        break;
      }
    }
  }

  function writeMeter(m: MeterView) {
    const el = mEl.current;
    if (!el) return;
    const L = mLast.current;
    if (!m.on || m.fade <= 0.001) {
      if (L.on) {
        el.style.opacity = "0";
        L.on = false;
        L.grade = "";
        mRate.current.fill = -1;
        // clear the last release read-out, so a stale "EARLY" never lingers behind a modal or into defense
        for (const r of [mTxt, mSub, mMs]) if (r.current) r.current.textContent = "";
        if (mTip.current) {
          mTip.current.textContent = "";
          mTip.current.style.display = "none";
        }
        if (mGrade.current) mGrade.current.style.opacity = "0";
      }
      return;
    }
    if (!L.on) L.on = true;
    const px = Math.round(m.x * size.current.w);
    const py = Math.round(m.y * size.current.h);
    if (px !== L.x || py !== L.y) {
      L.x = px;
      L.y = py;
      el.style.transform = `translate3d(${px}px,${py}px,0) translateY(-50%)`;
    }
    const fade = Math.round(m.fade * 50) / 50;
    if (fade !== L.fade) {
      L.fade = fade;
      el.style.opacity = String(fade);
    }
    // fill speed (fill units per ms) while the meter runs, for the "42 ms late" readout
    const now = performance.now();
    const R = mRate.current;
    if (m.grade === "none") {
      if (R.fill >= 0 && m.fill > R.fill && now > R.t) {
        const r = (m.fill - R.fill) / (now - R.t);
        R.rate = R.rate > 0 ? R.rate * 0.7 + r * 0.3 : r;
      }
      R.fill = m.fill;
      R.t = now;
    }
    const fill = Math.round(m.fill * 400) / 4;
    if (fill !== L.fill) {
      L.fill = fill;
      mFill.current?.setAttribute("stroke-dasharray", `${fill} 200`);
    }
    if (m.target !== L.target || m.window !== L.win) {
      L.target = m.target;
      L.win = m.window;
      const w = Math.max(0.5, m.window * 100);
      const start = Math.max(0, m.target * 100 - w / 2);
      mWin.current?.setAttribute("stroke-dasharray", `${w} 200`);
      mWin.current?.setAttribute("stroke-dashoffset", String(-start));
      const a = ((-60 + m.target * 120) * Math.PI) / 180;
      const t = mTick.current;
      if (t) {
        t.setAttribute("x1", String(38 * Math.cos(a)));
        t.setAttribute("y1", String(60 - 38 * Math.sin(a)));
        t.setAttribute("x2", String(62 * Math.cos(a)));
        t.setAttribute("y2", String(60 - 62 * Math.sin(a)));
      }
      const gh = mGhost.current;
      if (gh) {
        gh.style.left = `${((70 * Math.cos(a)) / 60) * 100}%`;
        gh.style.top = `${((60 - 70 * Math.sin(a)) / 120) * 100}%`;
      }
    }
    // RELEASE cue for the first shots: lights up as the bar reaches the notch
    const gh = mGhost.current;
    if (gh) {
      const want = m.grade === "none" && coachRef.current && readOnboarding().shots < GHOST_SHOTS && meterOn.current;
      const near = want && m.fill >= m.target - m.window * 0.5 - 0.08 && m.fill <= m.target + m.window;
      if (near !== L.ghost) {
        L.ghost = near;
        gh.style.opacity = near ? "1" : want ? "0.35" : "0";
      } else if (!want && gh.style.opacity !== "0") gh.style.opacity = "0";
      else if (want && !near && gh.style.opacity === "0") gh.style.opacity = "0.35";
    }
    if (m.grade !== L.grade) {
      const was = L.grade;
      L.grade = m.grade;
      el.dataset.g = m.grade;
      const arc = mArc.current;
      if (arc) arc.style.display = !meterOn.current && m.grade !== "none" ? "none" : "";
      const g = mGrade.current;
      if (g) {
        if (m.grade === "none") g.style.opacity = "0";
        else {
          // v2 feel: a green against a hand in the face is roughly a coin flip, so it does not read as EXCELLENT
          const smothered = m.grade === "perfect" && m.quality === "smothered";
          const [txt0, sub, col0] = GRADE[m.grade];
          const txt = smothered ? "CONTESTED" : txt0;
          const col = smothered ? "var(--color-gold)" : col0;
          const q = m.quality ? QUALITY_LABEL[m.quality] : "";
          if (mTxt.current) {
            mTxt.current.textContent = txt;
            mTxt.current.style.color = col;
          }
          if (mSub.current) mSub.current.textContent = q ? `${sub} · ${q}` : sub;
          let ms = 0;
          if (R.rate > 0) ms = Math.round((m.fill - m.target) / R.rate);
          if (mMs.current) {
            mMs.current.textContent = m.grade === "perfect" ? "Right on the notch" : ms === 0 ? "" : `${Math.abs(ms)} ms ${ms < 0 ? "early" : "late"}`;
            mMs.current.style.color = m.grade === "perfect" ? "var(--color-good)" : col;
          }
          if (mTip.current) {
            const tip = !coachRef.current || m.grade === "perfect" ? "" : m.grade === "early" || m.grade === "slightlyEarly" ? "Hold a little longer: let go on the gold notch" : "Let go sooner: right as the bar hits the gold notch";
            mTip.current.textContent = tip;
            mTip.current.style.display = tip ? "" : "none";
          }
          g.style.opacity = "1";
          g.animate(
            [
              { transform: "translateX(-50%) scale(1.5)", opacity: 0, filter: "blur(4px)" },
              { transform: "translateX(-50%) scale(1)", opacity: 1, filter: "blur(0)" },
            ],
            { duration: 220, easing: "cubic-bezier(0.16,1,0.3,1)" },
          );
          if (was === "none" || was === "") writeOnboarding({ shots: readOnboarding().shots + 1 });
        }
      }
    }
  }

  function writeTags(list: readonly ScreenTag[]) {
    const W = size.current.w;
    const H = size.current.h;
    for (let i = 0; i < 5; i++) {
      const el = tagEls.current[i];
      const L = tagLast.current[i];
      const t = list[i];
      if (!el) continue;
      if (!t || !t.on) {
        if (L.on) {
          el.style.display = "none";
          L.on = false;
          if (i === 0) setUserTagOn(false);
        }
        continue;
      }
      if (!L.on) {
        el.style.display = "";
        L.on = true;
        if (i === 0) setUserTagOn(true);
      }
      // keep tags out of the HUD bands: play-call label / ticker on top, scorebug and player card below
      const x = Math.round(Math.min(Math.max(t.x * W, 90), W - 90));
      const y = Math.round(Math.min(Math.max(t.y * H, H * 0.13 + 70), H - 150));
      if (x !== L.x || y !== L.y) {
        L.x = x;
        L.y = y;
        el.style.transform = `translate3d(${x}px,${y}px,0)`;
      }
      if (t.kind !== L.kind || t.text !== L.text || t.color !== L.color) {
        L.kind = t.kind;
        L.text = t.text;
        L.color = t.color;
        const nm = tagName.current[i];
        const ic = tagIcon.current[i];
        const bar = tagBar.current[i];
        el.dataset.kind = t.kind;
        if (t.kind === "name") {
          if (nm) nm.textContent = t.text;
          if (bar) bar.style.background = t.color;
        } else if (ic) {
          const isFace = t.text === "A" || t.text === "B" || t.text === "X" || t.text === "Y";
          ic.dataset.face = isFace ? t.text : "K";
          const k = tagKey.current[i];
          if (!isFace && k) k.textContent = t.text;
        }
      }
    }
  }

  function onBroadcast(c: BroadcastCue) {
    if (c.kind === "attack") {
      if (c.team !== userTeam()) return;
      cueDir.current = c.screen;
      if (!coachRef.current || performance.now() - lastAttackCue.current < 600) return;
      lastAttackCue.current = performance.now();
      const snap = hRef.current;
      const d = snap?.coach && !snap.cinematic ? attackSide(snap) || c.screen : c.screen;
      const half = !snap ? 1 : snap.period <= 2 ? 1 : snap.period <= 4 ? 2 : snap.period;
      const first = !halfSeen.current.has(half);
      halfSeen.current.add(half);
      const aid = ++seq.current;
      setAttack({ id: aid, text: first ? `You attack the ${d < 0 ? "left" : "right"} basket` : "Attack", dir: d });
      later(() => setAttack((a) => (a?.id === aid ? null : a)), first ? 2400 : 1500);
      return;
    }
    if (c.kind === "replay") {
      setReplayHide(c.on);
      return;
    }
    const id = ++seq.current;
    setCues((s) => applyCue(s, c, id, performance.now()));
  }

  useImperativeHandle(ref, () => ({ meter: writeMeter, tags: writeTags, event: onGameEvent, broadcast: onBroadcast }), []);

  const cine = !!h?.cinematic;
  const ut = h?.userTeam ?? -1;
  const userTeamData = ut === 0 ? home : ut === 1 ? away : null;
  const offScreen = !!h && !!h.user && !!h.coach && !h.coach.onScreen && h.phase === "live" && !cine;
  const showPrompt = coach && !quiet && prompt && !cine;
  return (
    <div ref={wrap} className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* floating tags: slot 0 is the user (YOU marker + coach chip), 1..4 icon-pass glyphs */}
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} ref={(el) => void (tagEls.current[i] = el)} className="tag" data-you={i === 0 ? "1" : undefined} style={{ display: "none" }}>
          {i === 0 && (
            <div className="absolute bottom-[4.1rem] left-0 flex -translate-x-1/2 flex-col items-center gap-1.5">
              {showPrompt && userTagOn && <CoachChip key={prompt.id} parts={prompt.parts} urgent={prompt.urgent} device={h?.device ?? "keys"} family={family} floating />}
              {chip && <span key={chip.id} className={cx("pop-in whitespace-nowrap rounded-[2px] px-2 py-0.5 text-[0.78rem] font-black uppercase tracking-[0.12em]", chip.tone === "good" ? "bg-good text-night" : chip.tone === "bad" ? "bg-bad text-white" : "bg-gold text-night")}>{chip.text}</span>}
            </div>
          )}
          <div className="tag-name absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center">
            {i === 0 && <span className="you-label ttl mb-0.5 text-[0.95rem] italic tracking-[0.12em] text-gold">YOU</span>}
            <div className="flex items-center overflow-hidden rounded-[2px] bg-night/85 shadow-lg backdrop-blur">
              <span ref={(el) => void (tagBar.current[i] = el)} className="h-full w-1 self-stretch" />
              <span ref={(el) => void (tagName.current[i] = el)} className="ttl px-2 py-[0.2rem] text-[0.95rem] tracking-[0.06em] text-white" />
            </div>
            {i === 0 ? <span className="you-arrow mt-0.5" /> : <span className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-night/80" />}
          </div>
          <span
            ref={(el) => void (tagIcon.current[i] = el)}
            className="tag-icon absolute bottom-[0.4rem] left-0 -translate-x-1/2 text-[1.5rem] drop-shadow-[0_0.2rem_0.5rem_rgb(0_0_0/0.7)]"
          >
            {(["A", "B", "X", "Y"] as const).map((b) => (
              <span key={b} data-f={b}>
                <Face b={b} family={family} />
              </span>
            ))}
            <span data-f="K" ref={(el) => void (tagKey.current[i] = el)} className="num grid h-[1.6em] min-w-[1.6em] place-items-center rounded-[0.25em] border border-white/40 border-b-[4px] bg-night/90 text-[0.9em] text-white" />
          </span>
        </div>
      ))}

      {/* shot meter */}
      <div ref={mEl} className="meter" style={{ opacity: 0 }}>
        <span className="meter-plate" />
        <svg ref={mArc} viewBox="0 0 60 120" className="relative h-full w-full overflow-visible">
          <path d={ARC_D} pathLength={100} fill="none" stroke="rgb(0 0 0 / 0.7)" strokeWidth="14" strokeLinecap="round" />
          <path d={ARC_D} pathLength={100} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="8" strokeLinecap="round" />
          <path ref={mWin} d={ARC_D} pathLength={100} fill="none" stroke="rgb(255 209 102 / 0.7)" strokeWidth="8" strokeDasharray="0 200" />
          <path ref={mFill} className="meter-fill" d={ARC_D} pathLength={100} fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeDasharray="0 200" />
          <line ref={mTick} x1="0" y1="0" x2="0" y2="0" stroke="#ffd166" strokeWidth="3.2" strokeLinecap="round" />
        </svg>
        <span ref={mGhost} className="meter-ghost" aria-hidden style={{ opacity: 0 }}>RELEASE</span>
        <div ref={mGrade} className="meter-grade flex flex-col items-center leading-none" style={{ opacity: 0 }}>
          <span ref={mTxt} className="ttl text-[2.3rem] italic drop-shadow-[0_2px_6px_rgb(0_0_0/0.8)]" />
          <span ref={mSub} className="mt-0.5 text-[0.66rem] font-bold tracking-[0.2em] text-white/90 drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]" />
          <span ref={mMs} className="num mt-1 text-[1.05rem] drop-shadow-[0_1px_3px_rgb(0_0_0/0.9)]" />
          <span ref={mTip} className="mt-1 rounded-[2px] bg-night/85 px-2 py-1 text-[0.72rem] font-semibold text-white" style={{ display: "none" }} />
        </div>
      </div>

      {/* banners */}
      <div
        className={cx(
          "absolute inset-x-0 flex justify-center transition-[top,scale] duration-200",
          h?.phase === "live" ? "top-[7%] scale-[0.55]" : "top-[17%]",
        )}
      >
        {banners[0] && <BannerView key={banners[0].id} b={banners[0]} />}
      </div>

      {h?.phase === "pregame" && !practice && (
        <div className="absolute right-[3.2%] top-[9%] flex items-center gap-2 rounded-[3px] bg-night/80 px-3 py-1.5 shadow-lg backdrop-blur">
          <span className="ttl text-[1.1rem] italic tracking-[0.16em] text-white">PREGAME</span>
          <span className="ml-2 text-[0.7rem] font-bold tracking-[0.18em] text-white/75">ANY BUTTON TO SKIP</span>
        </div>
      )}
      {h?.replay && (
        <div className="absolute right-[3.2%] top-[9%] flex items-center gap-2 rounded-[3px] bg-night/80 px-3 py-1.5 shadow-lg backdrop-blur">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff3b47]" />
          <span className="ttl text-[1.1rem] italic tracking-[0.16em] text-white">REPLAY</span>
          <span className="ml-2 text-[0.6rem] font-bold tracking-[0.18em] text-white/60">ANY BUTTON TO SKIP</span>
        </div>
      )}
      {h && (
        <div className={cx("absolute inset-0 transition-opacity duration-300", replayHide ? "invisible opacity-0 duration-0" : cine ? "opacity-0" : "opacity-100")}>
          <Feed items={feed} />
          {practice ? <PracticeBug team={userTeamData ?? home} /> : <Scorebug h={h} flash={flash} dir={dir} />}
          {!practice && <StatusChip h={h} />}
          {h.user && <PlayerCard p={h.user} team={h.user.team === 0 ? home : away} switchId={switchId} />}
          {!practice && !quiet && <PlayCall h={h} />}
          {coach && h.userTeam !== -1 && <ActionBar h={h} family={family} tabHint />}
          {tabHeld && h.userTeam !== -1 && <ControlsCard h={h} family={family} />}
          {poss && userTeamData && (h.phase === "live" || h.phase === "inbound") && <PossessionChip key={poss.id} offense={poss.offense} team={teamsRef.current[poss.side]} dir={dir} />}
          {showPrompt && !userTagOn && !h.freeThrow && <CoachChip key={prompt.id} parts={prompt.parts} urgent={prompt.urgent} device={h.device} family={family} />}
          {attack && attack.dir !== 0 && (h.phase === "live" || h.phase === "inbound") && <AttackFlash key={attack.id} dir={attack.dir} text={attack.text} />}
          {offScreen && h.user && h.coach && <EdgeArrow x={h.coach.screenX} y={h.coach.screenY} jersey={h.user.jersey} color={vivid(h.user.team === 0 ? home : away)} />}
        </div>
      )}
      {/* broadcast cards stay up through cinematic shots: the pregame intro is all cinematic */}
      {h && <BroadcastLayer cues={cues} h={h} home={home} away={away} />}
      {h && introOn && !practice && !quiet && userTeamData && !cues.matchup && !cues.lineup && (h.phase === "tipoff" || h.phase === "live") && (
        <IntroCard team={userTeamData} dir={dir} device={h.device} family={family} />
      )}
    </div>
  );
}

function BannerView({ b }: { b: Banner }) {
  const ms = b.ms ?? (b.big ? 2300 : undefined);
  return (
    <div className="banner relative flex w-max shrink-0 items-stretch whitespace-nowrap shadow-[0_1rem_3rem_rgb(0_0_0/0.5)]" style={{ animationDuration: ms ? `${ms}ms` : undefined }}>
      <span className="w-2.5" style={{ background: b.color }} />
      <div className="relative flex shrink-0 flex-col items-center justify-center overflow-hidden bg-night/88 px-10 py-2.5 backdrop-blur-md" style={{ boxShadow: `inset 0 -3px 0 ${b.color}` }}>
        <span className="absolute inset-0 opacity-30" style={{ background: `linear-gradient(90deg, ${b.color.startsWith("var") ? "transparent" : alpha(b.color, 0.55)}, transparent 70%)` }} />
        {b.tag && <span className="unskew relative mb-1 rounded-[2px] bg-white/12 px-2 py-0.5 text-[0.68rem] font-black uppercase tracking-[0.24em] text-white/85">{b.tag}</span>}
        <span className={cx("unskew ttl relative italic text-white", b.big ? "text-[3.6rem]" : "text-[2.6rem]")} style={{ textShadow: `0 0 1.6rem ${b.color}` }}>
          {b.text}
        </span>
        {b.sub && <span className="unskew relative mt-1 text-[0.8rem] font-bold uppercase tracking-[0.22em] text-white/80">{b.sub}</span>}
        {b.why && <span className="unskew relative mt-1.5 text-[1rem] font-semibold text-white">{b.why}</span>}
        {b.fix && (
          <span className="unskew relative mt-1 flex items-center gap-2 text-[0.95rem] font-semibold text-gold">
            <span className="h-1.5 w-1.5 rotate-45 bg-gold" /> {b.fix}
          </span>
        )}
      </div>
      <span className="w-1" style={{ background: b.color, opacity: 0.6 }} />
    </div>
  );
}

function Feed({ items }: { items: Feed[] }) {
  return (
    <div className="absolute right-[1.5rem] top-[15%] flex w-[20rem] flex-col items-end gap-1.5">
      {items.map((f) => (
        <div key={f.id} className="feed-in flex items-center gap-2 overflow-hidden rounded-[2px] bg-night/70 pr-3 text-[0.82rem] font-semibold text-ink/90 backdrop-blur">
          <span className="w-1 self-stretch" style={{ background: f.color }} />
          {f.pts ? <span className="num w-7 text-center text-[1.1rem]" style={{ color: f.color }}>+{f.pts}</span> : <span className="w-1" />}
          <span className="truncate py-1.5 first-letter:uppercase">{f.text}</span>
        </div>
      ))}
    </div>
  );
}

function Pips({ n, max, color, className }: { n: number; max: number; color: string; className?: string }) {
  return (
    <span className={cx("flex gap-[3px]", className)}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="h-[4px] w-[0.55rem] skew-x-[-20deg]" style={{ background: i < n ? color : "rgb(255 255 255 / 0.14)" }} />
      ))}
    </span>
  );
}

function BallIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Ball">
      <circle cx="12" cy="12" r="10" fill="#ff7a2e" stroke="#2a0d00" strokeWidth="1.6" />
      <path d="M2 12h20M12 2v20M5.5 4.8c3 3.2 3 11.2 0 14.4M18.5 4.8c-3 3.2-3 11.2 0 14.4" fill="none" stroke="#2a0d00" strokeWidth="1.4" />
    </svg>
  );
}

function TeamPlate({ t, side, h, flip, flash }: { t: HudTeam; side: TeamSide; h: HudSnapshot; flip?: boolean; flash: { side: TeamSide; id: number } | null }) {
  const col = vivid(t);
  const ball = h.possession === side;
  return (
    <div className={cx("relative flex items-stretch", flip && "flex-row-reverse")}>
      <div className="relative flex w-[4.7rem] items-center justify-center overflow-hidden" style={{ background: `linear-gradient(${flip ? 225 : 135}deg, ${mix(t.primary, "#ffffff", 0.12)}, ${mix(t.primary, "#000000", 0.25)})` }}>
        <span className="absolute inset-y-0 w-1" style={{ background: t.secondary, [flip ? "left" : "right"]: 0 }} />
        <span className="unskew ttl text-[1.75rem] tracking-[0.02em]" style={{ color: inkOn(t.primary) }}>
          {t.abbr}
        </span>
        {flash?.side === side && <span key={flash.id} className="flash-team absolute inset-0 bg-white/80" />}
      </div>
      <div className="relative flex w-[4.4rem] flex-col items-center justify-center bg-night/85">
        <span key={t.score} className="unskew num score-pop text-[2.35rem] leading-none text-white">
          {t.score}
        </span>
        {ball && <BallIcon className={cx("pop-in absolute top-1 h-[1.05rem] w-[1.05rem] drop-shadow", flip ? "left-1" : "right-1")} />}
        <span className={cx("absolute bottom-0 h-[3px] w-full transition-opacity duration-200", ball ? "opacity-100" : "opacity-0")} style={{ background: col, boxShadow: `0 0 0.6rem ${col}` }} />
      </div>
    </div>
  );
}

function TeamMeta({ t, flip, you, dir, defending }: { t: HudTeam; flip?: boolean; you?: boolean; dir?: -1 | 0 | 1; defending?: boolean }) {
  // on defense the arrow points at the basket the user protects (the other way from his attack)
  const d = defending ? (-(dir ?? 0) as -1 | 0 | 1) : dir;
  return (
    <div className={cx("unskew flex h-[1.15rem] items-center gap-2 px-1 text-[0.6rem] font-bold tracking-[0.16em] text-white/70", flip && "flex-row-reverse")}>
      <Pips n={t.timeouts} max={7} color="#ffffff" />
      <span className="text-[0.6rem] tracking-[0.12em] text-white/60">
        FOULS <span className="num text-[0.75rem] tracking-normal text-white/85">{t.fouls}</span>
      </span>
      {t.bonus && <span className="pop-in rounded-[2px] bg-warn px-1 py-px text-night">BONUS</span>}
      {you && (
        <span className={cx("flex items-center gap-1 rounded-[2px] px-1.5 py-px font-black", defending ? "bg-[#ff4d5e] text-white" : "bg-gold text-night")}>
          {d === -1 && "◀ "}
          {defending ? "YOU · DEFEND" : "YOU · ATTACK"}
          {d === 1 && " ▶"}
        </span>
      )}
    </div>
  );
}

/** "1ST" set in the condensed display face reads as "TST": show quarters as Q1..Q4, overtime as is. */
function shortPeriod(label: string): string {
  const m = /^([1-4])(ST|ND|RD|TH)$/.exec(label);
  return m ? `Q${m[1]}` : label;
}

function Scorebug({ h, flash, dir }: { h: HudSnapshot; flash: { side: TeamSide; id: number } | null; dir: -1 | 0 | 1 }) {
  const sc = h.shotClockOn && h.phase !== "freeThrow";
  const low = h.shotClock <= 5;
  const lastMin = h.clock < 60;
  return (
    <div className="absolute bottom-[1.6rem] left-1/2 -translate-x-1/2">
      <div className={cx("skew flex items-stretch overflow-hidden rounded-[3px] border border-white/10 shadow-[0_0.8rem_2.5rem_rgb(0_0_0/0.55)]", h.clutch && "clutch")}>
        <div className="flex items-center bg-night/90 px-3">
          <span className="unskew flex flex-col items-center leading-none">
            <span className="ttl text-[0.95rem] italic text-hot">HOOPS</span>
          </span>
        </div>
        <TeamPlate t={h.teams[1]} side={1} h={h} flash={flash} />
        <div className="flex w-[7.2rem] flex-col items-center justify-center bg-gradient-to-b from-[#1a2030] to-[#0d1119]">
          <span className="unskew num text-[0.8rem] tracking-[0.16em] text-mute">{h.phase === "periodBreak" ? "END " + shortPeriod(h.periodLabel) : shortPeriod(h.periodLabel)}</span>
          <span className={cx("unskew num text-[1.85rem] leading-none", lastMin ? "text-hot-hi" : "text-white")}>{fmtClock(h.clock)}</span>
        </div>
        <TeamPlate t={h.teams[0]} side={0} h={h} flip flash={flash} />
        <div className={cx("ml-[3px] flex w-[3.6rem] flex-col items-center justify-center gap-[2px] border-l border-white/10 transition-colors duration-200", !sc ? "bg-night/90" : low ? "bg-bad" : "bg-[#151a25]")}>
          <span className="unskew text-[0.5rem] font-bold tracking-[0.22em] text-white/45">SHOT</span>
          <span className={cx("unskew num text-[1.5rem] leading-none", !sc ? "text-white/15" : low ? "text-white" : "text-gold")}>{sc ? fmtShot(h.shotClock) : "--"}</span>
        </div>
      </div>
      <div className="skew mt-1 flex justify-between pl-[3.6rem] pr-[3.4rem]">
        <TeamMeta t={h.teams[1]} you={h.userTeam === 1} dir={dir} defending={h.possession !== -1 && h.possession !== h.userTeam} />
        <TeamMeta t={h.teams[0]} flip you={h.userTeam === 0} dir={dir} defending={h.possession !== -1 && h.possession !== h.userTeam} />
      </div>
    </div>
  );
}

function PracticeBug({ team }: { team: TeamData }) {
  return (
    <div className="absolute bottom-[1.6rem] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[3px] border border-white/10 bg-night/85 px-4 py-2 shadow-[0_0.8rem_2.5rem_rgb(0_0_0/0.55)]">
      <span className="ttl text-[0.95rem] italic text-hot">HOOPS</span>
      <span className="h-5 w-px bg-white/15" />
      <span className="ttl text-[1.35rem] tracking-[0.08em]">Practice court</span>
      <span className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-mute">{team.name} · no clock</span>
    </div>
  );
}

function StatusChip({ h }: { h: HudSnapshot }) {
  let text: string | null = null;
  let sub: string | null = null;
  if (h.freeThrow) {
    text = `FREE THROW ${h.freeThrow.index} OF ${h.freeThrow.total}`;
    sub = h.freeThrow.name;
  } else if (h.phase === "timeout") text = "TIMEOUT";
  else if (h.phase === "tipoff") text = "TIP-OFF";
  else if (h.phase === "inbound") text = null;
  if (!text) return null;
  return (
    <div className="fade absolute bottom-[7.6rem] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[2px] bg-night/80 px-4 py-1.5 backdrop-blur">
      <span className="h-2 w-2 rotate-45 bg-hot" />
      <span className="ttl text-[1.15rem] tracking-[0.12em]">{text}</span>
      {sub && <span className="text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-mute">{sub}</span>}
    </div>
  );
}

function PlayerCard({ p, team, switchId }: { p: HudPlayer; team: TeamData; switchId: number }) {
  const col = vivid(team);
  const st = Math.max(0, Math.min(1, p.stamina));
  const stCol = st > 0.6 ? "var(--color-good)" : st > 0.3 ? "var(--color-warn)" : "var(--color-bad)";
  const fire = p.onFire > 0.5 ? "hot" : p.onFire < -0.5 ? "cold" : null;
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!switchId) return;
    setFresh(true);
    const t = window.setTimeout(() => setFresh(false), 900);
    return () => clearTimeout(t);
  }, [switchId]);
  return (
    <div key={switchId} className={cx("absolute bottom-[1.6rem] left-[1.5rem] flex items-stretch overflow-hidden rounded-[3px] border bg-night/85 shadow-[0_0.8rem_2rem_rgb(0_0_0/0.5)] backdrop-blur-md", fresh ? "pop-in border-gold" : "border-white/10")}>
      <div className="relative flex w-[3.8rem] flex-col items-center justify-center" style={{ background: `linear-gradient(160deg, ${mix(team.primary, "#fff", 0.1)}, ${mix(team.primary, "#000", 0.35)})` }}>
        <span className="num text-[2.2rem] leading-none" style={{ color: inkOn(team.primary) }}>{p.jersey}</span>
        <span className="text-[0.6rem] font-bold tracking-[0.18em]" style={{ color: alpha(inkOn(team.primary) === "#ffffff" ? "#ffffff" : "#000000", 0.7) }}>{p.pos}</span>
      </div>
      <div className="flex min-w-[14rem] flex-col justify-center gap-1 px-3 py-2">
        <span className={cx("text-[0.58rem] font-black uppercase tracking-[0.22em]", fresh ? "text-gold" : "text-gold/80")}>{fresh ? "Now controlling" : "You"}</span>
        <div className="flex items-center gap-2">
          <span className="ttl truncate text-[1.35rem] tracking-[0.02em]">{p.name}</span>
          {fire && (
            <span className={cx("rounded-[2px] px-1.5 py-px text-[0.6rem] font-bold tracking-[0.16em]", fire === "hot" ? "pulse-hot bg-hot text-night" : "bg-ice text-night")}>{fire === "hot" ? "ON FIRE" : "COLD"}</span>
          )}
          <span className="ml-auto num text-[1rem]" style={{ color: col }}>{p.overall}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative h-[5px] flex-1 overflow-hidden bg-white/12">
            <span className="absolute inset-y-0 left-0 transition-[width] duration-200" style={{ width: `${st * 100}%`, background: stCol }} />
            {[0.25, 0.5, 0.75].map((m) => (
              <span key={m} className="absolute inset-y-0 w-[2px] bg-night/90" style={{ left: `${m * 100}%` }} />
            ))}
          </span>
          <span className="flex gap-[2px]">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="h-[5px] w-[5px] rounded-full" style={{ background: i < p.fouls ? (p.fouls >= 5 ? "var(--color-bad)" : "var(--color-warn)") : "rgb(255 255 255 / 0.15)" }} />
            ))}
          </span>
        </div>
        <div className="flex gap-3 text-[0.72rem] font-semibold tracking-[0.08em] text-mute">
          <span><b className="num text-[0.95rem] text-ink">{p.pts}</b> PTS</span>
          <span><b className="num text-[0.95rem] text-ink">{p.fgm}-{p.fga}</b> FG</span>
          <span><b className="num text-[0.95rem] text-ink">{p.reb}</b> REB</span>
          <span><b className="num text-[0.95rem] text-ink">{p.ast}</b> AST</span>
        </div>
      </div>
    </div>
  );
}

/** Only the user's own play call (the opponent's set read like an instruction to new players). */
function PlayCall({ h }: { h: HudSnapshot }) {
  if (!h.play || h.possession === -1 || h.phase !== "live") return null;
  const mine = h.userTeam !== -1 && h.possession === h.userTeam;
  if (h.userTeam !== -1 && !mine) return null;
  const t = h.teams[h.possession];
  return (
    <div key={h.play} className="fade absolute left-[1.5rem] top-[1.4rem] flex items-center gap-2 rounded-[2px] bg-night/70 py-1 pl-1 pr-3 backdrop-blur">
      <span className="h-5 w-1" style={{ background: vivid(t) }} />
      <span className="eyebrow text-[0.6rem]">{mine ? "Your play" : `${t.abbr} set`}</span>
      <span className="ttl text-[1.05rem] tracking-[0.06em]">{h.play}</span>
    </div>
  );
}
