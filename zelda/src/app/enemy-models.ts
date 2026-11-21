import * as THREE from "three";
import type { Look } from "./contracts";
import { at, leaf, merge, paint, paintByUp, rock, tatteredCone } from "./enemy-geo";
import type { PartDef } from "./enemy-rig";

// The three camp enemies, modeled from primitives. Models face local +z; part geometry is built around its pivot.

// ---- Brambling: knee-high thorny plant goblin (hips at 0.30 m) ----
export const B = { torso: 0, head: 1, eyes: 2, armL: 3, armR: 4, legL: 5, legR: 6, n: 7 } as const;

export function brambling(look: Look): PartDef[] {
  const vc = look.toon({ color: "#ffffff", vertexColors: true });
  const bark = "#4f6b34", belly = "#93a85c", thorn = "#3a2618", leafC = "#7fa246", leafD = "#5c8236", twig = "#6b4a2e";

  const torso: THREE.BufferGeometry[] = [
    paint(at(new THREE.SphereGeometry(0.27, 10, 8), 0, 0.2, 0, 0, 0, 0, 1, 1.05, 0.92), bark),
    paint(at(new THREE.SphereGeometry(0.2, 8, 6), 0, 0.16, 0.12, 0, 0, 0, 1, 1, 0.55), belly),
  ];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9 + (i % 2) * 0.12;
    const y = 0.12 + (i % 3) * 0.1;
    const r = 0.25;
    torso.push(paint(at(new THREE.ConeGeometry(0.045, 0.2, 5), Math.sin(a) * r, y, Math.cos(a) * r, Math.PI / 2 - 0.25, a, 0), i % 2 ? thorn : "#7a2a22"));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    torso.push(paint(at(leaf(0.26, 0.09), Math.sin(a) * 0.14, 0.4, Math.cos(a) * 0.14, 1.15, a, 0), i % 2 ? leafC : leafD));
  }

  const head: THREE.BufferGeometry[] = [
    paint(at(new THREE.SphereGeometry(0.21, 10, 8), 0, 0.15, 0.02, 0, 0, 0, 1.1, 0.95, 1), "#5f8a3c"),
    paint(at(new THREE.BoxGeometry(0.2, 0.04, 0.06), 0, 0.06, 0.2, 0.2), "#2b2118"),
    paint(at(leaf(0.46, 0.1), 0.22, 0.24, -0.02, 0, 0, -1.05), leafC),
    paint(at(leaf(0.46, 0.1), -0.22, 0.24, -0.02, 0, 0, 1.05), leafC),
    paint(at(leaf(0.3, 0.06), 0.2, 0.22, 0.0, 0, 0, -1.2, 1, 1, 1.4), "#b8c86a"),
    paint(at(leaf(0.3, 0.06), -0.2, 0.22, 0.0, 0, 0, 1.2, 1, 1, 1.4), "#b8c86a"),
    paint(at(new THREE.CylinderGeometry(0.015, 0.02, 0.16, 4), 0, 0.38, -0.03, -0.3), twig),
    paint(at(leaf(0.16, 0.06), 0.05, 0.46, -0.06, 0, 0, -0.9), leafC),
    paint(at(new THREE.ConeGeometry(0.03, 0.12, 4), 0.09, 0.27, 0.16, -0.9, 0, -0.5), thorn),
    paint(at(new THREE.ConeGeometry(0.03, 0.12, 4), -0.09, 0.27, 0.16, -0.9, 0, 0.5), thorn),
  ];
  for (let i = 0; i < 4; i++) head.push(paint(at(new THREE.ConeGeometry(0.014, 0.05, 3), -0.06 + i * 0.04, 0.075, 0.215, Math.PI), "#e8dcc0"));

  const eyes = merge([
    paint(at(new THREE.SphereGeometry(0.048, 8, 6), 0.08, 0, 0), "#ffffff"),
    paint(at(new THREE.SphereGeometry(0.048, 8, 6), -0.08, 0, 0), "#ffffff"),
  ]);
  const arm = (s: number) =>
    merge([
      paint(at(new THREE.CylinderGeometry(0.028, 0.04, 0.36, 5), 0, -0.17, 0, 0, 0, s * 0.12), twig),
      paint(at(new THREE.SphereGeometry(0.05, 6, 4), s * 0.02, -0.35, 0), twig),
      paint(at(new THREE.ConeGeometry(0.018, 0.14, 4), s * 0.02, -0.44, 0.04, Math.PI - 0.3), thorn),
      paint(at(new THREE.ConeGeometry(0.018, 0.14, 4), s * 0.05, -0.43, -0.01, Math.PI, 0, s * 0.3), thorn),
      paint(at(new THREE.ConeGeometry(0.018, 0.14, 4), -s * 0.01, -0.43, -0.03, Math.PI + 0.3, 0, -s * 0.3), thorn),
      paint(at(leaf(0.12, 0.04), s * 0.04, -0.12, 0.02, 0, 0, -s * 1.3), leafC),
    ]);
  const leg = () =>
    merge([
      paint(at(new THREE.CylinderGeometry(0.032, 0.045, 0.3, 5), 0, -0.15, 0), twig),
      paint(at(new THREE.ConeGeometry(0.06, 0.18, 5), 0, -0.29, 0.06, Math.PI / 2, 0, 0, 1, 1, 0.5), "#4a3222"),
      paint(at(new THREE.ConeGeometry(0.03, 0.12, 4), 0.05, -0.3, -0.02, -Math.PI / 2 - 0.3, 0.6, 0, 1, 1, 0.6), "#4a3222"),
    ]);
  return [
    { geo: merge(torso), mat: vc, glow: true },
    { geo: merge(head), mat: vc, glow: true },
    { geo: eyes, mat: look.toon({ color: "#e8382c", emissive: "#ff3b2a", emissiveIntensity: 1.4 }), shadow: false },
    { geo: arm(1), mat: vc },
    { geo: arm(-1), mat: vc },
    { geo: leg(), mat: vc },
    { geo: leg(), mat: vc },
  ];
}

