import type { SystemPart } from "..";

export function createBrewing(): SystemPart {
  let t = 0;
  return {
    name: "brewing",
    frame(ctx, dt) {
      t += dt;
      const fx = ctx.player.effects;
      let far = 0;
      const blind = fx.find((e) => e.id === "blindness");
      if (blind) far = blind.ticks < 20 ? 5 + (1 - blind.ticks / 20) * 60 : 5;
      else if (fx.some((e) => e.id === "darkness")) far = 14 + 18 * Math.abs(Math.sin(t * 0.9));
      ctx.renderer.setVisionFog?.(far);
    },
  };
}
