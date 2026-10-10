import type * as THREE from "three";
import type { Allies, Boost, Fx, GameEvent, Objective, Player, RunHud, TitanKind, Titans, Upgrade, UpgradeId, World } from "./contracts";
import { gearBoost } from "./progression";
import { bossFor, isBoss, quotaFor, type BossKind } from "./titan-waves";

type Count = "hook" | "gas" | "kill" | "waveKill" | "abnormal" | "tendon" | "sever" | "limb" | "perfect" | "save" | "boss" | "fastKill";
type Spec = { text: string; hint?: string; need: number; count?: Count; kind?: TitanKind; until?: "noDeath" | "depot" };
type Obj = Objective & { spec: Spec };

const UPGRADES: Omit<Upgrade, "level">[] = [
  { id: "tank", name: "Gas tank", jp: "大型ボンベ", text: "+15% gas capacity", max: 4 },
  { id: "reel", name: "Reel power", jp: "巻き取り強化", text: "+8% reel pull and top speed", max: 4 },
  { id: "blade", name: "Blade durability", jp: "刃の耐久", text: "Blades dull 15% slower", max: 4 },
  { id: "spare", name: "Spare blades", jp: "予備の刃", text: "+2 spare blade sets", max: 3 },
  { id: "damage", name: "Cut damage", jp: "斬撃強化", text: "+10% cut damage", max: 5 },
  { id: "charge", name: "Faster charge", jp: "溜め短縮", text: "Charge strikes 12% faster", max: 3 },
  { id: "health", name: "Health", jp: "体力強化", text: "+20% max health", max: 4 },
  { id: "squad", name: "Squad size", jp: "増員", text: "+1 soldier in your squad", max: 2 },
];

const PICK_S = 10;
const DRILL_KEY = "aot-bootcamp";
const DRILL: Spec[] = [
  { text: "Hook onto a building", hint: "Fire an anchor at a wall or roof", need: 1, count: "hook" },
  { text: "Boost with gas", hint: "Hold gas in the air", need: 1, count: "gas" },
  { text: "Cut a nape", hint: "Lock on, then slash the neck", need: 1, count: "kill" },
];
const FAST = 40;
const ABNORMAL: TitanKind[] = ["abnormal", "runner", "climber"];
const BOSS_OBJ: Record<BossKind, [Spec, Spec]> = {
  female: [
    { text: "Bring down the Female Titan", hint: "Cut two limbs, then the nape", need: 1, count: "boss", kind: "female" },
    { text: "Sever 2 of her limbs", need: 2, count: "limb", kind: "female" },
  ],
  armored: [
    { text: "Bring down the Armored Titan", hint: "Knee joints first", need: 1, count: "boss", kind: "armored" },
    { text: "Cut both his knees", need: 2, count: "tendon", kind: "armored" },
  ],
  beast: [
    { text: "Bring down the Beast Titan", hint: "Close in through the rocks", need: 1, count: "boss", kind: "beast" },
    { text: "Sever his throwing arm", need: 1, count: "sever", kind: "beast" },
  ],
};

export function plan(n: number): [Spec, Spec] {
  const bk = bossFor(n);
  if (bk) return BOSS_OBJ[bk];
  if (n === 1) return [{ text: "Kill 3 titans", need: 3, count: "kill" }, { text: "No deaths this wave", need: 1, until: "noDeath" }];
  if (n === 2) return [{ text: "Cut a tendon", hint: "Lock a leg, then strike", need: 1, count: "tendon" }, { text: "Kill an abnormal", need: 1, count: "abnormal" }];
  if (n === 3) return [{ text: "Land a perfect cut", hint: "Release the charge on the flash", need: 1, count: "perfect" }, { text: "Kill 2 abnormals", need: 2, count: "abnormal" }];
  let k = 0;
  for (let m = 5; m < n; m++) if (!bossFor(m)) k++;
  const hold = Math.min(quotaFor(n, false), 8 + Math.floor(n / 3));
  const mains: Spec[] = [
    { text: "Protect the supply depot", hint: "Titans march on it", need: 100, until: "depot" },
    { text: `Hold the breach: ${hold} titans`, need: hold, count: "waveKill" },
    { text: "Cut 4 tendons", need: 4, count: "tendon" },
  ];
  const bonus: Spec[] = [
    { text: "Save a grabbed comrade", need: 1, count: "save" },
    { text: "No deaths this wave", need: 1, until: "noDeath" },
    { text: "Kill 3 abnormals", need: 3, count: "abnormal" },
    { text: "Land 3 perfect cuts", need: 3, count: "perfect" },
    { text: "Kill 2 at top speed", need: 2, count: "fastKill" },
  ];
  return [mains[k % mains.length], bonus[k % bonus.length]];
}

const needFor = (level: number) => 100 + 50 * (level - 1);

