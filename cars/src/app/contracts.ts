import type * as THREE from "three";

// The interfaces between modules. Each module owner implements its part exactly.
// Units: meters, seconds, radians, kg, N, N·m. +y is up.
// World: +x is east, -z is north. Car local axes: +z forward, +y up, +x left.
// Wheel order everywhere: 0 front left, 1 front right, 2 rear left, 3 rear right.

export type Quality = "low" | "medium" | "high" | "ultra";
export type Surface = "asphalt" | "curb" | "grass" | "gravel" | "dirt" | "snow" | "cobble";
export type Weather = "clear" | "overcast" | "rain" | "fog" | "snow";
export type MapId = "monaco" | "nordschleife" | "tokyo" | "sanfrancisco" | "stelvio" | "spa";
export type CarId = "hyper" | "gt3" | "jdm" | "muscle" | "rally" | "v12" | "ev" | "classic";
export type Mode = "race" | "free" | "time"; // race: vs AI or friends, free: free drive, time: time attack vs own ghost

// ---- maps/<id>.ts, written by scripts/build-maps.mjs: export const MAP: MapData
// Local meters around `origin`: x = east, z = -north. Flat arrays keep the generated files small.
export type MapData = {
  id: MapId;
  name: string; // "Monaco"
  place: string; // "Monte Carlo"
  origin: readonly [number, number]; // lat, lon
  closed: boolean; // circuit: true, point to point: false
  laps: number; // default race laps, 1 for point to point
  center: readonly number[]; // centerline x,y,z triples, about 5 m apart, y is the road surface. Closed: last point does not repeat the first.
  width: readonly number[]; // full drivable width per centerline point
  runoff: readonly number[]; // per point: lateral distance from the road edge to the barrier, 0 = wall at the edge
  start: number; // centerline index of the start line, cars face increasing index
  tunnels: readonly (readonly [number, number])[]; // centerline index ranges with a roof
  elevated: readonly (readonly [number, number])[]; // index ranges on a bridge or a viaduct, no terrain under the road
  terrain: { x0: number; z0: number; step: number; nx: number; nz: number; h: readonly number[] }; // DEM grid, row major (z outer), h in m
  buildings: readonly number[]; // records: n, h, then n x,z pairs of the footprint (counterclockwise seen from above)
  roads: readonly number[]; // other streets for scenery: records: n, width, then n x,z pairs (y from terrain)
  water: readonly number[]; // records: n, then n x,z pairs, surface at y = waterY
  waterY: number;
  green: readonly number[]; // forest and park records: n, density 0..1, then n x,z pairs
  landmarks: readonly { name: string; x: number; z: number; kind: "tower" | "church" | "bridge" | "stadium" | "hotel" | "sign" | "monument" }[];
  env: { hour: number; weather: Weather; season: "summer" | "autumn" | "winter" };
  credit: string; // "© OpenStreetMap contributors"
};

export type MapInfo = { id: MapId; name: string; place: string; load: () => Promise<MapData> };

// ---- track.ts: createTrack(map: MapData): Track. Pure math, no three.js scene objects.
export type TrackFrame = {
  pos: THREE.Vector3; // centerline point on the road surface
  fwd: THREE.Vector3; // unit tangent, toward increasing s
  left: THREE.Vector3; // unit, along the road surface
  up: THREE.Vector3; // unit road normal, includes banking
  width: number;
  runoff: number;
};
export type GroundHit = {
  y: number; // surface height under the point
  normal: THREE.Vector3;
  surface: Surface;
  grip: number; // friction multiplier, 1 = dry asphalt
  s: number; // nearest track distance, use as the next hint
  lateral: number; // signed offset from the centerline, + is left
  onRoad: boolean;
  tunnel: boolean;
};
export interface Track {
  readonly map: MapData;
  readonly length: number; // centerline length in m
  readonly closed: boolean;
  frame(s: number, out: TrackFrame): TrackFrame; // wraps s on a closed track, clamps otherwise
  wrap(s: number): number;
  delta(a: number, b: number): number; // shortest signed s distance b - a, handles the wrap
  ground(x: number, y: number, z: number, hint: number, out: GroundHit): GroundHit; // hint: last s, also picks the right deck on stacked roads
  // Pushes a car body circle out of the barriers. Mutates pos and vel. Returns the impact speed into the wall, 0 when no contact.
  barrier(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, hint: number): number;
  readonly grid: readonly { pos: THREE.Vector3; yaw: number; s: number }[]; // 12 start slots, 2 wide, slot 0 is pole
  readonly checkpoints: readonly number[]; // s values, the first is the start line
  readonly line: Float32Array; // racing line: lateral offset per meter of s
  readonly speed: Float32Array; // target speed in m/s per meter of s for a car with grip 1 (scale it by car grip)
  readonly outline: Float32Array; // x,z pairs every 10 m, for the minimap
  heightAt(x: number, z: number): number; // terrain only, flattened under the road
}

