import { register } from "node:module";
register("./ts-loader.mjs", import.meta.url);
const THREE = await import("three");
const mod: any = await import("../../src/app/player-model.ts");
const look: any = { toon: () => new THREE.MeshBasicMaterial({ vertexColors: true }) };
const sc = new THREE.Scene();
const m = mod.createHeroModel(look); sc.add(m.group);
const a = mod.newAnimIn();
const cases: any[] = [{}, { speed: 6 }, { speed: 9, sprint: true, lean: 1 }, { mode: "climb", climbY: 1 }, { mode: "glide", glideMode: 2 }, { mode: "glide", glideMode: 1 },
  { mode: "ride", rideT: 0.5, speed: 8 }, { action: "attack3", actionT: 0.1, armed: true }, { action: "aim", draw: 1, hasBow: true }, { skid: 0.3, speed: 4 },
  { vault: 0.5, mode: "air" }, { pinAim: true, lanternLean: { x: 0.6, y: 0.8 } }, { mode: "swim", swimMove: 1 }, { mode: "dead" }, { action: "dodge", actionT: 0.2 }];
let bad = 0;
for (const c of cases) {
  Object.assign(a, mod.newAnimIn(), c);
  for (let i = 0; i < 90; i++) { a.time += 1 / 60; m.update(a, 1 / 60); }
  sc.updateMatrixWorld(true);
  m.group.traverse((o: any) => {
    if (o.isMesh) for (const k of ["position", "color"]) { if (!o.geometry.attributes[k]) continue; const arr = o.geometry.attributes[k].array; for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad++; break; } }
    if (o.isBone) for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) { bad++; break; }
  });
}
console.log("non-finite:", bad);
