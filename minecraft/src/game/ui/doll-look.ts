const D = Math.PI / 180;

export interface DollLook {
  bodyYaw: number; // game yaw: the doll camera sits on +z, so -pi faces the viewer
  headYaw: number;
  pitch: number; // game pitch is positive up, the opposite of vanilla XRot
  tilt: number;
}

// Vanilla InventoryScreen.renderEntityInInventoryFollowsMouse; box center and mouse in GUI px.
export function dollLook(cx: number, cy: number, mx: number, my: number): DollLook {
  const h = Math.atan((cx - mx) / 40);
  const i = Math.atan((cy - my) / 40);
  const bodyYaw = -h * 20 * D - Math.PI;
  return { bodyYaw, headYaw: bodyYaw - h * 20 * D, pitch: i * 20 * D, tilt: -i * 20 * D };
}
