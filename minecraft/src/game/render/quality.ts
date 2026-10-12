import type { Quality } from "../contracts";

export type CloudMode = "off" | "flat" | "fancy";

export interface QualityPreset {
  pixelRatio: number;
  renderDistance: number;
  clouds: CloudMode;
  particles: number;
  weatherRadius: number;
  uploadMs: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, renderDistance: 6, clouds: "off", particles: 1000, weatherRadius: 5, uploadMs: 3 },
  medium: { pixelRatio: 1, renderDistance: 10, clouds: "flat", particles: 4000, weatherRadius: 7, uploadMs: 4 },
  high: { pixelRatio: 2, renderDistance: 16, clouds: "fancy", particles: 10000, weatherRadius: 10, uploadMs: 4 },
};
