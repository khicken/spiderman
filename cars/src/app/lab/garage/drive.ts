import * as THREE from "three";
import type { CarId, MapId, Quality } from "../../contracts";
import { CARS } from "../../cars";
import { MAPS } from "../../maps";
import { createCarModel } from "../../car-model";
import { createRender } from "../../render";
import { createTrack } from "../../track";
import { createTrackMesh } from "../../track-mesh";
import { createVehicle } from "../../vehicle";
import { createDriver } from "../../ai";
import { createCameraRig } from "../../camera";

// Lab only: the car model on a real map, driven by the AI, seen through the game renderer.
export async function startDrive(canvas: HTMLCanvasElement, id: CarId, mapId: MapId, quality: Quality, hour: number) {
  const map = await MAPS.find((m) => m.id === mapId)!.load();
  const r = createRender(canvas);
  r.setQuality(quality);
  r.setEnv({ hour, weather: "clear", season: map.env.season, lat: map.origin[0] });
  const track = createTrack(map);
  const tm = createTrackMesh(track, quality);
  r.scene.add(tm.group);
  const cars = [id, id === "gt3" ? "hyper" : "gt3"].map((cid, i) => {
    const spec = CARS.find((c) => c.id === cid)!;
    const v = createVehicle(spec, track, i);
    const slot = track.grid[i];
    v.place(slot.pos, slot.yaw, slot.s);
    const m = createCarModel(spec, spec.paints[0], quality, i === 0);
    r.scene.add(m.group);
    return { v, m, d: createDriver(track, v, 0.9) };
  });
  const rig = createCameraRig(r.camera, track);
  rig.cut();
  r.resize();
  let raf = 0, last = performance.now(), acc = 0;
  const others = cars.map((c) => c.v.state);
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= 1 / 120) {
      for (const c of cars) c.v.step(1 / 120, c.d.drive(1 / 120, others));
      acc -= 1 / 120;
    }
    const lights = r.night > 0.5;
    for (const c of cars) {
      c.m.sync(c.v.state, dt);
      c.m.setEnv(r.envMap);
      c.m.setLights(lights || c.v.state.tunnel);
    }
    const s = cars[0].v.state;
    rig.update(dt, s, cars[0].v.spec, { x: 0, y: 0 }, false);
    r.frame(dt, s.pos, s.speed);
    r.render();
  };
  loop();
  const api = { cars, r };
  (window as unknown as { __drive: unknown }).__drive = api;
  return () => {
    cancelAnimationFrame(raf);
    for (const c of cars) c.m.dispose();
    tm.dispose();
    r.dispose();
  };
}
