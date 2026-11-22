import * as THREE from "three";
import type { EnemyKind, EnemyState, FrameCtx, GameEvent, Look } from "./contracts";
import { ENEMY, SWORD, WARDEN_PHASES } from "./contracts";
import { angleDiff } from "./state";
import { fireBolt, move, turnTo, v3 } from "./enemy-brain";
import type { EnemyRt, Host } from "./enemy-brain";
import { at, hash3, inflate, leaf, merge, paint, rock, tatteredCone } from "./enemy-geo";

// The Gloam Warden: a 6 m armored shade with a crown of broken lanterns and a cloak of violet smoke. One instance, a
// plain bone hierarchy (about 20 draw calls). Three phases; every attack has a wind-up glow and, where it hits an area,
// a ground telegraph.

const ARENA_R = 34;
const WALK_R = 29;

const C = {
  hipY: 0, torsoX: 1, torsoY: 2, torsoZ: 3, headX: 4, headY: 5,
  rShX: 6, rShY: 7, rShZ: 8, rEl: 9, swX: 10, swZ: 11,
  lShX: 12, lShY: 13, lShZ: 14, lEl: 15, cape: 16, n: 17,
} as const;
type PoseDef = Partial<Record<Exclude<keyof typeof C, "n">, number>>;
const BASE: PoseDef = { hipY: 0, torsoX: 0.12, rShX: -0.35, rShZ: -0.18, rEl: -0.9, swX: 2.3, lShX: -0.1, lShZ: 0.3, lEl: -0.5 };
function pose(d: PoseDef): Float32Array {
  const a = new Float32Array(C.n);
  for (const [k, v] of Object.entries({ ...BASE, ...d })) a[C[k as keyof PoseDef]] = v as number;
  return a;
}
const P = {
  idle: pose({}),
  walk: pose({ torsoX: 0.2, rShX: -0.15, swX: 2.0 }),
  c1w: pose({ torsoY: -0.75, torsoX: 0.05, rShX: -1.25, rShY: -2.0, rShZ: 0, rEl: -0.2, swX: 1.45, lShX: -0.6, lShZ: 0.6, hipY: -0.15 }),
  c1h: pose({ torsoY: 0.7, torsoX: 0.25, rShX: -1.35, rShY: 1.35, rShZ: 0, rEl: -0.1, swX: 1.55, lShX: 0.3, lShZ: 0.5, hipY: -0.25 }),
  c2w: pose({ torsoY: 0.85, torsoX: 0.1, rShX: -1.25, rShY: 1.9, rShZ: 0, rEl: -0.25, swX: 1.45, lShX: 0.2, lShZ: 0.7, hipY: -0.15 }),
  c2h: pose({ torsoY: -0.7, torsoX: 0.25, rShX: -1.35, rShY: -1.4, rShZ: 0, rEl: -0.1, swX: 1.55, lShX: -0.4, lShZ: 0.4, hipY: -0.25 }),
  c3w: pose({ torsoX: -0.3, hipY: 0.3, rShX: -3.35, rShY: 0.15, rShZ: 0.1, rEl: -0.7, swX: 1.3, lShX: -3.2, lShY: -0.15, lShZ: -0.35, lEl: -0.7, headX: -0.2 }),
  c3h: pose({ torsoX: 0.6, hipY: -0.45, rShX: -0.75, rShY: 0.15, rShZ: 0.05, rEl: -0.1, swX: 1.6, lShX: -0.8, lShY: -0.3, lShZ: -0.3, lEl: -0.3, headX: 0.25 }),
  lw: pose({ torsoX: -0.05, hipY: -0.55, torsoY: -0.35, rShX: 0.55, rShZ: -0.25, rEl: -1.75, swX: 1.6, lShX: -1.1, lShZ: 0.5, lEl: -0.4 }),
  lh: pose({ torsoX: 0.55, hipY: -0.35, torsoY: 0.25, rShX: -1.5, rShY: 0.1, rShZ: 0, rEl: 0, swX: 1.57, lShX: 0.5, lShZ: 0.4 }),
  sw: pose({ torsoX: -0.35, hipY: 0.4, rShX: -3.1, rShZ: 0.25, rEl: -0.35, swX: 1.6, lShX: -3.1, lShZ: -0.3, lEl: -0.35, headX: -0.25 }),
  sh: pose({ torsoX: 0.8, hipY: -0.7, rShX: -0.55, rShZ: 0.1, rEl: -0.1, swX: 1.65, lShX: -0.55, lShZ: -0.1, lEl: -0.1, headX: 0.3 }),
  vw: pose({ torsoX: -0.2, headX: -0.35, lShX: -2.9, lShZ: 0.35, lEl: -0.2, rShX: -0.2, swX: 2.5 }),
  vh: pose({ torsoX: 0.15, lShX: -1.55, lShZ: 0.1, lEl: 0, rShX: -0.2, swX: 2.5 }),
  bw: pose({ torsoX: -0.25, headX: -0.4, rShX: -3.1, rShY: 0, rShZ: 0, rEl: 0, swX: 1.57, lShX: -0.3, lShZ: 0.9, hipY: 0.2 }),
  bh: pose({ torsoX: 0.2, hipY: -0.3, rShX: -1.5, rShY: -1.57, rShZ: 0, rEl: 0, swX: 1.57, lShX: -0.3, lShZ: 1.2, torsoY: -0.4 }),
  kneel: pose({ hipY: -1.25, torsoX: 0.7, headX: 0.45, rShX: -0.65, rShZ: -0.2, rEl: -0.2, swX: 2.7, lShX: -0.9, lShZ: 0.2, lEl: -0.6 }),
  roar: pose({ hipY: 0.25, torsoX: -0.45, headX: -0.6, rShX: -0.3, rShZ: -1.25, rEl: -0.3, swX: 2.0, lShX: -0.3, lShZ: 1.25, lEl: -0.3 }),
  summon: pose({ torsoX: 0.5, hipY: -0.5, rShX: -0.9, rShZ: 0.05, rEl: -0.2, swX: 2.0, lShX: -0.4, lShZ: 1.1, headX: -0.3 }),
  dead: pose({ hipY: -1.9, torsoX: 1.1, headX: 0.6, rShX: 0.2, rShZ: -0.5, rEl: 0, swX: 2.9, lShX: 0.2, lShZ: 0.5, lEl: 0 }),
};

