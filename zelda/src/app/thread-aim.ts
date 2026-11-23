import type { ThreadAnchor } from "./contracts";

// Thread aim (DESIGN-V2 section 3, Aim). Pure and allocation-free so thread-sim.ts runs it offline.

/** Enemy id from an "enemy:<n>" anchor id, -1 when it is not one. Parses by char code: the frame loop builds no strings. */
export function enemyIdOf(id: string): number {
  if (!id.startsWith("enemy:") || id.length < 7) return -1;
  let v = 0;
  for (let i = 6; i < id.length; i++) {
    const c = id.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    v = v * 10 + c;
  }
  return v;
}

/** Vertical aim is this much looser than horizontal: a bowl or knot above the path is in reach without pitching the
 *  camera up to it (the camera sits behind and above Wren, so high anchors read low on screen). */
export const AIM_VERT = 2.2;

/** Index of the anchor the aim ray picks, or -1. (dx, dy, dz) is unit. `maxDist` is wider than the real range (checked
 *  from the lantern by the caller), so a target just past range is still picked and the HUD can say "Too far".
 *  `skip` (the pinned end 1) is never picked. `prefer` ranks anchors it accepts (inside the cone) above all others, so with end 1 pinned
 *  a valid end 2 behind or beside an invalid one still wins. Inside each rank the one closest to the reticle wins. */
export function pickAim(
  anchors: readonly ThreadAnchor[],
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cone: number, snapR: number, maxDist: number,
  lockId: number,
  skip: ThreadAnchor | null = null,
  prefer: ((a: ThreadAnchor) => boolean) | null = null,
): number {
  if (lockId >= 0) {
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.enabled && a !== skip && a.kind === "enemy" && enemyIdOf(a.id) === lockId) return i;
    }
  }
  // screen-vertical axis: world up with the ray's part removed
  let ux = -dx * dy, uy = 1 - dy * dy, uz = -dz * dy;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (ul < 1e-4) { ux = 0; uy = 0; uz = 1; } else { ux /= ul; uy /= ul; uz /= ul; }
  const coneV = cone * AIM_VERT, snapV = snapR * AIM_VERT;
  let best = -1;
  let bestRank = -1;
  let bestScore = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (!a.enabled || a === skip || (skip !== null && a.id === skip.id)) continue;
    const px = a.pos.x - ox, py = a.pos.y - oy, pz = a.pos.z - oz;
    const along = px * dx + py * dy + pz * dz;
    if (along <= 0.3) continue;
    const d2 = px * px + py * py + pz * pz;
    if (d2 > maxDist * maxDist) continue;
    const qx = px - along * dx, qy = py - along * dy, qz = pz - along * dz;
    const pv = qx * ux + qy * uy + qz * uz;
    const ph = Math.sqrt(Math.max(0, qx * qx + qy * qy + qz * qz - pv * pv));
    const ah = Math.atan2(ph, along) / cone, av = Math.atan2(Math.abs(pv), along) / coneV;
    const score = ah * ah + av * av; // <= 1 inside the cone (an ellipse, taller than wide)
    if (score > 1) {
      const sh = ph / snapR, sv = pv / snapV;
      if (sh * sh + sv * sv > 1) continue;
    }
    const rank = score <= 1 && prefer && prefer(a) ? 1 : 0; // a snap-radius-only hit never outranks the reticle
    if (rank > bestRank || (rank === bestRank && score < bestScore)) { bestRank = rank; bestScore = score; best = i; }
  }
  return best;
}
