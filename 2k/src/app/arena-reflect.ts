import * as THREE from "three";

// Planar mirror of the scene about the floor plane (y = 0) into a mipmapped half-float target. The floor shader
// samples it with textureLod by roughness (blurry lacquer), distorted by plank grain. Oblique near-plane clipping
// keeps anything below the floor out of the mirror.

export interface FloorReflection {
  readonly texture: THREE.Texture;
  readonly matrix: THREE.Matrix4; // world -> reflection texture (projective)
  enabled: boolean;
  scale: number;
  /** Run inside render.onBeforeRender. `hide` is hidden during the pass (the floor itself). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D): void;
  dispose(): void;
}

export function createFloorReflection(): FloorReflection {
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
  });
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(0);
  const matrix = new THREE.Matrix4();
  const size = new THREE.Vector2();
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const UP = new THREE.Vector3(0, 1, 0);
  const ORIGIN = new THREE.Vector3();
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  let frames = 0;
  const self: FloorReflection = {
    texture: rt.texture,
    matrix,
    enabled: true,
    scale: 0.5,
    render(renderer, scene, camera, hide) {
      // first frames: the shadow map does not exist yet and autoUpdate is off in this pass
      if (!self.enabled || frames++ < 2) return;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(16, Math.floor(size.x * self.scale));
      const h = Math.max(16, Math.floor(size.y * self.scale));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

      camera.updateMatrixWorld();
      camPos.setFromMatrixPosition(camera.matrixWorld);
      if (camPos.y <= 0.01) return;
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      cam.position.set(camPos.x, -camPos.y, camPos.z);
      cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(UP);
      look.y = -look.y;
      cam.lookAt(look);
      cam.far = camera.far;
      cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);

      matrix.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

      plane.setFromNormalAndCoplanarPoint(UP, ORIGIN).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = cam.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1 - 0.003;
      pm[14] = clip.w;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

      const prevTarget = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      hide.visible = false;
      renderer.setRenderTarget(rt);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, cam);
      hide.visible = true;
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.setRenderTarget(prevTarget);
    },
    dispose() {
      rt.dispose();
    },
  };
  return self;
}
