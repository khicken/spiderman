export interface Settings {
  fov: number; // 30..110
  renderDistance: number; // 2..32 chunks
  guiScale: number; // 0 auto, 1..4
  brightness: number; // 0 Moody .. 1 Bright
  sensitivity: number; // 0..1, 0.5 = 100%
  invertMouse: boolean;
  viewBobbing: boolean;
  clouds: boolean;
  graphics: "fast" | "fancy";
  master: number; // 0..1
  music: number;
  sound: number;
  advancedTooltips: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 70,
  renderDistance: 12,
  guiScale: 0,
  brightness: 0.5,
  sensitivity: 0.5,
  invertMouse: false,
  viewBobbing: true,
  clouds: true,
  graphics: "fancy",
  master: 1,
  music: 1,
  sound: 1,
  advancedTooltips: false,
};

export const fovLabel = (v: number) => `FOV: ${v === 70 ? "Normal" : v === 110 ? "Quake Pro" : v}`;
export const brightnessLabel = (v: number) => `Brightness: ${v <= 0 ? "Moody" : v >= 1 ? "Bright" : v === 0.5 ? "Default" : `+${Math.round(v * 100)}%`}`;
export const sensitivityLabel = (v: number) => `Sensitivity: ${v <= 0 ? "*yawn*" : v >= 1 ? "HYPERSPEED!!!" : `${Math.round(v * 200)}%`}`;
export const volumeLabel = (name: string, v: number) => `${name}: ${v <= 0 ? "OFF" : `${Math.round(v * 100)}%`}`;
export const guiScaleLabel = (v: number) => `GUI Scale: ${v === 0 ? "Auto" : v}`;

export const KEY_BINDS: [string, [string, string][]][] = [
  ["Movement", [["Walk Forwards", "W"], ["Walk Backwards", "S"], ["Strafe Left", "A"], ["Strafe Right", "D"], ["Jump", "Space"], ["Sneak", "Left Shift"], ["Sprint", "Left Control"]]],
  ["Gameplay", [["Attack/Destroy", "Left Button"], ["Use Item/Place Block", "Right Button"], ["Pick Block", "Middle Button"]]],
  ["Inventory", [["Open/Close Inventory", "E"], ["Drop Selected Item", "Q"], ["Swap Item With Offhand", "F"], ...Array.from({ length: 9 }, (_, i): [string, string] => [`Hotbar Slot ${i + 1}`, String(i + 1)])]],
  ["Multiplayer", [["Open Chat", "T"], ["Open Command", "/"]]],
  ["Miscellaneous", [["Take Screenshot", "F2"], ["Toggle Perspective", "F5"], ["Toggle Fullscreen", "F11"], ["Hide GUI", "F1"], ["Debug Screen", "F3"]]],
];
