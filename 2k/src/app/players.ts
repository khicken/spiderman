import * as THREE from "three";
import type { BallState, GameEvent, PassKind, PlayerData, PlayerRig, PlayerState, Quality, SimView, TeamData, V3 } from "./contracts";
import { COURT, QUALITY } from "./contracts";
import type { Anim, AnimCtx } from "./player-anim";
import { animate, createAnim, palmModel, toWorld } from "./player-anim";
import { createBallMesh } from "./player-ball";
import { buildBody } from "./player-mesh";
import { createRefs } from "./player-refs";
import type { Body } from "./player-skel";
import { B, BONES, PARENT, bodyFor } from "./player-skel";
import type { Look } from "./player-tex";
import { acquireRoughness, lookFor, paintAtlas, refLook, releaseRoughness, resetFontCache } from "./player-tex";
import { newBallState, newPlayerState } from "./state";

// Players: 10 skinned athletes + 3 referees + the menu showcase model + the ball. Each body is ONE SkinnedMesh with ONE
// material (per-player canvas atlas), so the whole cast costs ~14 draw calls (+ shadow pass).

/** Extra API beyond the contract (integrator/fx may use it). */
export type PlayersPlus = PlayerRig & {
  /** World position of a slot's palm center. hand: -1 left, 1 right (contract side convention). */
  handPos(slot: number, hand: -1 | 1, out: THREE.Vector3): THREE.Vector3;
  /** Referee world positions (3), e.g. for the camera or fx. */
  refPos(i: number, out: THREE.Vector3): THREE.Vector3;
};

interface Char {
  key: string;
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  look: Look;
  body: Body;
  anim: Anim;
  used: number; // frame stamp
}

const RIM = { value: new THREE.Color(0.16, 0.18, 0.22) };
const IDENT = new THREE.Matrix4();

function patchRim(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = RIM;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;")
      .replace(
        "#include <opaque_fragment>",
        "float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);\n" +
          "outgoingLight += uRim * rimF * (0.35 + 0.65 * diffuseColor.rgb);\n#include <opaque_fragment>",
      );
  };
  mat.customProgramCacheKey = () => "hoops-player-rim";
}

