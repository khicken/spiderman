import { register } from "node:module";
register("./ts-loader.mjs", import.meta.url);
const THREE = await import("three");
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {} }) }) };
const mod: any = await import(process.env.MODEL!);
const look: any = { toon: (o: any) => new THREE.MeshBasicMaterial({ color: o.color, side: o.side ?? THREE.FrontSide, vertexColors: !!o.vertexColors }) };
const scene = new THREE.Scene();
const m = (mod.createHeroModel ?? mod.createWrenModel)(look);
scene.add(m.group);
const a = mod.newAnimIn();
const modes: [string, any][] = [["idle", {}], ["run", { speed: 6 }], ["glide", { mode: "glide" }], ["attack", { action: "attack1", armed: true, actionT: 0.1 }], ["aim", { action: "aim", hasBow: true, draw: 0.5 }]];
for (const [name, o] of modes) {
  Object.assign(a, mod.newAnimIn(), o);
  for (let i = 0; i < 40; i++) { a.time += 1 / 60; m.update(a, 1 / 60); }
  scene.updateMatrixWorld(true);
  let calls = 0, tris = 0, shadowCalls = 0;
  scene.traverseVisible((o: any) => {
    if (!(o.isMesh || o.isLine || o.isSprite || o.isPoints)) return;
    const g = o.geometry; const mats = Array.isArray(o.material) ? o.material.length : 1;
    calls += o.isMesh || o.isSprite ? mats : 1;
    if (o.castShadow) shadowCalls++;
    tris += o.isSprite ? 2 : o.isLine ? 0 : (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  console.log(name.padEnd(7), "calls", calls, "shadowCasters", shadowCalls, "tris", Math.round(tris));
}
m.setOutline?.(true);
Object.assign(a, mod.newAnimIn());
m.update(a, 1 / 60);
let c2 = 0; scene.traverseVisible((o: any) => { if (o.isMesh || o.isLine || o.isSprite) c2++; });
console.log("with outline calls", c2);