const enum A { None, Chain, Lunge, Slam, Volley, Beam, Summon, Roar, Stagger, Death }

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Warden {
  readonly root = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly cape = new THREE.Group();
  private readonly skirt = new THREE.Group();
  private readonly rSh = new THREE.Group();
  private readonly rEl = new THREE.Group();
  private readonly sword = new THREE.Group();
  private readonly lSh = new THREE.Group();
  private readonly lEl = new THREE.Group();
  private readonly tip = new THREE.Object3D();
  private readonly palm = new THREE.Object3D();
  private readonly lanterns: THREE.Object3D[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly glowBody = new THREE.MeshBasicMaterial({ color: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  private readonly glowBlade = new THREE.MeshBasicMaterial({ color: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  private readonly cur = new Float32Array(C.n);
  private tgt: Float32Array = P.idle;
  private rate = 6;

  phase = 1;
  private atk = A.None;
  private atkT = 0;
  private step = 0;
  private fired = 0;
  private last = A.None;
  private crownHits = 0;
  private weak = 0; // vulnerability window left (s)
  private summoned = false;
  private nextPhase = 0;
  private beamYaw = 0;
  private beamPrev = 0;
  private beamHit = false;
  private beamDir = 1;
  private readonly waves = [0, 1, 2].map(() => ({ on: false, x: 0, y: 0, z: 0, r: 0, hit: false }));
  private flare = 0; // arena edge flare
  private deathT = -1;
  private dropped = false;
  private glow = 0;
  private hitDone = false;
  private sweepPrev = 0;
  readonly crown = new THREE.Vector3();
  readonly summonAt: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(group: THREE.Group, look: Look) {
    const vc = look.toon({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
    const glow = look.toon({ color: "#e3c8ff", emissive: "#b07ee6", emissiveIntensity: 2.0 });
    const lamp = look.toon({ color: "#ffe6a8", emissive: "#f3b14e", emissiveIntensity: 1.8 });
    const iron = "#3a3544", ironHi = "#5d5470", ironLo = "#28232f", gold = "#9a7628", cloakA = "#4d3160", cloakB = "#2b1c37";
    const add = (bone: THREE.Object3D, mat: THREE.Material, list: THREE.BufferGeometry[], shadow = true) => {
      const g = merge(list);
      this.geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow;
      bone.add(m);
      return m;
    };
    const overlay = (bone: THREE.Object3D, mat: THREE.Material, src: THREE.Mesh, by: number) => {
      const g = inflate(src.geometry, by);
      this.geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 3;
      bone.add(m);
    };

    this.root.add(this.hips);
    this.hips.position.y = 2.5;
    this.hips.add(this.torso, this.skirt);
    this.torso.position.y = 0.15;
    add(this.skirt, vc, [
      paint(at(tatteredCone(0.95, 2.0, 2.7, 16, 0.55, 1), 0, -1.25, 0), cloakA),
      paint(at(tatteredCone(0.85, 1.6, 2.5, 14, 0.45, 2), 0, -1.3, 0.05, 0, 0.3), cloakB),
      paint(at(new THREE.BoxGeometry(0.9, 1.0, 0.12), 0, -0.45, 0.95, -0.28), iron),
      paint(at(new THREE.BoxGeometry(0.9, 1.0, 0.12), 0.85, -0.45, 0.35, -0.25, Math.PI / 2 - 0.3, 0), ironHi),
      paint(at(new THREE.BoxGeometry(0.9, 1.0, 0.12), -0.85, -0.45, 0.35, -0.25, -Math.PI / 2 + 0.3, 0), ironHi),
      paint(at(new THREE.TorusGeometry(0.92, 0.09, 6, 18), 0, 0.05, 0, Math.PI / 2), gold),
    ]);
    const chest: THREE.BufferGeometry[] = [
      paint(at(new THREE.CylinderGeometry(1.0, 0.72, 1.8, 8), 0, 0.9, 0, 0, Math.PI / 8, 0, 1, 1, 0.78), iron),
      paint(at(new THREE.BoxGeometry(1.1, 1.0, 0.25), 0, 1.05, 0.55, -0.12), ironHi),
      paint(at(new THREE.TorusGeometry(0.55, 0.1, 6, 12), 0, 1.78, 0, Math.PI / 2), gold),
      paint(at(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 8), 0, 1.75, 0), ironLo),
    ];
    for (const s of [1, -1]) {
      chest.push(paint(at(new THREE.SphereGeometry(0.62, 10, 8), s * 1.15, 1.55, 0, 0, 0, s * -0.3, 1.05, 0.62, 0.95), ironHi));
      chest.push(paint(at(new THREE.TorusGeometry(0.6, 0.06, 5, 14), s * 1.15, 1.42, 0, Math.PI / 2, 0, s * -0.3, 1.05, 0.95, 1), gold));
      for (let i = 0; i < 3; i++) chest.push(paint(at(new THREE.ConeGeometry(0.1, 0.6 - i * 0.12, 5), s * (1.05 + i * 0.2), 1.95 - i * 0.08, -0.15 + i * 0.12, -0.2, 0, s * -(0.35 + i * 0.25)), ironLo));
    }
    add(this.torso, vc, chest);
    const rune = add(this.torso, glow, [
      paint(at(new THREE.BoxGeometry(0.1, 0.7, 0.06), 0, 1.05, 0.69, -0.12), "#ffffff"),
      paint(at(new THREE.BoxGeometry(0.5, 0.08, 0.06), 0, 1.25, 0.67, -0.12), "#ffffff"),
    ], false);
    void rune;
    const bodyShell = new THREE.Mesh(this.torso.children[0] instanceof THREE.Mesh ? (this.torso.children[0] as THREE.Mesh).geometry : new THREE.BufferGeometry());
    overlay(this.torso, this.glowBody, bodyShell, 0.09);

    this.torso.add(this.cape);
    this.cape.position.set(0, 1.7, -0.55);
    const capeG = new THREE.PlaneGeometry(2.3, 4.1, 6, 8);
    const cp = capeG.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i);
      const t = (2.05 - y) / 4.1;
      cp.setX(i, x * (0.8 + t * 0.5));
      cp.setZ(i, -t * t * 0.9 - Math.abs(x) * 0.15 + 0.08 * hash3(x, y, 3));
      if (t > 0.95) cp.setY(i, y + Math.abs(hash3(x * 9, 1, 1)) * 0.5);
    }
    capeG.computeVertexNormals();
    add(this.cape, vc, [paint(at(capeG, 0, -2.05, 0), cloakB)]);

    this.torso.add(this.head);
    this.head.position.set(0, 1.85, 0.05);
    const helm: THREE.BufferGeometry[] = [
      paint(at(new THREE.CylinderGeometry(0.4, 0.46, 0.8, 6), 0, 0.38, 0, 0, Math.PI / 6), iron),
      paint(at(new THREE.BoxGeometry(0.62, 0.55, 0.2), 0, 0.33, 0.36, 0.1), ironHi),
      paint(at(new THREE.ConeGeometry(0.42, 0.3, 6), 0, 0.92, 0, 0, Math.PI / 6), ironLo),
      paint(at(new THREE.TorusGeometry(0.47, 0.06, 5, 14), 0, 0.78, 0, Math.PI / 2), gold),
    ];
    const lampG: THREE.BufferGeometry[] = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.2;
      const broken = i === 2 || i === 5;
      const lean = 0.35 + (broken ? 0.45 : 0);
      const x = Math.sin(a) * 0.46, z = Math.cos(a) * 0.46;
      helm.push(paint(at(new THREE.ConeGeometry(0.06, 0.75, 4), x * 1.1, 1.15, z * 1.1, Math.cos(a) * lean, 0, -Math.sin(a) * lean), ironLo));
      const h = broken ? 1.25 : 1.42;
      const lx = x * (1.1 + lean * 0.7), lz = z * (1.1 + lean * 0.7);
      helm.push(paint(at(new THREE.BoxGeometry(0.2, 0.05, 0.2), lx, h + 0.14, lz, broken ? 0.5 : 0, a, broken ? 0.4 : 0), ironLo));
      helm.push(paint(at(new THREE.BoxGeometry(0.2, 0.05, 0.2), lx, h - 0.13, lz, 0, a, 0), ironLo));
      if (broken) helm.push(paint(at(new THREE.BoxGeometry(0.15, 0.2, 0.15), lx, h, lz, 0.2, a, 0.25), "#3c2f26"));
      else {
        lampG.push(paint(at(new THREE.BoxGeometry(0.16, 0.24, 0.16), lx, h, lz, 0, a, 0), "#ffffff"));
        const o = new THREE.Object3D();
        o.position.set(lx, h, lz);
        this.head.add(o);
        this.lanterns.push(o);
      }
    }
    add(this.head, vc, helm);
    add(this.head, lamp, lampG, false);
    add(this.head, glow, [paint(at(new THREE.BoxGeometry(0.46, 0.06, 0.06), 0, 0.42, 0.47, 0.1), "#ffffff"), paint(at(new THREE.BoxGeometry(0.06, 0.2, 0.06), 0, 0.3, 0.47, 0.1), "#ffffff")], false);

    const arm = (sh: THREE.Group, el: THREE.Group, s: number) => {
      this.torso.add(sh);
      sh.position.set(s * 1.25, 1.45, 0);
      sh.rotation.order = "YXZ";
      add(sh, vc, [
        paint(at(new THREE.CylinderGeometry(0.3, 0.26, 1.15, 8), 0, -0.55, 0), ironLo),
        paint(at(new THREE.SphereGeometry(0.34, 8, 6), 0, -1.12, 0), ironHi),
      ]);
      sh.add(el);
      el.position.y = -1.12;
      add(el, vc, [
        paint(at(new THREE.CylinderGeometry(0.26, 0.22, 1.0, 8), 0, -0.5, 0), iron),
        paint(at(new THREE.CylinderGeometry(0.33, 0.27, 0.45, 8), 0, -0.75, 0), ironHi),
        paint(at(new THREE.TorusGeometry(0.31, 0.05, 5, 12), 0, -0.52, 0, Math.PI / 2), gold),
        paint(at(rock(0.27, 0, 0.12, s * 5), 0, -1.12, 0.04, 0, 0, 0, 1, 1.05, 1.1), ironLo),
      ]);
    };
    arm(this.rSh, this.rEl, -1);
    arm(this.lSh, this.lEl, 1);
    const claw: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) claw.push(paint(at(new THREE.ConeGeometry(0.06, 0.45, 4), -0.18 + i * 0.12, -1.4, 0.1, 0.25, 0, 0), ironLo));
    add(this.lEl, vc, claw);
    this.lEl.add(this.palm);
    this.palm.position.set(0, -1.3, 0.3);
    this.rEl.add(this.sword);
    this.sword.position.set(0, -1.12, 0.05);
    const blade = add(this.sword, vc, [
      paint(at(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6), 0, 0.05, 0), "#2a2030"),
      paint(at(new THREE.SphereGeometry(0.12, 6, 4), 0, -0.36, 0), gold),
      paint(at(new THREE.BoxGeometry(1.1, 0.14, 0.24), 0, 0.45, 0), ironHi),
      paint(at(new THREE.ConeGeometry(0.09, 0.3, 4), 0.62, 0.45, 0, 0, 0, -Math.PI / 2), ironHi),
      paint(at(new THREE.ConeGeometry(0.09, 0.3, 4), -0.62, 0.45, 0, 0, 0, Math.PI / 2), ironHi),
      paint(at(new THREE.BoxGeometry(0.46, 4.1, 0.13), 0, 2.6, 0), "#2c2734"),
      paint(at(new THREE.ConeGeometry(0.33, 0.7, 4), 0, 4.98, 0, 0, Math.PI / 4, 0, 1, 1, 0.3), "#2c2734"),
    ]);
    add(this.sword, glow, [paint(at(new THREE.BoxGeometry(0.08, 3.8, 0.17), 0, 2.55, 0), "#ffffff")], false);
    const bladeShell = new THREE.Mesh(merge([paint(at(new THREE.BoxGeometry(0.5, 4.4, 0.2), 0, 2.75, 0), "#fff")]));
    this.geos.push(bladeShell.geometry);
    overlay(this.sword, this.glowBlade, bladeShell, 0.06);
    void blade;
    this.sword.add(this.tip);
    this.tip.position.set(0, 5.1, 0);
    // smoke wisps trailing from the cloak hem
    add(this.skirt, vc, [0, 1, 2, 3, 4].map((i) => paint(at(leaf(1.2, 0.35), Math.sin(i * 1.3) * 1.6, -2.1, Math.cos(i * 1.3) * 1.6, 0.4 * Math.cos(i * 1.3), i, -0.4 * Math.sin(i * 1.3)), i % 2 ? cloakA : cloakB)), false);

    this.root.visible = false;
    group.add(this.root);
    this.cur.set(P.idle);
  }

  get active(): boolean {
    return this.root.visible;
  }

  /** Wake in the arena. */
  wake(e: EnemyState, rt: EnemyRt): void {
    this.phase = 1;
    this.atk = A.Roar;
    this.atkT = 0;
    this.nextPhase = 1;
    this.crownHits = 0;
    this.summoned = false;
    this.deathT = -1;
    this.dropped = false;
    this.weak = 0;
    this.flare = 1;
    this.last = A.None;
    for (const w of this.waves) w.on = false;
    e.phase = 1;
    rt.aggro = true;
    rt.emerge = 1;
    this.cur.set(P.roar);
    this.root.visible = true;
  }

  sleep(): void {
    this.root.visible = false;
    for (const w of this.waves) w.on = false;
  }

  get dying(): boolean {
    return this.deathT >= 0;
  }

  /** Applies a player hit; returns the damage after weak points and windows. */
  damage(e: EnemyState, dmg: number, kind: string, hy: number, out: GameEvent[]): number {
    if (this.atk === A.Roar || this.atk === A.Death) return 0;
    let k = 1;
    const crownHit = kind === "arrow" && (hy > e.pos.y + 4.6 || Math.hypot(hy - this.crown.y, 0) < 0.9);
    if (crownHit) {
      k *= 1.5;
      if (this.phase === 3 && this.atk !== A.Stagger) {
        this.crownHits++;
        if (this.crownHits >= 4) {
          this.crownHits = 0;
          this.start(A.Stagger, e);
          this.weak = 4;
          this.atkT = -2.6;
          out.push({ type: "shake", strength: 0.4 });
        }
      }
    }
    if (this.weak > 0) k *= 1.5;
    return dmg * k;
  }

  /** A parried warden blow: kneel, open for a riposte. */
  parried(e: EnemyState): void {
    if (this.atk === A.Roar || this.atk === A.Death || this.atk === A.Stagger) return;
    this.start(A.Stagger, e);
    this.weak = SWORD.parryStun;
    this.atkT = 0;
    e.stun = SWORD.parryStun;
  }

  die(e: EnemyState, host: Host): void {
    this.start(A.Death, e);
    this.deathT = 0;
    host.out.push({ type: "bossDefeated", pos: v3(e.pos.x, e.pos.y, e.pos.z) });
  }

  /** Lab hook: start a named attack now. */
  force(name: "chain" | "lunge" | "slam" | "volley" | "beam" | "summon", e: EnemyState): void {
    const m = { chain: A.Chain, lunge: A.Lunge, slam: A.Slam, volley: A.Volley, beam: A.Beam, summon: A.Summon };
    if (name === "summon") this.summoned = false;
    this.start(m[name], e);
  }

  private start(a: A, e: EnemyState): void {
    this.atk = a;
    this.atkT = 0;
    this.step = 0;
    this.fired = 0;
    this.hitDone = false;
    e.brainT = 0;
  }

  private brain(e: EnemyState, b: EnemyState["brain"]): void {
    if (e.brain !== b) {
      e.brain = b;
      e.brainT = 0;
    }
  }

  private strike(ctx: FrameCtx, e: EnemyState, host: Host, x: number, z: number, yaw: number, reach: number, arc: number, dmg: number, kind: "warden" | "slam", kb: number, unblockable = false): void {
    const s = host.strike;
    s.source = e.id;
    s.origin.x = x;
    s.origin.y = e.pos.y + 1.4;
    s.origin.z = z;
    s.yaw = yaw;
    s.reach = reach;
    s.arc = arc;
    s.height = 2.6;
    s.damage = dmg;
    s.kind = kind;
    s.knockback = kb;
    s.unblockable = unblockable;
    ctx.combat.strike(s);
  }

  /** Strike that lands right on the player (shockwave, beam). Combat still applies i-frames and dodge. */
  private zap(ctx: FrameCtx, e: EnemyState, host: Host, dmg: number): void {
    const p = ctx.player.pos;
    const dx = p.x - e.pos.x, dz = p.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    const ox = p.x - (dx / d) * 0.4, oz = p.z - (dz / d) * 0.4;
    const s = host.strike;
    s.source = e.id;
    s.origin.x = ox;
    s.origin.y = p.y + 0.9;
    s.origin.z = oz;
    s.yaw = Math.atan2(dx, dz);
    s.reach = 1.2;
    s.arc = Math.PI * 2;
    s.height = 1.5;
    s.damage = dmg;
    s.kind = "slam";
    s.knockback = 8;
    s.unblockable = true;
    ctx.combat.strike(s);
  }

  think(ctx: FrameCtx, e: EnemyState, rt: EnemyRt, host: Host, summon: (kind: EnemyKind, x: number, z: number) => void): void {
    const dt = ctx.dt, p = ctx.player;
    const spec = ENEMY.warden;
    const fast = this.phase === 3 ? 0.8 : 1;
    this.atkT += dt;
    e.brainT += dt;
    this.weak = Math.max(0, this.weak - dt);
    this.flare = Math.max(0, this.flare - dt * 0.5);
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) + 1e-6;
    const face = Math.atan2(dx, dz);
    const gy = ctx.world.heightAt(e.pos.x, e.pos.z);
    let dvx = 0, dvz = 0;
    let glowT = 0;
    const playerUp = p.hp > 0 && p.mode !== "dead";

    const frac = e.hp / e.maxHp;
    if (this.atk !== A.Death && this.atk !== A.Roar) {
      const want = frac <= WARDEN_PHASES[2] ? 3 : frac <= WARDEN_PHASES[1] ? 2 : 1;
      if (want > this.phase) {
        this.phase = want;
        e.phase = want;
        this.nextPhase = want;
        this.start(A.Roar, e);
        host.release(rt);
      }
    }

    switch (this.atk) {
      case A.Roar: {
        this.brain(e, "alert");
        this.tgt = P.roar;
        this.rate = 5;
        if (this.step === 0 && this.atkT > 0.25) {
          this.step = 1;
          this.flare = 1;
          host.out.push({ type: "bossPhase", phase: this.phase });
          host.out.push({ type: "shake", strength: 0.6 });
          ctx.fx.burst("gloam", v3(e.pos.x, e.pos.y + 4, e.pos.z), 40, v3(0, 1, 0), 6);
        }
        turnTo(e, face, 1.5, dt);
        if (this.atkT >= 2) {
          if (this.phase === 2 && !this.summoned) this.start(A.Summon, e);
          else this.start(A.None, e);
          rt.cd = 0.6;
        }
        break;
      }
      case A.None: {
        if (!playerUp) {
          this.brain(e, "idle");
          this.tgt = P.idle;
          this.rate = 3;
          break;
        }
        this.brain(e, "chase");
        rt.cd -= dt;
        turnTo(e, face, spec.walk * 0.9 * (this.phase === 3 ? 1.3 : 1), dt);
        const sp = spec.walk * (this.phase === 3 ? 1.3 : 1);
        if (d > 5.5) {
          dvx = (dx / d) * sp;
          dvz = (dz / d) * sp;
        } else if (d < 3.5) {
          dvx = -(dx / d) * sp * 0.5;
          dvz = -(dz / d) * sp * 0.5;
        }
        this.tgt = rt.speed > 0.4 ? P.walk : P.idle;
        this.rate = 4;
        if (rt.cd <= 0 && Math.abs(angleDiff(face, e.yaw)) < 0.6) this.pick(e, d);
        break;
      }
      case A.Chain: {
        const w1 = 0.75 * fast, w2 = 0.45 * fast, w3 = 1.1 * fast;
        const t1 = w1, t2 = t1 + 0.25 + w2, t3 = t2 + 0.25 + w3;
        const t = this.atkT;
        if (t < t1) {
          this.brain(e, "windup");
          this.tgt = P.c1w;
          this.rate = 6;
          glowT = t / w1;
          turnTo(e, face, 3.5, dt);
          if (this.step === 0) this.windEvt(e, host);
        } else if (t < t1 + 0.25) {
          this.brain(e, "attack");
          this.tgt = P.c1h;
          this.rate = 18;
          if (this.step === 1) {
            this.step = 2;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 4.8, 2.6, 4, "warden", 7);
            dvx = Math.sin(e.yaw) * 4;
            dvz = Math.cos(e.yaw) * 4;
          }
        } else if (t < t2) {
          this.brain(e, "windup");
          this.tgt = P.c2w;
          this.rate = 8;
          glowT = (t - t1 - 0.25) / w2;
          turnTo(e, face, 3.5, dt);
          if (this.step === 2) this.windEvt(e, host);
        } else if (t < t2 + 0.25) {
          this.brain(e, "attack");
          this.tgt = P.c2h;
          this.rate = 18;
          if (this.step === 3) {
            this.step = 4;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 4.8, 2.6, 4, "warden", 7);
          }
        } else if (t < t3) {
          // the delayed overhead: a long, trembling hold
          this.brain(e, "windup");
          this.tgt = P.c3w;
          this.rate = 5;
          glowT = Math.min(1, (t - t2 - 0.25) / w3) * (0.8 + 0.2 * Math.sin(t * 30));
          if (t - t2 - 0.25 < w3 * 0.7) turnTo(e, face, 2.5, dt);
          if (this.step === 4) this.windEvt(e, host);
          const fx = e.pos.x + Math.sin(e.yaw) * 3.6, fz = e.pos.z + Math.cos(e.yaw) * 3.6;
          host.fx.ring(fx, gy, fz, 1.6, Math.min(1, (t - t2 - 0.25) / w3), 0.8, 0.4, 1);
        } else if (t < t3 + 0.2) {
          this.brain(e, "attack");
          this.tgt = P.c3h;
          this.rate = 22;
          if (this.step === 5 && t > t3 + 0.1) {
            this.step = 6;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 5.2, 1.0, 8, "warden", 10);
            const fx = e.pos.x + Math.sin(e.yaw) * 4, fz = e.pos.z + Math.cos(e.yaw) * 4;
            ctx.fx.burst("dust", v3(fx, gy + 0.2, fz), 24, v3(0, 1, 0), 5);
            host.out.push({ type: "shake", strength: 0.5 });
          }
        } else {
          this.recover(e, rt, 1.0, P.c3h, 0);
        }
        break;
      }
      case A.Lunge: {
        const w = 0.75 * fast;
        const t = this.atkT;
        if (t < w) {
          this.brain(e, "windup");
          this.tgt = P.lw;
          this.rate = 6;
          glowT = t / w;
          turnTo(e, face, 3, dt);
          if (this.step === 0) this.windEvt(e, host);
          this.sweepPrev = Math.max(2, Math.min(10, d - 1.8));
        } else if (t < w + 0.38) {
          this.brain(e, "attack");
          this.tgt = P.lh;
          this.rate = 20;
          const sp = this.sweepPrev / 0.38;
          dvx = Math.sin(e.yaw) * sp;
          dvz = Math.cos(e.yaw) * sp;
          rt.speed = sp;
          e.vel.set(dvx, 0, dvz);
          if (this.step === 1 && t > w + 0.14) {
            this.step = 2;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 4.0, 1.8, 6, "warden", 10);
          }
          if (this.step === 2 && t > w + 0.3) {
            this.step = 3;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 4.0, 1.4, 6, "warden", 10);
          }
          ctx.fx.burst("gloam", v3(e.pos.x, e.pos.y + 0.5, e.pos.z), 1);
        } else {
          this.recover(e, rt, 1.3, P.lh, 1.3);
        }
        break;
      }
      case A.Slam: {
        const w = 1.0 * fast;
        const t = this.atkT;
        if (t < w) {
          this.brain(e, "windup");
          this.tgt = P.sw;
          this.rate = 5;
          glowT = t / w;
          turnTo(e, face, 2, dt);
          if (this.step === 0) this.windEvt(e, host);
          host.fx.ring(e.pos.x, gy, e.pos.z, 4.4, t / w, 0.85, 0.42, 1);
          host.fx.ring(e.pos.x, gy, e.pos.z, 9 + (t / w) * 3, 0, 0.18, 0.1, 0.25);
        } else if (t < w + 0.16) {
          this.brain(e, "attack");
          this.tgt = P.sh;
          this.rate = 24;
          if (this.step === 1 && t > w + 0.1) {
            this.step = 2;
            this.strike(ctx, e, host, e.pos.x, e.pos.z, e.yaw, 4.4, Math.PI * 2, 6, "slam", 12);
            const wv = this.waves.find((x) => !x.on) ?? this.waves[0];
            wv.on = true;
            wv.x = e.pos.x;
            wv.y = gy;
            wv.z = e.pos.z;
            wv.r = 4.4;
            wv.hit = false;
            ctx.fx.burst("dust", v3(e.pos.x, gy + 0.3, e.pos.z), 40, v3(0, 1, 0), 7);
            ctx.fx.burst("gloam", v3(e.pos.x, gy + 0.3, e.pos.z), 30, v3(0, 1, 0), 5);
            host.out.push({ type: "shake", strength: 0.9 });
          }
        } else {
          this.recover(e, rt, 1.5, P.sh, 1.5);
        }
        break;
      }
      case A.Volley: {
        const w = 1.0 * fast;
        const t = this.atkT;
        if (t < w + 5 * 0.15) {
          turnTo(e, face, 2.5, dt);
          const lit = Math.min(5, Math.floor((t / w) * 5.5));
          if (t < w) {
            this.brain(e, "windup");
            this.tgt = P.vw;
            this.rate = 6;
            glowT = (t / w) * 0.5;
            if (this.step === 0) this.windEvt(e, host);
          } else {
            this.brain(e, "attack");
            this.tgt = P.vh;
            this.rate = 10;
          }
          // orbs gather above the crown, then fly one by one
          for (let i = this.fired; i < lit; i++) {
            const a = (i - 2) * 0.55;
            _v.set(this.crown.x + Math.sin(e.yaw + a) * 1.2, this.crown.y + 1.1 + Math.cos(a) * 0.4, this.crown.z + Math.cos(e.yaw + a) * 1.2);
            const pulse = 0.28 + 0.05 * Math.sin(t * 20 + i);
            host.fx.orb(_v.x, _v.y, _v.z, pulse, 0.9, 0.55, 1.2);
            host.fx.orb(_v.x, _v.y, _v.z, pulse * 0.5, 1.2, 1.1, 1.3);
          }
          if (t >= w + this.fired * 0.15 && this.fired < 5) {
            const i = this.fired++;
            const a = (i - 2) * 0.55;
            _v.set(this.crown.x + Math.sin(e.yaw + a) * 1.2, this.crown.y + 1.1 + Math.cos(a) * 0.4, this.crown.z + Math.cos(e.yaw + a) * 1.2);
            fireBolt(ctx, e, host, 4, 15, (i - 2) * 0.07, _v);
          }
        } else {
          this.recover(e, rt, 0.7, P.vh, 0);
        }
        break;
      }
      case A.Summon: {
        const t = this.atkT;
        this.tgt = P.summon;
        this.rate = 5;
        if (this.step === 0) {
          this.step = 1;
          this.summoned = true;
          this.windEvt(e, host);
          for (let i = 0; i < 3; i++) {
            const a = e.yaw + (i - 1) * 1.4;
            const hx = e.home.x, hz = e.home.z;
            let sx = e.pos.x + Math.sin(a) * 7, sz = e.pos.z + Math.cos(a) * 7;
            const r = Math.hypot(sx - hx, sz - hz);
            if (r > WALK_R) {
              sx = hx + ((sx - hx) / r) * WALK_R;
              sz = hz + ((sz - hz) / r) * WALK_R;
            }
            this.summonAt[i].set(sx, 0, sz);
          }
        }
        this.brain(e, t < 1.2 ? "windup" : "recover");
        glowT = Math.min(1, t / 1.2);
        for (const s of this.summonAt) host.fx.ring(s.x, ctx.world.heightAt(s.x, s.z), s.z, 1.3, Math.min(1, t / 1.2), 0.9, 0.45, 1.1);
        if (t >= 1.2 && this.step === 1) {
          this.step = 2;
          for (const s of this.summonAt) summon("brambling", s.x, s.z);
        }
        if (t >= 1.8) this.start(A.None, e);
        break;
      }
      case A.Beam: {
        const w = 1.4 * fast, len = 3.4;
        const t = this.atkT;
        if (t < w) {
          this.brain(e, "windup");
          this.tgt = P.bw;
          this.rate = 5;
          glowT = t / w;
          turnTo(e, face, 2.5, dt);
          if (this.step === 0) {
            this.windEvt(e, host);
            this.beamDir = Math.random() < 0.5 ? 1 : -1;
          }
          this.beamYaw = e.yaw - this.beamDir * 1.2;
          this.beamPrev = this.beamYaw;
          this.beamHit = false;
          // telegraph: a faint line where the beam starts, and the arena edge it reaches
          const k = t / w;
          host.fx.beam(e.pos.x, gy + 0.9, e.pos.z, this.beamYaw, ARENA_R + 2, 0.15 + 0.1 * k, 0.25 + 0.35 * k);
          host.fx.ring(e.pos.x, gy, e.pos.z, ARENA_R, 0, 0.25 * k, 0.12 * k, 0.4 * k);
        } else if (t < w + len) {
          this.brain(e, "attack");
          this.tgt = P.bh;
          this.rate = 12;
          glowT = 1;
          this.beamPrev = this.beamYaw;
          this.beamYaw += this.beamDir * ((Math.PI * 2 + 0.6) / len) * dt;
          e.yaw = this.beamYaw + Math.PI / 2;
          host.fx.beam(e.pos.x, gy + 0.9, e.pos.z, this.beamYaw, ARENA_R + 2, 0.75, 1);
          host.fx.orb(e.pos.x + Math.sin(this.beamYaw) * 2.2, gy + 0.9, e.pos.z + Math.cos(this.beamYaw) * 2.2, 0.7, 0.9, 0.6, 1.2);
          // did the beam pass over the player this frame?
          const pa = Math.atan2(dx, dz);
          const a0 = angleDiff(pa, this.beamPrev), a1 = angleDiff(pa, this.beamYaw);
          const crossed = Math.abs(a0) < 0.6 && Math.abs(a1) < 0.6 && Math.sign(a0) !== Math.sign(a1);
          const low = p.pos.y - ctx.world.heightAt(p.pos.x, p.pos.z) < 1.3;
          if (!this.beamHit && crossed && low && d < ARENA_R + 2 && playerUp) {
            this.beamHit = true;
            this.zap(ctx, e, host, 6);
          }
          if (Math.random() < 0.5) ctx.fx.burst("gloam", v3(e.pos.x + Math.sin(this.beamYaw) * (3 + Math.random() * 28), gy + 0.9, e.pos.z + Math.cos(this.beamYaw) * (3 + Math.random() * 28)), 2);
        } else {
          this.recover(e, rt, 1.3, P.bh, 1.3);
        }
        break;
      }
      case A.Stagger: {
        this.brain(e, "stunned");
        this.tgt = P.kneel;
        this.rate = 7;
        e.stun = Math.max(0, this.weak);
        if (this.weak <= 0) {
          this.start(A.None, e);
          rt.cd = 0.8;
        }
        break;
      }
      case A.Death: {
        this.brain(e, "dead");
        this.tgt = P.dead;
        this.rate = 1.5;
        this.deathT += dt;
        if (Math.random() < 0.8) {
          _v.set(e.pos.x + (Math.random() - 0.5) * 3, e.pos.y + Math.random() * 4, e.pos.z + (Math.random() - 0.5) * 3);
          ctx.fx.burst("gloam", v3(_v.x, _v.y, _v.z), 3, v3(0, 1, 0), 2);
        }
        if (this.deathT > 1.6 && !this.dropped) {
          this.dropped = true;
          host.fx.drop(e.pos.x, e.pos.y + 1, e.pos.z, 20, spec.glimmers);
          ctx.fx.burst("gloam", v3(e.pos.x, e.pos.y + 3, e.pos.z), 60, v3(0, 1, 0), 8);
        }
        break;
      }
    }

    for (const w of this.waves) {
      if (!w.on) continue;
      const prev = w.r;
      w.r += 11 * dt;
      const k = 1 - w.r / ARENA_R;
      if (k <= 0) {
        w.on = false;
        continue;
      }
      host.fx.wave(w.x, w.y, w.z, w.r, 1.0, 0.6 + 0.6 * k);
      host.fx.ring(w.x, w.y, w.z, w.r, 0, 0.7 * k, 0.4 * k, 1 * k);
      const pd = Math.hypot(p.pos.x - w.x, p.pos.z - w.z);
      const low = p.pos.y - ctx.world.heightAt(p.pos.x, p.pos.z) < 0.75;
      if (!w.hit && playerUp && low && pd >= prev - 0.45 && pd <= w.r + 0.45) {
        w.hit = true;
        this.zap(ctx, e, host, 4);
      }
    }
    if (this.flare > 0) host.fx.ring(e.home.x, e.home.y, e.home.z, ARENA_R, 0, 1.2 * this.flare, 0.6 * this.flare, 1.6 * this.flare);

    this.glow += (glowT - this.glow) * Math.min(1, dt * 12);
    if (this.atk !== A.Death && this.atk !== A.Beam) {
      move(ctx, e, rt, dvx, dvz, this.atk === A.Lunge ? 30 : 5, spec.radius, false);
      // stay inside the arena
      const hx = e.pos.x - e.home.x, hz = e.pos.z - e.home.z, hr = Math.hypot(hx, hz);
      if (hr > WALK_R) {
        e.pos.x = e.home.x + (hx / hr) * WALK_R;
        e.pos.z = e.home.z + (hz / hr) * WALK_R;
      }
    } else {
      e.vel.set(0, 0, 0);
      rt.speed = 0;
    }
  }

  private windEvt(e: EnemyState, host: Host): void {
    this.step++;
    host.out.push({ type: "enemyWindup", id: e.id, kind: "warden", pos: v3(e.pos.x, e.pos.y, e.pos.z) });
  }

  private recover(e: EnemyState, rt: EnemyRt, dur: number, hold: Float32Array, weak: number): void {
    this.brain(e, "recover");
    if (this.step < 99) {
      this.step = 99;
      this.atkT = 0;
      this.weak = Math.max(this.weak, weak);
    }
    this.tgt = this.atkT < dur * 0.6 ? hold : P.idle;
    this.rate = this.atkT < dur * 0.6 ? 10 : 3;
    if (this.atkT >= dur) {
      this.start(A.None, e);
      rt.cd = ENEMY.warden.cooldown * (this.phase === 3 ? 0.8 : 1) * (0.7 + Math.random() * 0.5);
    }
  }

  private pick(e: EnemyState, d: number): void {
    const ph = this.phase;
    const opts = [A.Chain, A.Lunge, A.Slam, A.Volley, A.Beam];
    const wt = [
      d < 5.5 ? 4 : d < 9 ? 1 : 0,
      d > 10 ? 3 : d > 5.5 ? 2 : 0.3,
      d < 5.5 ? 3 : d < 9 ? 2 : 0.2,
      ph >= 2 ? (d > 9 ? 3 : 1.2) : 0,
      ph >= 3 ? 2.2 : 0,
    ];
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      if (opts[i] === this.last) wt[i] *= 0.3;
      sum += wt[i];
    }
    if (sum <= 0) return;
    let r = Math.random() * sum;
    for (let i = 0; i < 5; i++) {
      r -= wt[i];
      if (r <= 0) {
        this.last = opts[i];
        this.start(opts[i], e);
        return;
      }
    }
  }

  /** Pose the bones and place the model. */
  draw(ctx: FrameCtx, e: EnemyState, rt: EnemyRt): void {
    const dt = ctx.dt;
    const k = 1 - Math.exp(-this.rate * dt);
    const cur = this.cur, tgt = this.tgt;
    for (let i = 0; i < C.n; i++) cur[i] += (tgt[i] - cur[i]) * k;
    const t = ctx.time;
    const walk = Math.min(1, rt.speed / 3);
    const breathe = Math.sin(t * 1.4) * 0.04;
    let sink = 0, scale = 1;
    if (this.deathT >= 0) {
      const dk = Math.max(0, (this.deathT - 1.2) / 2.2);
      sink = dk * 2.5;
      scale = 1 - dk * 0.5;
      if (dk >= 1) this.root.visible = false;
    }
    this.root.position.set(e.pos.x, e.pos.y - sink, e.pos.z);
    this.root.rotation.y = e.yaw;
    this.root.scale.setScalar(scale);
    this.hips.position.y = 2.5 + cur[C.hipY] + Math.abs(Math.sin(t * 4)) * 0.1 * walk;
    this.hips.rotation.set(0, Math.sin(t * 2) * 0.05 * walk, Math.sin(t * 2) * 0.04 * walk);
    this.skirt.rotation.set(-cur[C.torsoX] * 0.25 + walk * -0.15, 0, Math.sin(t * 1.3) * 0.03);
    this.skirt.scale.set(1, Math.max(0.35, 1 + Math.min(0, cur[C.hipY]) * 0.42), 1);
    this.torso.rotation.set(cur[C.torsoX] + breathe, cur[C.torsoY], cur[C.torsoZ]);
    this.head.rotation.set(cur[C.headX] - breathe * 0.5, cur[C.headY], 0);
    this.cape.rotation.set(0.15 + walk * 0.35 + Math.sin(t * 1.7) * 0.06 - cur[C.torsoX] * 0.6, 0, Math.sin(t * 1.1) * 0.05);
    this.rSh.rotation.set(cur[C.rShX], cur[C.rShY], cur[C.rShZ]);
    this.rEl.rotation.set(cur[C.rEl], 0, 0);
    this.sword.rotation.set(cur[C.swX], 0, cur[C.swZ]);
    this.lSh.rotation.set(cur[C.lShX], cur[C.lShY], cur[C.lShZ]);
    this.lEl.rotation.set(cur[C.lEl], 0, 0);
    this.root.updateMatrixWorld(true);

    // crown position (weak point) and glows
    this.head.localToWorld(this.crown.set(0, 1.35, 0));
    const g = this.glow;
    const weakK = this.weak > 0 ? 0.6 + 0.4 * Math.sin(t * 10) : 0;
    this.glowBody.color.setRGB(0.5 * g + 0.35 * weakK, 0.25 * g + 0.25 * weakK, 0.8 * g + 0.1 * weakK);
    this.glowBlade.color.setRGB(0.75 * g + 0.05, 0.4 * g + 0.02, 1.1 * g + 0.08);
    this.glowBody.visible = g + weakK > 0.02;
    void _w;
    void rt;
  }

  /** Crown lantern glows, drawn through the shared orb pool. */
  drawCrown(e: EnemyState, host: Host, t: number): void {
    if (!this.root.visible) return;
    const weakK = this.weak > 0 ? 1 : 0;
    const p3 = this.phase === 3 ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    for (let i = 0; i < this.lanterns.length; i++) {
      this.lanterns[i].getWorldPosition(_v);
      const f = 0.85 + 0.15 * Math.sin(t * 13 + i * 2.1);
      const k = (0.35 + 0.5 * weakK + 0.35 * p3) * f * (this.deathT >= 0 ? Math.max(0, 1 - this.deathT) : 1);
      host.fx.orb(_v.x, _v.y, _v.z, 0.22 + 0.12 * (weakK + p3), 0.9 * k, 0.62 * k, 0.25 * k);
    }
    if (this.weak > 0 || this.phase === 3) e.aimPoint.copy(this.crown);
    else e.aimPoint.set(e.pos.x, e.pos.y + 3.6, e.pos.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.glowBody.dispose();
    this.glowBlade.dispose();
  }
}
