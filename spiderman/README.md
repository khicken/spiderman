# spiderman

A 3D web-swinging game in the browser, inspired by Spider-Man: Miles Morales. Play it at [kalebkim.com/spiderman](https://kalebkim.com/spiderman).

Everything is procedural: three.js geometry, canvas textures, and Web Audio music. There are no asset files.

## Play

- Hold left click to swing. Right click or E to web zip. F to web strike.
- WASD to move, Space to jump or do an air trick, Shift to sprint or dive.
- V to change suit, M to mute, 1 2 3 to change graphics mode, Esc for the menu.

Goals: swing races, crimes, getaway car chases, 30 backpacks, and XP levels.

## Run

```
cd spiderman
npm install
npm run dev
```

Open http://localhost:3000/spiderman. A desktop browser with a keyboard and mouse is needed.

## Code

| File | Contents |
| --- | --- |
| src/app/game.ts | Renderer, sky, swing physics, camera, input |
| src/app/page.tsx | Menu and HUD |
| src/app/hero.ts | Hero model, suits, poses |
| src/app/city.ts, city-*.ts | City, traffic, props, river |
| src/app/missions.ts | Races, crimes, chases, collectibles, XP |
| src/app/audio.ts | Music and sound effects |

Fan project. Not affiliated with Marvel, Sony, or Insomniac Games.
