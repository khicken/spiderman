# Map builder

`build-maps.mjs` builds the six `src/app/maps/<id>.ts` files from OpenStreetMap (Overpass API) and AWS Terrain Tiles. It routes the track through waypoints, smooths it, samples elevation, and collects buildings, streets, water, green areas and landmarks around it.
Run `npm run maps` for all maps, or `node scripts/build-maps.mjs monaco spa` for some. Raw downloads are cached in `scripts/.cache/` (git-ignored), so a second run works offline.
Per-map settings (waypoints, widths, smoothing, scenery budget) are in `maps-config.mjs`. Each run also writes a top-down SVG check to `scripts/.cache/preview-<id>.svg`.
