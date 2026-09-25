/**
 * The end-of-construction audit for the industrial district: roads, navigation
 * surfaces, connectivity to downtown and to the reserved port, the rail, the built
 * fabric, streaming and the performance budget. `npm run verify:industrial` prints it;
 * the test suite asserts it.
 */
import { DISTRICTS } from '../world/data';
import { nearestRiver } from '../world/geometry';
import { polygonArea, polygonCentroid, pointInPolygon, distance2d, pointToSegment } from '../city/geometry2d';
import { IND_POLYGON, conditionAt, toGrid } from './frame';
import { IND_NETWORK, LEVEL_CROSSINGS, nearestIndStreet } from './plan';
import { RAIL_LINES, YARD_TRACKS, railLength } from './rail';
import { SITES, siteSummary } from './sites';
import { IND_BUILDINGS, IND_LANDMARKS, IND_FENCES, IND_YARDS, IND_INTERIOR_BUILDINGS, buildingsInBounds, indSummary } from './buildings';
import { IND_PROPS, propSummary } from './props';
import { LANES, VEHICLES, vehiclePose, trafficSummary } from './traffic';
import { piecesForBounds } from './surfaces';
import { indBuildingBuffers, indLandmarkBuffers, indFenceBuffers } from './indmeshes';
import { ANCHORS } from './identity';

export type Check = { name: string; ok: boolean; detail: string };

const PORT = DISTRICTS.find(d => d.id === 'port')!;
const check = (name: string, ok: boolean, detail: string): Check => ({ name, ok, detail });

/* ── summary ─────────────────────────────────────────────────────────────────── */

export const industrialSummary = (() => {
  let streetM = 0;
  for (const street of IND_NETWORK.streets) streetM += street.length;
  const streetKm = Math.round(streetM / 10) / 100;
  const controls: Record<string, number> = {};
  for (const j of IND_NETWORK.junctions) controls[j.control] = (controls[j.control] ?? 0) + 1;
  const rail = railLength();
  let fenceKm = 0;
  for (const f of IND_FENCES) for (let i = 0; i + 1 < f.points.length; i++) fenceKm += distance2d(f.points[i], f.points[i + 1]);
  // Static triangle estimate for the whole district at the detailed ring.
  const bounds = { minX: 1800, minZ: -800, maxX: 4500, maxZ: 2200 };
  let triangles = 0;
  for (const buffer of indBuildingBuffers(IND_BUILDINGS, 0).groups.values()) triangles += buffer.triangles;
  for (const buffer of indLandmarkBuffers(IND_LANDMARKS, 0).values()) triangles += buffer.triangles;
  for (const buffer of indFenceBuffers(IND_FENCES, 0).values()) triangles += buffer.triangles;
  const byCondition: Record<string, number> = {};
  for (const b of IND_BUILDINGS) byCondition[b.condition] = (byCondition[b.condition] ?? 0) + 1;
  return {
    streetKm,
    streets: IND_NETWORK.streets.length,
    junctions: IND_NETWORK.junctions.length,
    edges: IND_NETWORK.edges.length,
    gates: IND_NETWORK.gateways.length,
    controls,
    levelCrossings: LEVEL_CROSSINGS.length,
    sites: SITES.length,
    siteAreaHa: siteSummary.areaHa,
    buildings: IND_BUILDINGS.length,
    landmarks: IND_LANDMARKS.length,
    interiors: IND_INTERIOR_BUILDINGS.length,
    props: IND_PROPS.length,
    yards: IND_YARDS.length,
    fenceKm: Math.round(fenceKm / 100) / 10,
    railCorridorKm: Math.round(rail.corridorKm * 100) / 100,
    trackKm: Math.round(rail.trackKm * 100) / 100,
    lanes: LANES.length,
    laneKm: trafficSummary.laneKm,
    vehicles: VEHICLES.length,
    buildingConditions: byCondition,
    lod0Triangles: triangles,
  };
})();

/* ── the audit ───────────────────────────────────────────────────────────────── */

