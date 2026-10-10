import type { MapInfo } from "./contracts";

export const MAPS: readonly MapInfo[] = [
  { id: "monaco", name: "Monaco", place: "Monte Carlo", load: () => import("./maps/monaco").then((m) => m.MAP) },
  { id: "nordschleife", name: "Nordschleife", place: "Nürburg", load: () => import("./maps/nordschleife").then((m) => m.MAP) },
  { id: "tokyo", name: "Shuto C1", place: "Tokyo", load: () => import("./maps/tokyo").then((m) => m.MAP) },
  { id: "sanfrancisco", name: "San Francisco", place: "Russian Hill", load: () => import("./maps/sanfrancisco").then((m) => m.MAP) },
  { id: "stelvio", name: "Stelvio Pass", place: "South Tyrol", load: () => import("./maps/stelvio").then((m) => m.MAP) },
  { id: "spa", name: "Spa", place: "Francorchamps", load: () => import("./maps/spa").then((m) => m.MAP) },
];
