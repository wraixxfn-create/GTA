# Industrial District — "Marrow Reach Works"

5.4 km² of riverward flats east of downtown, constructed in `src/industrial/`.
It carries the Sound Parkway / Inner Belt regional roads straight through, connects
to downtown by eight western gates, and is deliberately *aimed* at the reserved
port district: road gates cross the southern limit and the freight rail branch
ends 221 m inside the port reservation, ready for the future terminal.

## Layout logic

- **Street grid.** Four haulways (30 m, truck routes, signalised) crossed by
  boulevards (24 m), secondary streets (18 m), service lanes (11 m, warehouses
  back-to-back) and yard stubs (8.5 m). 26 streets / 27.9 km, 69 junctions on a
  control hierarchy: 20 gate terminals, 22 stops, 15 yields, 6 signals. The wide,
  sparse rhythm is the opposite of downtown's tight block grid.
- **Rail.** A single-track main line runs north–south on the eastern edge with a
  port branch leaving the south limit, plus five works spurs (kilnside, scrap,
  freight hub, marrow yard ×2) and a six-track yard/station. 8.85 km laid track;
  all seven road crossings are declared level crossings with barrier equipment.
- **Plots.** A superblock lattice clipped by streets and anchor rectangles, split
  into 204 sites (193 ha): yards, warehouses, factories, offices, workshops,
  parking, derelict ground and construction lots — every use appears in nine or
  more of the eleven zones.
- **Anchor facilities (8).** Kilnside Brickworks (renovated, rail-served),
  Cinder Point Aggregate (active), the Works Admin complex (renovated),
  Meridian Freight Hub (active, rail-served), Tidehall Marine Works (active),
  Marrow Yard Container Terminal (active, rail-served), Brackewater Depot
  (abandoned, rail-served), Eastbank Civil Works Site (construction).
- **Environmental storytelling.** Condition blobs paint the district: a renovated
  band around the works, an abandoned pocket (Brackewater), a live construction
  site (Eastbank), the rest active — 159 buildings and their fencing, props and
  yard dressing inherit the condition of their ground.
- **River terrace.** Everything east of Riverside Drive is kept as open derelict
  ground — future waterfront, no standing buildings.

## Interiors

Six buildings are interior-ready (floors, lights, doors that gameplay can open):
the kilnside factory floor, two warehouses (freight hub, works depot), the
tidehall workshop, the works office, and the marrow yard canteen. That is 3.8% of
the roster — deliberately not every building is enterable.

## Prepared for later systems (not implemented here)

- 68 vehicle lanes / 75.3 km with a kinetic fleet of 50 trucks, lorries, vans and
  cars (`traffic.ts`) — the groundwork for deliveries, chases and industrial
  traffic missions.
- Wide haulways, long sightlines, fenced yards with gate terminals: spaces for
  stealth, shootouts and faction activity.
- Loading docks (289 dock doors), yard pads and the reserved port limit.

## Rendering & performance

- `IndustrialLayer.ts` streams 500 m tiles inside the district polygon on a
  7 ms budget: surfaces at LOD ≤ 2, buildings/landmarks/fences/props at LOD ≤ 1,
  merged massing at LOD ≥ 2; the fleet rides three persistent InstancedMeshes.
- LOD0 static triangle budget district-wide: **104k** (buildings, landmarks,
  fences); surfaces and props stream per tile (~1.7k pieces in a dense tile).
- Fencing renders as ribbon strips with sparse instanced posts — per-panel
  geometry would cost ~360k triangles for 71.5 km.

## Verification

`npm run verify:industrial` — 24 checks covering graph connectivity, street
vocabulary, control hierarchy, grades (≤7% flats), water, rail and level
crossings, downtown gates and legacy route carry-through, the port reservation,
plot/building hygiene, interiors, navigation surfaces, lanes, props and LOD
budgets. `tests/industrial.test.ts` pins the same invariants.
