import * as THREE from "three";

const OUT = 0.3;
const HOLD = 0.12;
const IN = 0.45;

// Full-screen black fade drawn as the last thing in the scene.
export function createFade(scene: THREE.Scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform float uA; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uA); }",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.visible = false;
  scene.add(mesh);
  let t = -1;
  let action: (() => void) | null = null;

  return {
    mesh,
    get busy() {
      return t >= 0;
    },
    run(fn: () => void) {
      if (t >= 0) return false;
      t = 0;
      action = fn;
      return true;
    },
    update(dt: number) {
      if (t < 0) return;
      t += dt;
      if (action && t >= OUT) {
        const a = action;
        action = null;
        a();
      }
      const a = t < OUT ? t / OUT : t < OUT + HOLD ? 1 : 1 - (t - OUT - HOLD) / IN;
      mat.uniforms.uA.value = THREE.MathUtils.clamp(a, 0, 1);
      mesh.visible = a > 0;
      if (t >= OUT + HOLD + IN) {
        t = -1;
        mesh.visible = false;
      }
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

export type Fade = ReturnType<typeof createFade>;