// ---- track-mesh.ts: createTrackMesh(track: Track, quality: Quality): TrackMesh. Road, curbs, lines, barriers, terrain, tunnels.
export interface TrackMesh {
  readonly group: THREE.Group;
  setWet(wet: number): void; // 0..1, darkens the road and lowers roughness, adds puddles
  setQuality(q: Quality): void;
  dispose(): void;
}

// ---- scenery.ts: createScenery(track: Track, quality: Quality): Scenery. Buildings, trees, water, landmarks, props, lights, crowds.
export interface Scenery {
  readonly group: THREE.Group;
  setNight(night: number): void; // 0 day .. 1 night: windows, street lights, neon
  setQuality(q: Quality): void;
  update(dt: number, camera: THREE.Camera): void; // LOD, water animation, flags
  dispose(): void;
}

// ---- cars.ts: export const CARS: readonly CarSpec[]
export type Drive = "rwd" | "fwd" | "awd";
export type EngineLayout = "i4" | "i6" | "f6" | "v8" | "v8flat" | "v10" | "v12" | "electric";
export type CarSpec = {
  id: CarId;
  name: string; // short, no brand names
  year: number;
  klass: "S2" | "S1" | "A" | "B"; // performance class for the menu
  pi: number; // performance index 100..999
  body: { length: number; width: number; height: number; wheelbase: number; trackF: number; trackR: number; wheelR: number; rideH: number };
  mass: number;
  cgH: number; // center of mass height above the ground
  frontW: number; // static weight on the front axle, 0..1
  inertia: [number, number, number]; // pitch, yaw, roll moments, kg·m²
  engine: {
    layout: EngineLayout;
    cylinders: number; // 0 for electric
    aspiration: "na" | "turbo" | "twin" | "super" | "electric";
    idle: number; // rpm
    redline: number;
    limiter: number;
    curve: readonly (readonly [number, number])[]; // rpm, torque N·m at full throttle
    inertia: number; // flywheel, kg·m²
    braking: number; // engine braking torque at redline, N·m
  };
  gears: readonly number[]; // forward ratios, gear 1 first
  reverse: number;
  final: number;
  shiftTime: number; // s
  drive: Drive;
  awdFront: number; // torque share to the front on AWD
  brake: number; // max brake torque per front wheel, N·m
  brakeBias: number; // front share 0..1
  tire: { mu: number; muLat: number; width: number; peakSlip: number; peakAngle: number }; // peak slip ratio, peak slip angle in rad
  steerLock: number; // rad at the front wheels
  aero: { cd: number; area: number; clF: number; clR: number }; // clF, clR: downforce coefficient × area per axle
  susp: { k: number; c: number; travel: number; arbF: number; arbR: number }; // spring N/m, damper N·s/m per wheel, travel m, anti roll N/m
  sound: { tone: number; rasp: number; pops: number; whine: number }; // 0..1 timbre knobs for audio.ts
  paints: readonly string[]; // hex, the first is the default
};

// ---- input.ts: createInput(canvas: HTMLCanvasElement): Input
export type Controls = {
  throttle: number; // 0..1
  brake: number; // 0..1, also reverse when stopped
  steer: number; // -1 full left .. 1 full right, already smoothed for keys
  handbrake: number; // 0..1
  shiftUp: boolean; // this frame
  shiftDown: boolean;
};
export type Press = "camera" | "rewind" | "reset" | "pause" | "horn" | "lookBack" | "photo";
export type Device = "keys" | "pad" | "touch";
export interface Input {
  read(dt: number, speed: number): Controls; // speed in m/s, for speed-sensitive key steering
  pressed(p: Press): boolean; // went down since the last read()
  held(p: Press): boolean;
  look(): { x: number; y: number }; // right stick or mouse drag, -1..1, free look around the car
  readonly device: Device; // last used device, so the UI shows the right glyphs
  setTouch(t: Partial<Controls> & { held?: Partial<Record<Press, boolean>> }): void; // from ui-touch.tsx
  rumble(strong: number, weak: number, ms: number): void;
  dispose(): void;
}