// ---- Mossback: 2.6 m hunched brute with a mossy boulder on its back (hips at 1.0 m) ----
export const M = { torso: 0, shell: 1, head: 2, eyes: 3, armL: 4, armR: 5, legL: 6, legR: 7, n: 8 } as const;

export function mossback(look: Look): PartDef[] {
  const vc = look.toon({ color: "#ffffff", vertexColors: true });
  const hide = "#5d6450", hideLo = "#4a5040", chest = "#7f7c66", stone = "#8d8473", moss = "#6f8a4a";

  const torso = merge([
    paint(at(new THREE.SphereGeometry(0.75, 12, 9), 0, 0.42, 0.05, 0.35, 0, 0, 1.15, 0.95, 0.9), hide),
    paint(at(new THREE.SphereGeometry(0.55, 10, 8), 0, 0.42, 0.45, 0.2, 0, 0, 1.1, 0.95, 0.6), chest),
    paint(at(new THREE.SphereGeometry(0.5, 10, 8), 0, 0.02, 0.1, 0, 0, 0, 1.1, 0.7, 0.9), hideLo),
    paint(at(new THREE.SphereGeometry(0.38, 8, 6), 0.72, 0.62, 0.2, 0, 0, 0, 1, 0.85, 1), hide),
    paint(at(new THREE.SphereGeometry(0.38, 8, 6), -0.72, 0.62, 0.2, 0, 0, 0, 1, 0.85, 1), hide),
  ]);

  const boulder = paintByUp(rock(1.0, 1, 0.16, 3).scale(1.2, 0.85, 1.05), moss, stone, 0.25, 7);
  const shellParts: THREE.BufferGeometry[] = [at(boulder, 0, 0.12, -0.12, 0.25)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const r = 0.35 + (i % 3) * 0.17;
    shellParts.push(paint(at(leaf(0.42 + (i % 2) * 0.2, 0.1), Math.sin(a) * r, 0.86 - r * 0.25, Math.cos(a) * r - 0.1, Math.cos(a) * 0.5, a, Math.sin(a) * 0.5), i % 2 ? "#5f8a3a" : "#88a84e"));
  }
  shellParts.push(paint(at(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 5), 0.5, 0.6, 0.45), "#e7dcc2"));
  shellParts.push(paint(at(new THREE.SphereGeometry(0.11, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0.5, 0.68, 0.45, 0, 0, 0, 1, 0.6, 1), "#c4553a"));
  shellParts.push(paint(at(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 5), 0.62, 0.55, 0.38), "#e7dcc2"));
  shellParts.push(paint(at(new THREE.SphereGeometry(0.075, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0.62, 0.61, 0.38, 0, 0, 0, 1, 0.6, 1), "#d9a24a"));
  for (let i = 0; i < 5; i++) {
    const a = -1.2 + i * 0.6;
    shellParts.push(paint(at(new THREE.ConeGeometry(0.05, 0.4, 4), Math.sin(a) * 0.9, -0.45, Math.cos(a) * 0.55 - 0.4, 0.4, a, 0, 1, 1, 0.3), "#5a7a3a"));
  }
  const shell = merge(shellParts);

  const head = merge([
    paint(at(new THREE.SphereGeometry(0.34, 10, 8), 0, 0.02, 0.08, 0, 0, 0, 1.1, 0.85, 1), hideLo),
    paint(at(new THREE.BoxGeometry(0.62, 0.22, 0.4), 0, -0.16, 0.2, 0.15), "#55594a"),
    paint(at(rock(0.2, 0, 0.2, 5), 0, 0.2, 0.22, 0, 0, 0, 1.9, 0.6, 0.9), stone),
    paint(at(new THREE.ConeGeometry(0.05, 0.22, 5), 0.2, 0.02, 0.38, -0.25), "#e4d9bd"),
    paint(at(new THREE.ConeGeometry(0.05, 0.22, 5), -0.2, 0.02, 0.38, -0.25), "#e4d9bd"),
  ]);
  const eyes = merge([
    paint(at(new THREE.SphereGeometry(0.06, 8, 6), 0.14, 0, 0), "#ffffff"),
    paint(at(new THREE.SphereGeometry(0.06, 8, 6), -0.14, 0, 0), "#ffffff"),
  ]);
  const arm = (s: number) =>
    merge([
      paint(at(new THREE.CylinderGeometry(0.2, 0.24, 0.78, 8), 0, -0.36, 0, 0, 0, s * 0.08), hide),
      paint(at(new THREE.CylinderGeometry(0.17, 0.21, 0.62, 8), s * 0.04, -0.98, 0.05, 0.12), hideLo),
      at(paintByUp(rock(0.4, 0, 0.18, s * 11).scale(1, 0.95, 1.05), moss, stone, 0.6, s), s * 0.04, -1.38, 0.1),
      paint(at(rock(0.18, 0, 0.2, s * 4), s * 0.12, -0.25, -0.12, 0, 0, 0, 1, 0.7, 1), stone),
    ]);
  const leg = (s: number) =>
    merge([
      paint(at(new THREE.CylinderGeometry(0.24, 0.3, 0.7, 8), 0, -0.4, 0), hideLo),
      paint(at(new THREE.BoxGeometry(0.5, 0.2, 0.62), s * 0.03, -0.9, 0.1), "#4a4e3e"),
      paint(at(new THREE.ConeGeometry(0.06, 0.14, 4), 0.14, -0.9, 0.44, Math.PI / 2), "#e4d9bd"),
      paint(at(new THREE.ConeGeometry(0.06, 0.14, 4), -0.14, -0.9, 0.44, Math.PI / 2), "#e4d9bd"),
    ]);
  return [
    { geo: torso, mat: vc, glow: true },
    { geo: shell, mat: vc, glow: true },
    { geo: head, mat: vc, glow: true },
    { geo: eyes, mat: look.toon({ color: "#c58be0", emissive: "#d7a6ff", emissiveIntensity: 1.6 }), shadow: false },
    { geo: arm(1), mat: vc, glow: true },
    { geo: arm(-1), mat: vc, glow: true },
    { geo: leg(1), mat: vc },
    { geo: leg(-1), mat: vc },
  ];
}

