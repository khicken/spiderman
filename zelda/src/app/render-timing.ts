import type * as THREE from "three";
import type { GpuTiming } from "./contracts";

// WebGL2 allows one TIME_ELAPSED query at a time, so a frame is cut into consecutive segments: switch(label) ends the
// running query and starts the next. Meshes switch the label from onBeforeRender, because three interleaves draws.

interface Seg { q: WebGLQuery; label: string }
interface Frame { segs: Seg[] }

const WINDOW = 60;

export interface RenderTiming {
  readonly supported: boolean;
  enabled: boolean;
  beginFrame(): void;
  switch(label: string): void;
  endFrame(): void;
  /** Label meshes once per second: userData.hmPass wins, else the caller's classify(). */
  tagScene(scene: THREE.Scene, classify: (o: THREE.Mesh) => string): void;
  stats(): GpuTiming;
  /** 95th percentile of the frame total over the window, ms. */
  p95(): number;
  dispose(): void;
}

export function createRenderTiming(renderer: THREE.WebGLRenderer): RenderTiming {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext
    ? gl.getExtension("EXT_disjoint_timer_query_webgl2")
    : null) as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const free: WebGLQuery[] = [];
  const pending: Frame[] = [];
  let cur: Frame | null = null;
  let active: Seg | null = null;
  const ring: Map<string, number>[] = [];
  const out: GpuTiming = { supported: !!ext, total: 0, passes: {} };
  let dirty = true;

  const take = (): WebGLQuery => free.pop() ?? (gl.createQuery() as WebGLQuery);

  const stop = () => {
    if (!active || !ext) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    active = null;
  };

  const poll = () => {
    if (!ext) return;
    while (pending.length) {
      const f = pending[0];
      const last = f.segs[f.segs.length - 1];
      if (last && !gl.getQueryParameter(last.q, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const m = new Map<string, number>();
      for (const s of f.segs) {
        if (!disjoint) {
          const ns = gl.getQueryParameter(s.q, gl.QUERY_RESULT) as number;
          m.set(s.label, (m.get(s.label) ?? 0) + ns / 1e6);
        }
        free.push(s.q);
      }
      if (!disjoint) {
        ring.push(m);
        if (ring.length > WINDOW) ring.shift();
        dirty = true;
      }
    }
  };

  const api: RenderTiming = {
    supported: !!ext,
    enabled: false,
    beginFrame() {
      if (!ext || !api.enabled) return;
      poll();
      cur = { segs: [] };
    },
    switch(label) {
      if (!ext || !cur) return;
      if (active && active.label === label) return;
      stop();
      const s = { q: take(), label };
      gl.beginQuery(ext.TIME_ELAPSED_EXT, s.q);
      active = s;
      cur.segs.push(s);
    },
    endFrame() {
      if (!ext || !cur) return;
      stop();
      if (cur.segs.length) pending.push(cur);
      while (pending.length > 64) for (const s of (pending.shift() as Frame).segs) free.push(s.q);
      cur = null;
    },
    tagScene(scene, classify) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!(mesh as { isMesh?: boolean }).isMesh && !(o as { isPoints?: boolean }).isPoints && !(o as { isLine?: boolean }).isLine) return;
        const label = (o.userData.hmPass as string | undefined) ?? classify(mesh);
        if (o.userData.hmTimingLabel === label) return;
        const prev = o.userData.hmTimingPrev as THREE.Object3D["onBeforeRender"] | undefined;
        const base = prev ?? o.onBeforeRender;
        o.userData.hmTimingPrev = base;
        o.userData.hmTimingLabel = label;
        o.onBeforeRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D["onBeforeRender"]>) {
          api.switch(label);
          base.apply(this, args);
        };
      });
    },
    stats() {
      if (!ext) return out;
      if (dirty) {
        dirty = false;
        const sum: Record<string, number> = {};
        for (const m of ring) for (const [k, v] of m) sum[k] = (sum[k] ?? 0) + v;
        let total = 0;
        const n = Math.max(1, ring.length);
        for (const k of Object.keys(sum)) {
          sum[k] /= n;
          total += sum[k];
        }
        out.passes = sum;
        out.total = total;
      }
      return out;
    },
    p95() {
      if (!ring.length) return 0;
      const t = ring.map((m) => { let s = 0; for (const v of m.values()) s += v; return s; }).sort((a, b) => a - b);
      return t[Math.min(t.length - 1, Math.floor(t.length * 0.95))];
    },
    dispose() {
      stop();
      for (const f of pending) for (const s of f.segs) free.push(s.q);
      pending.length = 0;
      for (const q of free) gl.deleteQuery(q);
      free.length = 0;
    },
  };
  return api;
}
