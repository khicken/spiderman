// Camera yaw/pitch (radians, "YXZ") of each captured face; the viewer places a plane with the same rotation.
export const PANORAMA_FACES: { yaw: number; pitch: number }[] = [
  { yaw: 0, pitch: 0 },
  { yaw: -Math.PI / 2, pitch: 0 },
  { yaw: Math.PI, pitch: 0 },
  { yaw: Math.PI / 2, pitch: 0 },
  { yaw: 0, pitch: Math.PI / 2 },
  { yaw: 0, pitch: -Math.PI / 2 },
];
