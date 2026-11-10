import type { HintMode } from "./contracts";

// v2 onboarding: what the player has seen, kept in localStorage. Every access is wrapped: storage can throw or be empty
// (private windows, blocked site data), and the game must behave like a first launch then.

export type Onboarding = {
  welcomed: boolean; // the first-launch "New to HOOPS?" choice was answered
  tutorialDone: boolean;
  games: number; // exhibition games started
  shots: number; // user shots released (the meter shows the RELEASE cue for the first 10)
  frontcourtTips: number; // "don't go back over the line" reminders shown
};

const KEY = "hoops.onboarding.v1";
const FRESH: Onboarding = { welcomed: false, tutorialDone: false, games: 0, shots: 0, frontcourtTips: 0 };
let cache: Onboarding | null = null;

export function readOnboarding(): Onboarding {
  if (cache) return cache;
  let v: Onboarding = { ...FRESH };
  try {
    const s = localStorage.getItem(KEY);
    if (s) v = { ...FRESH, ...(JSON.parse(s) as Partial<Onboarding>) };
  } catch {
    /* storage blocked: treat as a first launch */
  }
  cache = v;
  return v;
}

export function writeOnboarding(p: Partial<Onboarding>): Onboarding {
  const v = { ...readOnboarding(), ...p };
  cache = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
  return v;
}

/** Prompts and the action bar are shown when this is true. Tutorial and practice always coach. */
export function coachOn(mode: HintMode | undefined, games: number, practice: boolean): boolean {
  if (practice) return true;
  const m = mode ?? "first";
  if (m === "off") return false;
  if (m === "always") return true;
  return games <= 3;
}
