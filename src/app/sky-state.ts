import * as THREE from "three";

// Shared by reference across materials, so the clock moves them with no recompiles.
export const SKY = {
  night: { value: 0.3 },
  reflHi: { value: new THREE.Color(0.22, 0.36, 0.55) },
  reflLo: { value: new THREE.Color(0.85, 0.55, 0.45) },
  glow: new THREE.Color(1, 1, 1),
  headlight: new THREE.Color(1, 1, 1),
  steam: new THREE.Color(1, 1, 1),
};
