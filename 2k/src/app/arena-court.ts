import * as THREE from "three";
import type { Quality, TeamData } from "./contracts";
import { COURT, QUALITY } from "./contracts";
import { canvas2d, canvasTexture, contrastOn, drawEmblem, fitText, hashStr, seeded, shade, spacedText } from "./arena-tex";
import type { FloorReflection } from "./arena-reflect";

// The hardwood: one canvas holds planks, two-tone stain, paint, regulation lines, center emblem and wordmarks.
// Canvas top = far (+z) sideline, so floor text reads upright from the broadcast camera on the -z side.

const FT = 0.3048;
export const FLOOR_X = 56 * FT; // half extents of the finished floor (court + apron + bench area)
export const FLOOR_Z = 37 * FT;
const PLANK = 2.25 * 0.0254;

export interface Court {
  readonly mesh: THREE.Mesh;
  readonly surround: THREE.Mesh;
  paint(home: TeamData, away: TeamData): void;
  setQuality(q: Quality, reflection: FloorReflection | null): void;
  dispose(): void;
}

function texSize(q: Quality, max: number) {
  const s = QUALITY[q].textureSize >= 1024 ? 4096 : 2048;
  return Math.min(s, max);
}

export function createCourt(renderer: THREE.WebGLRenderer, home: TeamData, away: TeamData, quality: Quality, reflection: FloorReflection | null): Court {
  const maxTex = renderer.capabilities.maxTextureSize;
  let W = texSize(quality, maxTex);
  let H = Math.round((W * FLOOR_Z) / FLOOR_X);
  let [cv, ctx] = canvas2d(W, H);
  let [rc, rctx] = canvas2d(W >> 2, H >> 2);
  let map = canvasTexture(cv, true, QUALITY[quality].anisotropy);
  let rough = canvasTexture(rc, false, QUALITY[quality].anisotropy);
  let teams: [TeamData, TeamData] = [home, away];

  const geo = new THREE.PlaneGeometry(FLOOR_X * 2, FLOOR_Z * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  // u runs toward -x: the broadcast camera looks along +z from the -z side, so world +x is screen LEFT
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (FLOOR_X - pos.getX(i)) / (2 * FLOOR_X), (pos.getZ(i) + FLOOR_Z) / (2 * FLOOR_Z));

  const uniforms = {
    tReflect: { value: reflection?.texture ?? null },
    uReflMatrix: { value: reflection?.matrix ?? new THREE.Matrix4() },
    uReflStrength: { value: 1.25 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    map, roughnessMap: rough, roughness: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.08,
    envMapIntensity: 0.5, specularIntensity: 0.6,
  });
  let planar = false;
  mat.onBeforeCompile = (sh) => {
    if (!planar) return;
    Object.assign(sh.uniforms, uniforms);
    sh.defines = { ...(sh.defines ?? {}), USE_PLANAR: "" };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uReflMatrix;\nvarying vec4 vReflCoord;\nvarying vec3 vFloorP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 fw = modelMatrix * vec4(transformed, 1.0); vFloorP = fw.xyz; vReflCoord = uReflMatrix * fw; }");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tReflect;\nuniform float uReflStrength;\nvarying vec4 vReflCoord;\nvarying vec3 vFloorP;\nfloat fh(float n) { return fract(sin(n * 91.345) * 47453.5453); }")
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `{
  float row = floor(vFloorP.z / ${PLANK.toFixed(5)});
  float seg = floor((vFloorP.x + fh(row) * 3.0) / 1.9);
  vec2 wob = vec2(fh(row + seg * 7.13) - 0.5, fh(row * 1.7 + seg) - 0.5) * 0.006;
  vec2 ruv = vReflCoord.xy / vReflCoord.w + wob * (0.4 + roughnessFactor);
  float lod = clamp(roughnessFactor * 7.0 - 0.6, 0.0, 5.0);
  vec3 refl = textureLod(tReflect, ruv, lod).rgb;
  // soft-clip highlights: light panels and white boards must read as gloss, not as white rectangles
  float rl = max(refl.r, max(refl.g, refl.b));
  refl *= 1.0 / (1.0 + max(rl - 0.35, 0.0) * 2.2);
  float nv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  float fres = 0.05 + 0.95 * pow(1.0 - nv, 5.0);
  float gloss = clamp(1.0 - roughnessFactor * 1.15, 0.0, 1.0);
  // view-angle fade: grazing broadcast views mirror strongly, top-down views barely at all
  float graze = smoothstep(0.25, 0.9, 1.0 - nv);
  outgoingLight = outgoingLight * (1.0 - fres * 0.5 * gloss) + refl * mix(0.03, 1.0, fres) * mix(0.25, 1.0, graze) * gloss * uReflStrength;
}
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => (planar ? "floor-planar" : "floor-probe");

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "court";

  const sgeo = new THREE.PlaneGeometry(160, 120);
  sgeo.rotateX(-Math.PI / 2);
  const smat = new THREE.MeshStandardMaterial({ color: "#0c0b0c", roughness: 0.85, metalness: 0 });
  const surround = new THREE.Mesh(sgeo, smat);
  surround.position.y = -0.01;
  surround.receiveShadow = true;

  function applyMode(q: Quality, refl: FloorReflection | null) {
    const was = planar;
    planar = !!refl && QUALITY[q].floorReflection === "planar";
    if (refl) {
      uniforms.tReflect.value = refl.texture;
      uniforms.uReflMatrix.value = refl.matrix;
    }
    const probe = QUALITY[q].floorReflection === "probe";
    mat.clearcoat = probe ? 0.85 : 0;
    mat.envMapIntensity = planar ? 0.25 : probe ? 0.55 : 0.4;
    if (was !== planar) mat.needsUpdate = true;
  }

  function draw() {
    const [h, a] = teams;
    const S = W / (2 * FLOOR_X);
    const X = (x: number) => (x + FLOOR_X) * S;
    const Y = (z: number) => (FLOOR_Z - z) * S;
    const rnd = seeded(hashStr(h.abbr + "floor"));
    const wood = h.court.wood || "#c9935b";
    const paintC = h.court.paint || h.primary;
    const lineC = h.court.line || "#ffffff";
    const apronC = shade(h.primary, -0.35);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, W, H);
    const rowH = PLANK * S;
    const rows = Math.ceil(H / rowH) + 1;
    const base = new THREE.Color(wood);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const y0 = r * rowH;
      let x = -rnd() * 2.4 * S;
      while (x < W) {
        const len = (1.0 + rnd() * 2.2) * S;
        const dl = (rnd() - 0.5) * 0.09 + (rnd() < 0.08 ? -0.05 : 0);
        c.setHSL(hsl.h + (rnd() - 0.5) * 0.018, hsl.s * (0.9 + rnd() * 0.2), Math.min(0.9, Math.max(0.05, hsl.l + dl)));
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fillRect(x, y0, len, rowH);
        ctx.globalAlpha = 0.08 + rnd() * 0.08;
        ctx.fillStyle = shade(`#${c.getHexString()}`, -0.3);
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) ctx.fillRect(x, y0 + rnd() * rowH, len, Math.max(0.6, rowH * 0.08));
        if (rnd() < 0.05) {
          ctx.globalAlpha = 0.12;
          ctx.beginPath();
          ctx.ellipse(x + rnd() * len, y0 + rowH / 2, rowH * 1.2, rowH * 0.35, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = shade(wood, -0.55);
        ctx.fillRect(x, y0, Math.max(1, S * 0.004), rowH);
        ctx.globalAlpha = 1;
        x += len;
      }
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = shade(wood, -0.5);
      ctx.fillRect(0, y0, W, Math.max(0.7, S * 0.0025));
      ctx.globalAlpha = 1;
    }

    const lw = Math.max(2, COURT.lineW * S);
    const L = COURT.halfL;
    const Wd = COURT.halfW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(X(-L), Y(Wd), (2 * L) * S, (2 * Wd) * S);
    ctx.clip("evenodd");
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = shade(apronC, 0.15);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = apronC;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    for (const d of [-1, 1]) {
      ctx.save();
      threePath(d);
      ctx.closePath();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = shade(wood, 0.55);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = paintC;
    for (const d of [-1, 1]) {
      const x0 = Math.min(X(d * L), X(d * COURT.ftLineX));
      ctx.fillRect(x0, Y(COURT.laneW / 2), Math.abs(X(d * L) - X(d * COURT.ftLineX)), COURT.laneW * S);
    }
    ctx.beginPath();
    ctx.arc(X(0), Y(0), COURT.centerCircleR * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawEmblem(ctx, h, X(0), Y(0), (COURT.centerCircleR - 0.18) * S);

    ctx.strokeStyle = lineC;
    ctx.fillStyle = lineC;
    ctx.lineWidth = lw;
    ctx.lineCap = "butt";
    const inset = lw / 2;
    ctx.strokeRect(X(-L) + inset, Y(Wd) + inset, 2 * L * S - lw, 2 * Wd * S - lw);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(Wd));
    ctx.lineTo(X(0), Y(-Wd));
    ctx.stroke();
    ring(0, 0, COURT.centerCircleR);
    ring(0, 0, COURT.innerCircleR);
    for (const d of [-1, 1]) {
      const bx = X(d * L) - d * inset;
      const fx = X(d * COURT.ftLineX);
      ctx.strokeRect(Math.min(bx, fx), Y(COURT.laneW / 2) + inset, Math.abs(bx - fx), COURT.laneW * S - lw);
      // free-throw circle: solid toward midcourt, dashed inside the lane
      const r = COURT.ftCircleR * S - inset;
      ctx.beginPath();
      ctx.arc(fx, Y(0), r, d > 0 ? Math.PI / 2 : -Math.PI / 2, d > 0 ? (3 * Math.PI) / 2 : Math.PI / 2);
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([1.25 * FT * S, 1.25 * FT * S]);
      ctx.beginPath();
      ctx.arc(fx, Y(0), r, d > 0 ? -Math.PI / 2 : Math.PI / 2, d > 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      ctx.stroke();
      ctx.restore();
      // lane space marks (from the baseline): block at 7 ft, then 8, 11, 14 ft
      for (const side of [-1, 1]) {
        const zEdge = side * COURT.laneW / 2;
        for (const [at, w, len] of [[7, 1, 0.66], [8, 0.17, 0.5], [11, 0.17, 0.5], [14, 0.17, 0.5]] as const) {
          const xa = X(d * (L - at * FT));
          const xb = X(d * (L - (at + w) * FT));
          ctx.fillRect(Math.min(xa, xb), side > 0 ? Y(zEdge + len * FT) : Y(zEdge), Math.abs(xb - xa), len * FT * S);
        }
      }
      ctx.beginPath();
      const rx = X(d * COURT.rimX);
      const rr = COURT.restrictedR * S - inset;
      ctx.moveTo(X(d * COURT.boardX), Y(COURT.restrictedR) + inset);
      ctx.lineTo(rx, Y(COURT.restrictedR) + inset);
      ctx.arc(rx, Y(0), rr, -Math.PI / 2, Math.PI / 2, d > 0);
      ctx.lineTo(X(d * COURT.boardX), Y(-COURT.restrictedR) - inset);
      ctx.stroke();
      ctx.save();
      threePath(d, inset);
      ctx.stroke();
      ctx.restore();
      for (const side of [-1, 1]) {
        const hx = X(d * (L - 28 * FT));
        ctx.fillRect(hx - lw / 2, side > 0 ? Y(Wd + 3 * FT) : Y(-Wd) , lw, 3 * FT * S);
        ctx.fillRect(hx - lw / 2, side > 0 ? Y(Wd) : Y(-Wd + 3 * FT), lw, 3 * FT * S);
      }
      ctx.fillRect(Math.min(X(d * L), X(d * (L - 0.5 * FT))), Y(COURT.laneW / 2 + 3 * FT), 0.5 * FT * S, lw);
      ctx.fillRect(Math.min(X(d * L), X(d * (L - 0.5 * FT))), Y(-COURT.laneW / 2 - 3 * FT), 0.5 * FT * S, lw);
    }

    // wordmarks: city on the far apron, brand on the near apron, nickname on each baseline apron
    const ink = contrastOn(apronC, "#ffffff", shade(h.primary, -0.8));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = ink;
    fitText(ctx, h.city.toUpperCase(), 900, 4.6 * FT * S, 40 * FT * S, 0.12);
    spacedText(ctx, h.city.toUpperCase(), X(0), Y(Wd + 3.1 * FT), 0.12);
    ctx.fillStyle = h.secondary;
    ctx.globalAlpha = 0.85;
    fitText(ctx, "HOOPS", 900, 3.8 * FT * S, 18 * FT * S, 0.3);
    spacedText(ctx, "HOOPS", X(-30 * FT), Y(-Wd - 3.2 * FT), 0.3);
    spacedText(ctx, "HOOPS", X(30 * FT), Y(-Wd - 3.2 * FT), 0.3);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = ink;
    for (const d of [-1, 1]) {
      ctx.save();
      ctx.translate(X(d * (L + 3 * FT)), Y(0));
      ctx.rotate(d > 0 ? -Math.PI / 2 : Math.PI / 2);
      fitText(ctx, h.name.toUpperCase(), 900, 4 * FT * S, 34 * FT * S, 0.14);
      spacedText(ctx, h.name.toUpperCase(), 0, 0, 0.14);
      ctx.restore();
    }
    for (const d of [-1, 1]) drawEmblem(ctx, h, X(d * 37 * FT), Y(-Wd + 4.3 * FT), 2.2 * FT * S, { alpha: 0.5 });
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ink;
    fitText(ctx, `VS ${a.abbr}`, 800, 1.6 * FT * S, 10 * FT * S, 0.2);
    spacedText(ctx, `VS ${a.abbr}`, X(0), Y(-Wd - 4 * FT), 0.2);
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = "multiply";
    for (const d of [-1, 1]) {
      const g = ctx.createRadialGradient(X(d * (L - 9 * FT)), Y(0), 0, X(d * (L - 9 * FT)), Y(0), 18 * FT * S);
      g.addColorStop(0, "rgba(200,190,180,1)");
      g.addColorStop(1, "rgba(255,255,255,1)");
      ctx.fillStyle = g;
      ctx.fillRect(X(d * L) - 30 * FT * S, 0, 60 * FT * S, H);
    }
    ctx.globalCompositeOperation = "source-over";
    map.needsUpdate = true;

    // roughness (green channel): lacquer, rougher seams, scuffed paint areas
    const RW = rc.width;
    const RH = rc.height;
    const rs = RW / (2 * FLOOR_X);
    rctx.fillStyle = "rgb(0,62,0)";
    rctx.fillRect(0, 0, RW, RH);
    const rr = seeded(7);
    for (let i = 0; i < 900; i++) {
      const x = rr() * RW;
      const y = rr() * RH;
      const r = (0.2 + rr() * 1.4) * rs;
      const g = rctx.createRadialGradient(x, y, 0, x, y, r);
      const v = 62 + Math.floor(rr() * 40);
      g.addColorStop(0, `rgba(0,${v},0,0.35)`);
      g.addColorStop(1, "rgba(0,62,0,0)");
      rctx.fillStyle = g;
      rctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const d of [-1, 1]) {
      const cx = (d * (L - 8 * FT) + FLOOR_X) * rs;
      const g = rctx.createRadialGradient(cx, RH / 2, 0, cx, RH / 2, 16 * FT * rs);
      g.addColorStop(0, "rgba(0,120,0,0.5)");
      g.addColorStop(1, "rgba(0,62,0,0)");
      rctx.fillStyle = g;
      rctx.fillRect(0, 0, RW, RH);
    }
    rctx.fillStyle = "rgb(0,120,0)";
    rctx.globalAlpha = 0.6;
    rctx.fillRect(0, 0, RW, (FLOOR_Z - Wd - 7 * FT) * rs);
    rctx.globalAlpha = 1;
    rough.needsUpdate = true;

    function ring(x: number, z: number, r: number) {
      ctx.beginPath();
      ctx.arc(X(x), Y(z), r * S - inset, 0, Math.PI * 2);
      ctx.stroke();
    }
    function threePath(d: number, ins = 0) {
      const cz = COURT.threeCornerZ;
      const xCorner = d * (L - COURT.threeCornerLen);
      const rx = X(d * COURT.rimX);
      const r3 = COURT.threeR * S - ins;
      const ang = Math.asin(Math.min(1, (cz * S - ins) / r3));
      ctx.beginPath();
      ctx.moveTo(X(d * L), Y(cz) + ins);
      ctx.lineTo(X(xCorner), Y(cz) + ins);
      if (d > 0) ctx.arc(rx, Y(0), r3, -Math.PI / 2 - (Math.PI / 2 - ang), Math.PI / 2 + (Math.PI / 2 - ang), true);
      else ctx.arc(rx, Y(0), r3, -ang, ang, false);
      ctx.lineTo(X(d * L), Y(-cz) - ins);
    }
  }

  draw();
  applyMode(quality, reflection);
  return {
    mesh,
    surround,
    paint(h, a) {
      teams = [h, a];
      draw();
    },
    setQuality(q, refl) {
      const nw = texSize(q, maxTex);
      if (nw !== W) {
        W = nw;
        H = Math.round((W * FLOOR_Z) / FLOOR_X);
        map.dispose();
        rough.dispose();
        [cv, ctx] = canvas2d(W, H);
        [rc, rctx] = canvas2d(W >> 2, H >> 2);
        map = canvasTexture(cv, true, QUALITY[q].anisotropy);
        rough = canvasTexture(rc, false, QUALITY[q].anisotropy);
        mat.map = map;
        mat.roughnessMap = rough;
        draw();
      } else {
        map.anisotropy = rough.anisotropy = QUALITY[q].anisotropy;
        map.needsUpdate = rough.needsUpdate = true;
      }
      applyMode(q, refl);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      rough.dispose();
      sgeo.dispose();
      smat.dispose();
    },
  };
}
