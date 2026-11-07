import * as THREE from "three";

// Procedural arena reflection probe. A tiny stand-in scene (dark bowl, bright ceiling light banks, LED ribbons,
// glowing center-hung board, warm hardwood) is rendered once into a PMREM cube. Players, ball, glass and the floor
// clearcoat read it through scene.environment. No asset files.

export interface EnvProbe {
  readonly texture: THREE.Texture;
  dispose(): void;
}

export function createEnvProbe(renderer: THREE.WebGLRenderer): EnvProbe {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const basic = (c: THREE.ColorRepresentation, k = 1, side: THREE.Side = THREE.FrontSide) => {
    const m = new THREE.MeshBasicMaterial({ color: c, side });
    m.color.multiplyScalar(k);
    mats.push(m);
    return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0) => {
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    scene.add(mesh);
    return mesh;
  };

  add(new THREE.BoxGeometry(120, 44, 90), basic("#0b0d14", 1, THREE.BackSide), 0, 20, 0);
  const bowl = new THREE.CylinderGeometry(42, 30, 14, 48, 1, true);
  add(bowl, basic("#241c1a", 1, THREE.BackSide), 0, 7, 0);
  add(new THREE.PlaneGeometry(90, 70), basic("#120d0a", 1), 0, 0.01, 0, -Math.PI / 2);
  const floorMat = basic("#b07a46", 0.9);
  add(new THREE.PlaneGeometry(32, 18), floorMat, 0, 0.02, 0, -Math.PI / 2);
  const bank = new THREE.PlaneGeometry(3.2, 1.4);
  const bankMat = basic("#fff3e2", 26);
  for (let i = -3; i <= 3; i++)
    for (const z of [-6, 6]) add(bank, bankMat, i * 4.6, 26, z, Math.PI / 2);
  const ringMat = basic("#ffe9cf", 9);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    add(bank, ringMat, Math.cos(a) * 22, 24, Math.sin(a) * 15, Math.PI / 2 + 0.5 * Math.sin(a), 0);
  }
  const board = new THREE.BoxGeometry(7, 4, 5);
  add(board, basic("#3a6c9a", 2.2), 0, 18, 0);
  const ribbon = new THREE.CylinderGeometry(24.5, 24.5, 0.9, 64, 1, true);
  const accentMat = basic("#46d2ff", 2.6, THREE.BackSide);
  add(ribbon, accentMat, 0, 9.5, 0);
  const suites = new THREE.CylinderGeometry(33, 33, 1.2, 64, 1, true);
  add(suites, basic("#ffb070", 1.4, THREE.BackSide), 0, 14, 0);
  const courtLed = new THREE.PlaneGeometry(30, 0.9);
  const ledMat = basic("#ff6a2a", 2.2);
  add(courtLed, ledMat, 0, 0.5, 9.5, 0, Math.PI);
  add(courtLed, ledMat, 0, 0.5, -10.5);

  // Built once: players capture render.envMap at startup, so the texture identity must never change.
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 200, { size: 256, position: new THREE.Vector3(0, 2, 0) });
  return {
    texture: rt.texture,
    dispose() {
      rt.dispose();
      pmrem.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
