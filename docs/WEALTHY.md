# Hillside District — "Vantage Heights"

6.6 km² of sheltered bluff west of downtown, constructed in `src/wealthy/`. It is the
third built district and deliberately the opposite of the first two: where downtown is
tight, signalised and dense, and the works are wide, signalised and industrial, the bluff
is walled, gated, planted and **signal-free**. 30 streets / 22.44 km, 61 junctions with
**zero traffic lights**, 396 properties, 304 plots over 398 ha, and 7 landmark properties
on 130 ha of ground reserved whole.

## Terrain

The district is **not flattened**. The natural ridge stands: 46–132 m, crown at
`(-3630, 1700)` at 131.6 m, falling east to ~45 m and south to ~55 m, 744 m inside the
footprint. Every other district is graded onto a slab; this one keeps its relief and pays
for it in earthworks instead.

- Level building pads are modelled **per site** as terraces with retaining walls and
  gravel batters, not by lowering the terrain. Flattening the hill in `terrainSample`
  would have shifted the base map globally and broken the world audit.
- Because the datum is the natural ground, `HILL_SLAB = 1.6` in `frame.ts` puts the
  district's road surfaces at terrain + 1.67 m, which meets the outside regional ribbon at
  terrain + 1.7 m to within 0.03 m — no step at the gates.
- Each **part** of a landmark estate gets its own terrace level (`padLevel` over the part
  polygon). One datum across a 400 m property buried the downhill ranges and left the
  uphill ones floating; per-part terracing is both correct geometry and how a hillside
  estate is actually built.
- Worst grade 9.0 % (a terrace lane); through routes ≤ 8.5 %, inside the regional audit's
  9 % limit.

## Layout logic

- **Street vocabulary.** Vantage Boulevard (21 m, 4 lanes, planted median) is the spine;
  Ridge Road and Bluff Rise are scenic; Serpentine Drive winds the shoulder; Marchmont
  Avenue is the collector; 8 private roads and 9 estate lanes serve the compounds; and
  Belvedere Walk and The Cliff Walk are pedestrian. 30 streets / 22.44 km.
- **No signals.** 18 gate terminals, 18 estate gates, 18 yields and 3 roundabouts —
  Crown Circus (21 m island), Marchmont Circus (16 m) and Village Circus (14 m).
- **Carried regional routes.** Coastway, Bluff Road (×2), Valley Road, Foothill Road and
  Coastal Rise cross the reservation on their authored alignments and converge on the
  crown, giving 7 gates on the limit.
- **Plots.** A lattice clipped by streets into 304 plots (398 ha): 138 villas, 65 garden
  plots, 31 shops, 22 apartments, 14 gate lodges, 10 mansions, 8 restaurants, 8 club
  plots, 8 parkland. Median plot 13 072 m²; **76 % of plot area stays garden**; every plot
  meets the 1 400 m² minimum and the 42 % minimum garden fraction.
- **Landmark properties (7).** Vantage House (mansion, walled, crown), The Meridian Bay
  Hotel (46 m tower), Vantage Country Club (walled, with stables), Casa Lumen
  (cantilevered modern villa, walled), Belvedere Arcade (shopping arcade), Marchmont
  Heights (luxury apartments), The Lantern Club (walled private club).
- **Three generations of cladding** across 13 facades — estate (109), classic (176) and
  modern (111) — in stone, render, bronze glass, cedar and zinc, against the concrete and
  painted metal of the other districts.

## Grounds, water and walls

- **885 ground patches / 538 ha**: drives, terraces, formal gardens, lawns, forecourts,
  tennis courts, practice ground, kitchen gardens, plazas and woodland.
- **79 water features / 4.5 ha**: 60 pools, 18 infinity pools on the bluff edge, 1 fountain.
- **149 wall runs / 27.8 km**: 102 stone, 43 hedge, 4 railing. **53 gates**: 36 estate,
  10 house, 7 district.

## Interiors

Five buildings are enterable — 1.3 % of 396. Most of the district is deliberately closed.

| id | name | kind |
| --- | --- | --- |
| `vantage-house` | Vantage House | mansion |
| `meridian-hotel` | The Meridian Bay Hotel | hotel |
| `the-orangery` | The Orangery | restaurant |
| `marchmont-apartment` | Marchmont Heights | luxury apartment |
| `vantage-club` | Vantage Country Club | club |

## Prepared for later systems (not implemented here)

- **19 moving vehicles** — 11 saloons, 5 coupes, 2 SUVs, 1 limousine — on 47 lanes /
  45.9 km. That is deliberately lighter than the works' fleet and lighter again than
  downtown's; only 11 of 30 streets carry traffic, since private drives and estate lanes
  carry none. The boulevard's first car is forced to be a limousine, because at this fleet
  size a 10 % weight can roll empty.
- **599 parked luxury vehicles** (cars, sports cars, SUVs, limousines) as static
  placeholders for future traffic.
- **196 security props** — 153 cameras and 43 sentry boxes — plus 1 631 planted props,
  1 258 lights, benches, parasols, loungers, sculptures, flagpoles and topiary:
  4 809 props across 25 kinds.

**No NPC behaviour and no security AI.** Guards and cameras are static world dressing
only; `props.ts` contains no simulation, and the audit asserts that.

## Rendering & performance

`WealthyLayer` streams 500 m tiles on LOD 0–3, merging 2×2 at LOD ≥ 2, at 7 ms / 3 chunks
per frame, disposing tiles exactly as they leave. Static budget is
**137 730 triangles at LOD0** (buildings and walls; surfaces and props stream per tile),
collapsing to **3 960 triangles at LOD2** — a 35× reduction. Prop geometry is cached per
kind and 10 kinds are near-ring only.

## Verification

`npm run verify:wealthy` runs 35 checks and exits non-zero on failure; `tests/wealthy.test.ts`
asserts the same audit plus pinned counts.

Connectivity with the base map and the neighbouring districts is proven two ways:

1. **Physical link.** Every gate is measured against the *polyline* of its regional road,
   not just the nearest node. Worst gap **55.1 m** (Coastal Rise); the other six are
   6–30 m.
2. **Graph reachability.** A flood fill over the region-wide node graph from each gate's
   entry node reaches **6/6** targets: `downtown=downtownCore`, `industrial=industrial`,
   `suburban=suburbWest`, `beach=beachWest`, `residential=innerBelt`,
   `entertainment=entertainment`.

Also asserted: the street graph is 61/61 connected, no street runs through water or leaves
the reservation, no other reservation is built in (residential and entertainment included),
and every building stands inside the district, clear of carriageways and on its terrace.
