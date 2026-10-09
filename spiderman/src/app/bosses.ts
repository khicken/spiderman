import * as THREE from "three";
import type { Box, City } from "./city";
import { BOUNDS, LANDMARKS, ROAD_W, SPAWN, nearestAvenue, nearestStreet, onLand, shoreDist, streetDist } from "./city-geo";
import type { HudState, Input, Marker } from "./contracts";
import type { Bounds, CombatCtx, Hit, HitResult, Hittable, Threat } from "./combat";
import * as BM from "./boss-models";

export type BossName = "kingpin" | "shocker" | "vulture" | "rhino";

export const BOSSES: Record<BossName, { name: string; title: string; level: number; place: string; intro: string; phase2: string; phase3: string }> = {
  kingpin: { name: "KINGPIN", title: "Wilson Fisk", level: 2, place: "Holiday Plaza rink", intro: "Disable the turrets, then Fisk", phase2: "Dodge his charge into the boards", phase3: "Goons incoming. Clear them first" },
  shocker: { name: "SHOCKER", title: "Herman Schultz", level: 4, place: "Harlem crossing", intro: "Web him when his gauntlets vent", phase2: "Dodge the beam sideways", phase3: "Jump the double shockwaves" },
  vulture: { name: "VULTURE", title: "Adrian Toomes", level: 6, place: "Midtown rooftop", intro: "Strike him when he pauses", phase2: "Watch for feather volleys", phase3: "He called in gunmen" },
  rhino: { name: "RHINO", title: "Aleksei Sytsevich", level: 8, place: "Brooklyn lot", intro: "Dodge his charge into a wall", phase2: "Jump the slam shockwave", phase3: "Mash LMB when he grabs you" },
};

