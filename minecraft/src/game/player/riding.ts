import type { Entity, GameCtx, PlayerApi } from "../contracts";
import { mobDef } from "../entities/registry";
import { playerSeat, type RideInput } from "../entities/riding";
import type { InputApi } from "./input";
import { bodyBox, noCollision } from "./physics";
import { EYE_STAND, HEIGHT_STAND } from "./stats";
import type { PlayerState } from "./state";

const JUMPERS = new Set(["horse", "donkey", "mule", "skeleton_horse", "zombie_horse", "camel"]);
const box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const BOATS = new Set(["boat", "chest_boat"]);
const LOOK_LIMIT = (105 * Math.PI) / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function canJumpMount(type: string) {
  return JUMPERS.has(type);
}

// Vanilla 1.21 canInteractWithEntity(e, 4): an entity screen stays open while the entity lives and its box is
// within the entity interaction range (3, creative 5) plus 4 of the eyes.
export function entityScreenValid(p: PlayerApi, e: Entity | undefined) {
  if (!e || e.dead || e.data._remove) return false;
  const b = e.body, hw = b.width / 2;
  const x = p.body.pos.x, y = p.body.pos.y + EYE_STAND, z = p.body.pos.z;
  const dx = Math.max(b.pos.x - hw - x, 0, x - b.pos.x - hw);
  const dy = Math.max(b.pos.y - y, 0, y - b.pos.y - b.height);
  const dz = Math.max(b.pos.z - hw - z, 0, z - b.pos.z - hw);
  const r = (p.gameMode === "creative" ? 5 : 3) + 4;
  return dx * dx + dy * dy + dz * dz < r * r;
}

export function createRiding() {
  let chargeTicks = 0;
  let charge = 0;
  let sneakWas = true;
  let followYaw = NaN;

  function seatOf(v: Entity) {
    return mobDef(v.type)?.seat ?? 0;
  }

  function dismount(p: PlayerState, ctx: GameCtx, v: Entity | undefined) {
    p.vehicle = null;
    chargeTicks = 0;
    charge = 0;
    if (!v) return;
    v.data._ctl = undefined;
    const b = p.body;
    b.height = HEIGHT_STAND;
    const r = v.body.width / 2 + b.width / 2 + 0.05;
    for (const dy of [0, 1]) {
      for (const [sx, sz] of SIDES) {
        const len = Math.hypot(sx, sz);
        b.pos.set(v.body.pos.x + (sx / len) * r, Math.floor(v.body.pos.y) + dy, v.body.pos.z + (sz / len) * r);
        if (noCollision(ctx.world, bodyBox(b, box))) {
          p.teleport(b.pos.x, b.pos.y, b.pos.z);
          return;
        }
      }
    }
    p.teleport(v.body.pos.x, v.body.pos.y + v.body.height, v.body.pos.z);
  }

  return {
    jumpBar(p: PlayerState, ctx: GameCtx): number | undefined {
      const v = p.vehicle != null ? ctx.entities.get(p.vehicle) : undefined;
      return v && JUMPERS.has(v.type) ? charge : undefined;
    },
    mountHealth(p: PlayerState, ctx: GameCtx): number | undefined {
      const v = p.vehicle != null ? ctx.entities.get(p.vehicle) : undefined;
      return v && mobDef(v.type)?.category !== "misc" ? v.health : undefined;
    },
    // Vanilla Boat.positionRider: the view turns with the boat and stays within 105 degrees of its yaw.
    frame(p: PlayerState, ctx: GameCtx, pt: number) {
      const v = p.vehicle != null ? ctx.entities.get(p.vehicle) : undefined;
      if (!v || !BOATS.has(v.type)) {
        followYaw = NaN;
        return;
      }
      const prev = (v.data._pyaw as number) ?? v.yaw;
      const vy = prev + wrap(v.yaw - prev) * pt;
      if (!Number.isNaN(followYaw)) p.yaw += wrap(vy - followYaw);
      followYaw = vy;
      const d = wrap(p.yaw - vy);
      p.yaw += Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, d)) - d;
    },
    tick(p: PlayerState, ctx: GameCtx, input: InputApi): boolean {
      if (p.vehicle == null) {
        sneakWas = input.sneak;
        return false;
      }
      const v = ctx.entities.get(p.vehicle);
      const on = input.enabled && !p.dead;
      const sneakDown = on && input.sneak && !sneakWas;
      sneakWas = on && input.sneak;
      if (!v || v.dead || p.dead || p.gameMode === "spectator" || sneakDown) {
        dismount(p, ctx, v);
        return false;
      }
      let jumpCharge = 0;
      // Vanilla LocalPlayer.aiStep: no jump charge while the camel's dash cools down.
      if (JUMPERS.has(v.type) && ((v.data.dashCd as number) ?? 0) > 0) {
        chargeTicks = 0;
        charge = 0;
      } else if (JUMPERS.has(v.type)) {
        if (on && input.jump) {
          chargeTicks++;
          charge = chargeTicks < 10 ? chargeTicks * 0.1 : 0.8 + (2 / (chargeTicks - 9)) * 0.1;
        } else if (chargeTicks > 0) {
          jumpCharge = charge >= 0.9 ? 1 : 0.4 + (0.4 * charge) / 0.9;
          chargeTicks = 0;
          charge = 0;
        }
      }
      const ctl: RideInput = (v.data._ctl as RideInput | undefined) ?? { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0, pitch: 0, jumpCharge: 0 };
      ctl.forward = on ? input.forward : 0;
      ctl.strafe = on ? input.strafe : 0;
      ctl.jump = on && input.jump;
      ctl.sneak = false;
      ctl.sprint = on && input.sprint;
      ctl.yaw = p.yaw;
      ctl.pitch = p.pitch;
      ctl.jumpCharge = jumpCharge;
      v.data._ctl = ctl;
      const [seat, fwd] = playerSeat(ctx, v, seatOf(v));
      const fx = -Math.sin(v.yaw) * fwd, fz = -Math.cos(v.yaw) * fwd;
      const b = p.body;
      b.height = HEIGHT_STAND;
      p.eyeHeight = EYE_STAND;
      p.sneaking = false;
      p.sprinting = false;
      p.flying = false;
      p.prevPos.set(((v.data._px as number) ?? v.body.pos.x) + fx, ((v.data._py as number) ?? v.body.pos.y) + seat, ((v.data._pz as number) ?? v.body.pos.z) + fz);
      b.pos.set(v.body.pos.x + fx, v.body.pos.y + seat, v.body.pos.z + fz);
      b.vel.set(0, 0, 0);
      b.fallDistance = 0;
      b.onGround = v.body.onGround;
      b.inWater = v.body.inWater;
      let d = v.yaw - p.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.bodyYaw += d;
      return true;
    },
  };
}
