// HOOPS fx: net ripple helper for the arena builder (optional to use). A damped spring per basket driven by events.
// Arena calls ripple.handle(events) and ripple.update(dt) each frame, then for each net vertex at depth v (0 rim ..
// 1 bottom) and angle a: radial += ripple.radial(side, v, a); y += ripple.lift(side, v). sway(side) gives a whole-net
// lateral offset for the bottom ring. No allocations per frame.
// Owner: audio-fx.
import type { Dir, GameEvent } from "./contracts";

interface Spring {
  x: number; // radial bulge amplitude (m)
  v: number;
  y: number; // vertical lift (m), negative pulls the net down
  vy: number;
  sx: number; // lateral sway
  sz: number;
  vsx: number;
  vsz: number;
  ph: number; // travelling wave phase
  wave: number; // travelling wave amplitude
}

const mk = (): Spring => ({ x: 0, v: 0, y: 0, vy: 0, sx: 0, sz: 0, vsx: 0, vsz: 0, ph: 0, wave: 0 });

export function createNetRipple() {
  const s: [Spring, Spring] = [mk(), mk()];
  const idx = (side: Dir | 0) => (side === 1 ? 1 : 0);

  function kick(side: Dir | 0, bulge: number, lift: number, sway: number) {
    const sp = s[idx(side)];
    sp.v += bulge;
    sp.vy += lift;
    const a = Math.random() * Math.PI * 2;
    sp.vsx += Math.cos(a) * sway;
    sp.vsz += Math.sin(a) * sway;
    sp.wave = Math.min(0.05, sp.wave + Math.abs(bulge) * 0.04);
  }

  return {
    handle(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.type === "swish") kick(e.side, 0.9, -0.9, 0.35);
        else if (e.type === "net") kick(e.side, 0.6 * e.strength + 0.3, -0.6, 0.25);
        else if (e.type === "dunk") kick(e.side, 1.4, -1.6, 0.8);
        else if (e.type === "rim") kick(e.side, 0.15 * e.strength, 0.1, 0.2 * e.strength);
        else if (e.type === "make" && !e.swish) kick(e.side, 0.4, -0.4, 0.2);
      }
    },
    /** Kick directly (e.g. from ball.inNet). */
    kick,
    update(dt: number) {
      for (const sp of s) {
        // net cord: stiff-ish, quickly damped
        sp.v += (-sp.x * 180 - sp.v * 9) * dt;
        sp.x += sp.v * dt;
        sp.vy += (-sp.y * 120 - sp.vy * 7) * dt;
        sp.y += sp.vy * dt;
        sp.vsx += (-sp.sx * 60 - sp.vsx * 3.5) * dt;
        sp.vsz += (-sp.sz * 60 - sp.vsz * 3.5) * dt;
        sp.sx += sp.vsx * dt;
        sp.sz += sp.vsz * dt;
        sp.ph += dt * 14;
        sp.wave *= Math.exp(-dt * 4);
      }
    },
    /** Radial displacement (m) for a net vertex at depth v (0 rim .. 1 bottom) and angle a (rad). */
    radial(side: Dir | 0, v: number, a: number) {
      const sp = s[idx(side)];
      return sp.x * 0.05 * Math.sin(Math.PI * v) + sp.wave * Math.sin(v * 9 - sp.ph + a * 2) * v;
    },
    /** Vertical offset (m) for depth v. */
    lift(side: Dir | 0, v: number) {
      return s[idx(side)].y * 0.08 * v;
    },
    /** Lateral sway (m) at depth v along x and z. */
    swayX(side: Dir | 0, v: number) {
      return s[idx(side)].sx * 0.12 * v * v;
    },
    swayZ(side: Dir | 0, v: number) {
      return s[idx(side)].sz * 0.12 * v * v;
    },
  };
}
export type NetRipple = ReturnType<typeof createNetRipple>;
