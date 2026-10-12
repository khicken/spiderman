import type { WorldApi } from "../../contracts";
import { AIR, stateOf } from "../../contracts";
import { blockByName } from "../../blocks/registry";
import { EXIT_Y } from "./state";

const st = (name: string) => {
  const d = blockByName(name);
  return d ? stateOf(d.id) : AIR;
};

export function exitPortalLit(w: WorldApi): boolean {
  const portal = blockByName("end_portal")?.id;
  return portal !== undefined && (w.getBlock(2, EXIT_Y + 1, 0) & 0xfff) === portal;
}

// Vanilla exit portal: bedrock bowl, a 4-high bedrock pillar, portal ring when lit, egg on top.
export function buildExitPortal(w: WorldApi, lit: boolean, egg: boolean): void {
  const bed = st("bedrock");
  const portal = lit ? st("end_portal") : AIR;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d = dx * dx + dz * dz;
      if (d > 12.5) continue;
      w.setBlock(dx, EXIT_Y, dz, bed, 0);
      if (dx === 0 && dz === 0) continue;
      w.setBlock(dx, EXIT_Y + 1, dz, d > 6.25 ? bed : portal, 0);
    }
  }
  for (let y = EXIT_Y + 1; y <= EXIT_Y + 4; y++) w.setBlock(0, y, 0, bed, 0);
  if (egg) w.setBlock(0, EXIT_Y + 5, 0, st("dragon_egg"), 1);
}

// Vanilla EndGatewayFeature: gateway in the middle, bedrock plus shapes above and below, bedrock caps 2 away.
export function buildGateway(w: WorldApi, x: number, y: number, z: number): void {
  const bed = st("bedrock");
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = dx === 0, cz = dz === 0, far = Math.abs(dy) === 2;
        let s = AIR;
        if (cx && cz && dy === 0) s = st("end_gateway");
        else if (dy === 0) s = AIR;
        else if (far && cx && cz) s = bed;
        else if ((cx || cz) && !far) s = bed;
        w.setBlock(x + dx, y + dy, z + dz, s, 0);
      }
    }
  }
}
