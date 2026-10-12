// Game-wide End state. The "end" system saves and loads it. Entity code reads it, so it holds no imports.

export interface Gateway {
  x: number;
  y: number;
  z: number;
  exit?: { x: number; y: number; z: number }; // the linked outer gateway, set on first use
}

export const END_STATE = {
  dragonKilled: false,
  kills: 0,
  creditsSeen: false,
  gateways: [] as Gateway[], // main-island gateways in spawn order
  outer: [] as Gateway[], // outer-island return gateways, exit points back to the main island
  order: [] as number[], // shuffled ring slots 0..19
};

export const EXIT_Y = 62; // bedrock base of the exit portal, matches worldgen/end.ts
export const GATEWAY_Y = 75;
export const GATEWAY_RADIUS = 96;

export function gatewaySlot(i: number): { x: number; z: number } {
  const a = 2 * (-Math.PI + 0.15707963 * i);
  return { x: Math.floor(GATEWAY_RADIUS * Math.cos(a)), z: Math.floor(GATEWAY_RADIUS * Math.sin(a)) };
}

export function resetEndState(): void {
  END_STATE.dragonKilled = false;
  END_STATE.kills = 0;
  END_STATE.creditsSeen = false;
  END_STATE.gateways = [];
  END_STATE.outer = [];
  END_STATE.order = [];
}