// ---- vehicle.ts: createVehicle(spec: CarSpec, track: Track): Vehicle
export type Assists = { abs: boolean; tcs: boolean; stability: boolean; autoGear: boolean; steer: boolean }; // steer: counter-steer and slip help for keys
export type WheelState = {
  compress: number; // 0..1 of travel
  spin: number; // wheel rotation angle, rad
  omega: number; // rad/s
  steer: number; // rad
  slipRatio: number;
  slipAngle: number;
  load: number; // N
  contact: boolean;
  surface: Surface;
  skid: number; // 0..1 how hard the tire slides, for smoke, marks and squeal
  pos: THREE.Vector3; // contact point in world space
};
export type VehicleState = {
  pos: THREE.Vector3; // center of mass, world
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  speed: number; // forward speed, m/s, negative in reverse
  rpm: number;
  gear: number; // -1 reverse, 0 neutral, 1..n
  throttle: number; // after assists
  brake: number;
  boost: number; // turbo spool 0..1
  limiter: boolean;
  shifting: boolean;
  wheels: WheelState[];
  s: number; // track distance
  lateral: number;
  onRoad: boolean;
  airborne: boolean;
  tunnel: boolean;
};
export type VehicleSnap = Float32Array; // full state for rewind and for the network
export interface Vehicle {
  readonly spec: CarSpec;
  readonly state: VehicleState;
  assists: Assists;
  step(dt: number, c: Controls): GameEvent[]; // fixed step, called at 120 Hz
  place(pos: THREE.Vector3, yaw: number, s: number): void; // at rest, wheels on the ground
  resetToTrack(): void; // back on the centerline at the current s, facing forward
  snap(out?: VehicleSnap): VehicleSnap;
  load(s: VehicleSnap): void;
}
// vehicle.ts also exports: collideCars(cars: Vehicle[]): GameEvent[]  (body box against body box)

// ---- car-model.ts: createCarModel(spec: CarSpec, paint: string, quality: Quality): CarModel
export interface CarModel {
  readonly group: THREE.Group; // origin on the ground, at the center of mass in x and z
  setPaint(hex: string): void;
  sync(s: VehicleState, dt: number): void; // body pose, wheel spin and steer, suspension, brake and reverse lights
  setLights(on: boolean): void; // headlights for night and tunnels
  setEnv(env: THREE.Texture | null): void; // reflection map from render
  setQuality(q: Quality): void;
  dispose(): void;
}

// ---- camera.ts: createCameraRig(camera: THREE.PerspectiveCamera, track: Track): CameraRig
export type CamMode = "chase" | "far" | "hood" | "bumper" | "cockpit";
export interface CameraRig {
  mode: CamMode;
  cycle(): CamMode;
  update(dt: number, car: VehicleState, spec: CarSpec, look: { x: number; y: number }, lookBack: boolean): void;
  showroom(dt: number, target: THREE.Vector3, t: number): void; // slow orbit for the menu
  shake(strength: number): void;
  cut(): void; // no smoothing on the next update, after a reset or rewind
}

// ---- render.ts: createRender(canvas: HTMLCanvasElement): Render
export type Env = { hour: number; weather: Weather; season: "summer" | "autumn" | "winter"; lat: number };
export interface Render {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly envMap: THREE.Texture | null; // updates with the sky, for car paint and wet roads
  setQuality(q: Quality): void;
  setEnv(env: Env): void; // sun, sky, fog, rain, snow, exposure
  readonly night: number; // 0..1 from the hour
  readonly wet: number; // 0..1 road wetness from the weather
  resize(): void;
  frame(dt: number, focus: THREE.Vector3, speed: number): void; // shadow camera, weather particles follow focus
  render(): void;
  stats(): { fps: number; ms: number; calls: number; tris: number };
  dispose(): void;
}
// render.ts also exports: QUALITY: Record<Quality, QualityPreset>, detectQuality(): Quality
export type QualityPreset = {
  label: string;
  scale: number; // render resolution × devicePixelRatio, clamped
  shadow: number; // shadow map size, 0 = off
  cascades: number;
  ao: boolean;
  ssr: boolean;
  bloom: boolean;
  blur: boolean; // motion blur
  far: number; // draw distance, m
  detail: number; // 0..3 for scenery density and mesh detail
  particles: number; // budget
};

// ---- fx.ts: createFx(scene: THREE.Scene): Fx
export interface Fx {
  tire(car: number, wheel: number, pos: THREE.Vector3, vel: THREE.Vector3, skid: number, surface: Surface, wet: number): void; // smoke, dust, spray and skid marks
  sparks(pos: THREE.Vector3, dir: THREE.Vector3, amount: number): void;
  backfire(pos: THREE.Vector3, dir: THREE.Vector3): void;
  debris(pos: THREE.Vector3, amount: number, surface: Surface): void;
  update(dt: number, camera: THREE.Camera): void;
  setQuality(q: Quality): void;
  clear(): void; // drop skid marks and particles on a map change
  dispose(): void;
}

