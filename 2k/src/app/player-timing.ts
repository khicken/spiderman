// Animation timing the sim can import (pure data, no three.js). Fractions of PlayerState.actionDur.
// These match the key moments in contracts.ACTION_DUR and are what the player rig is authored against.

/** Ball release / contact moment per one-shot action (fraction of actionDur). */
export const RELEASE = {
  jumpShot: 0.58, // natural release at the top of the jump (sim may clamp the user's release to 0.45..0.8)
  freeThrow: 0.72,
  layup: 0.6,
  floater: 0.55,
  hook: 0.6,
  dunk: 0.6, // slam; hands hang on the rim 0.6..0.8
  pass: 0.4,
  inbound: 0.5,
  crossover: 0.5, // ball changes hands
  between: 0.5,
  behindBack: 0.5,
  steal: 0.4, // reach peak
  block: 0.5, // peak height
  contest: 0.5,
  rebound: 0.55, // highest point, hands at full reach
  jumpBall: 0.6, // tip
} as const;

/** Airborne window per action (fractions of actionDur) as authored by the rig's synthetic jump. */
export const AIRBORNE: Record<string, readonly [number, number]> = {
  jumpShot: [0.3, 0.9],
  layup: [0.35, 0.95],
  floater: [0.3, 0.95],
  hook: [0.35, 0.85],
  dunk: [0.3, 1.0],
  block: [0.15, 0.95],
  contest: [0.18, 0.86],
  rebound: [0.22, 0.88],
  jumpBall: [0.28, 0.95],
  stepBack: [0.22, 0.66],
};

/**
 * Ball position helpers for the sim, in the player's MODEL frame (x = player's left, y up from the feet, z forward),
 * as fractions of standing height. The rig's hands reach for wherever the sim puts the ball; these are the spots
 * that look natural. Convert with: world = pos + rotY(facing) * (x, y * H, z).
 */
export const BALL_SPOTS = {
  triple: { x: 0.08, y: 0.5, z: 0.22 }, // triple threat, ball at the hip on the shooting side (x sign: -1 for righties)
  chest: { x: 0, y: 0.68, z: 0.3 }, // catch / chest pass
  setPoint: { x: 0.03, y: 1.06, z: 0.14 }, // jump shot set point (above the forehead), relative to the feet at the jump
  dribbleTop: { x: 0.21, y: 0.42, z: 0.22 }, // top of a stationary dribble (x sign = dribble hand side, right = -x)
  dribbleLow: { x: 0.22, y: 0.32, z: 0.2 }, // crouched / protected dribble
} as const;