export const bossText = (name: BossName, phase: number) => {
  const d = BOSSES[name];
  return phase >= 3 ? d.phase3 : phase === 2 ? d.phase2 : d.intro;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const inBox = (b: Box, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;

export function placeOf(city: City, name: string) {
  const geo = LANDMARKS.find((l) => l.name === name || l.alias === name);
  const names = [name, geo?.name, geo?.alias];
  const lm = city.landmarks.find((l) => names.includes(l.name));
  if (lm) return new THREE.Vector3(lm.pos.x, 0, lm.pos.z);
  return geo ? new THREE.Vector3(geo.x, 0, geo.z) : null;
}

type Avoid = (x: number, z: number) => boolean;
const NONE: Avoid = () => false;

export function openLot(city: City, x: number, z: number, hx: number, hz: number, range: number, maxShore = Infinity, avoid = NONE) {
  const roadGap = ROAD_W / 2 + 1;
  let best: THREE.Vector3 | null = null;
  let bd = Infinity;
  for (let dx = -range; dx <= range; dx += 6) {
    for (let dz = -range; dz <= range; dz += 6) {
      const cx = x + dx;
      const cz = z + dz;
      const d = Math.hypot(dx, dz);
      if (d >= bd || d > range || shoreDist(cx, cz) > maxShore || avoid(cx, cz)) continue;
      if (cx - hx < BOUNDS.minX + 20 || cx + hx > BOUNDS.maxX - 20 || cz - hz < BOUNDS.minZ + 20 || cz + hz > BOUNDS.maxZ - 20) continue;
      const pts = [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz], [cx, cz - hz], [cx, cz + hz]];
      if (!pts.every(([px, pz]) => onLand(px, pz) && shoreDist(px, pz) > 3 && streetDist(px, pz) > roadGap)) continue;
      if (city.near(cx, cz, Math.max(hx, hz) + 2).some((b) => b.maxY > 0.6 && b.minX < cx + hx + 1 && b.maxX > cx - hx - 1 && b.minZ < cz + hz + 1 && b.maxZ > cz - hz - 1)) continue;
      [bd, best] = [d, new THREE.Vector3(cx, 0, cz)];
    }
  }
  return best;
}

const vultureRoof = (city: City, avoid = NONE): Box => {
  const clear = (b: Box) => !city.near((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 40).some((o) => o !== b && o.maxY > b.maxY - 0.5 && o.minX < b.maxX && o.maxX > b.minX && o.minZ < b.maxZ && o.maxZ > b.minZ);
  const at = placeOf(city, "Empire Tower") ?? new THREE.Vector3();
  const d = (b: Box) => Math.hypot((b.minX + b.maxX) / 2 - at.x, (b.minZ + b.maxZ) / 2 - at.z);
  const roofs = city.boxes.filter((b) => b.maxX - b.minX > 24 && b.maxZ - b.minZ > 24 && b.maxY > 25 && b.maxY < 90).sort((a, b) => d(a) - d(b));
  return roofs.find((b) => clear(b) && !avoid((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)) ?? roofs.find(clear) ?? roofs[0];
};
const roofAt = (city: City, p: THREE.Vector3) => city.near(p.x, p.z, 1).find((b) => inBox(b, p.x, p.z) && Math.abs(b.maxY - p.y) < 0.5) ?? vultureRoof(city);

const YARD = { half: 12, len: 37 };
const rhinoYard = (pos: THREE.Vector3) => ({ x: pos.x, z0: pos.z - YARD.len / 2, z1: pos.z + YARD.len / 2, half: YARD.half });

export function bossArena(city: City, name: BossName, avoid = NONE) {
  if (name === "rhino") {
    const at = placeOf(city, "DUMBO") ?? new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    const lot = (shore: number) => openLot(city, at.x, at.z, YARD.half + 2, YARD.len / 2 + 2, 320, shore, avoid);
    return lot(70) ?? lot(Infinity) ?? at;
  }
  if (name === "kingpin") {
    const lm = placeOf(city, "Holiday Plaza") ?? new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    return lm.setZ(lm.z - 11);
  }
  if (name === "shocker") {
    const at = placeOf(city, "Harlem") ?? new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
    const av = nearestAvenue(at.x, at.z);
    const st = nearestStreet(at.z, av ? av.line : at.x);
    return new THREE.Vector3(av ? av.line : at.x, 0, st ? st.line : at.z);
  }
  const r = vultureRoof(city, avoid);
  return new THREE.Vector3((r.minX + r.maxX) / 2, r.maxY, (r.minZ + r.maxZ) / 2);
}

type Load = { st: "hang" | "fall" | "down" | "gone"; t: number; webs: number; x: number; z: number; center: THREE.Vector3; model: ReturnType<typeof BM.girderModel>; hit: Hittable };
type Turret = { st: "on" | "off" | "flying" | "gone"; base: THREE.Vector3; center: THREE.Vector3; webs: number; t: number; aim: number; cd: number; threat: Threat; from: THREE.Vector3; model: ReturnType<typeof BM.turretModel>; hit: Hittable };

export function createBosses(ctx: CombatCtx) {
  const root = new THREE.Group();
  root.name = "bosses";
  ctx.group.add(root);
  const fisk = BM.kingpinModel();
  const shock = BM.shockerModel();
  const vult = BM.vultureModel();
  const rhino = BM.rhinoModel();
  const models = { kingpin: fisk, shocker: shock, vulture: vult, rhino };
  for (const m of Object.values(models)) {
    m.root.visible = false;
    root.add(m.root);
  }

  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _u = new THREE.Vector3();
  let seed = 31337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const B = {
    name: null as BossName | null,
    id: 0,
    active: false,
    hp: 100,
    phase: 1,
    st: "intro",
    t: 0,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    center: new THREE.Vector3(),
    home: new THREE.Vector3(),
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } as Bounds,
    floorY: 0,
    hits: 0,
    webs: 0,
    takedown: false,
    hurtDone: false,
    seq: 0,
    aim: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    beamA: 0,
    beamW: 0,
    orbit: 0,
    goons: [] as number[],
    waves: 0,
    nextMove: "dive",
    stunLen: 4,
    mash: 0,
    threat: { at: 0, sensed: false } as Threat,
  };
  const done = new Set<number>();
  let seqId = 0;
  let detail = 2;

  const turretAt = (i: number): Turret => {
    const model = BM.turretModel();
    model.root.visible = false;
    root.add(model.root);
    const tu: Turret = { st: "gone", base: new THREE.Vector3(), center: new THREE.Vector3(), webs: 0, t: 0, aim: 0, cd: 2 + i * 2.5, threat: { at: 0, sensed: false }, from: new THREE.Vector3(), model, hit: null as unknown as Hittable };
    tu.hit = {
      center: tu.center,
      radius: 0.7,
      targetable: () => B.active && (tu.st === "on" || tu.st === "off"),
      airborne: () => true,
      yaw: () => 0,
      hit: () => "block",
      web: (n) => {
        if (tu.st !== "on") return false;
        tu.webs += n;
        if (tu.webs >= 4) {
          tu.st = "off";
          tu.aim = 0;
          tu.t = 0;
          ctx.unwarn(tu.threat);
          ctx.events.push({ type: "sfx", name: "metal" }, { type: "toast", title: "TURRET JAMMED", text: "Hold F to yank it" });
          ctx.burst(tu.center, 12, 7, 3, 2.4, 1);
        }
        return true;
      },
      yank: () => {
        if (tu.st !== "off") return false;
        tu.st = "flying";
        tu.t = 0;
        tu.from.copy(tu.center);
        ctx.events.push({ type: "sfx", name: "metal" });
        return true;
      },
      finishable: () => false,
      finishCost: () => 1,
      finish: () => {},
      hint: () => (tu.st === "on" ? { key: "RMB", label: "Web the turret" } : tu.st === "off" ? { key: "F", label: "Hold to yank the turret" } : null),
    };
    return tu;
  };
  const turrets = [turretAt(0), turretAt(1)];

  const GANTRY_Y = 9;
  const barriers = BM.barrierRow(YARD.half * 2);
  barriers.visible = false;
  root.add(barriers);
  const loadAt = (i: number): Load => {
    const model = BM.girderModel();
    model.root.visible = false;
    root.add(model.root);
    const l: Load = { st: "gone", t: 0, webs: 0, x: 0, z: 0, center: new THREE.Vector3(), model, hit: null as unknown as Hittable };
    const drop = () => {
      if (l.st !== "hang") return false;
      l.st = "fall";
      l.t = 0;
      ctx.events.push({ type: "sfx", name: "metal" });
      return true;
    };
    l.hit = {
      center: l.center,
      radius: 1,
      targetable: () => B.active && B.name === "rhino" && l.st === "hang",
      airborne: () => true,
      yaw: () => 0,
      hit: () => "none",
      web: (n) => {
        if (l.st !== "hang") return false;
        l.webs += n;
        if (l.webs >= 2) drop();
        return true;
      },
      yank: () => drop(),
      finishable: () => false,
      finishCost: () => 1,
      finish: () => {},
      hint: () => (l.st === "hang" ? { key: "RMB", label: "Web the girders down" } : null),
    };
    void i;
    return l;
  };
  const loads = [loadAt(0), loadAt(1)];

  const body: Hittable = {
    center: B.center,
    get radius() {
      return B.name === "kingpin" ? 1.25 : B.name === "rhino" ? 1.4 : 0.9;
    },
    targetable: () => B.active && B.st !== "intro" && B.st !== "defeat",
    airborne: () => B.pos.y > B.floorY + 1.5,
    yaw: () => B.yaw,
    hit: (h) => onHit(h),
    web: (n) => onWeb(n),
    yank: () => {
      if (B.name === "vulture" && B.st === "pause") {
        onWeb(3);
        return true;
      }
      return false;
    },
    finishable: () => B.active && B.takedown,
    finishCost: () => 0,
    finish: () => onFinish(),
    hint: () => null,
  };
  const kingpinTargets = [body, turrets[0].hit, turrets[1].hit];
  const rhinoTargets = [body, ...loads.map((l) => l.hit)];
  const soloTargets = [body];
  const none: Hittable[] = [];

  const set = (st: string) => {
    B.st = st;
    B.t = 0;
    B.hurtDone = false;
    ctx.unwarn(B.threat);
  };
  const P = () => ctx.player();
  const feet = () => P().pos.y - 0.95;
  const toPlayer = (out: THREE.Vector3) => out.set(P().pos.x - B.pos.x, 0, P().pos.z - B.pos.z);
  const faceP = (dt: number, k = 6) => {
    toPlayer(_v);
    B.yaw = turn(B.yaw, Math.atan2(_v.x, _v.z), dt * k);
  };
  const keepIn = (m: number) => {
    const b = B.bounds;
    const x = clamp(B.pos.x, b.minX + m, b.maxX - m);
    const z = clamp(B.pos.z, b.minZ + m, b.maxZ - m);
    const hitWall = x !== B.pos.x || z !== B.pos.z;
    B.pos.x = x;
    B.pos.z = z;
    return hitWall;
  };

  const goonsUp = () => B.name === "kingpin" && B.phase === 3 && (B.waves < 2 || B.goons.some((g) => !ctx.groupDone(g)));
  const damage = (n: number) => {
    const floor = goonsUp() ? 5 : 1;
    B.hp = Math.max(floor, B.hp - n);
    const ph = B.hp > 66.6 ? 1 : B.hp > 33.3 ? 2 : 3;
    if (ph > B.phase) {
      B.phase = ph;
      const def = BOSSES[B.name!];
      ctx.events.push({ type: "sfx", name: "bossPhase" }, { type: "toast", title: `PHASE ${ph}`, text: ph === 2 ? def.phase2 : def.phase3 }, { type: "shake", strength: 0.5 }, { type: "music", state: "boss", duration: 900 });
      ctx.ring(_v.copy(B.pos).setY(B.floorY), 14, 10, 0, 3, 1.5, 0.5);
      onPhase(ph);
    }
    if (B.hp <= 1) {
      B.takedown = true;
      set("beaten");
    }
  };

  const onPhase = (ph: number) => {
    if (B.name === "kingpin") {
      set("stalk");
      if (ph === 3) {
        B.goons.push(ctx.spawnGroup("thug", B.home, 3, { bounds: B.bounds, aware: true }));
        B.waves = 1;
      }
    } else if (B.name === "shocker") {
      B.seq = 0;
      set("move");
    } else if (B.name === "rhino") {
      B.seq = 0;
      set("roar");
      ctx.events.push({ type: "sfx", name: "charge" });
    } else if (B.name === "vulture") {
      set("recover");
      if (ph === 3) B.goons.push(ctx.spawnGroup("gunner", _v.copy(B.home).setY(B.floorY), 2, { aware: true, radius: 8 }));
    }
  };

  const vulnerable = () =>
    (B.name === "kingpin" && B.st === "stunned") ||
    (B.name === "shocker" && (B.st === "stunned" || B.st === "vent")) ||
    (B.name === "vulture" && (B.st === "pause" || B.st === "grounded")) ||
    (B.name === "rhino" && B.st === "stunned") ||
    B.st === "beaten";

  const armor = () => (B.name === "rhino" ? 0.7 : B.name === "kingpin" ? 0.75 : 1);

  const onHit = (h: Hit): HitResult => {
    if (!B.active || B.st === "defeat" || B.st === "intro") return "none";
    if (B.st === "grab") return "none";
    if (!vulnerable() || B.st === "beaten") {
      ctx.burst(_v.copy(B.center).addScaledVector(h.dir, -0.6), 4, 4, 1.2, 1.8, 3);
      return "block";
    }
    if (B.takedown) return "hit";
    const base = (B.name === "shocker" && B.st === "vent" ? 0.6 : 1.3) * armor();
    const dmg = base * h.dmg * (h.behind ? 1.5 : 1) * (h.kind === "strike" ? 1.2 : 1);
    B.hits++;
    damage(dmg);
    if (B.hits >= 5 && !B.takedown && B.st !== "vent") B.takedown = true;
    return "hit";
  };

  const onWeb = (n: number) => {
    if (!B.active) return false;
    if ((B.name === "kingpin" || B.name === "rhino") && B.st === "stunned") {
      B.webs += n;
      if (B.webs <= 2) B.t -= 0.8;
      return true;
    }
    if (B.name === "shocker" && B.st === "vent") {
      B.webs += n;
      if (B.webs >= 2) {
        set("stunned");
        B.hits = 0;
        ctx.events.push({ type: "sfx", name: "webImpact" }, { type: "toast", title: "STUNNED", text: "Hit him now" });
      }
      return true;
    }
    if (B.name === "vulture" && B.st === "pause") {
      B.webs += n;
      B.t -= 0.4;
      if (B.webs >= 3) {
        set("grounded");
        B.hits = 0;
        ctx.events.push({ type: "sfx", name: "webImpact" }, { type: "shake", strength: 0.4 });
      }
      return true;
    }
    return false;
  };

  const onFinish = () => {
    if (!B.takedown) return;
    B.takedown = false;
    B.hits = 0;
    if (B.hp <= 1) {
      defeat();
      return;
    }
    damage(10 * armor());
    if (B.st === "beaten") return;
    set("recover");
  };

  const defeat = () => {
    B.hp = 0;
    set("defeat");
    const def = BOSSES[B.name!];
    ctx.events.push(
      { type: "slowmo", scale: 0.25, duration: 1.4 },
      { type: "sfx", name: "bossDefeat" },
      { type: "toast", title: `${def.name} DEFEATED`, text: def.title },
      { type: "music", state: "victory", duration: 8 },
      { type: "shake", strength: 0.9 },
    );
    ctx.xp(1500, `${def.name[0]}${def.name.slice(1).toLowerCase()} defeated`);
    ctx.burst(B.center, 28, 12, 4, 3, 1.4);
    for (const g of B.goons) if (!ctx.groupDone(g)) ctx.clearGroup(g);
  };

  const start = (name: BossName, pos: THREE.Vector3) => {
    if (B.active) return B.id;
    B.name = name;
    B.id = ++seqId;
    B.active = true;
    B.hp = 100;
    B.phase = 1;
    B.hits = 0;
    B.webs = 0;
    B.takedown = false;
    B.seq = 0;
    B.waves = 0;
    B.goons.length = 0;
    B.home.copy(pos);
    B.floorY = pos.y;
    B.pos.copy(pos);
    B.vel.set(0, 0, 0);
    B.yaw = 0;
    if (name === "kingpin") {
      B.bounds = { minX: pos.x - 11.4, maxX: pos.x + 11.4, minZ: pos.z - 7.4, maxZ: pos.z + 7.4 };
      B.pos.z -= 3;
      turrets.forEach((tu, i) => {
        tu.st = "on";
        tu.webs = 0;
        tu.cd = 2.5 + i * 2.2;
        tu.aim = 0;
        tu.base.set(pos.x + (i ? 13.2 : -13.2), 0, pos.z + 9.2);
        tu.model.root.position.copy(tu.base);
        tu.model.root.visible = true;
        tu.model.web.visible = false;
        tu.center.set(tu.base.x, 3.8, tu.base.z);
      });
    } else if (name === "shocker") {
      B.bounds = { minX: pos.x - 12.5, maxX: pos.x + 12.5, minZ: pos.z - 12.5, maxZ: pos.z + 12.5 };
    } else if (name === "rhino") {
      const y = rhinoYard(pos);
      const m = 1.6;
      B.bounds = { minX: y.x - y.half + m, maxX: y.x + y.half - m, minZ: y.z0 + m, maxZ: y.z1 - m };
      B.pos.z = y.z0 + 5;
      B.mash = 0;
      barriers.position.set(y.x, pos.y, y.z1 + 0.4);
      barriers.visible = true;
      loads.forEach((l, i) => {
        const s = i ? 1 : -1;
        l.x = y.x + s * (y.half - 3.6);
        l.z = pos.z + (i ? 5 : -3);
        l.model.root.position.set(l.x, pos.y + GANTRY_Y, l.z);
        l.model.root.rotation.y = i ? Math.PI : 0;
        l.model.root.visible = true;
        hang(l);
      });
    } else {
      const r = roofAt(ctx.city, pos);
      B.bounds = { minX: r.minX + 2, maxX: r.maxX - 2, minZ: r.minZ + 2, maxZ: r.maxZ - 2 };
      B.pos.y = B.floorY + 9;
    }
    for (const [k, m] of Object.entries(models)) m.root.visible = k === name;
    set("intro");
    const def = BOSSES[name];
    ctx.events.push({ type: "sfx", name: "bossIntro" }, { type: "toast", title: def.name, text: def.intro }, { type: "music", state: "boss", duration: 900 }, { type: "shake", strength: 0.4 });
    return B.id;
  };

  const updateTurrets = (dt: number) => {
    const p = P();
    let aiming = false;
    for (const tu of turrets) if (tu.aim > 0) aiming = true;
    for (const tu of turrets) {
      if (tu.st === "gone") continue;
      if (tu.st === "flying") {
        tu.t += dt / 0.6;
        _v.lerpVectors(tu.from, B.center, Math.min(1, tu.t));
        _v.y += Math.sin(Math.min(1, tu.t) * Math.PI) * 3;
        tu.center.copy(_v);
        if (tu.t >= 1) {
          tu.st = "gone";
          tu.model.root.visible = false;
          ctx.events.push({ type: "sfx", name: "explosion" }, { type: "shake", strength: 0.8 });
          ctx.burst(B.center, 22, 11, 4, 2, 0.5);
          damage(12);
          if (B.phase === 1) set("stagger");
        }
        continue;
      }
      if (tu.st === "off") {
        tu.t += dt;
        if (rnd() < dt * 2) ctx.burst(tu.center, 2, 3, 3, 2.4, 1);
        if (tu.t > 9) {
          tu.st = "on";
          tu.webs = 0;
          tu.cd = 1.5;
          ctx.events.push({ type: "sfx", name: "metal" });
        }
        continue;
      }
      tu.cd -= dt;
      if (tu.aim > 0) {
        tu.aim += dt;
        _v.copy(p.pos).y += 0.1;
        ctx.line(tu.center, _v, 3.5 * (tu.aim > 1.1 && Math.sin(tu.aim * 60) > 0 ? 1.6 : 1), 0.12, 0.1);
        if (tu.aim >= 1.5) {
          tu.aim = 0;
          tu.cd = 3 + rnd() * 1.5;
          ctx.unwarn(tu.threat);
          ctx.events.push({ type: "sfx", name: "gunshot" });
          if (p.pos.distanceTo(tu.center) < 50) ctx.hurt(8, tu.center, 3);
        }
      } else if (tu.cd <= 0 && !aiming && B.st !== "intro") {
        tu.aim = 0.001;
        aiming = true;
        ctx.warn(tu.threat, ctx.now() + 1.5);
      }
    }
  };

  // Moves along B.dir, hurts the player once on contact, returns true on a wall hit.
  const chargeStep = (dt: number, speed: number, reach: number, margin: number) => {
    B.pos.addScaledVector(B.dir, speed * dt);
    if (!B.hurtDone && P().pos.distanceTo(_w.copy(B.pos).setY(B.pos.y + 1)) < reach) {
      B.hurtDone = true;
      ctx.unwarn(B.threat);
      ctx.hurt(25, B.pos, 12);
    }
    return keepIn(margin);
  };

  const updateKingpin = (dt: number) => {
    const p = P();
    toPlayer(_v);
    const d = _v.length();
    if (B.phase === 1) updateTurrets(dt);
    if (B.phase === 3 && B.waves === 1 && ctx.groupDone(B.goons[0])) {
      B.goons.push(ctx.spawnGroup("brute", B.home, 1, { bounds: B.bounds, aware: true, mix: { thug: 2 } }));
      B.waves = 2;
      ctx.events.push({ type: "toast", title: "MORE GOONS", text: "A brute joins the fight" });
    }
    switch (B.st) {
      case "intro":
        faceP(dt);
        if (B.t > 2.5) set(B.phase === 1 ? "idle" : "stalk");
        break;
      case "idle":
        faceP(dt, 3);
        if ((B.phase > 1 || turrets.every((tu) => tu.st === "gone")) && !goonsUp()) set("stalk");
        else if (B.t > 4.5) {
          set("slam");
          ctx.warn(B.threat, ctx.now() + 0.9);
        }
        break;
      case "slam":
        if (B.t > 0.9) {
          ctx.unwarn(B.threat);
          ctx.ring(_w.copy(B.pos).setY(B.floorY), 12, 14, 12, 3, 2.2, 1);
          ctx.events.push({ type: "sfx", name: "bigLand" }, { type: "shake", strength: 0.5 });
          set(B.phase === 1 ? "idle" : "stalk");
        }
        break;
      case "stagger":
        if (B.t > 1.1) set(B.phase === 1 ? "idle" : "stalk");
        break;
      case "stalk": {
        faceP(dt, 4);
        if (goonsUp()) {
          set("idle");
          break;
        }
        if (d > 3) {
          _w.copy(_v).normalize().multiplyScalar(2.6 * dt);
          B.pos.add(_w);
          keepIn(1.4);
        }
        if (d < 3.6 && B.t > 0.6) {
          set("swipe");
          ctx.warn(B.threat, ctx.now() + 0.7);
        } else if (B.t > (B.phase === 3 ? 3.4 : 4.2)) {
          if (B.seq++ % 2) {
            set("slam");
            ctx.warn(B.threat, ctx.now() + 0.9);
          } else {
            set("paw");
            ctx.warn(B.threat, ctx.now() + 1 + d / 22);
          }
        }
        break;
      }
      case "swipe":
        faceP(dt, 3);
        if (B.t > 0.7 && !B.hurtDone) {
          B.hurtDone = true;
          ctx.unwarn(B.threat);
          ctx.events.push({ type: "sfx", name: "whoosh" });
          if (d < 3.9 && Math.abs(feet() - B.floorY) < 2) ctx.hurt(15, B.pos, 9);
        }
        if (B.t > 1.2) {
          set("paw");
          ctx.warn(B.threat, ctx.now() + 1 + d / 22);
        }
        break;
      case "paw":
        faceP(dt, 5);
        if (rnd() < dt * 5) ctx.burst(_w.copy(B.pos).setY(B.floorY + 0.1), 2, 3, 1.5, 1.5, 1.5);
        if (B.t > 1) {
          B.dir.set(Math.sin(B.yaw), 0, Math.cos(B.yaw));
          set("charge");
          ctx.warn(B.threat, ctx.now() + d / 22);
          ctx.events.push({ type: "sfx", name: "whoosh" });
        }
        break;
      case "charge": {
        if (chargeStep(dt, B.phase === 3 ? 25 : 22, 2.1, 1.3)) {
          set("stunned");
          B.hits = 0;
          B.webs = 0;
          ctx.events.push({ type: "sfx", name: "bigLand" }, { type: "sfx", name: "metal" }, { type: "shake", strength: 0.8 }, { type: "toast", title: "STUNNED", text: "Web him, then hit him" });
          ctx.burst(_w.copy(B.pos).addScaledVector(B.dir, 1.2).setY(B.floorY + 1.5), 18, 9, 3, 3, 3);
        } else if (B.t > 2.2) set("stalk");
        break;
      }
      case "stunned":
        if (rnd() < dt * 6) ctx.burst(_w.copy(B.pos).setY(B.floorY + 3.6), 1, 2, 4, 3.4, 0.6);
        if (B.t > 4.5) {
          B.takedown = false;
          set("recover");
        }
        break;
      case "recover":
        if (B.t < dt * 1.5) {
          ctx.ring(_w.copy(B.pos).setY(B.floorY), 14, 7, 6, 3, 2.2, 1);
          ctx.events.push({ type: "sfx", name: "bigLand" });
        }
        if (B.t > 1) set("stalk");
        break;
    }
  };


  const HANG = 2.2;
  const hang = (l: Load) => {
    l.st = "hang";
    l.t = 0;
    l.webs = 0;
    l.model.cable.visible = true;
    l.model.cable.scale.y = HANG;
    l.model.bundle.position.set(0, -HANG - 0.75, 0);
    l.model.bundle.visible = true;
    l.center.set(l.x, B.floorY + GANTRY_Y - HANG - 0.75, l.z);
  };
  // The dropped bundle is a 4.6 x 1.1 box on the floor; r grows it by the boss radius.
  const inPile = (l: Load, x: number, z: number, r: number) => l.st === "down" && Math.abs(x - l.x) < 2.3 + r && Math.abs(z - l.z) < 0.55 + r;
  const pushOutOfPiles = () => {
    for (const l of loads) {
      if (!inPile(l, B.pos.x, B.pos.z, 1.2)) continue;
      const ox = 3.5 - Math.abs(B.pos.x - l.x);
      const oz = 1.75 - Math.abs(B.pos.z - l.z);
      if (ox < oz) B.pos.x += Math.sign(B.pos.x - l.x || 1) * ox;
      else B.pos.z += Math.sign(B.pos.z - l.z || 1) * oz;
    }
  };
  const smashPile = (l: Load) => {
    l.st = "gone";
    l.t = 0;
    l.model.bundle.visible = false;
    ctx.burst(_u.set(l.x, B.floorY + 0.8, l.z), 26, 10, 2.2, 1.1, 0.5);
    ctx.events.push({ type: "sfx", name: "metal" }, { type: "sfx", name: "explosion", volume: 0.6 });
  };

  const updateLoads = (dt: number) => {
    for (const l of loads) {
      l.t += dt;
      if (l.st === "hang") {
        l.model.bundle.rotation.z = Math.sin(l.t * 1.3 + l.x) * 0.04;
        continue;
      }
      if (l.st === "fall") {
        l.model.cable.visible = false;
        const top = GANTRY_Y - HANG - 0.75;
        const y = Math.max(0.25, top - 0.5 * 30 * l.t * l.t);
        l.model.bundle.position.y = y - GANTRY_Y;
        l.center.y = B.floorY + y;
        if (y <= 0.25) {
          l.st = "down";
          l.t = 0;
          l.model.bundle.rotation.z = 0;
          ctx.events.push({ type: "sfx", name: "bigLand" }, { type: "sfx", name: "metal" }, { type: "shake", strength: 0.5 });
          ctx.burst(_u.set(l.x, B.floorY + 0.3, l.z), 16, 6, 1.6, 1.5, 1.3);
          if (inPile(l, B.pos.x, B.pos.z, 1.4) && B.st !== "stunned") {
            smashPile(l);
            crash(true);
          }
        }
        continue;
      }
      if (l.st === "gone" && l.t > 14 && B.st !== "defeat" && B.st !== "beaten") hang(l);
    }
  };

  const crash = (big: boolean) => {
    if (big) {
      damage(6);
      if (B.st === "beaten") return;
    }
    set("stunned");
    B.hits = 0;
    B.webs = 0;
    B.stunLen = big ? 5.5 : 4.2;
    ctx.events.push({ type: "sfx", name: "bigLand" }, { type: "sfx", name: "metal" }, { type: "shake", strength: big ? 1 : 0.8 }, { type: "toast", title: "STUNNED", text: "Hit him now" });
    ctx.burst(_w.copy(B.pos).addScaledVector(B.dir, 1.4).setY(B.floorY + 1.8), 18, 9, 2.4, 2.4, 2.4);
  };

  const RHINO_SEQ = [["paw"], ["paw", "rear"], ["paw", "grab", "paw", "rear"]];
  const front = (out: THREE.Vector3, k: number) => out.set(B.pos.x + Math.sin(B.yaw) * k, B.floorY, B.pos.z + Math.cos(B.yaw) * k);

  const updateRhino = (dt: number, input: Input) => {
    const p = P();
    toPlayer(_v);
    const d = _v.length();
    updateLoads(dt);
    switch (B.st) {
      case "intro":
      case "roar":
        faceP(dt, 3);
        if (B.t > (B.st === "intro" ? 2.5 : 1.4)) set("stalk");
        break;
      case "stalk": {
        faceP(dt, 4);
        if (d > 3.2) {
          B.pos.addScaledVector(_w.copy(_v).normalize(), 3.2 * dt);
          pushOutOfPiles();
          keepIn(0);
        }
        if (B.t > (B.phase === 1 ? 3.2 : B.phase === 2 ? 2.6 : 2.2)) {
          const seq = RHINO_SEQ[B.phase - 1];
          let next = seq[B.seq % seq.length];
          B.seq++;
          if (next === "grab" && d > 10) next = "paw";
          set(next === "grab" ? "grabWind" : next);
          if (next === "paw") {
            ctx.warn(B.threat, ctx.now() + 1.2 + d / 25);
            ctx.events.push({ type: "sfx", name: "charge" });
          } else if (next === "rear") ctx.warn(B.threat, ctx.now() + 1);
          else ctx.warn(B.threat, ctx.now() + 0.5 + d / 10);
        }
        break;
      }
      case "paw":
        faceP(dt, 5);
        if (rnd() < dt * 6) ctx.burst(front(_w, 0.8).setY(B.floorY + 0.1), 2, 3, 1.5, 1.5, 1.5);
        if (B.t > 1.2) {
          B.dir.set(Math.sin(B.yaw), 0, Math.cos(B.yaw));
          set("charge");
          ctx.warn(B.threat, ctx.now() + Math.max(0.2, d / 25));
          ctx.events.push({ type: "sfx", name: "whoosh" });
        }
        break;
      case "charge": {
        if (rnd() < dt * 10) ctx.burst(_w.copy(B.pos).setY(B.floorY + 0.2), 2, 3, 1.5, 1.5, 1.5);
        const wall = chargeStep(dt, B.phase === 3 ? 27 : 24, 2.5, 0);
        const pile = loads.find((l) => inPile(l, B.pos.x + B.dir.x, B.pos.z + B.dir.z, 1.2));
        if (pile) {
          smashPile(pile);
          crash(true);
        } else if (wall) crash(false);
        else if (B.t > 2.5) set("stalk");
        break;
      }
      case "stunned":
        if (rnd() < dt * 6) ctx.burst(_w.copy(B.pos).setY(B.floorY + 3.9), 1, 2, 4, 3.4, 0.6);
        if (B.t > B.stunLen) {
          B.takedown = false;
          set("recover");
        }
        break;
      case "recover":
        if (B.t < dt * 1.5) {
          ctx.ring(_w.copy(B.pos).setY(B.floorY), 14, 7, 0, 2.4, 2.2, 2);
          ctx.events.push({ type: "sfx", name: "bigLand" });
        }
        if (B.t > 1) set("stalk");
        break;
      case "rear":
        faceP(dt, 3);
        if (B.t > 1) {
          ctx.unwarn(B.threat);
          ctx.ring(_w.copy(B.pos).setY(B.floorY), 13, 17, 14, 2.6, 1.8, 0.9);
          ctx.events.push({ type: "sfx", name: "bigLand" }, { type: "sfx", name: "charge", volume: 0.6 }, { type: "shake", strength: 0.7 });
          ctx.burst(front(_w, 1.6).setY(B.floorY + 0.2), 20, 8, 1.6, 1.5, 1.3);
          set("slamEnd");
        }
        break;
      case "slamEnd":
        if (B.t > 0.9) set("stalk");
        break;
      case "grabWind":
        faceP(dt, 8);
        if (B.t > 0.5) {
          B.dir.copy(_v).normalize();
          B.yaw = Math.atan2(B.dir.x, B.dir.z);
          set("grabRush");
          ctx.warn(B.threat, ctx.now() + Math.max(0.15, (d - 2) / 11));
        }
        break;
      case "grabRush":
        B.pos.addScaledVector(B.dir, 11 * dt);
        pushOutOfPiles();
        keepIn(0);
        front(_w, 1.5);
        if (Math.hypot(p.pos.x - _w.x, p.pos.z - _w.z) < 1.9 && Math.abs(feet() - B.floorY) < 2 && ctx.hurt(4, B.pos, 0)) {
          set("grab");
          B.mash = 0;
          ctx.events.push({ type: "sfx", name: "charge" }, { type: "shake", strength: 0.5 }, { type: "toast", title: "GRABBED", text: "Mash LMB to break free" });
        } else if (B.t > 0.8) set("stalk");
        break;
      case "grab": {
        if (ctx.downed()) {
          set("slamEnd");
          break;
        }
        front(_w, 1.7).y = B.floorY + 2.4;
        p.teleport(_w);
        p.face(_u.set(-Math.sin(B.yaw), 0, -Math.cos(B.yaw)));
        p.busy = true;
        p.act("grabbed", Math.min(1, B.t / 3.2));
        if (input.pressed.has("attack") || input.pressed.has("swing")) {
          B.mash++;
          ctx.events.push({ type: "sfx", name: "punch", volume: 0.5 }, { type: "shake", strength: 0.12 });
        }
        if (B.mash >= 10) {
          set("stunned");
          B.stunLen = 3.5;
          B.hits = 0;
          B.webs = 0;
          p.push(_u.set(Math.sin(B.yaw) * 4, 3, Math.cos(B.yaw) * 4));
          ctx.events.push({ type: "sfx", name: "punchHeavy" }, { type: "toast", title: "BROKE FREE", text: "Hit him now" }, { type: "shake", strength: 0.5 });
        } else if (B.t > 3.2) {
          set("slamEnd");
          ctx.hurt(22, B.pos, 14);
          ctx.events.push({ type: "sfx", name: "bigLand" });
        }
        break;
      }
    }
  };

  const SHOCK_SEQ = [
    ["blast", "blast", "blast", "quake", "vent"],
    ["blast", "blast", "beam", "quake", "vent"],
    ["quake2", "beam", "blast", "blast", "blast", "vent"],
  ];
  const hand = (out: THREE.Vector3) => out.set(B.pos.x + Math.sin(B.yaw) * 0.7 - Math.cos(B.yaw) * 0.35, B.pos.y + 1.35, B.pos.z + Math.cos(B.yaw) * 0.7 + Math.sin(B.yaw) * 0.35);

  const updateShocker = (dt: number) => {
    const p = P();
    toPlayer(_v);
    const d = _v.length();
    const beam = shock.extra.beam as THREE.Mesh;
    beam.visible = false;
    switch (B.st) {
      case "intro":
        faceP(dt);
        if (B.t > 2.5) set("move");
        break;
      case "move": {
        faceP(dt);
        const want = 9;
        const k = d > want + 2 ? 1 : d < want - 2 ? -1 : 0;
        _w.set(_v.x * k - _v.z * 0.6, 0, _v.z * k + _v.x * 0.6).normalize().multiplyScalar(4 * dt);
        if (_w.lengthSq() > 0) B.pos.add(_w);
        keepIn(1.5);
        if (B.t > (B.phase === 3 ? 0.8 : 1.3)) {
          const seq = SHOCK_SEQ[B.phase - 1];
          const next = seq[B.seq % seq.length];
          B.seq++;
          set(next);
          if (next === "blast") B.t = B.phase === 3 ? 0.2 : 0;
          if (next === "quake" || next === "quake2") ctx.warn(B.threat, ctx.now() + 0.9 + 0.3);
          if (next === "beam") {
            const a = Math.atan2(_v.x, _v.z);
            const s = rnd() < 0.5 ? 1 : -1;
            B.beamA = a - 0.95 * s;
            B.beamW = (1.9 * s) / 2;
            ctx.warn(B.threat, ctx.now() + 0.9 + 0.95 / Math.abs(B.beamW));
          }
          if (next === "vent") {
            B.webs = 0;
            ctx.events.push({ type: "sfx", name: "shock", volume: 0.5 });
          }
        }
        break;
      }
      case "blast":
        faceP(dt, 8);
        if (B.t > 0.6) {
          hand(_w);
          _u.set(p.pos.x, p.pos.y + 0.1, p.pos.z).sub(_w).normalize().multiplyScalar(24);
          ctx.fire("blast", _w, _u, 12);
          ctx.events.push({ type: "sfx", name: "shock" });
          set("move");
          B.t = 0.9;
        }
        break;
      case "quake":
      case "quake2":
        if (B.t > 0.9 && !B.hurtDone) {
          B.hurtDone = true;
          ctx.unwarn(B.threat);
          ctx.ring(_w.copy(B.pos).setY(B.floorY), 12, 20, 15, 1, 2.6, 4);
          ctx.events.push({ type: "sfx", name: "shock" }, { type: "shake", strength: 0.6 });
        }
        if (B.st === "quake2" && B.t > 1.7 && B.t - dt <= 1.7) ctx.ring(_w.copy(B.pos).setY(B.floorY), 12, 20, 15, 1, 2.6, 4);
        if (B.t > (B.st === "quake2" ? 2.3 : 1.5)) set("move");
        break;
      case "beam": {
        const aim = B.t < 0.9;
        const a = aim ? B.beamA : B.beamA + B.beamW * (B.t - 0.9);
        B.yaw = turn(B.yaw, a, dt * 12);
        hand(_w);
        if (aim) {
          ctx.line(_w, _u.set(_w.x + Math.sin(a) * 28, _w.y, _w.z + Math.cos(a) * 28), 1, 2.6, 4);
        } else {
          beam.visible = true;
          beam.position.copy(_w);
          beam.rotation.set(0, a, 0);
          beam.scale.set(1 + 0.15 * Math.sin(B.t * 50), 1, 28);
          const pa = Math.atan2(p.pos.x - _w.x, p.pos.z - _w.z);
          if (!B.hurtDone && Math.abs(wrap(pa - a)) < 0.1 && d < 28 && feet() < B.floorY + 2.4) {
            B.hurtDone = true;
            ctx.unwarn(B.threat);
            ctx.hurt(25, _w, 10);
          }
          if (rnd() < dt * 12) ctx.burst(_u.set(_w.x + Math.sin(a) * 28, B.floorY + 1, _w.z + Math.cos(a) * 28), 2, 5, 1, 2.6, 4);
        }
        if (B.t > 2.9) set("move");
        break;
      }
      case "vent":
        if (rnd() < dt * 6) ctx.burst(hand(_w), 2, 3, 2, 2, 2);
        if (B.t > (B.phase === 3 ? 3 : 3.6)) set("move");
        break;
      case "stunned":
        if (rnd() < dt * 6) ctx.burst(_w.copy(B.pos).setY(B.floorY + 2.1), 1, 2, 4, 3.4, 0.6);
        if (B.t > 4.5) {
          B.takedown = false;
          set("recover");
        }
        break;
      case "recover":
        if (B.t < dt * 1.5) ctx.ring(_w.copy(B.pos).setY(B.floorY), 14, 6, 6, 1, 2.6, 4);
        if (B.t > 0.9) set("move");
        break;
    }
  };

  const updateVulture = (dt: number) => {
    const p = P();
    toPlayer(_v);
    const fly = (to: THREE.Vector3, k: number) => B.pos.lerp(to, 1 - Math.exp(-k * dt));
    switch (B.st) {
      case "intro":
      case "circle":
      case "recover": {
        B.orbit += dt * 0.8;
        _w.set(B.home.x + Math.cos(B.orbit) * 10, B.floorY + (B.st === "recover" ? 7 : 9), B.home.z + Math.sin(B.orbit) * 10);
        fly(_w, 2);
        B.yaw = turn(B.yaw, B.orbit + Math.PI, dt * 4);
        const wait = B.st === "intro" ? 3 : B.st === "recover" ? 1.2 : B.phase === 3 ? 1.6 : 2.5;
        const near = Math.hypot(p.pos.x - B.home.x, p.pos.z - B.home.z) < 32 && p.pos.y > B.floorY - 2;
        if (B.t > wait && (near || B.st !== "circle")) {
          if (B.st !== "circle") set("circle");
          else {
            const move = B.nextMove;
            B.nextMove = move === "dive" ? "swipeWind" : "dive";
            if (move === "dive") {
              set("screech");
              ctx.warn(B.threat, ctx.now() + 0.8 + B.pos.distanceTo(p.pos) / 26);
            } else {
              set("swipeWind");
              _u.set(-_v.z, 0, _v.x).normalize();
              if (rnd() < 0.5) _u.negate();
              B.aim.copy(p.pos).addScaledVector(_u, 12);
              B.aim.y = B.floorY + 1.4;
              B.dir.copy(_u).negate();
              ctx.warn(B.threat, ctx.now() + 0.8 + 12 / 20);
            }
            ctx.events.push({ type: "sfx", name: "whoosh" });
          }
        }
        break;
      }
      case "screech":
        faceP(dt, 6);
        if (B.t > 0.8) {
          B.aim.copy(p.pos);
          B.dir.subVectors(B.aim, B.pos).normalize();
          set("dive");
        }
        break;
      case "dive":
        B.pos.addScaledVector(B.dir, 26 * dt);
        if (!B.hurtDone && B.pos.distanceTo(p.pos) < 2.3) {
          B.hurtDone = true;
          ctx.unwarn(B.threat);
          ctx.hurt(18, B.pos, 6);
        }
        if (B.pos.distanceTo(B.aim) < 1 || B.pos.y < B.floorY + 1.2 || B.t > 2) {
          B.pos.y = Math.max(B.pos.y, B.floorY + 1.2);
          keepIn(0);
          ctx.events.push({ type: "sfx", name: "bigLand", volume: 0.6 }, { type: "shake", strength: 0.4 });
          ctx.burst(_w.copy(B.pos).setY(B.floorY + 0.2), 10, 6, 1.6, 1.6, 1.4);
          startPause();
        }
        break;
      case "swipeWind":
        fly(B.aim, 4);
        B.yaw = turn(B.yaw, Math.atan2(B.dir.x, B.dir.z), dt * 8);
        if (B.t > 0.8) set("swipe");
        break;
      case "swipe":
        B.pos.addScaledVector(B.dir, 20 * dt);
        if (!B.hurtDone && B.pos.distanceTo(p.pos) < 2.2) {
          B.hurtDone = true;
          ctx.unwarn(B.threat);
          ctx.hurt(14, B.pos, 6);
        }
        if (B.t > 1.2) {
          keepIn(0);
          startPause();
        }
        break;
      case "pause": {
        _w.set(B.pos.x, B.floorY + 3.6, B.pos.z);
        fly(_w, 4);
        faceP(dt, 3);
        if (B.t > (B.phase === 3 ? 2.1 : 2.7) + (B.takedown ? 1.5 : 0)) {
          B.takedown = false;
          set("recover");
        }
        break;
      }
      case "grounded":
        _w.set(B.pos.x, B.floorY, B.pos.z);
        fly(_w, 8);
        if (rnd() < dt * 6) ctx.burst(_w.copy(B.pos).setY(B.floorY + 2.1), 1, 2, 4, 3.4, 0.6);
        if (B.t > 4) {
          B.takedown = false;
          set("recover");
        }
        break;
      case "beaten":
      case "defeat":
        _w.set(B.pos.x, B.floorY, B.pos.z);
        fly(_w, 5);
        break;
    }
    if (B.pos.y < B.floorY) B.pos.y = B.floorY;
  };

  const startPause = () => {
    set("pause");
    B.hits = 0;
    B.webs = 0;
    if (B.phase >= 2) {
      const a = Math.atan2(P().pos.x - B.pos.x, P().pos.z - B.pos.z);
      for (let k = -2; k <= 2; k++) {
        const b = a + k * 0.2;
        _w.set(B.pos.x, B.pos.y + 1.4, B.pos.z);
        _u.set(Math.sin(b), 0, Math.cos(b)).multiplyScalar(26);
        _u.y = (P().pos.y - _w.y) * 26 / Math.max(4, B.pos.distanceTo(P().pos));
        ctx.fire("feather", _w, _u, 6);
      }
      ctx.events.push({ type: "sfx", name: "whoosh" });
    }
  };

  const hideAll = () => {
    for (const m of Object.values(models)) m.root.visible = false;
    for (const tu of turrets) {
      tu.st = "gone";
      tu.model.root.visible = false;
    }
    barriers.visible = false;
    for (const l of loads) {
      l.st = "gone";
      l.model.root.visible = false;
    }
  };

  const update = (dt: number, t: number, input: Input) => {
    if (!B.active) return;
    B.t += dt;
    if (B.st === "defeat") {
      if (B.t > 6) {
        B.active = false;
        done.add(B.id);
        hideAll();
      }
      if (B.name === "vulture") updateVulture(dt);
      return;
    }
    if (B.st === "beaten") {
      faceP(dt, 2);
      if (B.name === "vulture") updateVulture(dt);
      if (rnd() < dt * 5) ctx.burst(_w.copy(B.pos).setY(B.pos.y + (B.name === "kingpin" ? 3.6 : B.name === "rhino" ? 3.9 : 2.1)), 1, 2, 4, 3.4, 0.6);
      return;
    }
    if (B.name === "kingpin") updateKingpin(dt);
    else if (B.name === "shocker") updateShocker(dt);
    else if (B.name === "rhino") updateRhino(dt, input);
    else updateVulture(dt);
    void t;
  };

  const render = (dt: number, t: number) => {
    if (!B.active || !B.name) return;
    const st = B.st;
    const k = B.t;
    if (B.name === "kingpin") {
      const m = fisk;
      const h = st === "beaten" || st === "defeat" ? 0 : 1;
      m.root.position.copy(B.pos);
      m.root.rotation.set(0, B.yaw, 0);
      const walk = st === "stalk" ? Math.sin(t * 5) : st === "charge" ? Math.sin(t * 12) : 0;
      m.legL.rotation.x = walk * 0.5;
      m.legR.rotation.x = -walk * 0.5;
      let aL = -0.15;
      let aR = -0.35;
      let lean = 0;
      let sL = 0.25;
      let sR = 0.25;
      if (st === "idle" || st === "intro") aR = -0.5 + Math.sin(t * 2) * 0.1;
      if (st === "slam") {
        aR = -2.6 * Math.min(1, k / 0.6);
        lean = -0.15;
      }
      if (st === "swipe") {
        aR = k < 0.7 ? -1.6 - k : -0.4;
        sR = k < 0.7 ? 0.9 : 0.2;
      }
      if (st === "paw") {
        lean = 0.45;
        aL = aR = -0.7;
        m.legL.rotation.x = Math.sin(t * 14) * 0.3 - 0.3;
      }
      if (st === "charge") {
        lean = 0.6;
        aL = aR = 0.6;
      }
      if (st === "stunned" || st === "beaten") {
        lean = -0.2 + Math.sin(t * 3) * 0.08;
        aL = aR = 0.1;
        sL = sR = 0.5;
      }
      if (st === "stagger") lean = -0.3;
      if (st === "defeat") {
        m.root.rotation.x = -Math.min(1, k / 1.2) * (Math.PI / 2 - 0.15);
        m.root.position.y = B.floorY + 0.4 * Math.min(1, k / 1.2);
      } else m.root.rotation.x = 0;
      m.body.rotation.x = lean * h + (st === "beaten" ? 0.3 : 0);
      m.armL.rotation.set(aL, 0, sL);
      m.armR.rotation.set(aR, 0, -sR);
      B.center.set(B.pos.x, B.pos.y + 2.1, B.pos.z);
      for (const tu of turrets) {
        if (tu.st === "gone") continue;
        if (tu.st === "flying") {
          tu.model.root.position.set(tu.center.x, tu.center.y - 3.8, tu.center.z);
          tu.model.root.rotation.x += dt * 12;
        } else {
          tu.model.root.rotation.set(0, 0, 0);
          const a = Math.atan2(ctx.player().pos.x - tu.base.x, ctx.player().pos.z - tu.base.z);
          tu.model.head.rotation.y = tu.st === "on" ? turn(tu.model.head.rotation.y, a, dt * 4) : tu.model.head.rotation.y;
          tu.model.head.rotation.z = tu.st === "off" ? 0.35 : 0;
          tu.model.eye.visible = tu.st === "on" && (tu.aim === 0 || Math.sin(t * 30) > 0);
          tu.model.web.visible = tu.webs > 0;
          tu.model.web.scale.setScalar(0.5 + Math.min(3, tu.webs) * 0.17);
        }
      }
    } else if (B.name === "shocker") {
      const m = shock;
      m.root.scale.setScalar(1.15);
      m.root.position.copy(B.pos);
      m.root.rotation.set(0, B.yaw, 0);
      const walk = st === "move" ? Math.sin(t * 8) : 0;
      m.legL.rotation.x = walk * 0.5;
      m.legR.rotation.x = -walk * 0.5;
      let aL = -1.2;
      let aR = -1.2;
      let lean = 0.1;
      if (st === "blast") aR = -1.57;
      if (st === "beam") aL = aR = -1.57;
      if (st === "quake" || st === "quake2") {
        const up = k < 0.75 ? k / 0.75 : Math.max(0, 1 - (k - 0.75) * 6);
        aL = aR = -1.2 - 1.8 * up;
        lean = k > 0.8 && k < 1.4 ? 0.5 : 0;
      }
      if (st === "vent" || st === "stunned" || st === "beaten") {
        aL = aR = -0.2;
        lean = -0.15 + (st === "stunned" ? Math.sin(t * 3) * 0.1 : 0);
      }
      if (st === "defeat") {
        m.root.rotation.x = -Math.min(1, k / 1) * (Math.PI / 2 - 0.1);
        m.root.position.y = B.floorY + 0.25 * Math.min(1, k);
      } else m.root.rotation.x = 0;
      m.body.rotation.x = lean;
      m.armL.rotation.set(aL, 0, 0.15);
      m.armR.rotation.set(aR, 0, -0.15);
      const hot = st === "vent" || st === "stunned";
      for (const g of shock.glows) (g.material as THREE.MeshBasicMaterial).color.setRGB(hot ? 4 : 0.8, hot ? 1.2 : 2.5, hot ? 0.3 : 4).multiplyScalar(st === "defeat" ? 0.2 : 1);
      B.center.set(B.pos.x, B.pos.y + 1.2, B.pos.z);
    } else if (B.name === "rhino") {
      const m = rhino;
      m.root.position.copy(B.pos);
      m.root.rotation.set(0, B.yaw, 0);
      const gait = st === "stalk" ? Math.sin(t * 5) : st === "charge" ? Math.sin(t * 14) : st === "grabRush" ? Math.sin(t * 11) : 0;
      m.legL.rotation.x = gait * (st === "charge" ? 0.8 : 0.5);
      m.legR.rotation.x = -gait * (st === "charge" ? 0.8 : 0.5);
      let aL = -0.2;
      let aR = -0.2;
      let sp = 0.3;
      let lean = 0.15;
      let nod = 0;
      if (st === "intro" || st === "roar") {
        sp = 1.1;
        aL = aR = -0.6;
        lean = -0.25;
        nod = -0.35;
      } else if (st === "paw") {
        lean = 0.55;
        nod = 0.3;
        aL = aR = 0.4;
        m.legR.rotation.x = Math.sin(t * 14) * 0.35 - 0.35;
      } else if (st === "charge") {
        lean = 0.75;
        nod = 0.45;
        aL = aR = 0.7;
      } else if (st === "rear") {
        const u = Math.min(1, k / 0.8);
        lean = -0.35 * u;
        aL = aR = -2.8 * u;
        sp = 0.35;
      } else if (st === "slamEnd") {
        const u = Math.max(0, 1 - k / 0.9);
        lean = 0.6 * u;
        aL = aR = -1.1 * u;
      } else if (st === "grabWind" || st === "grabRush") {
        lean = 0.35;
        aL = aR = -1.45;
        sp = st === "grabWind" ? 0.9 : 0.5;
      } else if (st === "grab") {
        lean = 0.1;
        aL = aR = -1.5;
        sp = 0.15 + Math.sin(t * 9) * 0.05;
      } else if (st === "stunned" || st === "beaten") {
        lean = -0.2 + Math.sin(t * 3) * 0.08;
        nod = -0.2;
        aL = aR = 0.15;
        sp = 0.55;
      }
      if (st === "defeat") {
        m.root.rotation.x = -Math.min(1, k / 1.2) * (Math.PI / 2 - 0.2);
        m.root.position.y = B.floorY + 0.5 * Math.min(1, k / 1.2);
      } else m.root.rotation.x = 0;
      m.body.rotation.x = lean;
      m.head.rotation.x = nod;
      m.armL.rotation.set(aL, 0, sp);
      m.armR.rotation.set(aR, 0, -sp);
      B.center.set(B.pos.x, B.pos.y + 2.2, B.pos.z);
    } else {
      const m = vult;
      m.root.position.copy(B.pos);
      const diving = st === "dive" || st === "swipe";
      m.root.rotation.set(diving ? 0.9 : st === "screech" ? -0.4 : 0.15, B.yaw, 0);
      const flap = st === "pause" || st === "circle" || st === "recover" || st === "intro" ? Math.sin(t * (st === "pause" ? 5 : 3.5)) : 0;
      const fold = diving ? -0.9 : st === "grounded" || st === "beaten" || st === "defeat" ? 0.8 : 0;
      vult.wings[0].rotation.set(0, -fold * 0.8, flap * 0.5 + (st === "screech" ? 0.6 : 0));
      vult.wings[1].rotation.set(0, fold * 0.8, -flap * 0.5 - (st === "screech" ? 0.6 : 0));
      m.legL.rotation.x = diving ? 0.6 : 0.25;
      m.legR.rotation.x = diving ? 0.6 : -0.1;
      m.armL.rotation.set(diving ? -2.8 : -0.5, 0, 0.4);
      m.armR.rotation.set(diving ? -2.8 : st === "swipe" ? -1.6 : -0.5, 0, -0.4);
      if (st === "defeat") m.root.rotation.x = -Math.min(1, k) * (Math.PI / 2 - 0.1);
      B.center.set(B.pos.x, B.pos.y + 1.1, B.pos.z);
    }
  };

  const cancel = () => {
    if (!B.active || B.st === "defeat") return;
    for (const g of B.goons) if (!ctx.groupDone(g)) ctx.clearGroup(g);
    B.goons.length = 0;
    B.active = false;
    hideAll();
  };

  return {
    start,
    cancel,
    update,
    render,
    targets: () => (!B.active ? none : B.name === "kingpin" ? kingpinTargets : B.name === "rhino" ? rhinoTargets : soloTargets),
    active: () => B.active,
    done: (id: number) => done.has(id),
    hud: (): HudState["boss"] => {
      if (!B.active || !B.name) return null;
      const def = BOSSES[B.name];
      return { name: def.name, title: def.title, health: B.hp / 100, phase: B.phase, phases: 3 };
    },
    markers: (out: Marker[]) => {
      if (B.active && B.st !== "defeat") out.push({ x: B.pos.x, z: B.pos.z, kind: "boss" });
    },
    prompts: (out: { key: string; label: string }[]) => {
      if (!B.active || B.st === "defeat") return;
      if (B.takedown) out.push({ key: "X", label: "Takedown" });
      else if (B.name === "kingpin" && B.phase === 1 && turrets.some((tu) => tu.st !== "gone")) {
        if (turrets.some((tu) => tu.st === "off")) out.push({ key: "F", label: "Hold to yank the turret" });
        else out.push({ key: "RMB", label: "Web a turret" });
      } else if (B.name === "kingpin" && B.st === "stunned") out.push({ key: "LMB", label: "Hit him now" });
      else if (B.name === "kingpin" && B.st === "paw") out.push({ key: "Q", label: "Dodge the charge" });
      else if (B.name === "shocker" && B.st === "vent") out.push({ key: "RMB", label: "Web him while he vents" });
      else if (B.name === "shocker" && (B.st === "quake" || B.st === "quake2")) out.push({ key: "Space", label: "Jump the shockwave" });
      else if (B.name === "vulture" && B.st === "pause") out.push({ key: "F", label: "Web strike to him" });
      else if (B.name === "rhino") {
        if (B.st === "grab") out.push({ key: "LMB", label: "Mash to break free" });
        else if (B.st === "stunned") out.push({ key: "LMB", label: "Hit him now" });
        else if (B.st === "paw") out.push({ key: "Q", label: "Dodge the charge" });
        else if (B.st === "rear") out.push({ key: "Space", label: "Jump the shockwave" });
        else if (B.st === "grabWind" || B.st === "grabRush") out.push({ key: "Q", label: "Dodge the grab" });
        else if (loads.some((l) => l.st === "hang")) out.push({ key: "RMB", label: "Web the girders down" });
      }
    },
    onPlayerDown: () => {
      if (!B.active || B.st === "defeat" || B.st === "beaten") return;
      set(B.name === "kingpin" ? (B.phase === 1 ? "idle" : "stalk") : B.name === "shocker" ? "move" : B.name === "rhino" ? "stalk" : "recover");
    },
    setDetail: (level: number) => {
      detail = level;
      for (const m of Object.values(models)) m.root.traverse((o) => (o.castShadow = detail === 2));
    },
    dispose: () => {
      ctx.group.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
      });
    },
  };
}

export type Bosses = ReturnType<typeof createBosses>;