// ---- audio.ts: createAudio(): Audio. Make it after a user gesture.
export type Sfx =
  | "shift" | "impact" | "scrape" | "curb" | "backfire" | "blowoff" | "horn" | "beep" | "go" | "checkpoint"
  | "lap" | "best" | "finish" | "rewind" | "click" | "hover" | "splash" | "land" | "join" | "leave";
export type MusicState = "menu" | "race" | "final" | "results" | "off";
export type EngineInput = {
  rpm: number;
  throttle: number;
  load: number; // -1 engine braking .. 1 full load
  gear: number;
  boost: number;
  speed: number; // m/s
  limiter: boolean;
  skid: number; // 0..1 max over wheels
  surface: Surface; // under the rear wheels
  pos: THREE.Vector3; // for 3D sound
  tunnel: boolean;
};
export interface EngineVoice {
  update(i: EngineInput): void;
  dispose(): void;
}
export interface Audio {
  engine(spec: CarSpec, player: boolean): EngineVoice; // engine, exhaust, turbo, tires and wind of one car
  sfx(name: Sfx, opts?: { volume?: number; at?: THREE.Vector3 }): void;
  music(state: MusicState, map?: MapId): void;
  listener(pos: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3): void;
  ambience(map: MapId, weather: Weather, night: number): void;
  setVolume(master: number, music: number): void;
  setMuted(m: boolean): void;
  dispose(): void;
}

// ---- ai.ts: createDriver(track: Track, car: Vehicle, skill: number): Driver. skill 0..1.
export interface Driver {
  drive(dt: number, others: readonly VehicleState[]): Controls;
}

// ---- race.ts: createRace(track: Track, mode: Mode, laps: number, ids: readonly string[]): Race
export type Entrant = { id: string; name: string; color: string; car: CarId; me: boolean; ai: boolean };
export type Standing = { id: string; place: number; lap: number; progress: number; finished: boolean; time: number; best: number; gap: number };
export interface Race {
  readonly phase: "grid" | "countdown" | "racing" | "done";
  readonly clock: number; // race time since the green light
  start(at: number): void; // performance.now() ms of the green light, shared in multiplayer
  update(now: number, cars: ReadonlyMap<string, VehicleState>): GameEvent[]; // now: performance.now() ms
  standings(): readonly Standing[];
  readonly countdown: number; // 3, 2, 1, 0 = go, -1 = none
  wrongWay(id: string): boolean;
}

// ---- net.ts: createNet(room: string, me: Entrant): Net. WebRTC through trystero, no server.
export type NetCar = { id: string; snap: VehicleSnap; controls: Controls; t: number };
export type Lobby = { map: MapId; mode: Mode; laps: number; weather: Weather | "map"; hour: number | "map"; startAt: number | null; ai: number };
export interface Net {
  readonly room: string;
  readonly host: boolean;
  readonly peers: readonly Entrant[];
  readonly clockOffset: number; // add to performance.now() to get the host clock
  setMe(me: Entrant): void;
  sendCar(snap: VehicleSnap, c: Controls): void; // call at 30 Hz, net throttles
  remote(id: string, now: number, out: VehicleSnap): boolean; // interpolated snapshot 100 ms in the past, false when stale
  setLobby(l: Lobby): void; // host only
  readonly lobby: Lobby | null;
  on(cb: (e: NetEvent) => void): () => void;
  leave(): void;
}
export type NetEvent = { type: "join" | "leave"; who: Entrant } | { type: "lobby"; lobby: Lobby } | { type: "finish"; id: string; time: number };

// ---- events from modules to game.ts
export type GameEvent =
  | { type: "sfx"; name: Sfx; volume?: number; at?: THREE.Vector3 }
  | { type: "impact"; at: THREE.Vector3; speed: number; car: number } // body hit, speed in m/s
  | { type: "scrape"; at: THREE.Vector3; dir: THREE.Vector3; amount: number; car: number }
  | { type: "shake"; strength: number }
  | { type: "shift"; car: number; up: boolean }
  | { type: "backfire"; car: number }
  | { type: "checkpoint"; id: string; split: number; delta: number | null } // delta vs best, s
  | { type: "lap"; id: string; lap: number; time: number; best: boolean }
  | { type: "finish"; id: string; place: number; time: number }
  | { type: "toast"; text: string };

// ---- HUD state, pushed to React at 10 Hz. Needles and the minimap draw per frame through DOM refs.
export type HudState = {
  speed: number; // km/h or mph per setting
  gear: string; // "R", "N", "1".."8"
  rpm: number;
  redline: number;
  limiter: number;
  place: number;
  total: number;
  lap: number;
  laps: number;
  time: number;
  last: number;
  best: number;
  delta: number | null;
  countdown: number;
  wrongWay: boolean;
  phase: Race["phase"];
  mode: Mode;
  device: Device;
};
