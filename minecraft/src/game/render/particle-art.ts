export const SPRITE = {
  generic: 0, // 8 frames, 0 smallest
  flame: 8,
  heart: 9,
  angry: 10,
  crit: 11,
  note: 12,
  bubble: 13,
  splash: 14, // 4 frames
  dripHang: 18,
  dripFall: 19,
  dripLand: 20,
  explosion: 21, // 16 frames
  gust: 37, // 12 frames
  spark: 49,
  pixel: 50,
} as const;
export const SPRITE_LAYERS = 51;

type Px = Uint8Array;

function set(p: Px, l: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const i = (l * 256 + y * 16 + x) * 4;
  p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = a;
}

function rows(p: Px, l: number, art: string[], pal: Record<string, [number, number, number]>) {
  const oy = Math.floor((16 - art.length) / 2);
  for (let y = 0; y < art.length; y++) {
    const ox = Math.floor((16 - art[y].length) / 2);
    for (let x = 0; x < art[y].length; x++) {
      const c = pal[art[y][x]];
      if (c) set(p, l, ox + x, oy + y, c[0], c[1], c[2]);
    }
  }
}

function disc(p: Px, l: number, r: number, inner: number, outer: number) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d <= r) {
        const v = d > r - 1 ? outer : inner;
        set(p, l, x, y, v, v, v);
      }
    }
}

function hash(a: number, b: number) {
  let h = Math.imul(a * 73856093 ^ b * 19349663, 0x9e3779b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function paintParticleSheet(): Uint8Array {
  const p = new Uint8Array(SPRITE_LAYERS * 256 * 4);
  for (let k = 0; k < 8; k++) disc(p, SPRITE.generic + k, 0.8 + k * 0.85, 255, 200);

  rows(p, SPRITE.flame, [
    "   y   ",
    "  yy   ",
    "  yoy  ",
    " yoyy  ",
    " yowoy ",
    "yoowwoy",
    "yowwwoy",
    "yowwwoy",
    " yowoy ",
    "  yoy  ",
  ], { y: [255, 190, 50], o: [255, 120, 20], w: [255, 245, 200] });

  rows(p, SPRITE.heart, [
    " kk kk ",
    "krrkrrk",
    "krwrrrk",
    "krrrrrk",
    " krrrk ",
    "  krk  ",
    "   k   ",
  ], { k: [70, 10, 10], r: [230, 40, 40], w: [255, 200, 200] });

  rows(p, SPRITE.angry, [
    "kk   kk",
    "krk krk",
    " krkrk ",
    "  krk  ",
    " krkrk ",
    "krk krk",
    "kk   kk",
  ], { k: [40, 40, 40], r: [180, 30, 30] });

  rows(p, SPRITE.crit, [
    "   w   ",
    "   w   ",
    "w  w  w",
    " wwwww ",
    "  www  ",
    " w w w ",
    "w  w  w",
  ], { w: [255, 255, 255] });

  rows(p, SPRITE.note, [
    "  wwww",
    "  wwww",
    "  w  w",
    "  w  w",
    "  w  w",
    "www www",
    "www www",
  ], { w: [255, 255, 255] });

  rows(p, SPRITE.bubble, [
    " bbb ",
    "bw  b",
    "b   b",
    "b   b",
    " bbb ",
  ], { b: [200, 220, 255], w: [255, 255, 255] });

  for (let k = 0; k < 4; k++)
    for (let i = 0; i < 3 + k; i++) {
      const x = Math.floor(hash(k, i) * 9) + 3, y = Math.floor(hash(i, k + 7) * 9) + 3;
      set(p, SPRITE.splash + k, x, y, 120, 160, 255);
      set(p, SPRITE.splash + k, x, y + 1, 70, 110, 230);
    }

  rows(p, SPRITE.dripHang, ["ww", "ww", " w"], { w: [255, 255, 255] });
  rows(p, SPRITE.dripFall, ["w", "w"], { w: [255, 255, 255] });
  rows(p, SPRITE.dripLand, ["w  w", " ww "], { w: [255, 255, 255] });

  for (let k = 0; k < 16; k++) {
    const l = SPRITE.explosion + k;
    const grow = 3 + k * 0.4, fade = k / 15;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let best = 99;
        for (let b = 0; b < 5; b++) {
          const cx = 7.5 + (hash(b, 3) - 0.5) * 8, cy = 7.5 + (hash(b, 5) - 0.5) * 8;
          best = Math.min(best, Math.hypot(x - cx, y - cy) - grow * (0.6 + hash(b, 9) * 0.6));
        }
        if (best < 0 && hash(x * 16 + y, k) > fade * 0.85) {
          const v = best > -1 ? 150 : 210 + Math.floor(hash(x, y) * 45);
          set(p, l, x, y, v, v, v);
        }
      }
  }

  for (let k = 0; k < 12; k++) {
    const l = SPRITE.gust + k;
    const rad = 2.5 + k * 0.45, rot = k * 0.5;
    for (let s = 0; s < 3; s++)
      for (let t = 0; t < 14; t++) {
        const a = rot + s * 2.094 + t * 0.12;
        const r = rad + t * 0.12;
        set(p, l, Math.round(7.5 + Math.cos(a) * r), Math.round(7.5 + Math.sin(a) * r), 255, 255, 255, k > 8 ? 160 : 255);
      }
  }

  rows(p, SPRITE.spark, [" w ", "www", " w "], { w: [255, 255, 255] });
  rows(p, SPRITE.pixel, ["ww", "ww"], { w: [255, 255, 255] });
  return p;
}

// Vanilla particle/ texture per sheet layer. Vanilla generic_0 is the largest, our generic layer 0 the smallest.
export const PARTICLE_PATHS: [number, string][] = [
  ...Array.from({ length: 8 }, (_, k) => [SPRITE.generic + k, `particle/generic_${7 - k}`] as [number, string]),
  [SPRITE.flame, "particle/flame"],
  [SPRITE.heart, "particle/heart"],
  [SPRITE.angry, "particle/angry"],
  [SPRITE.crit, "particle/critical_hit"],
  [SPRITE.note, "particle/note"],
  [SPRITE.bubble, "particle/bubble"],
  ...Array.from({ length: 4 }, (_, k) => [SPRITE.splash + k, `particle/splash_${k}`] as [number, string]),
  [SPRITE.dripHang, "particle/drip_hang"],
  [SPRITE.dripFall, "particle/drip_fall"],
  [SPRITE.dripLand, "particle/drip_land"],
  ...Array.from({ length: 16 }, (_, k) => [SPRITE.explosion + k, `particle/explosion_${k}`] as [number, string]),
  ...Array.from({ length: 12 }, (_, k) => [SPRITE.gust + k, `particle/gust_${k}`] as [number, string]),
  [SPRITE.spark, "particle/spark_0"],
];
