import * as THREE from "three";
import type { Look, QualityPreset, V3, World } from "./contracts";
import { clamp01, mulberry32, shaderMat } from "./nature-util";

const FIREFLY_VS = /* glsl */ `
attribute vec4 aF;
uniform float uSize;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float pulse = 0.5 + 0.5 * sin(uTime * (1.4 + aF.y * 1.6) + aF.x * 40.0);
  vGlow = aF.z * (0.25 + 0.75 * pulse * pulse);
  gl_PointSize = clamp(uSize * (0.55 + 0.7 * pulse) / max(-mv.z, 1.0), 3.0, 48.0) * (0.3 + 0.7 * aF.z);
  gl_Position = projectionMatrix * mv;
}`;

const FIREFLY_FS = /* glsl */ `
varying float vGlow;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float core = smoothstep(1.0, 0.0, d);
  float a = core * core * vGlow;
  if (a < 0.01) discard;
  vec3 c = mix(vec3(1.0, 0.7, 0.25), vec3(1.0, 0.95, 0.6), core * core);
  gl_FragColor = vec4(c * (0.7 + 0.8 * vGlow), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BIRD_VS = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute float aWing;
varying vec3 vN; varying vec3 vW; varying float vCol; varying float vShade;
void main() {
  float fly = aB.y;
  float sc = aB.z;
  float flap = sin(aB.x) * fly;
  vec3 p = position;
  p.y += abs(aWing) * flap * 0.55 * abs(p.x) * 1.8;
  p.y -= (1.0 - fly) * abs(aWing) * 0.28;
  p.x *= mix(0.45, 1.0, fly);
  float c = cos(aA.w), s = sin(aA.w);
  vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) * sc;
  vec3 wp = aA.xyz + r;
  vW = wp; vCol = aB.w; vShade = 0.8 + 0.3 * p.y;
  vN = normalize(vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const BIRD_FS = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying float vCol; varying float vShade;
void main() {
  vec3 col = vCol < 0.33 ? vec3(0.34, 0.26, 0.2) : vCol < 0.66 ? vec3(0.28, 0.4, 0.58) : vec3(0.62, 0.3, 0.22);
  vec3 V = normalize(cameraPosition - vW);
  vec3 c = hmShade(col * vShade, vN, vW, V);
  c = hmFog(c, length(cameraPosition - vW));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const idx: number[] = [];
  const v = (x: number, y: number, z: number, w: number) => { pos.push(x, y, z); wing.push(w); return wing.length - 1; };
  const nose = v(0, 0, 0.2, 0), tail = v(0, 0.02, -0.22, 0), top = v(0, 0.11, 0, 0), bot = v(0, -0.07, 0, 0);
  const l = v(-0.1, 0, 0, 0), r = v(0.1, 0, 0, 0);
  idx.push(nose, top, l, nose, r, top, tail, l, top, tail, top, r, nose, l, bot, nose, bot, r, tail, bot, l, tail, r, bot);
  const wl0 = v(-0.06, 0.03, 0.08, -1), wl1 = v(-0.06, 0.03, -0.1, -1), wl2 = v(-0.46, 0.03, -0.02, -1);
  const wr0 = v(0.06, 0.03, 0.08, 1), wr1 = v(0.06, 0.03, -0.1, 1), wr2 = v(0.46, 0.03, -0.02, 1);
  idx.push(wl0, wl1, wl2, wl2, wl1, wl0, wr0, wr2, wr1, wr1, wr2, wr0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  g.setIndex(idx);
  return g;
}

interface Bird {
  x: number; y: number; z: number;
  vx: number; vz: number; vy: number;
  yaw: number; phase: number; fly: number; scale: number; col: number;
  state: 0 | 1 | 2; // perched, flying, gone
  t: number;
  home: number;
}

const PERCH_BIOMES = new Set(["meadow", "forest", "highland", "lakeshore", "beach"]);

export class LifeSystem {
  private group: THREE.Group;
  private ffGeo!: THREE.BufferGeometry;
  private ffPts!: THREE.Points;
  private ffPos!: Float32Array;
  private ffF!: Float32Array;
  private ffN = 0;
  private ffVel!: Float32Array;
  private ffMat!: THREE.ShaderMaterial;
  private birdMesh!: THREE.Mesh;
  private birdGeo!: THREE.InstancedBufferGeometry;
  private bA!: THREE.InstancedBufferAttribute;
  private bB!: THREE.InstancedBufferAttribute;
  private birds: Bird[] = [];
  private rnd: () => number;
  private ffFade = 0;
  private birdFade = 1;
  private spawnAcc = 0;

  constructor(parent: THREE.Group, private look: Look, private world: World, q: QualityPreset) {
    this.group = parent;
    this.rnd = mulberry32((world.seed ^ 0x51ed) >>> 0);
    this.build(q);
  }

  private build(q: QualityPreset): void {
    this.ffN = Math.round(32 + 56 * clamp01(q.grassDensity));
    this.ffPos = new Float32Array(this.ffN * 3);
    this.ffF = new Float32Array(this.ffN * 4);
    this.ffVel = new Float32Array(this.ffN * 3);
    for (let i = 0; i < this.ffN; i++) {
      this.ffF[i * 4] = this.rnd(); this.ffF[i * 4 + 1] = this.rnd(); this.ffF[i * 4 + 2] = 0;
      this.ffPos[i * 3 + 1] = -9999;
      this.ffVel[i * 3] = (this.rnd() - 0.5); this.ffVel[i * 3 + 1] = (this.rnd() - 0.5) * 0.4; this.ffVel[i * 3 + 2] = (this.rnd() - 0.5);
    }
    this.ffGeo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.ffPos, 3).setUsage(THREE.DynamicDrawUsage);
    const fa = new THREE.BufferAttribute(this.ffF, 4).setUsage(THREE.DynamicDrawUsage);
    this.ffGeo.setAttribute("position", pa);
    this.ffGeo.setAttribute("aF", fa);
    this.ffMat = shaderMat(this.look, FIREFLY_VS, FIREFLY_FS, { uSize: { value: 900 } }, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ffPts = new THREE.Points(this.ffGeo, this.ffMat);
    this.ffPts.frustumCulled = false;
    this.group.add(this.ffPts);

    const nb = q.grassDensity > 0.6 ? 14 : q.grassDensity > 0.3 ? 9 : 5;
    const base = birdGeometry();
    this.birdGeo = new THREE.InstancedBufferGeometry();
    this.birdGeo.index = base.index;
    this.birdGeo.setAttribute("position", base.getAttribute("position"));
    this.birdGeo.setAttribute("aWing", base.getAttribute("aWing"));
    this.bA = new THREE.InstancedBufferAttribute(new Float32Array(nb * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.bB = new THREE.InstancedBufferAttribute(new Float32Array(nb * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.birdGeo.setAttribute("aA", this.bA);
    this.birdGeo.setAttribute("aB", this.bB);
    this.birdGeo.instanceCount = nb;
    this.birdMesh = new THREE.Mesh(this.birdGeo, shaderMat(this.look, BIRD_VS, BIRD_FS, {}, { side: THREE.DoubleSide }));
    this.birdMesh.frustumCulled = false;
    this.group.add(this.birdMesh);
    this.birds.length = 0;
    for (let i = 0; i < nb; i++) {
      this.birds.push({ x: 0, y: -9999, z: 0, vx: 0, vz: 0, vy: 0, yaw: 0, phase: this.rnd() * 6, fly: 0, scale: 1.3 + this.rnd() * 0.6, col: this.rnd(), state: 2, t: this.rnd() * 3, home: 0 });
    }
  }

  setQuality(q: QualityPreset): void {
    this.disposeMeshes();
    this.build(q);
  }

  private findSpot(cx: number, cz: number, fx: number, fz: number, minD: number, maxD: number, out: V3): boolean {
    const w = this.world;
    for (let k = 0; k < 6; k++) {
      const a = Math.atan2(fz, fx) + (this.rnd() - 0.5) * 2.6;
      const d = minD + this.rnd() * (maxD - minD);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!PERCH_BIOMES.has(w.biomeAt(x, z))) continue;
      const h = w.heightAt(x, z);
      const wl = w.waterAt(x, z);
      if (wl !== -Infinity && h < wl + 0.3) continue;
      out.x = x; out.y = h; out.z = z;
      return true;
    }
    return false;
  }

  private spot: V3 = { x: 0, y: 0, z: 0 };

  update(dt: number, time: number, camX: number, camZ: number, fx: number, fz: number, px: number, py: number, pz: number, daylight: number, rain: number): void {
    const night = clamp01((0.42 - daylight) / 0.3);
    this.ffFade += ((night > 0 ? 1 : 0) - this.ffFade) * Math.min(1, dt * 0.8);
    const ffOn = night * (1 - rain * 0.7);
    this.updateFireflies(dt, px, pz, ffOn);
    this.ffPts.visible = ffOn > 0.01;
    const day = clamp01((daylight - 0.3) / 0.25) * (1 - rain * 0.85);
    this.updateBirds(dt, camX, camZ, fx, fz, px, py, pz, day);
    void time;
  }

  private updateFireflies(dt: number, px: number, pz: number, on: number): void {
    const w = this.world;
    const R = 34;
    const n = this.ffN;
    const P = this.ffPos, F = this.ffF, Vl = this.ffVel;
    let respawn = 4;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let y = P[o + 1];
      const dx = P[o] - px, dz = P[o + 2] - pz;
      const far = y < -9000 || dx * dx + dz * dz > R * R;
      if (far && respawn > 0) {
        respawn--;
        const a = this.rnd() * Math.PI * 2, d = 4 + Math.sqrt(this.rnd()) * (R - 6);
        const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
        const b = w.biomeAt(x, z);
        const ok = b === "forest" || b === "lakeshore" || (b === "meadow" && this.rnd() < 0.35);
        if (ok) {
          const wl = w.waterAt(x, z);
          const h = w.heightAt(x, z);
          if (wl === -Infinity || h > wl + 0.2) {
            P[o] = x; P[o + 2] = z;
            P[o + 1] = h + 0.6 + this.rnd() * 2.2;
            F[i * 4 + 3] = P[o + 1] - h;
            F[i * 4 + 2] = 0;
            continue;
          }
        }
        P[o + 1] = -9999;
        F[i * 4 + 2] = 0;
        continue;
      }
      if (y < -9000) { F[i * 4 + 2] = 0; continue; }
      const ph = F[i * 4] * 60;
      P[o] += (Vl[o] * 0.35 + Math.sin(this.ffFade * 0 + ph + performance.now() * 0.0006 * (0.6 + F[i * 4 + 1])) * 0.5) * dt;
      P[o + 2] += (Vl[o + 2] * 0.35 + Math.cos(ph * 1.3 + performance.now() * 0.0005 * (0.6 + F[i * 4 + 1])) * 0.5) * dt;
      const h = w.heightAt(P[o], P[o + 2]);
      const hover = F[i * 4 + 3] + Math.sin(ph + performance.now() * 0.0011) * 0.5;
      y = h + Math.max(0.35, hover);
      P[o + 1] = y;
      const edge = clamp01((R - Math.sqrt(dx * dx + dz * dz)) / 8);
      F[i * 4 + 2] += (edge * on - F[i * 4 + 2]) * Math.min(1, dt * 1.5);
    }
    (this.ffGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.ffGeo.getAttribute("aF") as THREE.BufferAttribute).needsUpdate = true;
  }

  scatter(x: number, z: number, r: number): void {
    for (const b of this.birds) {
      if (b.state !== 0) continue;
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz < r * r) this.flush(b, x, z);
    }
  }

  private flush(b: Bird, fromX: number, fromZ: number): void {
    const dx = b.x - fromX, dz = b.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    const sp = 5 + this.rnd() * 3;
    const ang = Math.atan2(dz, dx) + (this.rnd() - 0.5) * 1.2;
    b.vx = Math.cos(ang) * sp; b.vz = Math.sin(ang) * sp;
    b.vy = 4 + this.rnd() * 2.5;
    b.state = 1; b.t = 0;
    b.yaw = Math.atan2(b.vx, b.vz);
    void l;
  }

  private updateBirds(dt: number, camX: number, camZ: number, fx: number, fz: number, px: number, py: number, pz: number, day: number): void {
    const w = this.world;
    this.spawnAcc += dt;
    const A = this.bA.array as Float32Array, B = this.bB.array as Float32Array;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (b.state === 2) {
        if (day > 0.5 && this.spawnAcc > 0.25 && this.findSpot(px, pz, fx, fz, 14, 46, this.spot)) {
          this.spawnAcc = 0;
          b.x = this.spot.x; b.z = this.spot.z; b.y = this.spot.y + 0.4;
          b.state = 0; b.fly = 0; b.t = 0; b.yaw = this.rnd() * 6.28;
        } else {
          b.y = -9999;
        }
      } else if (b.state === 0) {
        const dx = b.x - px, dz = b.z - pz;
        const run = 1;
        if (dx * dx + dz * dz < 25 * run || day < 0.2) this.flush(b, px, pz);
        else {
          b.t += dt;
          b.phase += dt * 1.2;
          b.yaw += Math.sin(b.t * 0.7 + i) * dt * 0.8;
          b.y = w.heightAt(b.x, b.z) + 0.4 + Math.max(0, Math.sin(b.t * 5 + i * 2)) * (Math.sin(b.t * 0.4 + i) > 0.85 ? 0.05 : 0);
          if (dx * dx + dz * dz > 70 * 70) b.state = 2;
        }
      } else {
        b.t += dt;
        b.phase += dt * 22;
        b.fly += (1 - b.fly) * Math.min(1, dt * 8);
        const ground = w.heightAt(b.x, b.z);
        const target = ground + 7 + Math.sin(b.phase * 0.02 + i) * 2.5;
        b.vy += ((target - b.y) * 0.6 - b.vy * 0.5) * dt * 2.4;
        const turn = Math.sin(b.t * 0.6 + i * 1.7) * 0.5;
        const c = Math.cos(turn * dt), s = Math.sin(turn * dt);
        const vx = b.vx * c - b.vz * s, vz = b.vx * s + b.vz * c;
        b.vx = vx; b.vz = vz;
        b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
        b.yaw = Math.atan2(b.vx, b.vz);
        const dx = b.x - px, dz = b.z - pz;
        if (b.t > 9 || dx * dx + dz * dz > 60 * 60 || day < 0.15) b.state = 2;
      }
      const o = i * 4;
      A[o] = b.x; A[o + 1] = b.y; A[o + 2] = b.z; A[o + 3] = b.yaw;
      B[o] = b.phase; B[o + 1] = b.state === 1 ? b.fly : 0; B[o + 2] = b.scale; B[o + 3] = b.col;
      if (b.state !== 1) b.fly = 0;
    }
    void camX; void camZ; void py;
    this.bA.needsUpdate = true;
    this.bB.needsUpdate = true;
  }

  private disposeMeshes(): void {
    this.group.remove(this.ffPts);
    this.ffGeo.dispose();
    this.ffMat.dispose();
    this.group.remove(this.birdMesh);
    this.birdGeo.dispose();
    (this.birdMesh.material as THREE.Material).dispose();
  }

  dispose(): void {
    this.disposeMeshes();
  }
}
