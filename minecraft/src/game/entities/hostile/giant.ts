import type { MobDef } from "../../contracts";
import { applyPhysics } from "../ai";
import { ZOMBIES } from "./zombie";

const ZOMBIE = ZOMBIES.find((d) => d.type === "zombie")!;
const SCALE = 6;

// Vanilla Giant registers no AI goals, so it only stands and takes physics. It never spawns naturally.
export const GIANT_DEF: MobDef = {
  type: "giant",
  displayName: "Giant",
  category: "hostile",
  width: 3.6,
  height: 12,
  maxHealth: 100,
  speed: 0.5,
  attackDamage: 50,
  xp: [5, 5],
  drops: ZOMBIE.drops,
  sounds: ZOMBIE.sounds,
  createModel() {
    const m = ZOMBIE.createModel();
    const animate = m.animate;
    m.root.scale.multiplyScalar(SCALE);
    // The zombie model resets its root scale every frame.
    m.animate = (e, pt, walk, phase) => {
      animate(e, pt, walk, phase);
      m.root.scale.multiplyScalar(SCALE);
    };
    return m;
  },
  tick: applyPhysics,
  onDeath: ZOMBIE.onDeath,
};