export function createPlayers(scene: THREE.Scene, quality: Quality): PlayersPlus {
  let q = quality;
  const root = new THREE.Group();
  root.name = "players";
  scene.add(root);
  const rough = acquireRoughness();
  let env: THREE.Texture | null = null;
  let home: TeamData | null = null;
  let away: TeamData | null = null;
  let frame = 0;
  let lastView: SimView | null = null;
  let simJumps = false;
  const cache = new Map<string, Char>();
  const slots: (Char | null)[] = new Array(10).fill(null);
  const slotKey: string[] = new Array(10).fill("");
  const passTo: (THREE.Vector3 | null)[] = new Array(10).fill(null);
  const passToV = Array.from({ length: 10 }, () => new THREE.Vector3());
  const passKind: PassKind[] = new Array(10).fill("chest");

  // ball
  let ballM = createBallMesh(Math.min(1024, QUALITY[q].textureSize));
  root.add(ballM.mesh);
  const ballQ = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  // contact shadows: one instanced quad per body + ball
  const BLOBS = 16;
  const blobTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgb(70,70,70)");
    g.addColorStop(0.35, "rgb(140,140,140)");
    g.addColorStop(0.7, "rgb(225,225,225)");
    g.addColorStop(1, "rgb(255,255,255)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTex, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // instance color.r = shadow strength: the quad fades to white (no-op under multiply) at strength 0
  blobMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <map_fragment>", "vec4 blobTx = texture2D( map, vMapUv );")
      .replace("#include <color_fragment>", "diffuseColor.rgb = mix( vec3( 1.0 ), blobTx.rgb, vColor.r );");
  };
  blobMat.customProgramCacheKey = () => "hoops-blob";
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, BLOBS);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.frustumCulled = false;
  blobs.renderOrder = 1;
  blobs.count = 0;
  root.add(blobs);
  const blobColor = new THREE.Color();
  blobs.setColorAt(0, blobColor.setScalar(1));
  let blobN = 0;
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _qi = new THREE.Quaternion();
  function blob(x: number, z: number, r: number, darkness: number) {
    if (blobN >= BLOBS) return;
    _m.compose(_p.set(x, 0.006, z), _qi, _s.set(r * 2, 1, r * 2));
    blobs.setMatrixAt(blobN, _m);
    blobs.setColorAt(blobN, blobColor.setScalar(darkness));
    blobN++;
  }

  // refs + showcase
  const refs = createRefs();
  const refChars: (Char | null)[] = [null, null, null];
  const refBall = newBallState();
  let show: { data: PlayerData; team: TeamData; at: THREE.Vector3; char: Char | null; p: PlayerState; ball: BallState; mesh: THREE.Mesh } | null = null;

  const ctx: AnimCtx = {
    ball: refBall, slot: -1, simJumps: false, dt: 0, time: 0, passTo: null, passKind: "chest", signal: "none", signalT: 0, rimX: COURT.rimX,
  };

  function build(key: string, data: PlayerData, look: Look, isRef: boolean): Char {
    const qp = QUALITY[q];
    const body = bodyFor(data);
    const geo = buildBody(body, look, { detail: qp.playerDetail });
    const size = Math.min(1024, qp.textureSize);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    paintAtlas(canvas.getContext("2d")!, size, look);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, qp.anisotropy);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughnessMap: rough, roughness: 1, metalness: 0, envMap: env, envMapIntensity: 0.65 });
    patchRim(mat);
    const bones: THREE.Bone[] = [];
    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < BONES; i++) {
      const bone = new THREE.Bone();
      const px = body.rest[i * 3];
      const py = body.rest[i * 3 + 1];
      const pz = body.rest[i * 3 + 2];
      const par = PARENT[i];
      if (par < 0) bone.position.set(px, py, pz);
      else bone.position.set(px - body.rest[par * 3], py - body.rest[par * 3 + 1], pz - body.rest[par * 3 + 2]);
      if (par >= 0) bones[par].add(bone);
      bones.push(bone);
      inverses.push(new THREE.Matrix4().makeTranslation(-px, -py, -pz));
    }
    const group = new THREE.Group();
    group.name = key;
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(bones[0]);
    group.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, inverses), IDENT);
    root.add(group);
    const anim = createAnim(body, isRef);
    return { key, group, mesh, bones, geo, mat, tex, canvas, look, body, anim, used: frame };
  }

  function free(c: Char) {
    root.remove(c.group);
    c.geo.dispose();
    c.mat.dispose();
    c.tex.dispose();
    c.mesh.skeleton.dispose();
  }

  function charFor(p: PlayerState): Char {
    const team = p.team === 0 ? home : away;
    const key = `${p.team}:${p.data.id}:${team?.abbr ?? "?"}`;
    let c = cache.get(key);
    if (!c) {
      const look = team ? lookFor(p.data, team, p.team === 0) : refLook(p.slot);
      c = build(key, p.data, look, false);
      cache.set(key, c);
      if (cache.size > 34) {
        // drop the least recently used bench body
        let oldest: Char | null = null;
        for (const v of cache.values()) if (!slots.includes(v) && (!oldest || v.used < oldest.used)) oldest = v;
        if (oldest) {
          cache.delete(oldest.key);
          free(oldest);
        }
      }
    }
    return c;
  }

  function apply(c: Char, p: PlayerState) {
    const A = c.anim;
    for (let i = 0; i < BONES; i++) c.bones[i].quaternion.copy(A.lq[i]);
    c.bones[B.hips].position.copy(A.restP[B.hips]).add(A.hip);
    c.group.position.set(p.pos.x, p.pos.y + A.rootY, p.pos.z);
    c.group.rotation.set(0, A.yaw, 0);
    c.group.visible = true;
  }

  function nearestRim(x: number) {
    return x >= 0 ? COURT.rimX : -COURT.rimX;
  }

  function clearAll() {
    for (const c of cache.values()) free(c);
    cache.clear();
    slots.fill(null);
    slotKey.fill("");
    for (let i = 0; i < 3; i++) {
      const r = refChars[i];
      if (r) free(r);
      refChars[i] = null;
    }
    if (show?.char) {
      free(show.char);
      show.char = null;
    }
  }

  // repaint atlases once webfonts are ready (numbers/names use the display face)
  let fontsHooked = false;
  function hookFonts() {
    if (fontsHooked || typeof document === "undefined" || !document.fonts) return;
    fontsHooked = true;
    document.fonts.ready
      .then(() => {
        if (disposed) return;
        resetFontCache();
        for (const c of cache.values()) {
          paintAtlas(c.canvas.getContext("2d")!, c.canvas.width, c.look);
          c.tex.needsUpdate = true;
        }
        if (show?.char) {
          paintAtlas(show.char.canvas.getContext("2d")!, show.char.canvas.width, show.char.look);
          show.char.tex.needsUpdate = true;
        }
      })
      .catch(() => {});
  }
  let disposed = false;

  const _w = new THREE.Vector3();
  const _w2 = new THREE.Vector3();
  const _dk0 = new THREE.Vector3();
  const _dk1 = new THREE.Vector3();

  const rig: PlayersPlus = {
    ball: ballM.mesh,
    setTeams(h, a) {
      if (home && away && (home.abbr !== h.abbr || away.abbr !== a.abbr)) {
        for (const c of cache.values()) free(c);
        cache.clear();
        slots.fill(null);
        slotKey.fill("");
      }
      home = h;
      away = a;
      hookFonts();
    },
    update(dt, view) {
      frame++;
      if (view !== lastView) {
        simJumps = false;
        lastView = view;
      }
      blobN = 0;
      ctx.dt = Math.max(1e-4, Math.min(dt, 1 / 20));
      ctx.time = view.time;
      ctx.ball = view.ball;
      const players = view.players;
      if (!simJumps) for (let i = 0; i < players.length; i++) if (players[i].pos.y > 0.03) simJumps = true;
      ctx.simJumps = simJumps;
      ctx.signal = "none";
      for (let i = 0; i < 10 && i < players.length; i++) {
        const p = players[i];
        const c = charFor(p);
        if (slots[i] !== c) {
          if (slots[i] && !Array.from(slots).some((s, k) => k !== i && s === slots[i])) slots[i]!.group.visible = false;
          slots[i] = c;
          slotKey[i] = c.key;
        }
        c.used = frame;
        ctx.slot = i;
        ctx.passTo = passTo[i];
        ctx.passKind = passKind[i];
        ctx.rimX = nearestRim(p.pos.x);
        animate(c.anim, p, ctx);
        // dunks: the head stays under the rim (and out of the net) however high the sim jump goes
        if (p.action === "dunk") {
          const maxY = COURT.rimHeight - 0.1 - c.body.H;
          const tot = p.pos.y + c.anim.rootY;
          if (tot > maxY) c.anim.rootY -= tot - maxY;
        }
        apply(c, p);
        const air = p.pos.y + c.anim.rootY;
        blob(p.pos.x, p.pos.z, 0.42 + p.radius * 0.6 + air * 0.25, 0.55 * Math.max(0.15, 1 - air * 0.9));
      }
      // hide cached bodies that are not on the floor
      for (const c of cache.values()) if (c.used !== frame && c.group.visible) c.group.visible = false;

      // referees
      refs.update(ctx.dt, view);
      ctx.ball = refBall;
      ctx.simJumps = false;
      ctx.passTo = null;
      for (let i = 0; i < 3; i++) {
        const p = refs.states[i];
        if (!refChars[i]) refChars[i] = build(`ref-${i}`, p.data, refLook(i), true);
        const c = refChars[i]!;
        ctx.slot = -2;
        ctx.signal = refs.signal[i];
        ctx.signalT = refs.signalT[i];
        animate(c.anim, p, ctx);
        apply(c, p);
        blob(p.pos.x, p.pos.z, 0.55, 0.45);
      }
      ctx.signal = "none";

      // showcase athlete
      if (show) {
        const s = show;
        if (!s.char) {
          s.char = build(`show:${s.data.id}`, s.data, lookFor(s.data, s.team, false), false);
          s.mesh.visible = true;
        }
        const p = s.p;
        p.pos.copy(s.at);
        p.facing = Math.PI;
        p.lookAt.set(s.at.x + Math.sin(view.time * 0.4) * 2, 1.6, s.at.z - 6);
        p.actionT += ctx.dt;
        p.actionP = (p.actionT * 0.5) % 1;
        // own dribble: right hand, ~1.9 bounces / s
        const ph = (p.actionT * 1.9) % 1;
        const bounce = Math.abs(Math.cos(ph * Math.PI));
        const H = s.char.body.H;
        const top = H * 0.43;
        const yb = COURT.ballR + (top - COURT.ballR) * (1 - (1 - bounce) * (1 - bounce));
        _w.set(-0.26, yb, 0.24);
        s.ball.pos.set(s.at.x - _w.x, yb, s.at.z - _w.z); // facing pi: model x -> -world x, z -> -world z
        s.ball.mode = "dribble";
        s.ball.holder = 99;
        s.mesh.position.copy(s.ball.pos);
        s.mesh.rotation.x += ctx.dt * 6;
        ctx.ball = s.ball;
        ctx.slot = 99;
        animate(s.char.anim, p, ctx);
        apply(s.char, p);
        blob(p.pos.x, p.pos.z, 0.55, 0.5);
        blob(s.ball.pos.x, s.ball.pos.z, 0.14, 0.35);
      }

      // ball
      const b = view.ball;
      ballM.mesh.position.copy(b.pos);
      // a dunk in flight carries the ball in the hand(s) up to the rim, not floating at the chest
      if (b.holder >= 0 && b.holder < 10 && b.holder < players.length) {
        const h = players[b.holder];
        const hc = slots[b.holder];
        if (h.action === "dunk" && hc) {
          const P = h.actionP;
          const w = Math.min(1, Math.max(0, (P - 0.26) / 0.12)) * (1 - Math.min(1, Math.max(0, (P - 0.6) / 0.05)));
          if (w > 0) {
            palmModel(hc.anim, 0, _w2);
            toWorld(hc.anim, h, _w2, _dk0);
            palmModel(hc.anim, 1, _w2);
            toWorld(hc.anim, h, _w2, _dk1);
            const two = h.dunkStyle === "twoHand" || h.dunkStyle === "reverse";
            if (two) _dk0.lerp(_dk1, 0.5);
            else if (_dk1.y > _dk0.y) _dk0.copy(_dk1);
            _dk0.y += two ? 0.06 : 0.1;
            ballM.mesh.position.lerp(_dk0, w);
          }
        }
      }
      const sp = b.spin;
      let wx = sp.x;
      let wy = sp.y;
      let wz = sp.z;
      if (Math.abs(wx) + Math.abs(wy) + Math.abs(wz) < 0.1 && (b.mode === "loose" || b.mode === "dead") && b.pos.y < COURT.ballR + 0.05) {
        // rolling: w = up x v / r
        wx = b.vel.z / COURT.ballR;
        wy = 0;
        wz = -b.vel.x / COURT.ballR;
      }
      const wl = Math.hypot(wx, wy, wz);
      if (wl > 1e-3) {
        axis.set(wx / wl, wy / wl, wz / wl);
        dq.setFromAxisAngle(axis, wl * ctx.dt);
        ballQ.premultiply(dq);
      }
      ballM.mesh.quaternion.copy(ballQ);
      ballM.mesh.visible = true;
      const by = Math.max(0, b.pos.y - COURT.ballR);
      blob(b.pos.x, b.pos.z, 0.13 + by * 0.06, 0.4 * Math.max(0, 1 - by * 0.35));

      blobs.count = blobN;
      blobs.instanceMatrix.needsUpdate = true;
      if (blobs.instanceColor) blobs.instanceColor.needsUpdate = true;
    },
    handle(events: readonly GameEvent[]) {
      refs.handle(events);
      for (const e of events) {
        if (e.type === "pass") {
          const v = lastView;
          if (v && e.from >= 0 && e.from < 10 && e.to >= 0 && e.to < 10) {
            const r = v.players[e.to];
            passTo[e.from] = passToV[e.from].set(r.pos.x, 1.2, r.pos.z);
            passKind[e.from] = e.kind;
          }
        }
      }
    },
    headPos(slot, out) {
      const c = slots[slot];
      const p = lastView?.players[slot];
      if (!c || !p) {
        if (p) return out.set(p.pos.x, p.pos.y + p.height + 0.12, p.pos.z);
        return out.set(0, 2.2, 0);
      }
      _w2.copy(c.anim.mp[B.head]);
      _w2.y += c.body.headR[1] * 1.9 + 0.08;
      return toWorld(c.anim, p, _w2, out);
    },
    handPos(slot, hand, out) {
      const c = slots[slot];
      const p = lastView?.players[slot];
      if (!c || !p) return out.set(0, 1, 0);
      palmModel(c.anim, hand === -1 ? 0 : 1, _w2);
      return toWorld(c.anim, p, _w2, out);
    },
    refPos(i, out) {
      return out.copy(refs.states[i % 3].pos);
    },
    showcase(data, team, at?: V3) {
      if (show) {
        if (show.char) free(show.char);
        root.remove(show.mesh);
        show = null;
      }
      if (!data || !team) return;
      const p = newPlayerState(-1, 0, 0, data);
      p.action = "dribble";
      p.crouch = 0.3;
      p.hasBall = true;
      const ball = newBallState();
      const mesh = new THREE.Mesh(ballM.geo, ballM.mat);
      mesh.castShadow = true;
      mesh.visible = false;
      root.add(mesh);
      show = { data, team, at: new THREE.Vector3(at?.x ?? 0, 0, at?.z ?? -3.4), char: null, p, ball, mesh };
    },
    setEnv(e) {
      env = e;
      for (const c of cache.values()) {
        c.mat.envMap = e;
        c.mat.needsUpdate = true;
      }
      for (const r of refChars) if (r) {
        r.mat.envMap = e;
        r.mat.needsUpdate = true;
      }
      if (show?.char) {
        show.char.mat.envMap = e;
        show.char.mat.needsUpdate = true;
      }
      ballM.mat.envMap = e;
      ballM.mat.needsUpdate = true;
    },
    setQuality(nq) {
      if (nq === q) return;
      const oldDetail = QUALITY[q].playerDetail;
      const oldTex = QUALITY[q].textureSize;
      q = nq;
      if (QUALITY[q].playerDetail !== oldDetail || Math.min(1024, QUALITY[q].textureSize) !== Math.min(1024, oldTex)) clearAll();
    },
    dispose() {
      disposed = true;
      clearAll();
      if (show) root.remove(show.mesh);
      show = null;
      scene.remove(root);
      ballM.dispose();
      blobGeo.dispose();
      blobMat.dispose();
      blobTex.dispose();
      blobs.dispose();
      releaseRoughness();
    },
  };
  void ballM;
  return rig;
}
