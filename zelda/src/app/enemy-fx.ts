import * as THREE from "three";
import type { FrameCtx, GameEvent, Look, World } from "./contracts";

// Enemy-owned effects: ground telegraphs, shockwave walls, glow orbs, the boss beam, "!" alert marks and glimmer drops.
// Telegraphs, waves and orbs are immediate mode: brains call them every frame between begin() and end().

const RINGS = 24, WAVES = 4, ORBS = 128, DROPS = 64, MARKS = 8;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _id = new THREE.Quaternion();

function additive(vertexColors = false, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: "#ffffff", vertexColors, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side,
    toneMapped: false,
  });
}

// Additive washes out to white over a sunlit ground, so telegraphs blend normally to stay violet.
function decal(opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: "#ffffff", transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false,
  });
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, _c.setRGB(0, 0, 0));
  m.frustumCulled = false;
  m.castShadow = false;
  m.renderOrder = order;
  m.count = 0;
  return m;
}

function markTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.lineJoin = "round";
  g.lineCap = "round";
  // a brush-stroke "!" in ink with a parchment halo and a gold dot
  g.strokeStyle = "#f8f0dd";
  g.lineWidth = 26;
  g.beginPath();
  g.moveTo(34, 14);
  g.quadraticCurveTo(28, 50, 32, 80);
  g.stroke();
  g.beginPath();
  g.arc(32, 106, 12, 0, Math.PI * 2);
  g.fillStyle = "#f8f0dd";
  g.fill();
  g.strokeStyle = "#2b2118";
  g.lineWidth = 13;
  g.beginPath();
  g.moveTo(34, 16);
  g.quadraticCurveTo(29, 50, 32, 78);
  g.stroke();
  g.beginPath();
  g.arc(32, 106, 7.5, 0, Math.PI * 2);
  g.fillStyle = "#b8402b";
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EnemyFx {
  private readonly group = new THREE.Group();
  private readonly ringGeo = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);
  private readonly discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private readonly waveGeo: THREE.BufferGeometry;
  private readonly orbGeo = new THREE.SphereGeometry(1, 12, 8);
  private readonly beamGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  private readonly dropGeo = new THREE.OctahedronGeometry(0.13, 0).scale(1, 1.5, 1);
  private readonly matRing = decal(0.85);
  private readonly matDisc = decal(0.5);
  private readonly matWave = additive(true, THREE.DoubleSide);
  private readonly matOrb = additive();
  private readonly matBeam = additive();
  private readonly rings: THREE.InstancedMesh;
  private readonly discs: THREE.InstancedMesh;
  private readonly waves: THREE.InstancedMesh;
  private readonly orbs: THREE.InstancedMesh;
  private readonly beamCore: THREE.Mesh;
  private readonly beamGlow: THREE.Mesh;
  private readonly matBeamGlow = decal(0.45);
  private readonly drops: THREE.InstancedMesh;
  private readonly tex = markTexture();
  private readonly marks: { s: THREE.Sprite; t: number; x: number; y: number; z: number }[] = [];
  private nr = 0;
  private nd = 0;
  private nw = 0;
  private no = 0;
  private beamOn = false;
  // glimmer drops
  private readonly dp = new Float32Array(DROPS * 3);
  private readonly dv = new Float32Array(DROPS * 3);
  private readonly dt = new Float32Array(DROPS);
  private readonly da = new Int32Array(DROPS);

  private readonly world: World;

  constructor(scene: THREE.Scene | THREE.Group, world: World, look: Look) {
    this.world = world;
    const wave = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);
    const p = wave.getAttribute("position") as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 1 - p.getY(i);
      col[i * 3] = k;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = k;
    }
    wave.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.waveGeo = wave;
    this.rings = inst(this.ringGeo, this.matRing, RINGS, 3);
    this.discs = inst(this.discGeo, this.matDisc, RINGS, 3);
    this.waves = inst(this.waveGeo, this.matWave, WAVES, 4);
    this.orbs = inst(this.orbGeo, this.matOrb, ORBS, 5);
    this.matBeam.color.set("#d6b3ff");
    this.matBeamGlow.color.set("#7b45b8");
    this.beamCore = new THREE.Mesh(this.beamGeo, this.matBeam);
    this.beamGlow = new THREE.Mesh(this.beamGeo, this.matBeamGlow);
    this.beamCore.renderOrder = 6;
    this.beamGlow.renderOrder = 5;
    this.beamCore.visible = this.beamGlow.visible = false;
    this.beamCore.frustumCulled = this.beamGlow.frustumCulled = false;
    const dm = look.toon({ color: "#e8c766", emissive: "#e8b84a", emissiveIntensity: 1.2 });
    this.drops = new THREE.InstancedMesh(this.dropGeo, dm, DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.drops.castShadow = false;
    this.da.fill(0);
    for (let i = 0; i < MARKS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false }));
      s.visible = false;
      s.renderOrder = 10;
      s.center.set(0.5, 0);
      this.marks.push({ s, t: 0, x: 0, y: 0, z: 0 });
      this.group.add(s);
    }
    this.group.add(this.rings, this.discs, this.waves, this.orbs, this.beamCore, this.beamGlow, this.drops);
    scene.add(this.group);
  }

  begin(): void {
    this.nr = this.nd = this.nw = this.no = 0;
    this.beamOn = false;
  }

  /** Ground telegraph: an outline at radius r, filling up with `fill` (0..1). Brightness k. */
  ring(x: number, y: number, z: number, r: number, fill: number, cr: number, cg: number, cb: number): void {
    if (this.nr < RINGS) {
      _m.compose(_v.set(x, y + 0.06, z), _id, _s.set(r, 1, r));
      this.rings.setMatrixAt(this.nr, _m);
      this.rings.setColorAt(this.nr++, _c.setRGB(cr, cg, cb));
    }
    if (fill > 0.01 && this.nd < RINGS) {
      _m.compose(_v.set(x, y + 0.05, z), _id, _s.set(r * fill, 1, r * fill));
      this.discs.setMatrixAt(this.nd, _m);
      this.discs.setColorAt(this.nd++, _c.setRGB(cr * 0.6, cg * 0.6, cb * 0.6));
    }
  }

  /** Expanding shockwave wall. */
  wave(x: number, y: number, z: number, r: number, h: number, k: number): void {
    if (this.nw >= WAVES) return;
    _m.compose(_v.set(x, y - 0.1, z), _id, _s.set(r, h, r));
    this.waves.setMatrixAt(this.nw, _m);
    this.waves.setColorAt(this.nw++, _c.setRGB(0.45 * k, 0.18 * k, 0.75 * k));
  }

  orb(x: number, y: number, z: number, size: number, cr: number, cg: number, cb: number): void {
    if (this.no >= ORBS) return;
    _m.compose(_v.set(x, y, z), _id, _s.set(size, size, size));
    this.orbs.setMatrixAt(this.no, _m);
    this.orbs.setColorAt(this.no++, _c.setRGB(cr, cg, cb));
  }

  /** Horizontal beam from (x, y, z) along yaw, `len` long. */
  beam(x: number, y: number, z: number, yaw: number, len: number, thick: number, k: number): void {
    this.beamOn = true;
    _q.setFromAxisAngle(_up, yaw);
    this.beamCore.position.set(x, y, z);
    this.beamCore.quaternion.copy(_q);
    this.beamCore.scale.set(thick * 0.45, thick * 0.45, len);
    this.beamGlow.position.set(x, y, z);
    this.beamGlow.quaternion.copy(_q);
    this.beamGlow.scale.set(thick * 1.4, thick * 1.4, len);
    this.matBeam.opacity = k;
    this.matBeamGlow.color.setRGB(0.55, 0.25, 0.9);
    this.matBeamGlow.opacity = 0.45 * k;
  }

  alert(x: number, y: number, z: number): void {
    let best = this.marks[0];
    for (const m of this.marks) {
      if (m.t <= 0) {
        best = m;
        break;
      }
      if (m.t < best.t) best = m;
    }
    best.t = 0.9;
    best.x = x;
    best.y = y;
    best.z = z;
  }

  /** Burst `count` glimmer motes worth `amount` total. */
  drop(x: number, y: number, z: number, count: number, amount: number): void {
    let left = amount;
    for (let n = 0; n < count; n++) {
      let i = -1;
      for (let k = 0; k < DROPS; k++) if (this.da[k] === 0) { i = k; break; }
      const give = n === count - 1 ? left : Math.max(1, Math.round(amount / count));
      if (i < 0) {
        // pool full: hand the rest straight to the nearest live mote
        for (let k = 0; k < DROPS; k++) if (this.da[k] > 0) { this.da[k] += left; break; }
        return;
      }
      left -= give;
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2.5;
      this.dp[i * 3] = x;
      this.dp[i * 3 + 1] = y + 0.5;
      this.dp[i * 3 + 2] = z;
      this.dv[i * 3] = Math.sin(a) * sp;
      this.dv[i * 3 + 1] = 4.5 + Math.random() * 3;
      this.dv[i * 3 + 2] = Math.cos(a) * sp;
      this.dt[i] = 0;
      this.da[i] = give;
      if (left <= 0) return;
    }
  }

  /** Physics for drops and marks; pushes pickup events into `out`. */
  update(ctx: FrameCtx, out: GameEvent[]): void {
    const dt = ctx.dt, p = ctx.player.pos;
    const px = p.x, py = p.y + 0.9, pz = p.z;
    let n = 0;
    for (let i = 0; i < DROPS; i++) {
      if (this.da[i] === 0) continue;
      const o = i * 3;
      this.dt[i] += dt;
      const t = this.dt[i];
      let x = this.dp[o], y = this.dp[o + 1], z = this.dp[o + 2];
      const dx = px - x, dy = py - y, dz = pz - z;
      const d = Math.hypot(dx, dy, dz);
      const alive = ctx.player.hp > 0;
      if (alive && t > 0.7 && (d < 5 || (t > 2.2 && d < 30))) {
        const pull = Math.min(1, (t - 0.7) * 1.5) * 26;
        this.dv[o] += ((dx / d) * pull - this.dv[o]) * Math.min(1, dt * 6);
        this.dv[o + 1] += ((dy / d) * pull - this.dv[o + 1]) * Math.min(1, dt * 6);
        this.dv[o + 2] += ((dz / d) * pull - this.dv[o + 2]) * Math.min(1, dt * 6);
      } else {
        this.dv[o + 1] -= 16 * dt;
      }
      x += this.dv[o] * dt;
      y += this.dv[o + 1] * dt;
      z += this.dv[o + 2] * dt;
      const g = this.world.heightAt(x, z) + 0.25;
      if (y < g) {
        y = g;
        this.dv[o + 1] = Math.abs(this.dv[o + 1]) * 0.35;
        this.dv[o] *= 0.6;
        this.dv[o + 2] *= 0.6;
      }
      this.dp[o] = x;
      this.dp[o + 1] = y;
      this.dp[o + 2] = z;
      if (alive && t > 0.5 && d < 0.7) {
        out.push({ type: "pickup", kind: "glimmer", amount: this.da[i], pos: { x, y, z }, id: "enemy-drop" });
        ctx.fx.burst("glimmer", { x, y, z }, 4);
        this.da[i] = 0;
        continue;
      }
      if (t > 40) {
        this.da[i] = 0;
        continue;
      }
      const s = 1 + 0.15 * Math.sin(t * 9 + i);
      _q.setFromAxisAngle(_up, t * 4 + i);
      _m.compose(_v.set(x, y + 0.08 * Math.sin(t * 3 + i), z), _q, _s.set(s, s, s));
      this.drops.setMatrixAt(n++, _m);
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
    for (const m of this.marks) {
      if (m.t <= 0) {
        m.s.visible = false;
        continue;
      }
      m.t -= ctx.realDt;
      const age = 0.9 - m.t;
      const pop = age < 0.12 ? age / 0.12 * 1.25 : 1 + 0.25 * Math.max(0, 1 - (age - 0.12) * 6);
      m.s.visible = m.t > 0;
      m.s.position.set(m.x, m.y + age * 0.25, m.z);
      const h = 0.7 * pop;
      m.s.scale.set(h * 0.5, h, 1);
      (m.s.material as THREE.SpriteMaterial).opacity = Math.min(1, m.t * 4);
    }
  }

  end(): void {
    const fin = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    fin(this.rings, this.nr);
    fin(this.discs, this.nd);
    fin(this.waves, this.nw);
    fin(this.orbs, this.no);
    this.beamCore.visible = this.beamGlow.visible = this.beamOn;
  }

  clear(): void {
    this.da.fill(0);
    for (const m of this.marks) m.t = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const m of [this.rings, this.discs, this.waves, this.orbs, this.drops]) m.dispose();
    for (const g of [this.ringGeo, this.discGeo, this.waveGeo, this.orbGeo, this.beamGeo, this.dropGeo]) g.dispose();
    for (const m of [this.matRing, this.matDisc, this.matWave, this.matOrb, this.matBeam, this.matBeamGlow]) m.dispose();
    for (const m of this.marks) (m.s.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
