import * as THREE from "three";
import { LAYER } from "./render-shared";

const BUCKETS = 8;

function normalMat(gloss: number, side: THREE.Side) {
  const m = new THREE.MeshNormalMaterial({ side });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGloss = { value: gloss };
    sh.fragmentShader =
      "uniform float uGloss;\n" +
      sh.fragmentShader
        .replace("gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );", "gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, uGloss );")
        .replace("gl_FragColor.a = 1.0;", "");
  };
  return m;
}

function glossOf(m: THREE.Material) {
  const p = m as THREE.MeshPhysicalMaterial;
  let g = 0;
  if (p.clearcoat > 0) g = p.clearcoat * (1 - p.clearcoatRoughness) * 0.85;
  else if (p.isMeshStandardMaterial) g = (1 - p.roughness) * (1 - p.roughness) * (p.metalness > 0.5 ? 0.75 : 0.4);
  return g < 0.18 ? 0 : g;
}

// View-space normals plus a gloss estimate for SSR and AO. Swaps materials in place, then restores them.
export function createPrepass() {
  const mats: THREE.Material[][] = [[], [], []];
  for (let b = 0; b < BUCKETS; b++)
    for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide]) mats[side].push(normalMat(b / (BUCKETS - 1), side));
  const skip = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const objs: THREE.Object3D[] = [];
  const saved: (THREE.Material | THREE.Material[])[] = [];
  const hidden: THREE.Object3D[] = [];
  const arrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  const pick = (m: THREE.Material) => (m.transparent || !m.visible || !m.depthWrite ? skip : mats[m.side][Math.round(glossOf(m) * (BUCKETS - 1))]);
  const layers = new THREE.Layers();
  layers.set(0);

  const visit = (o: THREE.Object3D) => {
    if (!o.layers.test(layers)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const m = mesh.material;
      objs.push(mesh);
      saved.push(m);
      if (Array.isArray(m)) {
        let arr = arrays.get(m);
        if (!arr) arrays.set(m, (arr = m.slice()));
        for (let i = 0; i < m.length; i++) arr[i] = pick(m[i]);
        mesh.material = arr;
      } else mesh.material = pick(m);
    } else if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
      o.visible = false;
      hidden.push(o);
    }
  };

  return {
    render(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget) {
      scene.traverseVisible(visit);
      const mask = camera.layers.mask;
      camera.layers.set(0);
      const env = scene.environment;
      const fog = scene.fog;
      scene.environment = null;
      scene.fog = null;
      r.setRenderTarget(target);
      r.setClearColor(0x8080ff, 0);
      r.clear();
      r.render(scene, camera);
      r.setClearColor(0x000000, 1);
      scene.environment = env;
      scene.fog = fog;
      camera.layers.mask = mask;
      for (let i = 0; i < objs.length; i++) (objs[i] as THREE.Mesh).material = saved[i];
      for (const o of hidden) o.visible = true;
      objs.length = saved.length = hidden.length = 0;
    },
    dispose() {
      for (const s of mats) for (const m of s) m.dispose();
      skip.dispose();
    },
  };
}

// Ultra only: a low resolution reflection probe around the focus, for car paint.
export function createProbe(renderer: THREE.WebGLRenderer) {
  const cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(2.6, 1500, cube);
  cam.layers.set(0);
  cam.layers.enable(LAYER.sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let pm: THREE.WebGLRenderTarget | null = null;
  return {
    get texture() {
      return pm?.texture ?? null;
    },
    update(scene: THREE.Scene, at: THREE.Vector3) {
      cam.position.copy(at);
      cam.position.y += 1.3;
      cam.update(renderer, scene);
      pm = pmrem.fromCubemap(cube.texture, pm);
    },
    dispose() {
      cube.dispose();
      pm?.dispose();
      pmrem.dispose();
    },
  };
}
