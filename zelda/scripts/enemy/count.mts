import { register } from "node:module";
register("../hero/ts-loader.mjs", import.meta.url);
const THREE = await import("three");
const models: any = await import("../../src/app/enemy-models.ts");
const { Rig } = await import("../../src/app/enemy-rig.ts");
const look: any = { toon: (o: any) => new THREE.MeshLambertMaterial({ color: o.color, emissive: o.emissive ?? 0, side: o.side ?? THREE.FrontSide, vertexColors: !!o.vertexColors }) };
const shellMat = new THREE.MeshBasicMaterial();
function stats(group: any, scene: any) {
  scene.updateMatrixWorld(true);
  let calls = 0, tris = 0;
  group.traverseVisible((o: any) => {
    if (!o.isMesh) return;
    const n = o.isInstancedMesh ? o.count : 1;
    if (n === 0) return;
    calls++;
    const g = o.geometry;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * n;
  });
  return { calls, tris: Math.round(tris) };
}
for (const kind of ["brambling", "mossback", "wisp"]) {
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  const rig = new Rig(models[kind](look), 20, group, shellMat);
  const pose = new Float32Array(rig.parts * 16);
  for (let i = 0; i < rig.parts; i++) new THREE.Matrix4().toArray(pose, i * 16);
  const run = (glow: number, outline: boolean) => {
    (rig as any).setOutline?.(outline);
    rig.begin(); rig.draw(pose, 0, 0, 0, 0, 1, glow, glow, glow); rig.end();
    return stats(group, scene);
  };
  const a = run(0, false), b = run(1, false), c = run(0, true);
  console.log(kind.padEnd(10), "idle", JSON.stringify(a), "glowing", JSON.stringify(b), "outline", JSON.stringify(c));
  // 10 enemies cost the same calls
  rig.begin(); for (let i = 0; i < 10; i++) rig.draw(pose, i, 0, 0, 0, 1, 0, 0, 0); rig.end();
  console.log("".padEnd(10), "x10 enemies calls", stats(group, scene).calls);
}