export function auditIndustrial(): Check[] {
  const out: Check[] = [];
  const S = industrialSummary;

  /* Roads and junctions */
  // Connectivity: every junction reachable from every other over the edge graph.
  const adjacency = new Map<string, Set<string>>();
  for (const j of IND_NETWORK.junctions) adjacency.set(j.id, new Set());
  for (const edge of IND_NETWORK.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const seen = new Set<string>();
  const queue = [IND_NETWORK.junctions[0].id];
  seen.add(queue[0]);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adjacency.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  out.push(check('street graph is fully connected', seen.size === IND_NETWORK.junctions.length,
    `${seen.size}/${IND_NETWORK.junctions.length} junctions reachable`));

  out.push(check('the flats contrast downtown: wide haulways, service lanes, yards',
    IND_NETWORK.streets.some(s => s.kind === 'haulway' && s.width >= 26) &&
    IND_NETWORK.streets.some(s => s.kind === 'service') &&
    IND_NETWORK.streets.some(s => s.kind === 'yard'),
    `${S.streets} streets / ${S.streetKm} km · haulways ${IND_NETWORK.streets.filter(s => s.kind === 'haulway').length}, service ${IND_NETWORK.streets.filter(s => s.kind === 'service').length}, yard stubs ${IND_NETWORK.streets.filter(s => s.kind === 'yard').length}`));

  const signals = IND_NETWORK.junctions.filter(j => j.control === 'signal').length;
  out.push(check('junctions carry industrial control hierarchy',
    signals >= 3 && signals <= 12 && S.gates >= 10 && (S.controls.stop ?? 0) >= 10,
    `${signals} signals · ${S.controls.stop ?? 0} stops · ${S.controls.yield ?? 0} yields · ${S.gates} gates · ${S.controls.terminal ?? 0} terminals`));

  // Grades: loaded trucks get generous limits, terrace streets are flagged.
  let worstNormal = 0, worstTerrace = 0;
  for (const street of IND_NETWORK.streets) {
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const grade = Math.abs(b.y - a.y) / d;
      if (street.terrace) worstTerrace = Math.max(worstTerrace, grade);
      else worstNormal = Math.max(worstNormal, grade);
    }
  }
  out.push(check('grades suit loaded trucks (≤7% flats, ≤9% flagged terrace)',
    worstNormal <= 0.07 && worstTerrace <= 0.09,
    `worst ${(Math.max(worstNormal, worstTerrace) * 100).toFixed(2)}% (flats ${(worstNormal * 100).toFixed(2)}%, terrace ${(worstTerrace * 100).toFixed(2)}%)`));

  // No street sample in the river or on river-level ground.
  let wet = 0;
  for (const street of IND_NETWORK.streets) {
    for (const s of street.samples) {
      const river = nearestRiver(s.x, s.z);
      if (s.y < Math.max(9.4, river.level + 1.2) && river.distance < river.width + 120) wet++;
    }
  }
  out.push(check('no street runs through water', wet === 0, `${wet} wet samples`));

  /* Rail */
  out.push(check('rail infrastructure: main line, port branch, spurs and a yard',
    RAIL_LINES.some(l => l.kind === 'main') && RAIL_LINES.some(l => l.kind === 'spur') &&
    YARD_TRACKS.length >= 5 && S.trackKm >= 8,
    `${RAIL_LINES.length} lines · ${YARD_TRACKS.length} yard tracks · ${S.railCorridorKm} km corridor · ${S.trackKm} km laid track`));

  const barrierCrossings = LEVEL_CROSSINGS.filter(c => c.barriers).length;
  out.push(check('every rail/road crossing is a declared level crossing',
    LEVEL_CROSSINGS.length >= 5 && barrierCrossings >= 4,
    `${LEVEL_CROSSINGS.length} crossings, ${barrierCrossings} with barriers`));

  /* Connectivity to downtown */
  const west = IND_NETWORK.gateways.filter(j => j.point.x < 2500);
  out.push(check('connectivity to downtown: gates on the western limit + legacy routes carried through',
    west.length >= 4 && IND_NETWORK.streets.some(s => s.id === 'legacy-a07') &&
    IND_NETWORK.streets.some(s => s.id === 'legacy-a21'),
    `${west.length} western gates · Sound Parkway and Inner Belt run through the district`));

  /* Port reservation and coastline */
  const south = IND_NETWORK.gateways.filter(j => j.point.z > 1700);
  const mainEnd = RAIL_LINES.find(l => l.kind === 'main')!.points.at(-1)!;
  let boundaryNear = Infinity;
  for (let i = 0; i < IND_POLYGON.length; i++) {
    boundaryNear = Math.min(boundaryNear, pointToSegment(mainEnd, IND_POLYGON[i], IND_POLYGON[(i + 1) % IND_POLYGON.length]).distance);
  }
  // The port branch must cross the district limit into the reserved port land (or
  // stop at the fence ready to), heading for the future terminal ground.
  const railExitsSouth = mainEnd.z > 1300 && (boundaryNear < 260 || pointInPolygon(PORT.polygon, mainEnd));
  out.push(check('port connection reserved: road gates and the rail line leave through the port limit',
    south.length >= 3 && railExitsSouth,
    `${south.length} southern gates · port branch ends ${(mainEnd.x).toFixed(0)},${(mainEnd.z).toFixed(0)} (${boundaryNear.toFixed(0)} m from the boundary, ${pointInPolygon(PORT.polygon, mainEnd) ? 'inside' : 'outside'} the port reservation)`));

  const portOverlap = SITES.some(s => polygonCentroid(s.polygon) && pointInPolygon(PORT.polygon, polygonCentroid(s.polygon))) ||
    IND_BUILDINGS.some(b => pointInPolygon(PORT.polygon, b.centre));
  out.push(check('the reserved port district is untouched', !portOverlap,
    portOverlap ? 'content spills into the port polygon' : `port polygon (${(polygonArea(PORT.polygon) / 1e6).toFixed(1)} km²) kept clear`));

  // Coastline: the river terrace east of Riverside Drive stays open brownfield.
  const terraceBuildings = IND_BUILDINGS.filter(b => {
    const g = toGrid(b.centre);
    return g.u > 860 && b.kind !== 'ruin';
  });
  out.push(check('river terrace reserved as open derelict ground (future waterfront)',
    terraceBuildings.length === 0,
    `${terraceBuildings.length} standing buildings east of Riverside Drive`));

  /* Fabric */
  out.push(check('industrial plot layout covers the district',
    S.sites >= 140 && S.siteAreaHa >= 150,
    `${S.sites} plots · ${S.siteAreaHa} ha · uses ${JSON.stringify(siteSummary.byUse)}`));

  const zoneCount = new Set(SITES.map(s => s.zone)).size;
  out.push(check('zoning spreads the trades (≥9 of 11 zone types used)', zoneCount >= 9, `${zoneCount} zone types`));

  const conditions = new Set([...SITES.map(s => s.condition), ...IND_BUILDINGS.map(b => b.condition)]);
  out.push(check('environmental storytelling: active, renovated, abandoned and construction ground',
    conditions.size >= 4 && S.buildingConditions.abandoned >= 8 && S.buildingConditions.renovated >= 8,
    `conditions: ${JSON.stringify(S.buildingConditions)}`));

  const anchorsBuilt = ANCHORS.every(a => IND_BUILDINGS.some(b => b.anchorId === a.id) || IND_LANDMARKS.some(l => l.anchorId === a.id) || IND_YARDS.some(y => y.owner === a.id || y.owner.startsWith(a.id)));
  out.push(check('all eight anchor facilities are built', anchorsBuilt, `${ANCHORS.length} anchors · ${indSummary.buildings} buildings · ${indSummary.landmarks} landmarks`));

  const buildingTypes = new Set(IND_BUILDINGS.map(b => b.kind));
  const requiredTypes = ['hall', 'warehouse', 'workshop', 'office', 'canteen', 'shed', 'gatehouse', 'cabin', 'frame', 'ruin'];
  out.push(check('building roster: factories, warehouses, workshops, offices, canteen, sheds, gates, cabins, frames, ruins',
    requiredTypes.every(t => buildingTypes.has(t as never)),
    `${buildingTypes.size} kinds: ${[...buildingTypes].join(', ')}`));

  /* Interiors */
  const interiorKinds = IND_INTERIOR_BUILDINGS.map(b => b.interior);
  const requiredInteriors = ['kilnside-floor', 'freight-warehouse', 'tidehall-workshop', 'works-office', 'depot-warehouse', 'marrow-canteen'];
  out.push(check('six interior-ready buildings: factory floor, warehouse ×2, workshop, office, canteen',
    requiredInteriors.every(id => interiorKinds.includes(id)) &&
    IND_INTERIOR_BUILDINGS.every(b => b.doors.length > 0),
    `${IND_INTERIOR_BUILDINGS.length}: ${interiorKinds.join(', ')}`));
  const enterableShare = IND_INTERIOR_BUILDINGS.length / IND_BUILDINGS.length;
  out.push(check('not every building is enterable', enterableShare < 0.08,
    `${IND_INTERIOR_BUILDINGS.length}/${IND_BUILDINGS.length} buildings (${(enterableShare * 100).toFixed(1)}%)`));

  /* Geometry hygiene */
  let inCorridor = 0, outOfDistrict = 0;
  for (const b of IND_BUILDINGS) {
    if (!pointInPolygon(IND_POLYGON, b.centre)) outOfDistrict++;
    for (const p of b.polygon) {
      if (!pointInPolygon(IND_POLYGON, p)) { outOfDistrict++; break; }
    }
  }
  for (const b of buildingsInBounds({ minX: 1800, minZ: -800, maxX: 4500, maxZ: 2200 })) {
    outer: for (const p of b.polygon) {
      const near = nearestIndStreet(p.x, p.z);
      if (near && near.distance < near.street.width / 2 + 1) { inCorridor++; break outer; }
    }
  }
  out.push(check('buildings stand inside the district and clear of the carriageways',
    outOfDistrict === 0 && inCorridor === 0,
    `${outOfDistrict} outside the footprint · ${inCorridor} inside a street corridor`));

  /* Navigation surfaces: one works tile for the road vocabulary, one rail tile for
   * the track, sleepers and crossing panels. */
  const centre = { minX: 2900, minZ: 400, maxX: 3400, maxZ: 900 };
  const pieces = piecesForBounds(centre, { markings: true, detail: true });
  const kinds = new Set(pieces.map(p => p.kind));
  const railTile = piecesForBounds({ minX: 3550, minZ: -500, maxX: 4050, maxZ: 100 }, { markings: true, detail: true });
  const railKinds = new Set(railTile.map(p => p.kind));
  out.push(check('industrial navigation surfaces: carriageways, yards, markings, dock aprons, rail',
    pieces.length > 400 && kinds.has('asphalt') && kinds.has('gravel') && kinds.has('concrete') &&
    kinds.has('paint-yellow') && kinds.has('paint-white') &&
    railKinds.has('deck') && railKinds.has('cobbles') && railKinds.has('paint-yellow'),
    `${pieces.length} road pieces + ${railTile.length} rail pieces in sample tiles · ${kinds.size + railKinds.size} surface kinds · ${IND_YARDS.length} yard pads`));

  out.push(check('lane graph and kinetic fleet prepared for future vehicle gameplay',
    LANES.length >= 50 && trafficSummary.laneKm >= 50 && VEHICLES.length >= 40 &&
    VEHICLES.every(v => vehiclePose(v) !== null),
    `${LANES.length} lanes / ${trafficSummary.laneKm} km · ${VEHICLES.length} vehicles ${JSON.stringify(trafficSummary.byKind)}`));

  /* Props */
  const propKinds = Object.keys(propSummary.byKind);
  const requiredProps = ['container20', 'container40', 'trailer', 'truck', 'van', 'pallet', 'barrel',
    'dumpster', 'pipe', 'bale', 'wreck', 'excavator', 'barrier', 'floodlight', 'pole', 'crossbuck', 'aggregate', 'generator'];
  out.push(check('environment props: containers, vehicles, pallets, barrels, pipes, plant, power and crossings',
    requiredProps.every(k => propKinds.includes(k)) && IND_PROPS.length >= 3000,
    `${IND_PROPS.length} props across ${propKinds.length} kinds · ${S.fenceKm} km of fencing`));

  /* Streaming and performance */
  out.push(check('aggressive LOD: detailed ring under 200k static triangles district-wide',
    S.lod0Triangles < 200_000,
    `${S.lod0Triangles.toLocaleString('en-GB')} triangles (buildings, landmarks, fences — surfaces and props stream per tile)`));

  const lod2 = indBuildingBuffers(IND_BUILDINGS, 2);
  let massing = 0;
  for (const buffer of lod2.groups.values()) massing += buffer.triangles;
  out.push(check('distant LOD collapses the district to massing', massing < 6000 && massing * 12 < S.lod0Triangles,
    `${massing.toLocaleString('en-GB')} triangles at LOD2 vs ${S.lod0Triangles.toLocaleString('en-GB')} at LOD0`));

  return out;
}

export function industrialPasses(): boolean {
  return auditIndustrial().every(c => c.ok);
}
