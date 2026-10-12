export interface Disc {
  author: string;
  title: string;
  seconds: number;
}

const C418 = "C418";
export const DISCS: Record<string, Disc> = {
  music_disc_13: { author: C418, title: "13", seconds: 178 },
  music_disc_cat: { author: C418, title: "cat", seconds: 185 },
  music_disc_blocks: { author: C418, title: "blocks", seconds: 345 },
  music_disc_chirp: { author: C418, title: "chirp", seconds: 185 },
  music_disc_far: { author: C418, title: "far", seconds: 174 },
  music_disc_mall: { author: C418, title: "mall", seconds: 197 },
  music_disc_mellohi: { author: C418, title: "mellohi", seconds: 96 },
  music_disc_stal: { author: C418, title: "stal", seconds: 150 },
  music_disc_strad: { author: C418, title: "strad", seconds: 188 },
  music_disc_ward: { author: C418, title: "ward", seconds: 251 },
  music_disc_11: { author: C418, title: "11", seconds: 71 },
  music_disc_wait: { author: C418, title: "wait", seconds: 238 },
  music_disc_otherside: { author: "Lena Raine", title: "otherside", seconds: 195 },
  music_disc_5: { author: "Samuel Åberg", title: "5", seconds: 178 },
  music_disc_pigstep: { author: "Lena Raine", title: "Pigstep", seconds: 149 },
  music_disc_relic: { author: "Aaron Cherof", title: "Relic", seconds: 218 },
  music_disc_creator: { author: "Lena Raine", title: "Creator", seconds: 176 },
  music_disc_creator_music_box: { author: "Lena Raine", title: "Creator (Music Box)", seconds: 73 },
  music_disc_precipice: { author: "Aaron Cherof", title: "Precipice", seconds: 299 },
};

export const discLabel = (item: string) => {
  const d = DISCS[item];
  return d ? `${d.author} - ${d.title}` : "";
};
