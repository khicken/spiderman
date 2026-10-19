export type SoundCategory = "music" | "records" | "weather" | "blocks" | "hostile" | "neutral" | "players" | "ambient" | "voice";

export interface Settings {
  fov: number; // 30..110
  renderDistance: number; // 2..32 chunks
  simulationDistance: number; // 5..32 chunks
  guiScale: number; // 0 auto, 1..4
  brightness: number; // 0 Moody .. 1 Bright
  sensitivity: number; // 0..1, 0.5 = 100%
  invertMouse: boolean;
  viewBobbing: boolean;
  clouds: boolean;
  cloudMode: "fancy" | "fast" | "off";
  graphics: "fast" | "fancy";
  smoothLighting: boolean;
  maxFps: number; // 10..260, 260 = Unlimited
  fovEffects: number; // 0..1
  particles: "all" | "decreased" | "minimal";
  entityShadows: boolean;
  master: number; // 0..1
  music: number;
  sound: number; // legacy single sound slider, kept equal to blocks
  volumes: Record<SoundCategory, number>;
  advancedTooltips: boolean;
  chatOpacity: number; // 0.1..1
  chatBackground: number; // 0..1
  chatLineSpacing: number; // 0..1
  chatWidth: number; // 40..320 GUI px
  chatScale: number; // 0..1
  toggleSneak: boolean;
  toggleSprint: boolean;
  keys: Record<string, string>; // bind id -> KeyboardEvent.code
  showSubtitles?: boolean;
}

export const SOUND_CATEGORIES: [SoundCategory, string][] = [
  ["music", "Music"],
  ["records", "Jukebox/Note Blocks"],
  ["weather", "Weather"],
  ["blocks", "Blocks"],
  ["hostile", "Hostile Creatures"],
  ["neutral", "Friendly Creatures"],
  ["players", "Players"],
  ["ambient", "Ambient/Environment"],
  ["voice", "Voice/Speech"],
];

// Vanilla key.* bind ids with their 1.21 labels and default keys, grouped like the Key Binds screen.
export const KEY_BIND_GROUPS: [string, [id: string, label: string, code: string][]][] = [
  ["Movement", [["forward", "Walk Forwards", "KeyW"], ["left", "Strafe Left", "KeyA"], ["back", "Walk Backwards", "KeyS"], ["right", "Strafe Right", "KeyD"], ["jump", "Jump", "Space"], ["sneak", "Sneak", "ShiftLeft"], ["sprint", "Sprint", "ControlLeft"]]],
  ["Gameplay", [["attack", "Attack/Destroy", "Mouse0"], ["use", "Use Item/Place Block", "Mouse2"], ["pick_block", "Pick Block", "Mouse1"]]],
  ["Inventory", [["drop", "Drop Selected Item", "KeyQ"], ["inventory", "Open/Close Inventory", "KeyE"], ["swap_offhand", "Swap Item With Offhand", "KeyF"], ...Array.from({ length: 9 }, (_, i): [string, string, string] => [`hotbar.${i + 1}`, `Hotbar Slot ${i + 1}`, `Digit${i + 1}`])]],
  ["Multiplayer", [["chat", "Open Chat", "KeyT"], ["command", "Open Command", "Slash"]]],
  ["Miscellaneous", [["advancements", "Advancements", "KeyL"], ["screenshot", "Take Screenshot", "F2"], ["perspective", "Toggle Perspective", "F5"], ["fullscreen", "Toggle Fullscreen", "F11"], ["hide_gui", "Hide GUI", "F1"], ["debug", "Debug Screen", "F3"]]],
];

export const DEFAULT_KEYS: Record<string, string> = Object.fromEntries(KEY_BIND_GROUPS.flatMap(([, list]) => list.map(([id, , code]) => [id, code])));

export const DEFAULT_SETTINGS: Settings = {
  fov: 70,
  renderDistance: 12,
  simulationDistance: 12,
  guiScale: 0,
  brightness: 0.5,
  sensitivity: 0.5,
  invertMouse: false,
  viewBobbing: true,
  clouds: true,
  cloudMode: "fancy",
  graphics: "fancy",
  smoothLighting: true,
  maxFps: 120,
  fovEffects: 1,
  particles: "all",
  entityShadows: true,
  master: 1,
  music: 1,
  sound: 1,
  volumes: { music: 1, records: 1, weather: 1, blocks: 1, hostile: 1, neutral: 1, players: 1, ambient: 1, voice: 1 },
  advancedTooltips: false,
  chatOpacity: 1,
  chatBackground: 0.5,
  chatLineSpacing: 0,
  chatWidth: 320,
  chatScale: 1,
  toggleSneak: false,
  toggleSprint: false,
  keys: DEFAULT_KEYS,
};

// Merges a stored object over the defaults, so settings saved by older builds gain new fields.
export function mergeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...o,
    volumes: { ...DEFAULT_SETTINGS.volumes, ...(o.volumes ?? {}) },
    keys: { ...DEFAULT_KEYS, ...(o.keys ?? {}) },
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
export const fovLabel = (v: number) => `FOV: ${v === 70 ? "Normal" : v === 110 ? "Quake Pro" : v}`;
export const brightnessLabel = (v: number) => `Brightness: ${v <= 0 ? "Moody" : v >= 1 ? "Bright" : v === 0.5 ? "Default" : `+${Math.round(v * 100)}%`}`;
export const sensitivityLabel = (v: number) => `Sensitivity: ${v <= 0 ? "*yawn*" : v >= 1 ? "HYPERSPEED!!!" : `${Math.round(v * 200)}%`}`;
export const volumeLabel = (name: string, v: number) => `${name}: ${v <= 0 ? "OFF" : pct(v)}`;
export const guiScaleLabel = (v: number) => `GUI Scale: ${v === 0 ? "Auto" : v}`;
export const fpsLabel = (v: number) => `Max Framerate: ${v >= 260 ? "Unlimited" : `${v} fps`}`;
export const fovEffectsLabel = (v: number) => `FOV Effects: ${v <= 0 ? "OFF" : pct(v)}`;
export const pctLabel = (name: string, v: number) => `${name}: ${pct(v)}`;

const KEY_NAMES: Record<string, string> = {
  Space: "Space", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Control", ControlRight: "Right Control",
  AltLeft: "Left Alt", AltRight: "Right Alt", MetaLeft: "Left Win", MetaRight: "Right Win", Tab: "Tab", CapsLock: "Caps Lock",
  Enter: "Enter", Backspace: "Backspace", Slash: "/", Backslash: "\\", Period: ".", Comma: ",", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", ArrowUp: "Up Arrow", ArrowDown: "Down Arrow",
  ArrowLeft: "Left Arrow", ArrowRight: "Right Arrow", Mouse0: "Left Button", Mouse1: "Middle Button", Mouse2: "Right Button",
  Mouse3: "Button 4", Mouse4: "Button 5", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down",
};

export function keyName(code: string): string {
  if (!code) return "Not Bound";
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Keypad ${code.slice(6)}`;
  return code;
}

let activeKeys: Record<string, string> = DEFAULT_KEYS;
// The page sets the live binds; screens read them for E (close inventory) and similar keys.
export const setActiveKeys = (k: Record<string, string>) => {
  activeKeys = k;
};
export const keyFor = (id: string) => activeKeys[id] ?? DEFAULT_KEYS[id] ?? "";

export const KEY_BINDS: [string, [string, string][]][] = KEY_BIND_GROUPS.map(([cat, list]) => [cat, list.map(([, label, code]) => [label, keyName(code)])]);
