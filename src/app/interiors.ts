import * as THREE from "three";
import { HALF, PERIOD, type Box, type City } from "./city";
import { Bucket, UNIT, box, mat } from "./city-kit";
import type { GameEvent, Input } from "./contracts";
import { R, groundAt, insideAny, rayBox, type Player } from "./player";
import { SIGN_COLORS, buildRoom, doorTexture, heartTexture, makeAtlas, type Interact, type Room, type ShopKind } from "./interiors-rooms";
import type { Fade } from "./interiors-fade";

const ROOM_X = 6000;
const ROOM_Z = 6000;
const DOOR_RANGE = 2.4;
const ACT_RANGE = 2.2;
const ICON_RANGE = 14;
const CAM_ARM = 3.2;
const EDGE = 15; // block edge offset from a street center line
const LAMPS = [EDGE + 3.5, PERIOD / 2, PERIOD - EDGE - 3.5];

type Door = {
  name: string;
  kind: ShopKind;
  pos: THREE.Vector3; // ground point on the face, center of the door
  n: THREE.Vector3; // outward
  roof: boolean;
  building: number; // index into lobby buildings, -1 for shops
};

const NAMES: Record<Exclude<ShopKind, "lobby">, string[]> = {
  bodega: ["Sal's Bodega", "Lucky Deli & Grocery", "Corner Stop Bodega", "Bravo Mini Market"],
  pizza: ["Nonna's Pizza", "Big Apple Slice", "Village Pie Co."],
  coffee: ["Bean There Coffee", "Daily Grind", "Steam Room Cafe"],
  comic: ["Panel Comics", "Web Head Comics", "Ink & Cape Comics"],
  laundromat: ["Suds City Laundromat", "Spin Cycle Wash", "Fresh Fold Laundry"],
};
const LOBBIES = ["The Ashford", "Parkview Tower", "The Calloway", "Hudson Court"];
const SHOP_ORDER: Exclude<ShopKind, "lobby">[] = ["bodega", "pizza", "coffee", "comic", "laundromat"];

const near = (v: number, k: number) => {
  const m = (((v + HALF - k * EDGE) % PERIOD) + PERIOD) % PERIOD;
  return Math.min(m, PERIOD - m) < 1.5;
};

function findDoors(city: City, spawn: THREE.Vector3) {
  type Cand = { b: Box; pos: THREE.Vector3; n: THREE.Vector3; district: string; tall: boolean };
  const cands: Cand[] = [];
  const free = (x: number, z: number) => !insideAny(city, x, 1, z, 0.3);
  for (const b of city.boxes) {
    if (b.maxY < 9 || b.maxX - b.minX < 10 || b.maxZ - b.minZ < 10) continue;
    if (b.minX < -HALF || b.maxX > HALF || b.minZ < -HALF || b.maxZ > HALF) continue;
    const faces: [number, number, number, number, boolean][] = [
      [b.minX, (b.minZ + b.maxZ) / 2, -1, 0, near(b.minX, 1)],
      [b.maxX, (b.minZ + b.maxZ) / 2, 1, 0, near(b.maxX, -1)],
      [(b.minX + b.maxX) / 2, b.minZ, 0, -1, near(b.minZ, 1)],
      [(b.minX + b.maxX) / 2, b.maxZ, 0, 1, near(b.maxZ, -1)],
    ];
    for (const [cx, cz, nx, nz, edge] of faces) {
      if (!edge) continue;
      const sx = -nz;
      const sz = nx;
      // Street lamps stand at the block corners and middle, so slide the door off them.
      const half = (nx ? b.maxZ - b.minZ : b.maxX - b.minX) / 2 - 1.8;
      const along = [5, -5, 8, -8, 0].find((o) => Math.abs(o) <= half && LAMPS.every((l) => Math.abs((((nx ? cz : cx) + o + HALF) % PERIOD + PERIOD) % PERIOD - l) > 2.5));
      if (along === undefined) continue;
      const x = cx + sx * along;
      const z = cz + sz * along;
      let ok = true;
      for (const out of [1.2, 3, 6]) for (const s of [-1.6, 0, 1.6]) if (!free(x + nx * out + sx * s, z + nz * out + sz * s)) ok = false;
      if (!ok) continue;
      const district = city.districts.find((d) => x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ)?.name ?? "";
      if (!district || district === "Central Park") continue;
      cands.push({ b, pos: new THREE.Vector3(x, 0, z), n: new THREE.Vector3(nx, 0, nz), district, tall: b.maxY > 30 && b.maxY < 130 });
    }
  }
  const doors: Door[] = [];
  const lobbyBoxes: Box[] = [];
  const taken = (p: THREE.Vector3, gap: number) => doors.some((d) => !d.roof && d.pos.distanceTo(p) < gap);
  const pick = (c: Cand, kind: ShopKind, name: string, building = -1) => doors.push({ name, kind, pos: c.pos, n: c.n, roof: false, building });
  const counts: Record<string, number> = {};
  let shop = 0;
  const addShop = (c: Cand) => {
    const kind = SHOP_ORDER[shop % SHOP_ORDER.length];
    const list = NAMES[kind];
    pick(c, kind, list[Math.floor(shop / SHOP_ORDER.length) % list.length]);
    counts[c.district] = (counts[c.district] ?? 0) + 1;
    shop++;
  };
  const street = new THREE.Vector3(spawn.x, 0, spawn.z);
  const byDist = [...cands].sort((a, b) => a.pos.distanceTo(street) - b.pos.distanceTo(street));
  if (byDist[0]) addShop(byDist[0]);
  const ordered = [...cands].sort((a, b) => (Math.sin(a.pos.x * 12.9898 + a.pos.z * 78.233) * 43758.5453) % 1 - (Math.sin(b.pos.x * 12.9898 + b.pos.z * 78.233) * 43758.5453) % 1);
  for (const c of ordered) {
    if (shop >= 16) break;
    if ((counts[c.district] ?? 0) >= 2 || taken(c.pos, 90)) continue;
    addShop(c);
  }
  for (const c of ordered) {
    if (lobbyBoxes.length >= LOBBIES.length) break;
    if (!c.tall || taken(c.pos, 60) || lobbyBoxes.includes(c.b)) continue;
    const roof = roofSpot(city, c.b);
    if (!roof) continue;
    const i = lobbyBoxes.length;
    lobbyBoxes.push(c.b);
    pick(c, "lobby", LOBBIES[i], i);
    doors.push({ name: LOBBIES[i], kind: "lobby", pos: roof.pos, n: roof.n, roof: true, building: i });
  }
  return doors;
}