export function createRun(o: { world: World; titans: Titans; player: Player; allies: Allies; fx: Fx; tier: number }) {
  const { world, titans, player, allies, fx } = o;
  const out: GameEvent[] = [];
  const lv = Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>;
  let objs: Obj[] = [];
  let wave = 0;
  let ended = true;
  let level = 1;
  let xp = 0;
  let total = 0;
  let pending = 0;
  let choice: Upgrade[] | null = null;
  let choiceT = 0;
  let done = 0;
  let count = 0;
  let deaths = 0;
  let wasDead = false;
  let lastKills = 0;
  let depot = -1;
  let depotHp = 1;
  let depotWarn = false;
  let drill = false;
  let drillT = 0;
  let finT = 0;
  let gasWas = 0;
  let begun = false;

  const boost = (): Boost => {
    const g = gearBoost(o.tier);
    return {
      tank: g.tank * (1 + 0.15 * lv.tank),
      reel: g.reel * (1 + 0.08 * lv.reel),
      wear: g.wear * 0.85 ** lv.blade,
      damage: g.damage * (1 + 0.1 * lv.damage),
      chargeTime: g.chargeTime * 0.88 ** lv.charge,
      health: g.health * (1 + 0.2 * lv.health),
      spare: g.spare + 2 * lv.spare,
    };
  };
  player.setBoost(boost());

  const gain = (amount: number) => {
    total += amount;
    xp += amount;
    while (xp >= needFor(level)) {
      xp -= needFor(level);
      level++;
      pending++;
      out.push({ type: "stinger", name: "levelUp" });
    }
  };

  const complete = (ob: Obj) => {
    ob.state = "done";
    if (!drill) done++;
    const x = ob.bonus ? 50 + 10 * wave : 80 + 15 * wave;
    out.push({ type: "stinger", name: "objective" });
    if (!drill) out.push({ type: "toast", title: ob.bonus ? "Bonus complete" : "Objective complete", text: `${ob.text}. +${x} XP` });
    gain(x);
  };

  const fail = (ob: Obj) => {
    ob.state = "failed";
    if (!ob.bonus) out.push({ type: "toast", title: "Objective failed", text: ob.text });
  };

  const add = (c: Count, kind: TitanKind | undefined, n = 1) => {
    for (const ob of objs) {
      const s = ob.spec;
      if (ob.state !== "on" || s.count !== c || (s.kind && s.kind !== kind)) continue;
      ob.have = Math.min(ob.need, ob.have + n);
      if (ob.have >= ob.need) complete(ob);
    }
  };

  const endWave = () => {
    if (ended) return;
    ended = true;
    for (const ob of objs) {
      if (ob.state !== "on") continue;
      if ((ob.spec.until === "noDeath" && deaths === 0) || (ob.spec.until === "depot" && depotHp > 0)) complete(ob);
      else fail(ob);
    }
    titans.lure(null);
    depot = -1;
    world.depotDown.fill(false);
  };

  const startWave = () => {
    ended = false;
    deaths = 0;
    lastKills = titans.kills;
    objs = plan(wave).map((s, i) => ({ spec: s, text: s.text, hint: s.hint, have: 0, need: s.need, state: "on", bonus: i === 1 }));
    count += objs.length;
    if (objs.some((ob) => ob.spec.until === "depot")) {
      let best = Infinity;
      world.supplies.forEach((p, i) => {
        const d = p.distanceToSquared(world.breach);
        if (d < best) {
          best = d;
          depot = i;
        }
      });
      depotHp = 1;
      depotWarn = false;
      for (const ob of objs) if (ob.spec.until === "depot") {
        ob.have = 100;
        ob.unit = "%";
      }
      titans.lure(world.supplies[depot]);
      out.push({ type: "radio", who: "Command", text: "Titans are heading for the depot!" });
    }
  };

  const tickDepot = (dt: number) => {
    const p: THREE.Vector3 = world.supplies[depot];
    let hurt = 0;
    for (const t of titans.list()) if (t.alive && !isBoss(t.kind) && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < 9 + t.height * 0.4) hurt += t.height / 10;
    if (!hurt) return;
    depotHp = Math.max(0, depotHp - dt * 0.012 * hurt);
    const ob = objs.find((x) => x.spec.until === "depot");
    if (ob) ob.have = Math.ceil(depotHp * 100);
    if (depotHp < 0.5 && !depotWarn) {
      depotWarn = true;
      out.push({ type: "radio", who: "Command", text: "The depot is taking hits!" });
    }
    if (depotHp > 0) return;
    world.depotDown[depot] = true;
    titans.lure(null);
    fx.dust(p, 14);
    fx.steam(p, 6, 3);
    out.push({ type: "sfx", name: "gateBreak", at: p.clone(), volume: 0.8 }, { type: "shake", strength: 0.3 }, { type: "toast", title: "Depot lost", text: "No refills there this wave" });
    depot = -1;
    if (ob) fail(ob);
  };

  const roll = () => {
    const open = UPGRADES.filter((u) => lv[u.id] < u.max && (u.id !== "squad" || allies.hud().max > 0));
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    return open.slice(0, 3).map((u) => ({ ...u, level: lv[u.id] }));
  };

  const endDrill = () => {
    drill = false;
    objs = [];
    try {
      localStorage.setItem(DRILL_KEY, "1");
    } catch {}
    titans.start();
  };

  return {
    begin() {
      if (begun) return;
      begun = true;
      let seen = true;
      try {
        seen = !!localStorage.getItem(DRILL_KEY);
      } catch {}
      if (seen || !titans.drill) return titans.start();
      drill = true;
      drillT = 0;
      finT = 0;
      objs = DRILL.map((s) => ({ spec: s, text: s.text, hint: s.hint, have: 0, need: s.need, state: "on", bonus: false }));
      titans.drill(2);
      out.push({ type: "banner", jp: "訓練", en: "Bootcamp", text: "Learn the gear on easy titans" });
    },
    skip(): GameEvent[] {
      if (!drill || drillT < 1) return [];
      endDrill();
      return [{ type: "sfx", name: "ui" }];
    },
    see(e: GameEvent) {
      if (e.type === "kill") {
        let x = 15 + e.height * 1.5;
        if (ABNORMAL.includes(e.kind)) x *= 1.5;
        if (isBoss(e.kind)) x += 250;
        if (e.speed >= FAST) x += 10;
        gain(Math.round(x));
        add("kill", e.kind);
        if (ABNORMAL.includes(e.kind)) add("abnormal", e.kind);
        if (isBoss(e.kind)) add("boss", e.kind);
        if (e.speed >= FAST) add("fastKill", e.kind);
      } else if (e.type === "feat") {
        gain({ tendon: 12, sever: 10, perfect: 8, save: 40 }[e.name]);
        add(e.name, e.kind);
        if (e.name === "tendon" || e.name === "sever") add("limb", e.kind);
      }
    },
    dress<E extends GameEvent>(e: E): E {
      if (e.type !== "banner" || e.en !== `Wave ${titans.wave}`) return e;
      const [m, b] = plan(titans.wave);
      return { ...e, text: `${m.text}. Bonus: ${b.text}` };
    },
    update(dt: number, real: number, live: boolean): GameEvent[] {
      if (titans.wave !== wave) {
        if (drill) endDrill();
        endWave();
        wave = titans.wave;
        if (wave > 0) startWave();
      } else if (wave > 0 && titans.breakT > 0) endWave();
      if (!ended) {
        const k = titans.kills;
        if (k > lastKills) add("waveKill", undefined, k - lastKills);
        lastKills = k;
        if (depot >= 0) tickDepot(dt);
      }
      const dead = !player.alive;
      if (dead && !wasDead) {
        deaths++;
        for (const ob of objs) if (ob.state === "on" && ob.spec.until === "noDeath") fail(ob);
      }
      wasDead = dead;
      if (drill) {
        drillT += real;
        const h = player.hud();
        if (h.hooks[0] || h.hooks[1]) add("hook", undefined);
        if (h.gas < gasWas && !player.grounded) add("gas", undefined);
        gasWas = h.gas;
        if (objs.every((ob) => ob.state === "done")) {
          if ((finT += real) > 2.5) endDrill();
        } else if (dt > 0 && objs.some((ob) => ob.spec.count === "kill" && ob.state === "on") && !titans.list().some((t) => t.alive)) titans.drill?.(1);
      }
      if (choice) {
        choiceT -= real;
        if (choiceT <= 0) out.push(...this.pick(0));
      } else if (pending > 0 && live && !dead && !titans.held()) {
        pending--;
        const c = roll();
        if (c.length) {
          choice = c;
          choiceT = PICK_S;
          out.push({ type: "sfx", name: "bladeDraw" }, { type: "slowmo", scale: 0.35, duration: 0.6 });
        }
      }
      return out.splice(0);
    },
    pick(i: number): GameEvent[] {
      const u = choice?.[i];
      if (!u) return [];
      choice = null;
      lv[u.id]++;
      player.setBoost(boost());
      const ev: GameEvent[] = [{ type: "sfx", name: "bladeSwap" }, { type: "toast", title: u.name, text: u.text }];
      if (u.id === "squad") ev.push(...allies.grow());
      return ev;
    },
    hud(): RunHud {
      return { level, xp, need: needFor(level), total, objectives: objs, choice, choiceT, done, count, drill };
    },
    get upgrades() {
      return { ...lv };
    },
  };
}
