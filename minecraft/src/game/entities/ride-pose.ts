import type * as THREE from "three";

// Vanilla HumanoidModel and IllagerModel riding pose: thighs raised, knees apart, arms forward.
export function ridingPose(p: Record<string, THREE.Object3D>) {
  const rl = p.right_leg, ll = p.left_leg, ra = p.right_arm, la = p.left_arm;
  if (!rl || !ll || !ra || !la) return;
  ra.rotation.x += Math.PI / 5;
  la.rotation.x += Math.PI / 5;
  rl.rotation.set(1.4137167, -Math.PI / 10, 0.07853982, "ZYX");
  ll.rotation.set(1.4137167, Math.PI / 10, -0.07853982, "ZYX");
}
