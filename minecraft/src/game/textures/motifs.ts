export const SHERD_MOTIFS: Record<string, string[]> = {
  angler: ["......X.", ".....X.X", "....X..X", "...X...X", "..X....X", ".X....XX", "X.....X.", "......XX"],
  archer: [".XX.....", "X..X...X", "X...X.X.", "X....X..", "X...XX..", "X..X..X.", "X.X....X", ".X......"],
  arms_up: ["X..XX..X", "X..XX..X", ".X.XX.X.", "..XXXX..", "...XX...", "...XX...", "..X..X..", ".X....X."],
  blade: [".......X", "......XX", ".....XX.", "....XX..", "X..XX...", ".XXX....", "..X.....", ".X.X...."],
  brewer: ["...XX...", "...XX...", "..X..X..", ".X....X.", "X.XXXX.X", "X.XXXX.X", "X.XXXX.X", ".XXXXXX."],
  burn: ["...X....", "...XX...", "..XXX.X.", ".XX.XXX.", ".X..X.XX", "XX....XX", "X.X..X.X", ".XXXXXX."],
  danger: ["........", ".XX..XX.", ".XX..XX.", "...XX...", "..XXXX..", "..XXXX..", "..X..X..", "........"],
  explorer: ["XXXXXXXX", "X......X", "X.X..X.X", "X..XX..X", "X..XX..X", "X.X..X.X", "X......X", "XXXXXXXX"],
  flow: [".XXXXX..", "X.....X.", "X.XXX..X", "X.X.X..X", "X.X..X.X", "X..XX..X", ".X....X.", "..XXXX.."],
  friend: ["..XXXX..", ".X....X.", "X.X..X.X", "X......X", "X.X..X.X", "X..XX..X", ".X....X.", "..XXXX.."],
  guster: ["..XXXX..", ".X.XX.X.", "X......X", ".XXXXXX.", "..X..X..", ".XXXXXX.", "X......X", ".XXXXXX."],
  heart: ["........", ".XX..XX.", "XXXXXXXX", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX...", "........"],
  heartbreak: ["........", ".XX..XX.", "XXX.XXXX", "XXXX.XXX", ".XX.XXX.", "..XX.X..", "...XX...", "........"],
  howl: ["X.......", "XX....X.", "XXX..XX.", ".XXXXXX.", ".XX.XXX.", "..XXXXXX", "...XXXXX", "....XX.."],
  miner: ["..XXXX..", ".X.XX.X.", "X..XX..X", "...XX...", "...XX...", "...XX...", "...XX...", "...XX..."],
  mourner: ["X......X", "XX....XX", ".XXXXXX.", ".X.XX.X.", ".XXXXXX.", "..X..X..", ".XXXXXX.", ".X....X."],
  plenty: ["........", "XXXXXXXX", "X......X", "XXXXXXXX", "X..XX..X", "X......X", "X......X", "XXXXXXXX"],
  prize: ["........", "..XXXX..", ".X.X..X.", "XXXXXXXX", ".X....X.", "..X..X..", "...XX...", "........"],
  scrape: [".XXX....", "XXXXX...", "XXX.X...", ".X..X...", "....X...", "....X...", "....X...", "....X..."],
  sheaf: ["X..X..X.", ".X.X.X..", "..XXX...", "...X....", "..XXX...", ".X.X.X..", "X..X..X.", "...X...."],
  shelter: ["...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX", "..XXXX..", "...XX...", "...XX...", "..XXXX.."],
  skull: ["..XXXX..", ".XXXXXX.", "X..XX..X", "X..XX..X", "XXXXXXXX", ".XX..XX.", "..XXXX..", "..X.X.X."],
  snort: ["........", "..XXXXX.", ".XXXXXXX", "XXX.XXXX", "X.XXXXX.", "..XXXXX.", "..X.X.X.", "........"],
};

export const BANNER_SPRITES: Record<string, string[]> = {
  creeper: ["........", ".XX..XX.", ".XX..XX.", "...XX...", "..XXXX..", "..XXXX..", "..X..X..", "........"],
  skull: ["..XXXX..", ".XXXXXX.", "XX..XX.X", "XX..XX.X", ".XXXXXX.", "..X.X.X.", "........", "X......X"],
  piglin: ["........", "..XXXX..", ".XXXXXX.", ".X.XX.X.", ".XXXXXX.", "..X..X..", "..XXXX..", "........"],
  mojang: ["........", "XX....XX", "XXX..XXX", "XX.XX.XX", "XX....XX", "XX....XX", "XX....XX", "........"],
  guster: ["...XX...", "..X..X..", ".X.XX.X.", ".X.X..X.", ".X..XX..", "..X.....", "...XXXX.", "........"],
  flower: ["...XX...", ".X.XX.X.", "..XXXX..", "XXX..XXX", "XXX..XXX", "..XXXX..", ".X.XX.X.", "...XX..."],
  globe: ["..XXXX..", ".X.XX.X.", "XXXXXXXX", "X..XX..X", "X..XX..X", "XXXXXXXX", ".X.XX.X.", "..XXXX.."],
  flow: SHERD_MOTIFS.flow,
};

export const motifAt = (rows: readonly string[] | undefined, x: number, y: number) => !!rows && y >= 0 && y < 8 && x >= 0 && x < 8 && rows[y][x] === "X";
