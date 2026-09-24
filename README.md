# Morrow Reach — geographic foundation

An original, fictional modern coastal region for a future open-world project. **This build is only the base map**: terrain, water, regional routes, bridge alignments, district reservations, and streaming sectors. It does not contain constructed neighborhoods, missions, NPC behavior, or a vehicle system.

## Run

```bash
npm install
npm run dev       # Vite, bound to 0.0.0.0
npm run build     # TypeScript check + production build
npm test          # geographic and streaming regression tests
npm run verify:world  # printable whole-region audit
```

The browser opens to a streamed 3D terrain view. **Open Atlas** (`M`) shows the whole region from above, with terrain relief, coastline, water, roads, and future district limits. Click a location in the sidebar or atlas to inspect/focus it.

| Input | Action |
| --- | --- |
| Drag / one-finger pan | Move across the map |
| Scroll / pinch | Zoom |
| Right-drag | Orbit camera |
| WASD / arrow keys | Move camera target |
| Q / E | Rotate camera |
| B | Show/hide district reservations |
| M / Escape | Open/close atlas |

## Foundation at a glance

- **18 × 14 km** coordinate envelope; ~**176 km² of land** over two landmasses.
- One indented southern bay, a sheltered sound, five crossing spans, a descending eastern river and delta, an elevated western lake, northern ridges, wooded foothills, coastal beaches, marsh flats and open western country.
- **73 authored road segments / ~143 km**: highways, arterials, secondary routes, a small number of connecting streets and rural tracks. Junctions share graph IDs and provide alternative routes.
- **12 reserved, unbuilt district footprints**. The large metropolitan area can later grow across the connected central lowlands; all other requested environments have explicit land reservations.
- **252 logical 1 km² streaming sectors**. Only nearby high-detail terrain, road surfaces, bridge structures and instanced woodland are constructed. A coarse all-region silhouette prevents gaps in the distance. Sector and district boundaries are data, not baked textures.

See [the geographic plan](docs/GEOGRAPHY.md) for terrain logic, connections, district space and future asset boundaries. `npm run verify:world` reports dry land, access distances, road grades, bridge clearances, streaming coverage and disconnected areas.

## Source of truth

- `src/world/data.ts` — authored shoreline, island, river, lake, road graph and district polygons (horizontal units: metres).
- `src/world/geometry.ts` — deterministic shared coastline distance, terrain height, biomes, sector mathematics.
- `src/world/roads.ts` — sampled junction-to-junction alignments and bridge elevations.
- `src/world/streaming.ts` — exact district/sector intersection for future asset bundles.
- `src/scene/` — Three.js 3D terrain, water, roads, simple forest instances and bounded sector loading.
- `src/ui/atlas.ts` — 2D atlas rendered from those same world functions.
- `src/world/verification.ts`, `tests/world.test.ts` — auditable foundation checks.

The atlas and 3D viewer intentionally share data. Changing a river, coastline or road alignment updates both views and is caught by the audit if it floods a route or isolates a region.
