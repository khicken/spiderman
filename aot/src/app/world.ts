import * as THREE from "three";
import type { Fx, GameEvent, Quality, World } from "./contracts";
import { createPuffs, PUFF } from "./fx";
import { toon } from "./toon";
import { createColossal, COLOSSAL_HEAD, KICK } from "./world-colossal";
import { createCollider, shape, type Shape } from "./world-collide";
import { Mesher, mat } from "./world-mesh";
import { cobble, facade, fields, rng, roofTiles, wallStone } from "./world-textures";
import { church, depot, GATE_HALF, GATE_H, house, maria, mariaZ, stall, tree, wall, WALL_H, WALL_R, WALL_T, type Meshers } from "./world-town";

export type { World };

const NONE: GameEvent[] = [];
const VANISH_AFTER = 40;

export function createWorld(scene: THREE.Scene, fx: Fx): World {
  const r = rng(1845);
  const group = new THREE.Group();
  group.name = "world";
  scene.add(group);

  const m: Meshers = {
    timber: new Mesher(),
    plain: new Mesher(),
    stone: new Mesher(),
    roof: new Mesher(),
    wall: new Mesher(),
    prop: new Mesher(),
    leaf: new Mesher(),
    far: new Mesher(),
  };
  const shapes: Shape[] = [];

  const wallInfo = wall(m, shapes, r);
  maria(m, shapes, r);

  const D2R = Math.PI / 180;
  const radials = [
    { a: 200 * D2R, w: 10 },
    { a: 225 * D2R, w: 10 },
    { a: 250 * D2R, w: 10 },
    { a: 270 * D2R, w: 18 },
    { a: 290 * D2R, w: 10 },
    { a: 315 * D2R, w: 10 },
    { a: 340 * D2R, w: 10 },
  ];
  const bounds = [{ a: Math.PI, w: 0 }, ...radials, { a: Math.PI * 2, w: 0 }];
  const supplies = [new THREE.Vector3(-70, 0, -70), new THREE.Vector3(70, 0, -70), new THREE.Vector3(-164, 0, -60), new THREE.Vector3(164, 0, -60), new THREE.Vector3(-60, 0, -165)];
  const plaza = new THREE.Vector3(0, 0, -128);
  const excl: [number, number, number][] = [[plaza.x, plaza.z, 40], [0, -WALL_R + 5, 26], ...supplies.map((s) => [s.x, s.z, 15] as [number, number, number])];
  const blocked = (x: number, z: number, rad: number) => excl.some(([ex, ez, er]) => Math.hypot(x - ex, z - ez) < er + rad);

  const styles = ["timber", "timber", "plain", "plain", "plain", "stone"] as const;
  const row = (rr: number, depth: number) => {
    for (let k = 0; k < bounds.length - 1; k++) {
      const ta = bounds[k].a + (bounds[k].w / 2 + 0.5) / rr;
      const tb = bounds[k + 1].a - (bounds[k + 1].w / 2 + 0.5) / rr;
      let t = ta;
      while (true) {
        const w = 6 + r() * 4;
        const dt = w / rr;
        if (t + dt > tb) break;
        const tc = t + dt / 2;
        t += dt;
        if (r() < 0.1) t += 3 / rr;
        const x = rr * Math.cos(tc), z = rr * Math.sin(tc);
        const d = depth - r() * 1.5;
        if (z + Math.max(w, d) / 2 > -4) continue;
        if (blocked(x, z, Math.max(w, d) / 2)) continue;
        const near = rr < 140 ? 1 : 0;
        const floors = Math.min(6, 3 + Math.floor(r() * 3) + near);
        house(m, shapes, r, x, z, tc + Math.PI / 2, w - 0.05, d, floors, r() < 0.6, styles[Math.floor(r() * styles.length)]);
      }
    }
  };
  const bands = [
    { r0: 20, r1: 94, mid: true },
    { r0: 104, r1: 169, mid: true },
    { r0: 181, r1: 238, mid: false },
  ];
  for (const b of bands) {
    row(b.r0 + 5, 10);
    row(b.r1 - 5, 10);
    if (b.mid) {
      const mid = (b.r0 + b.r1) / 2;
      row(mid - 5, 10);
      row(mid + 5, 10);
    } else {
      const mid = (b.r0 + b.r1) / 2;
      for (let t = Math.PI + 0.06; t < Math.PI * 2 - 0.06; t += 0.05 + r() * 0.06) {
        const rr = mid + (r() - 0.5) * 22;
        const x = rr * Math.cos(t), z = rr * Math.sin(t);
        if (z > -6 || blocked(x, z, 4) || radials.some((q) => Math.abs(q.a - t) * rr < q.w / 2 + 4)) continue;
        if (r() < 0.65) tree(m, r, x, z, 0.9 + r() * 0.4);
        else house(m, shapes, r, x, z, t + Math.PI / 2, 4 + r() * 2, 4 + r() * 2, 1, r() < 0.5, "timber");
      }
    }
  }

  church(m, shapes, r, plaza.x - 31, plaza.z + 6);
  m.stone.setColor("#d8cfbc");
  m.wall.setColor("#cfc6b3");
  m.wall.box(plaza.x, 0.5, plaza.z, 4.2, 0.5, 4.2, Math.PI / 4, 0.4);
  m.wall.add(new THREE.CylinderGeometry(0.6, 0.9, 3.4, 10), mat(plaza.x, 1.7, plaza.z), "#cfc6b3");
  m.prop.add(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 20), mat(plaza.x, 1.02, plaza.z, 1, 1, 1, 0, Math.PI / 8, 0), "#5f8fc2");
  const awnings = ["#b8462f", "#2f6e8a", "#c9a24a", "#3e7a46", "#9a3a5a"];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    if (Math.abs(Math.cos(a)) < 0.3 && Math.sin(a) > 0) continue;
    stall(m, plaza.x + Math.cos(a) * 22, plaza.z + Math.sin(a) * 22, a + Math.PI / 2, awnings[i % awnings.length]);
  }

  const flareTops: THREE.Vector3[] = [];
  const depotDown = supplies.map(() => false);
  for (const s of supplies) {
    const yaw = Math.atan2(s.z, s.x) + Math.PI / 2;
    const d = depot(m, shapes, r, s.x, s.z, yaw);
    flareTops.push(d.top);
    m.prop.setColor("#2f8a3e");
    for (const f of d.flags) m.prop.box(f.x + 1.1, f.y, f.z, 1.1, 0.7, 0.04, 0);
  }

  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const rr = 300 + r() * 900;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const n = 3 + Math.floor(r() * 7);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * 50, z = cz + (r() - 0.5) * 50;
      if (Math.abs(x) < 16 || Math.hypot(x, z) < WALL_R + 25 || Math.abs(z - mariaZ(x)) < 20) continue;
      tree(m, r, x, z, 1.4 + r() * 0.8);
    }
  }
  for (let z = -300; z > -1200; z -= 26) for (const sx of [-1, 1]) tree(m, r, sx * (14 + r() * 3), z + r() * 6, 1.3 + r() * 0.4);
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2;
    const rr = 420 + r() * 700;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (Math.abs(x) < 30 || Math.abs(z - mariaZ(x)) < 30) continue;
    for (let k = 0; k < 3 + r() * 4; k++) {
      const hx = x + (r() - 0.5) * 40, hz = z + (r() - 0.5) * 40;
      house(m, shapes, r, hx, hz, r() * Math.PI, 6 + r() * 3, 8 + r() * 3, 1 + Math.floor(r() * 2), r() < 0.5, r() < 0.5 ? "timber" : "plain");
    }
  }

  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + r() * 0.1;
    const rr = 3300 + r() * 600;
    const h = 90 + r() * 260;
    const rad = 300 + r() * 400;
    m.far.add(new THREE.ConeGeometry(rad, h, 6, 1), mat(Math.cos(a) * rr, h / 2 - 10, Math.sin(a) * rr, 1, 1, 0.8 + r() * 0.5, 0, r() * 3, 0), r() < 0.5 ? "#b4c6dc" : "#a9bcd6");
  }

  const mk = (geo: THREE.BufferGeometry, material: THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return mesh;
  };
  const roofMat = toon({ color: "#ffffff", map: roofTiles(), vertexColors: true, side: THREE.DoubleSide });
  const wallMat = toon({ color: "#ffffff", map: wallStone(), vertexColors: true });
  const propMat = toon({ color: "#ffffff", vertexColors: true });
  mk(m.timber.geometry(), toon({ color: "#ffffff", map: facade("timber"), vertexColors: true }));
  mk(m.plain.geometry(), toon({ color: "#ffffff", map: facade("plain"), vertexColors: true }));
  mk(m.stone.geometry(), toon({ color: "#ffffff", map: facade("stone"), vertexColors: true }));
  mk(m.roof.geometry(), roofMat);
  mk(m.wall.geometry(), wallMat);
  mk(m.prop.geometry(), propMat);
  mk(m.leaf.geometry(), toon({ color: "#ffffff", vertexColors: true }));
  const farMat = toon({ color: "#ffffff", vertexColors: true }) as THREE.MeshToonMaterial;
  farMat.fog = false;
  mk(m.far.geometry(), farMat, false);
  const lintel = mk(wallInfo.lintel, wallMat);
  const door = mk(wallInfo.door, propMat);

  const plane = new THREE.PlaneGeometry(9000, 9000, 1, 1);
  plane.rotateX(-Math.PI / 2);
  const puv = plane.getAttribute("uv");
  const ppos = plane.getAttribute("position");
  for (let i = 0; i < puv.count; i++) puv.setXY(i, ppos.getX(i) / 460, ppos.getZ(i) / 460);
  const fieldMat = toon({ color: "#ffffff", map: fields() });
  mk(plane, fieldMat, false);

  const overlay = (color: THREE.ColorRepresentation, map?: THREE.Texture) => {
    const mt = toon({ color, map }) as THREE.MeshToonMaterial;
    mt.polygonOffset = true;
    mt.polygonOffsetFactor = -2;
    mt.polygonOffsetUnits = -4;
    return mt;
  };
  const disk = new THREE.CircleGeometry(WALL_R, 96, 0, Math.PI);
  disk.rotateX(-Math.PI / 2);
  const duv = disk.getAttribute("uv");
  const dpos = disk.getAttribute("position");
  for (let i = 0; i < duv.count; i++) duv.setXY(i, dpos.getX(i) / 7, dpos.getZ(i) / 7);
  mk(disk, overlay("#ffffff", cobble()), false);
  const road = new Mesher();
  road.setColor("#d2bf96");
  road.quad([-9, 0, -WALL_R - 4], [9, 0, -WALL_R - 4], [9, 0, -1600], [-9, 0, -1600], 0, 0, 1, 1, [0, -1, -400]);
  road.quad([-9, 0, 10], [9, 0, 10], [9, 0, 1600], [-9, 0, 1600], 0, 0, 1, 1, [0, -1, 400]);
  const roadMat = overlay("#ffffff");
  (roadMat as THREE.MeshToonMaterial).vertexColors = true;
  mk(road.geometry(), roadMat, false);

  const col = createColossal();
  group.add(col.group);

  const white = (g: THREE.BufferGeometry) => {
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));
    return g;
  };
  const debrisGeo = white(new THREE.DodecahedronGeometry(1, 0));
  const debris = new THREE.InstancedMesh(debrisGeo, wallMat, 40);
  debris.castShadow = true;
  debris.receiveShadow = true;
  debris.visible = false;
  debris.frustumCulled = false;
  group.add(debris);
  const planks = new THREE.InstancedMesh(white(new THREE.BoxGeometry(0.6, 0.4, 5)), propMat, 18);
  planks.castShadow = true;
  planks.visible = false;
  planks.frustumCulled = false;
  group.add(planks);
  const DN = 58;
  const dp = new Float32Array(DN * 3), dv = new Float32Array(DN * 3), dr = new Float32Array(DN * 3), dw = new Float32Array(DN * 3), ds = new Float32Array(DN);
  const dRest = new Uint8Array(DN);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();
  for (let i = 0; i < 18; i++) planks.setColorAt(i, tmpC.set(i % 3 ? "#5c3f2b" : "#2e2a2a"));
  for (let i = 0; i < 40; i++) debris.setColorAt(i, tmpC.set("#d0c7b5").offsetHSL(0, 0, (r() - 0.5) * 0.1));

  const boltPts = 14;
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(boltPts * 2 * 3);
  boltGeo.setAttribute("position", new THREE.BufferAttribute(boltPos, 3));
  const bIdx: number[] = [];
  for (let i = 0; i < boltPts - 1; i++) bIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  boltGeo.setIndex(bIdx);
  const boltMat = new THREE.MeshBasicMaterial({ color: "#fff7c8", side: THREE.DoubleSide, fog: false, transparent: true });
  const bolt = new THREE.Mesh(boltGeo, boltMat);
  bolt.visible = false;
  bolt.frustumCulled = false;
  group.add(bolt);
  const buildBolt = () => {
    const top = new THREE.Vector3(COLOSSAL_HEAD.x - 120, 520, COLOSSAL_HEAD.z - 260);
    for (let i = 0; i < boltPts; i++) {
      const t = i / (boltPts - 1);
      const p = top.clone().lerp(COLOSSAL_HEAD, t);
      if (i > 0 && i < boltPts - 1) p.add(new THREE.Vector3((r() - 0.5) * 40, (r() - 0.5) * 20, (r() - 0.5) * 40));
      const w = 4.5 * (1 - t * 0.6);
      boltPos.set([p.x - w, p.y, p.z, p.x + w, p.y, p.z], i * 6);
    }
    boltGeo.getAttribute("position").needsUpdate = true;
    boltGeo.computeBoundingSphere();
  };

  const flares = createPuffs(320);
  group.add(flares.mesh);
  let flareAcc = 0;
  let flareRate = 0.14;

  const collider = createCollider(shapes);

  const spawnT = Math.PI * 1.5 + 150 / WALL_R;
  const spawn = new THREE.Vector3(Math.cos(spawnT) * (WALL_R - 4.4), WALL_H + 1.0, Math.sin(spawnT) * (WALL_R - 4.4));
  const spawnYaw = Math.atan2(-30 - spawn.x, -150 - spawn.z);
  const titanSpawns = [
    new THREE.Vector3(-20, 0, -305),
    new THREE.Vector3(24, 0, -315),
    new THREE.Vector3(0, 0, -340),
    new THREE.Vector3(-55, 0, -325),
    new THREE.Vector3(55, 0, -330),
    new THREE.Vector3(-95, 0, -300),
    new THREE.Vector3(95, 0, -305),
    new THREE.Vector3(0, 0, -380),
  ];
  const breach = new THREE.Vector3(0, 0, -WALL_R + 18);
  const gatePos = new THREE.Vector3(0, GATE_H / 2, -WALL_R);

  let gateOpen = false;
  let kickT = -1;
  let colossalOn = true;
  let steamAcc = 0;
  let steamIdx = 0;
  let boltT = 0;
  const steamTmp = new THREE.Vector3();
  const goneEvents: GameEvent[] = [{ type: "sfx", name: "steamHiss", volume: 1, at: COLOSSAL_HEAD }, { type: "shake", strength: 0.3 }];

  const kickGate = (): GameEvent[] => {
    if (gateOpen) return NONE;
    gateOpen = true;
    kickT = 0;
    door.visible = false;
    lintel.visible = false;
    wallInfo.doorShape.on = false;
    wallInfo.lintelShape.on = false;
    for (let i = 0; i < DN; i++) {
      const big = i < 40;
      dp[i * 3] = (r() - 0.5) * GATE_HALF * 2;
      dp[i * 3 + 1] = 2 + r() * (big ? 28 : 16);
      dp[i * 3 + 2] = -WALL_R - 2 + r() * 4;
      dv[i * 3] = (r() - 0.5) * 26;
      dv[i * 3 + 1] = 4 + r() * 18;
      dv[i * 3 + 2] = 18 + r() * (big ? 40 : 50);
      dr[i * 3] = r() * 6; dr[i * 3 + 1] = r() * 6; dr[i * 3 + 2] = r() * 6;
      dw[i * 3] = (r() - 0.5) * 8; dw[i * 3 + 1] = (r() - 0.5) * 8; dw[i * 3 + 2] = (r() - 0.5) * 8;
      ds[i] = big ? 0.8 + r() * 2.4 : 1;
      dRest[i] = 0;
    }
    debris.visible = planks.visible = true;
    buildBolt();
    bolt.visible = true;
    boltT = 0.45;
    fx.steam(COLOSSAL_HEAD, 14, 0.2);
    fx.dust(gatePos, 12);
    fx.steam(gatePos, 10, 0.2);
    return [
      { type: "sfx", name: "gateBreak", volume: 1, at: gatePos.clone() },
      { type: "sfx", name: "lightning", volume: 1, at: COLOSSAL_HEAD.clone() },
      { type: "shake", strength: 1.6 },
    ];
  };

  const stepDebris = (dt: number) => {
    let moving = false;
    for (let i = 0; i < DN; i++) {
      const o = i * 3;
      if (!dRest[i]) {
        moving = true;
        dv[o + 1] -= 22 * dt;
        dp[o] += dv[o] * dt;
        dp[o + 1] += dv[o + 1] * dt;
        dp[o + 2] += dv[o + 2] * dt;
        dr[o] += dw[o] * dt; dr[o + 1] += dw[o + 1] * dt; dr[o + 2] += dw[o + 2] * dt;
        const floorY = i < 40 ? ds[i] * 0.6 : 0.2;
        if (dp[o + 1] < floorY) {
          dp[o + 1] = floorY;
          if (Math.abs(dv[o + 1]) > 6 && i < 40 && ds[i] > 1.6) {
            steamTmp.set(dp[o], 0, dp[o + 2]);
            fx.dust(steamTmp, ds[i] * 1.6);
          }
          dv[o + 1] = -dv[o + 1] * 0.25;
          dv[o] *= 0.5; dv[o + 2] *= 0.5;
          dw[o] *= 0.5; dw[o + 1] *= 0.5; dw[o + 2] *= 0.5;
          if (Math.abs(dv[o + 1]) < 1.5 && Math.hypot(dv[o], dv[o + 2]) < 1.5) {
            dRest[i] = 1;
            if (i < 40 && ds[i] > 1.1) collider.addDynamic(shape(dp[o], dp[o + 2], dr[o + 1], ds[i] * 0.75, ds[i] * 0.75, 0, floorY + ds[i] * 0.6));
          }
        }
      }
      dummy.position.set(dp[o], dp[o + 1], dp[o + 2]);
      dummy.rotation.set(dr[o], dr[o + 1], dr[o + 2]);
      if (i < 40) {
        dummy.scale.set(ds[i], ds[i] * 0.8, ds[i]);
        dummy.updateMatrix();
        debris.setMatrixAt(i, dummy.matrix);
      } else {
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        planks.setMatrixAt(i - 40, dummy.matrix);
      }
    }
    debris.instanceMatrix.needsUpdate = true;
    planks.instanceMatrix.needsUpdate = true;
    return moving;
  };
  let debrisLive = false;

  const update = (dt: number): GameEvent[] => {
    flareAcc += dt;
    while (flareAcc > flareRate) {
      flareAcc -= flareRate;
      for (let i = 0; i < flareTops.length; i++) if (!depotDown[i]) flares.spawn(flareTops[i].x + (r() - 0.5), flareTops[i].y, flareTops[i].z + (r() - 0.5), 1.2 + r(), 7 + r() * 2, 0.6, 2.6 + r() * 1.2, 1.5, 7.5, PUFF.flare, 0.25, -0.2);
    }
    flares.update(dt);

    let out = NONE;
    if (colossalOn) {
      steamAcc += dt;
      if (steamAcc > 0.3) {
        steamAcc = 0;
        steamIdx = (steamIdx + 1) % col.steamPts.length;
        const p = col.steamPts[steamIdx];
        steamTmp.set(p.x + (r() - 0.5) * 3, p.y, p.z + (r() - 0.5) * 3);
        fx.steam(steamTmp, 4 + r() * 3, 0.2);
      }
      if (kickT >= 0) {
        kickT += dt;
        const k = kickT;
        const a = k < 0.22 ? (k / 0.22) * KICK : k < 0.9 ? KICK : k < 2.2 ? KICK * (1 - (k - 0.9) / 1.3) : 0;
        col.hip.rotation.x = -a;
        if (k > VANISH_AFTER) {
          colossalOn = false;
          col.group.visible = false;
          for (const p of col.steamPts) fx.steam(p, 16, 0.3);
          fx.steam(COLOSSAL_HEAD, 12, 5);
          steamTmp.set(0, 42, -285);
          fx.steam(steamTmp, 18, 4);
          out = goneEvents;
        }
      }
    }
    if (boltT > 0) {
      boltT -= dt;
      bolt.visible = boltT > 0 && Math.floor(boltT * 30) % 3 !== 0;
    }
    if (kickT >= 0 && (kickT < 0.2 || debrisLive)) debrisLive = stepDebris(dt);
    return out;
  };

  const inside = (x: number, z: number) => {
    if (z < 0) return x * x + z * z < (WALL_R - WALL_T / 2) ** 2;
    return z > mariaZ(x) + WALL_T / 2;
  };

  const quality = (q: Quality) => {
    flareRate = q === "low" ? 0.3 : q === "medium" ? 0.16 : 0.12;
    flares.setCap(q === "low" ? 120 : 320);
  };

  return {
    group,
    spawn,
    spawnYaw,
    supplies,
    depotDown,
    titanSpawns,
    breach,
    colossalHead: COLOSSAL_HEAD,
    get gateOpen() {
      return gateOpen;
    },
    raycast: collider.raycast,
    collide: collider.collide,
    pushTitan: collider.pushTitan,
    inside,
    kickGate,
    update: (dt: number) => update(dt),
    setQuality: quality,
  };
}