// A 3x3 m clear patch on the roof, with the door facing the roof center.
function roofSpot(city: City, b: Box) {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) {
    const x = b.minX + (b.maxX - b.minX) * fx;
    const z = b.minZ + (b.maxZ - b.minZ) * fz;
    let ok = true;
    for (let dx = -2.5; dx <= 2.5 && ok; dx += 1.25) for (let dz = -2.5; dz <= 2.5 && ok; dz += 1.25) if (Math.abs(groundAt(city, x + dx, z + dz, 1e4) - b.maxY) > 0.01) ok = false;
    if (!ok) continue;
    const n = Math.abs(cx - x) > Math.abs(cz - z) ? new THREE.Vector3(Math.sign(cx - x) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(cz - z) || 1);
    return { pos: new THREE.Vector3(x + n.x * 1.5, b.maxY, z + n.z * 1.5), n, center: new THREE.Vector3(x, b.maxY, z) };
  }
  return null;
}

export function createInteriors(scene: THREE.Scene, city: City, keep: THREE.Object3D[], spawn: THREE.Vector3, hooks: { heal: (amount: number) => void; setYaw: (yaw: number) => void }) {
  const doors = findDoors(city, spawn);
  const atlas = makeAtlas(doors.filter((d) => !d.roof).map((d) => ({ name: d.name, kind: d.kind })));
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const artMat = new THREE.MeshBasicMaterial({ map: atlas.tex, vertexColors: true });

  const dSolid = new Bucket();
  const dGlow = new Bucket();
  const dArt = new Bucket();
  const roofBoxes: Box[] = [];
  let sign = 0;
  for (const d of doors) {
    const ry = Math.atan2(d.n.x, d.n.z);
    const at = (along: number, y: number, out: number) => [d.pos.x + d.n.x * out - d.n.z * along, y, d.pos.z + d.n.z * out + d.n.x * along] as const;
    const put = (b: Bucket, along: number, y: number, out: number, w: number, h: number, t: number, col: number, k = 1) => {
      const [x, yy, z] = at(along, y, out);
      b.add(UNIT.box, mat(x, yy, z, w, h, t, ry), col, k);
    };
    if (d.roof) {
      const c = d.pos.clone().addScaledVector(d.n, -1.5);
      box(dSolid, c.x, d.pos.y + 1.4, c.z, 3, 2.8, 3, 0x8a5a44);
      box(dSolid, c.x, d.pos.y + 2.86, c.z, 3.3, 0.12, 3.3, 0x5a5e66);
      put(dSolid, 0, d.pos.y + 1.1, 0.03, 1.1, 2.2, 0.08, 0x3b4048);
      put(dGlow, 0, d.pos.y + 2.45, 0.1, 0.3, 0.15, 0.12, 0xffd59a, 3);
      put(dGlow, 0.35, d.pos.y + 1.05, 0.08, 0.06, 0.06, 0.04, 0xffe9a0, 1.5);
      roofBoxes.push({ minX: c.x - 1.5, maxX: c.x + 1.5, minZ: c.z - 1.5, maxZ: c.z + 1.5, maxY: d.pos.y + 2.8 });
      continue;
    }
    const [bg] = SIGN_COLORS[d.kind];
    const awn = new THREE.Color(bg).getHex();
    put(dSolid, 0, 1.5, 0.06, 2.2, 3.0, 0.12, 0x23262b);
    put(dGlow, 0, 1.3, 0.13, 1.6, 2.5, 0.02, 0xffd7a0, 1.25);
    put(dSolid, 0, 1.3, 0.15, 0.06, 2.5, 0.03, 0x23262b);
    put(dSolid, 0.55, 1.2, 0.17, 0.05, 0.4, 0.05, 0xc9a14a);
    put(dSolid, 0, 0.06, 0.5, 2.6, 0.12, 0.9, 0x8d8a84);
    const [ax, ay, az] = at(0, 3.35, 0.7);
    dSolid.add(UNIT.box, mat(ax, ay, az, 3.4, 0.08, 1.4, ry, 0.35), awn);
    put(dSolid, 0, 3.08, 1.38, 3.4, 0.35, 0.04, awn);
    const [sx, sy, sz] = at(0, 4.05, 0.08);
    dArt.add(UNIT.plane, mat(sx, sy, sz, 3.8, 0.48, 1, ry), 0xffffff, 1.3, [0, 0], atlas.signRect[sign++]);
    put(dGlow, 0, 4.36, 0.12, 3.6, 0.05, 0.08, 0xfff1d0, 2);
  }
  const outside = new THREE.Group();
  outside.add(new THREE.Mesh(dSolid.build(), solidMat), new THREE.Mesh(dGlow.build(), glowMat), new THREE.Mesh(dArt.build(), artMat));
  for (const m of outside.children) (m as THREE.Mesh).castShadow = false;
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: doorTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  icon.scale.setScalar(0.7);
  icon.visible = false;
  outside.add(icon);
  scene.add(outside);

  const kinds: ShopKind[] = ["bodega", "pizza", "coffee", "comic", "laundromat", "lobby"];
  const rooms = new Map<ShopKind, Room>();
  const inside = new THREE.Group();
  kinds.forEach((k, i) => {
    const room = buildRoom(k, ROOM_X + i * 60, ROOM_Z, atlas, { solid: solidMat, glow: glowMat, art: artMat });
    rooms.set(k, room);
    inside.add(room.group);
  });
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false, toneMapped: false }));
  heart.scale.setScalar(0.3);
  heart.visible = false;
  inside.add(heart);
  scene.add(inside);

  const events: GameEvent[] = [];
  const later: GameEvent[] = []; // pushed from fade callbacks, sent next frame
  const prompts: { key: string; label: string }[] = [];
  let room: Room | null = null;
  let entered: Door | null = null;
  let act: Interact | null = null;
  let door: Door | null = null;
  let talkT = 0;
  let heartT = 1;
  let petted = false;
  let read = false;
  let buyCd = 0;
  let line = 0;
  const hidden: THREE.Object3D[] = [];
  const tmp = new THREE.Vector3();
  const toPlayer = new THREE.Vector3();

  const setWorld = (show: boolean) => {
    if (show) {
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
      return;
    }
    for (const o of scene.children) {
      if (o === inside || keep.includes(o) || (o as THREE.Light).isLight || !o.visible) continue;
      o.visible = false;
      hidden.push(o);
    }
  };

  const place = (player: Player, pos: THREE.Vector3, face: THREE.Vector3) => {
    player.teleport(pos);
    player.face(face);
    hooks.setYaw(Math.atan2(face.x, face.z));
  };

  const enter = (d: Door, player: Player) => {
    const r = rooms.get(d.kind)!;
    room = r;
    entered = d;
    petted = false;
    read = false;
    buyCd = 0;
    r.group.visible = true;
    setWorld(false);
    player.ceiling = r.h;
    place(player, tmp.set(r.ox, R + 0.05, r.oz + 1.6), toPlayer.set(0, 0, 1));
    later.push({ type: "sfx", name: "ui", volume: 0.6 }, { type: "toast", title: d.kind === "lobby" ? `${d.name} lobby` : d.name });
  };

  const leave = (player: Player, to: Door) => {
    if (room) room.group.visible = false;
    room = null;
    entered = null;
    setWorld(true);
    player.ceiling = Infinity;
    place(player, tmp.copy(to.pos).addScaledVector(to.n, 1.6).setY(to.pos.y + R + 0.05), to.n);
    later.push({ type: "sfx", name: "ui", volume: 0.6 });
  };

  const run = (a: Interact, player: Player, fade: Fade) => {
    const r = room!;
    if (a.kind === "exit") {
      const back = entered!.roof ? doors.find((d) => d.building === entered!.building && !d.roof)! : entered!;
      fade.run(() => leave(player, back));
    } else if (a.kind === "elevator") {
      const top = doors.find((d) => d.building === entered!.building && d.roof)!;
      events.push({ type: "sfx", name: "ping", volume: 0.7 });
      fade.run(() => {
        leave(player, top);
        later.push({ type: "toast", title: "Roof access" });
      });
    } else if (a.kind === "talk") {
      talkT = 1.6;
      events.push({ type: "toast", title: r.npcName, text: r.lines[line++ % r.lines.length] }, { type: "sfx", name: "ui", volume: 0.5 });
    } else if (a.kind === "pet" && r.cat) {
      heartT = 0;
      events.push({ type: "sfx", name: "collect", volume: 0.5 });
      if (!petted) events.push({ type: "xp", amount: 25, reason: "Pet the bodega cat" });
      else events.push({ type: "toast", title: "Purr", text: "The cat leans into your hand." });
      petted = true;
    } else if (a.kind === "buy") {
      if (buyCd > 0) {
        events.push({ type: "toast", title: "Still enjoying the last one" });
        return;
      }
      buyCd = 8;
      hooks.heal(a.heal ?? 0.3);
      talkT = 1;
      events.push({ type: "sfx", name: "heal" }, { type: "toast", title: a.item ?? "Snack", text: "Warm and good. Health restored." });
    } else if (a.kind === "read") {
      events.push({ type: "sfx", name: "ui", volume: 0.5 }, { type: "toast", title: "Amazing Fantasy #15", text: "With great power..." });
      if (!read) events.push({ type: "xp", amount: 15, reason: "Read a comic" });
      read = true;
    }
  };

  const cam = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    get inside() {
      return room !== null;
    },
    reset(player: Player) {
      if (!room) return;
      room.group.visible = false;
      room = null;
      entered = null;
      setWorld(true);
      player.ceiling = Infinity;
    },
    prompts,
    boxes(x: number, z: number): readonly Box[] {
      if (room) return room.boxes;
      return Math.abs(x) < HALF + 50 && Math.abs(z) < HALF + 50 ? roofBoxes : [];
    },
    update(dt: number, t: number, input: Input, player: Player, fade: Fade, blocked: boolean) {
      events.length = 0;
      events.push(...later);
      later.length = 0;
      prompts.length = 0;
      buyCd -= dt;
      act = null;
      door = null;
      const p = player.pos;
      const canUse = !fade.busy && player.grounded && player.mode === "ground" && !player.swimming;
      // Another module moved the hero out (respawn, mission warp).
      if (room && Math.hypot(p.x - room.ox, p.z - room.oz - room.d / 2) > 40) this.reset(player);
      if (room) {
        const r = room;
        let best = Infinity;
        for (const a of r.acts) {
          const dx = r.ox + a.x - p.x;
          const dz = r.oz + a.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > ACT_RANGE) continue;
          const score = dist - ((dx * input.look.x + dz * input.look.z) / (dist || 1)) * 0.8;
          if (score < best) {
            best = score;
            act = a;
          }
        }
        if (act && canUse) {
          prompts.push({ key: "E", label: act.label });
          if (input.pressed.has("launch")) run(act, player, fade);
        }
        talkT -= dt;
        const npc = r.npc;
        toPlayer.set(p.x - npc.position.x, 0, p.z - npc.position.z);
        const base = npc.userData.baseYaw as number;
        let goal = base;
        if (toPlayer.lengthSq() < 30) {
          const want = Math.atan2(toPlayer.x, toPlayer.z);
          const diff = Math.atan2(Math.sin(want - base), Math.cos(want - base));
          goal = base + THREE.MathUtils.clamp(diff, -1.1, 1.1);
        }
        const cur = npc.rotation.y;
        npc.rotation.y = cur + Math.atan2(Math.sin(goal - cur), Math.cos(goal - cur)) * (1 - Math.exp(-5 * dt));
        npc.position.y = talkT > 0 ? Math.abs(Math.sin(t * 9)) * 0.04 : 0;
        npc.scale.y = 1 + Math.sin(t * 1.7) * 0.008;
        if (r.cat) {
          r.cat.tail.rotation.z = Math.sin(t * (heartT < 1 ? 7 : 2)) * 0.5;
          r.cat.body.scale.y = 1 + Math.sin(t * (heartT < 1 ? 10 : 1.5)) * (heartT < 1 ? 0.03 : 0.015);
        }
        heartT = Math.min(1, heartT + dt / 1.6);
        heart.visible = heartT < 1 && !!r.cat;
        if (heart.visible && r.cat) {
          heart.position.copy(r.cat.body.position).setY(1.5 + heartT * 0.7);
          heart.material.opacity = 1 - heartT * heartT;
          heart.scale.setScalar(0.25 + 0.1 * Math.sin(heartT * 12));
        }
      } else {
        let bestD = Infinity;
        let nearest: Door | null = null;
        for (const d of doors) {
          const dist = Math.hypot(d.pos.x - p.x, d.pos.z - p.z);
          const dy = Math.abs(p.y - R - d.pos.y);
          if (dy > 3 || dist > ICON_RANGE) continue;
          if (dist < bestD) {
            bestD = dist;
            nearest = d;
          }
        }
        icon.visible = nearest !== null;
        if (nearest) {
          icon.position.copy(nearest.pos).addScaledVector(nearest.n, 0.5).setY(nearest.pos.y + (nearest.roof ? 3.4 : 2.9) + Math.sin(t * 3) * 0.06);
          icon.material.opacity = THREE.MathUtils.clamp((ICON_RANGE - bestD) / 5, 0, 0.9);
          tmp.copy(nearest.pos).addScaledVector(nearest.n, 0.9);
          if (Math.hypot(tmp.x - p.x, tmp.z - p.z) < DOOR_RANGE && canUse && !blocked) door = nearest;
        }
        if (door) {
          const d = door;
          prompts.push({ key: "E", label: d.roof ? "Enter stairwell" : `Enter ${d.name}` });
          if (input.pressed.has("launch")) fade.run(() => enter(d, player));
        }
      }
      player.blockE = prompts.length > 0;
      return events;
    },
    fixCamera(camera: THREE.PerspectiveCamera, pos: THREE.Vector3) {
      if (!room) return;
      const r = room;
      focus.copy(pos).setY(pos.y + 0.9);
      dir.copy(camera.position).sub(focus);
      let len = Math.min(dir.length(), CAM_ARM);
      if (len < 1e-3) return;
      dir.normalize();
      const m = 0.3;
      const lim = (o: number, d: number, lo: number, hi: number) => (d > 1e-6 ? (hi - o) / d : d < -1e-6 ? (lo - o) / d : Infinity);
      len = Math.min(len, lim(focus.x, dir.x, r.ox - r.w / 2 + m, r.ox + r.w / 2 - m), lim(focus.z, dir.z, r.oz + m, r.oz + r.d - m), lim(focus.y, dir.y, m, r.h - m));
      for (const b of r.tall) {
        const hit = rayBox(focus, dir, b);
        if (hit >= 0 && hit < len) len = Math.max(0.25, hit - 0.25);
      }
      cam.copy(focus).addScaledVector(dir, Math.max(0.25, len));
      camera.position.copy(cam);
      camera.updateMatrixWorld();
    },
    dispose() {
      scene.remove(outside, inside);
      setWorld(true);
      const seen = new Set<THREE.Material>();
      for (const g of [outside, inside]) {
        g.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          const mt = m.material as THREE.Material | undefined;
          if (mt && !seen.has(mt)) {
            seen.add(mt);
            (mt as THREE.SpriteMaterial).map?.dispose();
            mt.dispose();
          }
        });
      }
      atlas.tex.dispose();
    },
  };
}

export type Interiors = ReturnType<typeof createInteriors>;
