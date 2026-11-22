import * as THREE from "three";
import type { EnemyState, PlayerState, World } from "./contracts";

// Cheap contact shadows for presets without a shadow map: one instanced soft disc per character, laid on the terrain.
const MAX = 24;
const N = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion();
const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const S = new THREE.Vector3();

const SIZE: Record<string, number> = { brambling: 0.9, mossback: 1.6, wisp: 0.6, warden: 4.5 };

export interface BlobShadows {
  update(world: World, player: PlayerState, enemies: readonly EnemyState[], on: boolean): void;
  dispose(): void;
}

export function createBlobShadows(scene: THREE.Scene): BlobShadows {
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  geo.setAttribute("aAlpha", alpha);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute float aAlpha; varying vec2 vUv; varying float vA;
      void main() { vUv = uv * 2.0 - 1.0; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; varying float vA;
      void main() { float r = length(vUv); float a = smoothstep(1.0, 0.25, r) * vA; if (a < 0.01) discard; gl_FragColor = vec4(0.08, 0.07, 0.1, a * 0.42); }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = "blob-shadows";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.userData.hmNoShadow = true;
  mesh.count = 0;
  scene.add(mesh);

  const put = (world: World, i: number, x: number, y: number, z: number, size: number) => {
    const g = world.heightAt(x, z);
    const h = y - g;
    if (h > 12 || h < -1.5) return i;
    world.normalAt(x, z, N);
    Q.setFromUnitVectors(UP, N);
    const k = size * (1 + Math.max(h, 0) * 0.04);
    P.set(x, g + 0.05, z);
    S.set(k, 1, k);
    M.compose(P, Q, S);
    mesh.setMatrixAt(i, M);
    alpha.setX(i, Math.max(0, 1 - Math.max(h, 0) / 12));
    return i + 1;
  };

  return {
    update(world, player, enemies, on) {
      mesh.visible = on;
      if (!on) return;
      let i = 0;
      const p = player.pos;
      if (player.mode !== "swim") i = put(world, i, p.x, p.y, p.z, 0.55);
      for (let k = 0; k < enemies.length && i < MAX; k++) {
        const e = enemies[k];
        if (!e.alive || !e.lockable) continue;
        const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
        if (dx * dx + dz * dz > 70 * 70) continue;
        const y = e.kind === "wisp" ? e.pos.y - 1.2 : e.pos.y;
        i = put(world, i, e.pos.x, y, e.pos.z, SIZE[e.kind] ?? 1);
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      alpha.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
