# Morrow Reach: regional geography, revision 01

**Status:** terrain and transport framework only. Names below are fictional design labels, not constructed places. No map, landmark, name or road was reproduced from another game or a real city.

## Spatial reading

The 18 km east–west × 14 km north–south frame contains a roughly 170 km² **main island** and a 5.6 km² **sound island**. Coordinates are metres: `x` increases east, `z` increases south, and elevation `y` is metres above mean sea level. The major shoreline curves south around a broad western beach, folds inward around the protected Lowmere bay, then turns into a tidal eastern estuary. The southeastern island is separated by navigable water and approached from **two** different sides.

The north is not a wall of uniform height: separate rounded summits (up to approximately 900 m) leave a lower southern foothill corridor for the Upland Parkway. Forest grows in the eastern foothills and western uplands; lower wooded bluffs transition to valley meadow, then sand and shore. The western lake sits at 25 m elevation within the rural basin. The river begins among the northeastern hills, descends continuously to the eastern coast, cuts a graded floodplain, and opens into low marsh. The airport plateau is kept deliberately level; the port is sheltered on the south shore. There are no copied city blocks or buildings.

Height, biome color, lakebed, floodplain and coastline are continuous world-space functions. The coastline is a smoothed authored polygon, **not** a rectangular heightmap or flat city grid. Its spatial distance index makes the function cheap enough to evaluate independently in every streaming tile.

## Space left for future districts

Areas are polygon reservations, not finished districts. Boundary sectors may carry more than one future bundle, but assets must be clipped to their precise district polygon.

| Reservation | Area | Terrain and reason for placement |
| --- | ---: | --- |
| Downtown | 6.2 km² | Connected, low central city floor; two radial approaches and a belt link. |
| Industrial | 4.8 km² | Level riverward flats with direct port and eastern crossing access. |
| Hillside / wealthy | 6.6 km² | Sheltered rolling bluff west of the core, above the exposed beaches. |
| Residential | 7.3 km² | Broad central valley between the foothills and downtown. |
| Suburbs | 8.2 km² | Western outer lowlands between lake country and the metropolitan core. |
| Entertainment | 4.2 km² | South-bay terrace with parallel city and port approaches. |
| Port | 3.1 km² | Protected deepwater headland; the west island bridge meets its road. |
| Airport | 5.5 km² | Mostly 29–42 m eastern plateau with a perimeter/ring road, no runway yet. |
| Rural | 8.0 km² | Western lake country; the inland lake accounts for part of its area. |
| Mountains | 10.6 km² | Northern ridge and lower approach country; peaks remain undeveloped. |
| Coastal / beaches | 5.3 km² | Broad western sand belt served by Coastway and a separate dune road. |
| Marshland | 3.1 km² | Flat eastern delta with small tidal pools and dry road corridors. |

The metropolitan footprint can expand outward through the central valley without pushing the airport into the mountains or the port into open surf. A district focus point is within 1.2 km of a regional road; open land remains between reservations for future design.

## Road hierarchy and crossings

- **Northspan Freeway** connects the west entrance, suburbs, residential valley, inner city, river crossing and airport side of the island.
- **Upland Parkway** skirts the southern edge of the ridge via the north river viaduct, eastern country, and airport ring. It avoids forcing a freeway over the summits.
- **Coastway / Sound Parkway / Tidal Road** form a distinct western beach–bluff–downtown–industrial–port–marsh corridor. Additional inner-belt, port, valley and lakeside distributors give local alternatives.
- **Rural roads** loop the freshwater basin and southern foothills instead of terminating at decorative viewpoints. The sound island has its own loop and two mainland approaches.
- **Five explicit bridges:** Northspan river bridge (`h07`), Upland river viaduct (`h13`), Tidal river bridge (`a10`), West Sound Bridge (`i02`) and East Sound Causeway (`i07`). Rendered decks have water clearance, rails and support piers.

The node graph is connected even if **any one** of these bridges is closed: the east and the sound island both retain a second route. Unbridged roads are tested against coastline, lakebed, river and tidal pools. Major roads stay at or below 10% sampled grade; steep rural tracks are limited to 18%. No full street grid has been laid out: only connecting alignments needed by this foundation are present.

## Streaming contract

`WORLD.minX = -9000`, `minZ = -7000`, sector width = **1000 m**, yielding **18 × 14 = 252** sectors. Tiles have stable integer addresses (`ix:iz`) and evaluate the same height function on both sides of every edge. Source polygons and road-junction IDs are persistent even when rendered tiles unload.

At runtime, the camera requests only sectors near its target. A typical close exploration requests about **32** tiles; a full 3D overview requests at most **125 of 252**. High-detail terrain uses ~42 m vertex spacing; road ribbons, bridge detail and instanced trees are created only for requested tiles, with a per-frame construction budget and disposal when they leave range. A ~150 m distant terrain silhouette is retained as low-cost LOD. The 2D atlas always shows the full region without loading district assets.

Future district packages should use `SECTOR_LAYOUT.tilesFor(district)` / `districtIds(ix, iz)` and the precise polygon to stream buildings or foliage only into appropriate tiles. Keep heavy detail out of the global silhouette. Future routes must join named nodes, explicitly declare water crossings and pass the same audit.

## Verification

`npm test` and `npm run verify:world` check: both landmasses and water basins, exact signed shore distances, twelve non-overlapping footprints and usable area, airport relief, connected multi-route road graph, absence of unbridged water or excessive grades, all five bridge spans and clearances, exact district-to-sector coverage, nearby-sector limits, and matching terrain vertices at an adjacent river tile seam. The printed audit provides individual dry percentages, elevation ranges and access distances. Browser desktop/mobile previews were also checked for readable atlas and streamed 3D views.