// ---- Wisp archer: floating paper-lantern body, hooded flame head (pos = lantern center) ----
export const W = { lantern: 0, hood: 1, flame: 2, tails: 3, armL: 4, armR: 5, n: 6 } as const;

export function wisp(look: Look): PartDef[] {
  const vc = look.toon({ color: "#ffffff", vertexColors: true });
  const prof: THREE.Vector2[] = [];
  const pts = [[0.04, -0.42], [0.18, -0.38], [0.28, -0.22], [0.31, -0.02], [0.28, 0.16], [0.18, 0.3], [0.06, 0.34]];
  for (const [x, y] of pts) prof.push(new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(prof, 10).toNonIndexed();
  lathe.deleteAttribute("uv");
  lathe.computeVertexNormals();
  const p = lathe.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const paper = new THREE.Color("#f2ddb0"), rib = new THREE.Color("#9a6f43");
  for (let f = 0; f < p.count; f += 3) {
    const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    const band = Math.abs(((y + 0.42) / 0.152) % 1 - 0.5) > 0.4;
    const c = band ? rib : paper;
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  lathe.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const lantern = merge([
    lathe,
    paint(at(new THREE.TorusGeometry(0.2, 0.035, 5, 12), 0, -0.4, 0, Math.PI / 2), "#4a2e1c"),
    paint(at(new THREE.CylinderGeometry(0.03, 0.05, 0.16, 5), 0, -0.52, 0), "#4a2e1c"),
    paint(at(new THREE.ConeGeometry(0.06, 0.18, 6), 0, -0.66, 0, Math.PI), "#b8402b"),
  ]);
  const hood = merge([
    paint(at(new THREE.SphereGeometry(0.33, 14, 8, Math.PI / 2 + 1.0, Math.PI * 2 - 2.0, 0, Math.PI * 0.64), 0, 0.02, 0, 0, 0, 0, 1, 1.15, 1), "#5b3d78"),
    paint(at(new THREE.ConeGeometry(0.2, 0.42, 8), 0, 0.5, -0.12, -0.55), "#5b3d78"),
    paint(at(new THREE.TorusGeometry(0.25, 0.035, 5, 14, Math.PI * 1.15), 0, 0.03, 0.2, -0.15, 0, -Math.PI * 0.075), "#d6ad45"),
    paint(at(tatteredCone(0.3, 0.42, 0.34, 12, 0.12, 3), 0, -0.2, -0.02), "#4a3163"),
    paint(at(new THREE.SphereGeometry(0.035, 6, 4), 0.075, 0.05, 0.24, 0, 0, 0, 1, 1.5, 1), "#1a0f24"),
    paint(at(new THREE.SphereGeometry(0.035, 6, 4), -0.075, 0.05, 0.24, 0, 0, 0, 1, 1.5, 1), "#1a0f24"),
  ]);
  const flame = merge([
    paint(at(new THREE.SphereGeometry(0.19, 10, 8), 0, 0, 0.02), "#ffffff"),
    paint(at(new THREE.ConeGeometry(0.13, 0.34, 8), 0, 0.22, -0.02, -0.25), "#ffffff"),
  ]);
  const tails: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    tails.push(paint(at(new THREE.PlaneGeometry(0.17, 0.5 + (i % 2) * 0.22, 1, 3), Math.sin(a) * 0.17, -0.27 - (i % 2) * 0.1, Math.cos(a) * 0.17, 0.3, a, 0), i % 2 ? "#7a58a0" : "#5b3d78"));
  }
  const arm = (s: number) =>
    merge([
      paint(at(new THREE.ConeGeometry(0.08, 0.32, 6, 1, true), 0, -0.14, 0, Math.PI), "#5b3d78"),
      paint(at(new THREE.SphereGeometry(0.05, 6, 4), 0, -0.3, 0.02), "#d8c4ee"),
      paint(at(new THREE.ConeGeometry(0.015, 0.1, 3), s * 0.02, -0.36, 0.05, Math.PI - 0.4), "#d8c4ee"),
      paint(at(new THREE.ConeGeometry(0.015, 0.1, 3), -s * 0.02, -0.36, 0.05, Math.PI - 0.4), "#d8c4ee"),
    ]);
  const cloth = look.toon({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
  return [
    { geo: lantern, mat: look.toon({ color: "#ffffff", vertexColors: true, emissive: "#7b4fa6", emissiveIntensity: 0.55 }), glow: true },
    { geo: hood, mat: cloth },
    { geo: flame, mat: look.toon({ color: "#e2c4ff", emissive: "#b67dff", emissiveIntensity: 1.8 }), glow: true, shadow: false },
    { geo: merge(tails), mat: cloth },
    { geo: arm(1), mat: cloth },
    { geo: arm(-1), mat: cloth },
  ];
}
