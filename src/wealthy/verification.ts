/**
 * Vantage Heights audit: roads, gates, fabric, grounds, connectivity to the base map and
 * to the neighbouring districts, streaming and the performance budget.
 *
 * `npm run verify:wealthy` prints these checks and exits non-zero if any line fails.
 */
import { DISTRICTS, NODES, ROADS } from '../world/data';
import { pointInPolygon, terrainHeight } from '../world/geometry';
import { polygonArea, pointToSegment } from '../city/geometry2d';
import { ESTATE_LIMITS, W_POLYGON, boundaryDistance, hillGround } from './frame';
import { W_IDENTITY, LANDMARK_ESTATES, INTERIOR_IDS } from './identity';
import { W_NETWORK, streetGrade, nearestStreet, type Street } from './plan';
import { ESTATE_GROUNDS, PLOTS, siteSummary } from './sites';
import {
  W_BUILDINGS, W_GARDENS, W_GATES, W_WALLS, W_WATERS, W_INTERIOR_BUILDINGS, wSummary,
  buildingsInBounds,
} from './buildings';
import { surfaceSummary } from './surfaces';
import { W_PROPS, propSummary } from './props';
import { LANES, VEHICLES, advanceTraffic, vehiclePose, trafficSummary } from './traffic';
import { wBuildingBuffers, wallBuffers, countTriangles } from './wmeshes';

export type Check = { name: string; ok: boolean; detail: string };

function check(out: Check[], name: string, ok: boolean, detail: string): void {
  out.push({ name, ok, detail });
}

/* ── the summary the CLI prints ───────────────────────────────────────────────── */

export const wealthySummary = (() => {
  const streetKm = W_NETWORK.streets.reduce((sum, s) => sum + s.length, 0) / 1000;
  const kinds = W_NETWORK.streets.reduce<Record<string, number>>((acc, s) => {
    acc[s.kind] = (acc[s.kind] ?? 0) + 1; return acc;
  }, {});
  const controls = W_NETWORK.junctions.reduce<Record<string, number>>((acc, j) => {
    acc[j.control] = (acc[j.control] ?? 0) + 1; return acc;
  }, {});
  const legacy = W_NETWORK.streets.filter(s => s.legacy);
  let grades = { through: 0, local: 0, worst: 0, worstId: '' };
  for (const street of W_NETWORK.streets) {
    const g = streetGrade(street).max;
    const local = street.kind === 'private' || street.kind === 'lane' || street.kind === 'pedestrian';
    if (local) grades.local = Math.max(grades.local, g);
    else grades.through = Math.max(grades.through, g);
    if (g > grades.worst) grades = { ...grades, worst: g, worstId: street.id };
  }
  const lod0Buildings = wBuildingBuffers(W_BUILDINGS, 0).triangles;
  const lod0Walls = countTriangles(wallBuffers(W_WALLS, 0));
  const lod2 = wBuildingBuffers(W_BUILDINGS, 2).triangles;
  return {
    district: W_IDENTITY.longName,
    streets: W_NETWORK.streets.length,
    streetKm: Math.round(streetKm * 100) / 100,
    kinds,
    junctions: W_NETWORK.junctions.length,
    controls,
    edges: W_NETWORK.edges.length,
    gates: W_NETWORK.gateways.length,
    estateGates: W_NETWORK.estateGates.length,
    roundabouts: W_NETWORK.roundabouts.length,
    viewpoints: W_NETWORK.viewpoints.length,
    signals: controls.signal ?? 0,
    legacyRoutes: legacy.map(s => s.name),
    grades: {
      through: Math.round(grades.through * 1000) / 10,
      local: Math.round(grades.local * 1000) / 10,
      worst: Math.round(grades.worst * 1000) / 10,
      worstId: grades.worstId,
    },
    buildings: wSummary.buildings,
    landmarks: wSummary.landmarks,
    interiors: wSummary.interiors,
    plots: siteSummary.count,
    plotAreaHa: siteSummary.areaHa,
    estateAreaHa: siteSummary.estateAreaHa,
    lod0Triangles: lod0Buildings + lod0Walls,
    lod2Triangles: lod2,
  };
})();

const S = wealthySummary;

/* ── connectivity to the base map ─────────────────────────────────────────────── */

/**
 * The reservations that do not touch the bluff, named so the audit says out loud that
 * they are kept clear rather than silently ignored.
 */
const OTHERS = ['residential', 'entertainment'] as const;

function districtOf(id: string) { return DISTRICTS.find(d => d.id === id)!; }

/** Gates on the reservation limit, grouped by which regional route they carry. */
function gateRoutes(): { gateId: string; routes: string[] }[] {
  return W_NETWORK.gateways.map(gate => ({
    gateId: gate.id,
    routes: gate.streets
      .map(id => W_NETWORK.streetById.get(id))
      .filter((s): s is Street => !!s && s.legacy)
      .map(s => s.name),
  }));
}

export function auditWealthy(): Check[] {
  const out: Check[] = [];

  /* 1. the street graph is connected */
  const adjacency = new Map<string, Set<string>>();
  for (const junction of W_NETWORK.junctions) adjacency.set(junction.id, new Set());
  for (const edge of W_NETWORK.edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const start = W_NETWORK.junctions[0]?.id;
  const seen = new Set<string>(start ? [start] : []);
  const pending = start ? [start] : [];
  while (pending.length) {
    const node = pending.pop()!;
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next); pending.push(next);
    }
  }
  check(out, 'street graph is fully connected',
    seen.size === W_NETWORK.junctions.length,
    `${seen.size}/${W_NETWORK.junctions.length} junctions reachable`);

  /* 2. the street vocabulary, and the contrast with the other two districts */
  const required = ['boulevard', 'ridge', 'scenic', 'collector', 'private', 'lane', 'pedestrian'];
  const missing = required.filter(kind => !(kind in S.kinds));
  check(out, 'the hill has its own street vocabulary: boulevard, winding roads, scenic route, private drives',
    missing.length === 0,
    `${S.streets} streets / ${S.streetKm} km · ${Object.entries(S.kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);

  /* 3. control hierarchy: gates and roundabouts, no signals at all */
  check(out, 'junctions are gated and circled — the district has no traffic signals',
    S.signals === 0 && S.roundabouts >= 3 && S.gates >= 6 && S.estateGates >= 8,
    `${S.signals} signals · ${S.roundabouts} roundabouts · ${S.gates} district gates · ${S.estateGates} estate gates`);

  /* 4. grades suit a hillside, and stay inside the regional audit's limits */
  check(out, 'grades suit a hillside (≤9% through routes, ≤12% private drives)',
    S.grades.through <= 9 && S.grades.local <= 12,
    `worst ${S.grades.worst}% (${S.grades.worstId}) · through ${S.grades.through}% · private ${S.grades.local}%`);

  /* 5. no street runs through water or off the reservation */
  let wet = 0, outside = 0;
  for (const street of W_NETWORK.streets) {
    for (const sample of street.samples) {
      if (hillGround(sample.x, sample.z) < 1.5) wet++;
      if (boundaryDistance(sample) < -2) outside++;
    }
  }
  check(out, 'no street runs through water or leaves the reservation', wet === 0 && outside === 0,
    `${wet} wet samples · ${outside} samples outside the limit`);

  /* 6. connectivity to the base map: every regional route carried through has a gate */
  const carried = new Set(W_NETWORK.streets.filter(s => s.legacy).map(s => s.name));
  const expectedRoutes = ['Coastway', 'Bluff Road', 'Valley Road', 'Foothill Road', 'Coastal Rise'];
  const missingRoutes = expectedRoutes.filter(name => !carried.has(name));
  check(out, 'connectivity to the base map: regional routes carried through on their authored alignments',
    missingRoutes.length === 0 && carried.size >= 5,
    `${carried.size} routes carried through: ${[...carried].join(', ')}`);

  /* 7. every gate physically meets the regional road it carries.
     Proximity is measured to the road's own polyline, not to a node: a gate 1 km from the
     nearest node still counts as connected only if the carriageways actually join. */
  const gatePoints = W_NETWORK.gateways.map(g => g.point);
  const roadPolyline = (id: string): { x: number; z: number }[] => {
    const road = ROADS.find(r => r.id === id)!;
    return [NODES[road.from], ...(road.via ?? []), NODES[road.to]].map(q => ({ x: q.x, z: q.z }));
  };
  const linkToRegional = (gate: { x: number; z: number }): { road: string; distance: number } => {
    let best = '', bd = Infinity;
    for (const road of ROADS) {
      const pts = roadPolyline(road.id);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointToSegment(gate, pts[i], pts[i + 1]).distance;
        if (d < bd) { bd = d; best = road.name; }
      }
    }
    return { road: best, distance: bd };
  };
  const links = gatePoints.map(gate => ({ ...linkToRegional(gate), gate }));
  const worstLink = links.reduce((a, b) => (b.distance > a.distance ? b : a));
  check(out, 'every gate physically joins the regional road it carries (gap under 60 m)',
    links.length >= 6 && links.every(l => l.distance < 60),
    `${links.length} gates · worst gap ${worstLink.distance.toFixed(1)} m onto ${worstLink.road} · ${links.map(l => l.distance.toFixed(0) + 'm').join(', ')}`);
  const gateRoutesList = gateRoutes();
  check(out, 'every gate sits on a route that continues outside the district',
    gateRoutesList.every(g => g.routes.length > 0),
    `${gateRoutesList.filter(g => g.routes.length).length}/${gateRoutesList.length} gates on a carried regional route`);

  /* 7b. the hillside is reachable from every other district over the regional graph.
     Walk the region-wide node graph from each gate's nearest regional node and require
     downtown, the works and all four neighbouring reservations to be in the component. */
  const regionalAdj = new Map<string, Set<string>>();
  for (const id of Object.keys(NODES)) regionalAdj.set(id, new Set());
  for (const road of ROADS) {
    regionalAdj.get(road.from)?.add(road.to);
    regionalAdj.get(road.to)?.add(road.from);
  }
  const componentOf = (start: string): Set<string> => {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      for (const next of regionalAdj.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next); stack.push(next);
      }
    }
    return seen;
  };
  const nearestNode = (p: { x: number; z: number }): { id: string; distance: number } => {
    let id = '', bd = Infinity;
    for (const [key, node] of Object.entries(NODES)) {
      const d = Math.hypot(node.x - p.x, node.z - p.z);
      if (d < bd) { bd = d; id = key; }
    }
    return { id, distance: bd };
  };
  const TARGETS = ['downtown', 'industrial', 'suburban', 'beach', 'residential', 'entertainment'];
  const districtNode = (id: string) => {
    const polygon = districtOf(id).polygon;
    const centre = {
      x: polygon.reduce((sum, q) => sum + q.x, 0) / polygon.length,
      z: polygon.reduce((sum, q) => sum + q.z, 0) / polygon.length,
    };
    return nearestNode(centre).id;
  };
  const targetNodes = TARGETS.map(id => ({ id, node: districtNode(id) }));
  const gateLinks = gatePoints.map(gate => {
    const entry = nearestNode(gate);
    const component = componentOf(entry.id);
    return { entry: entry.id, reaches: targetNodes.filter(t => component.has(t.node)).map(t => t.id) };
  });
  const shortReach = gateLinks.filter(l => l.reaches.length < TARGETS.length);
  check(out, 'connectivity: from every gate the whole region is reachable, downtown and the works included',
    shortReach.length === 0 && targetNodes.length === TARGETS.length,
    shortReach.length
      ? `${shortReach.length} gates miss: ${shortReach.map(l => `${l.entry}→${TARGETS.filter(t => !l.reaches.includes(t)).join('/')}`).join('; ')}`
      : `all ${gateLinks.length} gates reach ${targetNodes.length}/${targetNodes.length}: ${targetNodes.map(t => `${t.id}=${t.node}`).join(', ')}`);

  /* 8. no other reservation is built in */
  const overlaps = DISTRICTS.filter(d => d.id !== 'wealthy' &&
    W_BUILDINGS.some(b => pointInPolygon(b.centre.x, b.centre.z, d.polygon)));
  const propsOutside = W_PROPS.filter(p => DISTRICTS.some(d => d.id !== 'wealthy' &&
    pointInPolygon(p.x, p.z, d.polygon))).length;
  check(out, 'no other reservation is built in', overlaps.length === 0 && propsOutside === 0,
    overlaps.length ? `buildings found in: ${overlaps.map(d => d.id).join(', ')}` :
      `${DISTRICTS.length - 1} other footprints kept clear (${OTHERS.join(' and ')} included)`);

  /* 9. plots, estates and land use */
  check(out, 'plot layout covers the district, and landmark grounds are reserved whole',
    siteSummary.count > 220 && siteSummary.areaHa > 300 && ESTATE_GROUNDS.length === LANDMARK_ESTATES.length,
    `${siteSummary.count} plots · ${siteSummary.areaHa} ha · ${ESTATE_GROUNDS.length} landmark grounds / ${siteSummary.estateAreaHa} ha`);
  check(out, 'land use spreads across the hill (villas, mansions, apartments, shops, restaurants, clubs, gardens)',
    Object.keys(siteSummary.byUse).length >= 8 && (siteSummary.byUse.villa ?? 0) > 80,
    Object.entries(siteSummary.byUse).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  check(out, 'every zone of the district is used',
    Object.keys(siteSummary.byZone).length >= 7,
    `${Object.keys(siteSummary.byZone).length} zones: ${Object.keys(siteSummary.byZone).join(', ')}`);
  check(out, 'gardens dominate: no plot is built over more than it should be',
    siteSummary.gardenFraction > 0.6,
    `${Math.round(siteSummary.gardenFraction * 100)}% of plot area left as garden · median plot ${siteSummary.medianArea.toLocaleString('en-GB')} m²`);

  /* 10. landmark properties */
  const builtLandmarks = LANDMARK_ESTATES.filter(estate =>
    W_BUILDINGS.some(b => b.estateId === estate.id));
  const landmarkKinds = new Set(LANDMARK_ESTATES.map(e => e.kind));
  const requiredLandmarks = ['mansion', 'hotel', 'country-club', 'villa', 'arcade', 'apartments', 'club'];
  const missingLandmarks = requiredLandmarks.filter(kind => !landmarkKinds.has(kind as never));
  check(out, 'every landmark property is built: mansion, hotel, country club, modern villa, shopping arcade',
    builtLandmarks.length === LANDMARK_ESTATES.length && missingLandmarks.length === 0,
    `${builtLandmarks.length}/${LANDMARK_ESTATES.length}: ${LANDMARK_ESTATES.map(e => e.name).join(' · ')}`);

  /* 11. building roster */
  const requiredKinds = ['villa', 'mansion', 'apartments', 'tower', 'shop', 'restaurant', 'club', 'gate-lodge', 'garage', 'orangery'];
  const missingKinds = requiredKinds.filter(kind => !(kind in wSummary.byKind));
  check(out, 'building roster: villas, mansions, apartments, shops, restaurants, clubs, lodges',
    missingKinds.length === 0,
    `${Object.keys(wSummary.byKind).length} kinds · tallest ${S.buildings ? wSummary.tallest : 0} m · mean ${wSummary.meanHeight} m`);
  check(out, 'architecture contrasts the poorer districts: stone, render, bronze glass, cedar and zinc',
    Object.keys(wSummary.byFacade).length >= 10,
    `${Object.keys(wSummary.byFacade).length} claddings across ${Object.keys(wSummary.byVintage).length} generations (${Object.entries(wSummary.byVintage).map(([k, n]) => `${k} ${n}`).join(', ')})`);

  /* 12. interiors */
  const interiorKinds = W_INTERIOR_BUILDINGS.map(b => b.interior!);
  const requiredInteriors = ['vantage-house', 'meridian-hotel', 'the-orangery', 'marchmont-apartment'];
  const missingInteriors = requiredInteriors.filter(id => !interiorKinds.includes(id));
  const share = W_INTERIOR_BUILDINGS.length / W_BUILDINGS.length;
  check(out, 'interiors: mansion, hotel, restaurant, luxury apartment and the clubhouse',
    missingInteriors.length === 0 && INTERIOR_IDS.length === 5,
    `${W_INTERIOR_BUILDINGS.length}: ${interiorKinds.join(', ')}`);
  check(out, 'not every building is enterable', share < 0.05,
    `${W_INTERIOR_BUILDINGS.length}/${W_BUILDINGS.length} buildings (${(share * 100).toFixed(1)}%)`);

  /* 13. buildings stand inside the district and clear of the carriageways */
  let outsideFootprint = 0, inCorridor = 0, floating = 0;
  for (const building of W_BUILDINGS) {
    if (!pointInPolygon(building.centre.x, building.centre.z, W_POLYGON)) outsideFootprint++;
    const near = nearestStreet(building.centre.x, building.centre.z);
    if (near && near.street.kind !== 'pedestrian' &&
      near.distance < near.street.width / 2 + near.street.median / 2) inCorridor++;
    const ground = terrainHeight(building.centre.x, building.centre.z);
    if (building.base < ground - 0.6 || building.base > ground + 9) floating++;
  }
  check(out, 'buildings stand inside the district, clear of carriageways, on their terrace',
    outsideFootprint === 0 && inCorridor === 0 && floating === 0,
    `${outsideFootprint} outside the footprint · ${inCorridor} inside a carriageway · ${floating} off their terrace`);

  /* 14. navigation surfaces */
  check(out, 'navigation surfaces: carriageways, verges, lawns, drives, terraces and pools',
    surfaceSummary.pieces > 800 && surfaceSummary.kinds >= 8,
    `${surfaceSummary.pieces} pieces in a sample km² · ${surfaceSummary.kinds} surface kinds · ${surfaceSummary.groundHa} ha of ground`);

  /* 15. grounds and water */
  const waterKinds = Object.keys(wSummary.waterByKind);
  check(out, 'grounds: lawns, formal gardens, drives, tennis and practice ground',
    wSummary.gardens > 400 && Object.keys(wSummary.gardenByKind).length >= 8,
    `${wSummary.gardens} ground patches / ${wSummary.gardenHa} ha · ${Object.keys(wSummary.gardenByKind).join(', ')}`);
  check(out, 'swimming pools and fountains',
    (wSummary.waterByKind.pool ?? 0) > 20 && (wSummary.waterByKind.infinity ?? 0) > 4 && (wSummary.waterByKind.fountain ?? 0) >= 1 &&
    waterKinds.length >= 3,
    `${wSummary.waters} water features (${Object.entries(wSummary.waterByKind).map(([k, n]) => `${k} ${n}`).join(', ')}) · ${wSummary.poolHa} ha of water`);

  /* 16. walls and gates */
  check(out, 'walled and gated: estate perimeters, plot walls, hedges and railings',
    wSummary.wallKm > 20 && wSummary.gates > 40 && (wSummary.wallByKind.hedge ?? 0) > 0,
    `${wSummary.walls} wall runs / ${wSummary.wallKm} km · ${wSummary.gates} gates (${Object.entries(wSummary.gatesByKind).map(([k, n]) => `${k} ${n}`).join(', ')})`);

  /* 17. lanes and the light fleet */
  check(out, 'lane graph and a deliberately light fleet prepared for future vehicle gameplay',
    LANES.length > 30 && trafficSummary.laneKm > 40 && VEHICLES.length >= 18 && VEHICLES.length <= 40,
    `${trafficSummary.lanes} lanes / ${trafficSummary.laneKm} km · ${trafficSummary.vehicles} vehicles ${JSON.stringify(trafficSummary.byKind)}`);
  advanceTraffic(0.5);
  const poses = VEHICLES.map(vehiclePose).filter(p => p !== null);
  let offNetwork = 0;
  for (const pose of poses) {
    if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.angle)) { offNetwork++; continue; }
    const near = nearestStreet(pose.x, pose.z);
    if (!near || near.distance > 34) offNetwork++;
  }
  check(out, 'the fleet keeps a valid pose and stays on the street network',
    poses.length === VEHICLES.length && offNetwork === 0,
    `${poses.length}/${VEHICLES.length} poses valid · ${offNetwork} off the network`);
  check(out, 'quieter than downtown and the works: private drives and estate lanes carry no traffic',
    trafficSummary.quietStreets >= 15 && VEHICLES.length < 50,
    `${trafficSummary.servedStreets} of ${W_NETWORK.streets.length} streets carry traffic · ${trafficSummary.quietStreets} quiet`);

  /* 18. world detail: cameras, guard stands, planting, lighting, vehicles */
  check(out, 'world detail: security cameras, sentry boxes, planting, decorative lighting, parked cars',
    (propSummary.byKind['camera'] ?? 0) > 20 && (propSummary.byKind['guard-stand'] ?? 0) >= 10 &&
    propSummary.planting > 400 && propSummary.lighting > 400 && propSummary.parkedVehicles > 100,
    `${propSummary.count.toLocaleString('en-GB')} props across ${propSummary.kinds} kinds · ${propSummary.security} security · ${propSummary.planting} planted · ${propSummary.lighting} lights · ${propSummary.parkedVehicles} parked cars`);
  check(out, 'security and guard props are static dressing, not AI',
    !('guards' in propSummary) && (propSummary.byKind['guard-stand'] ?? 0) > 0,
    `${propSummary.byKind['guard-stand'] ?? 0} sentry boxes and ${propSummary.byKind['camera'] ?? 0} cameras, no NPC or AI in this district`);

  /* 19. elevated terrain and views */
  let minH = Infinity, maxH = -Infinity;
  for (let x = -4790; x <= -1680; x += 120) {
    for (let z = 800; z <= 3520; z += 120) {
      if (!pointInPolygon(x, z, W_POLYGON)) continue;
      const h = terrainHeight(x, z);
      minH = Math.min(minH, h); maxH = Math.max(maxH, h);
    }
  }
  check(out, 'the district keeps its hill: elevated terrain with scenic viewpoints over the bay',
    minH > 40 && maxH > 120 && W_NETWORK.viewpoints.length >= 3,
    `${Math.round(minH)}–${Math.round(maxH)} m · ${W_NETWORK.viewpoints.length} viewpoints on ${W_NETWORK.streets.filter(s => s.scenic).length} scenic routes`);

  /* 20. LOD budgets */
  check(out, 'aggressive LOD: detailed ring under 160k static triangles district-wide',
    S.lod0Triangles < 160_000 && S.lod0Triangles > 40_000,
    `${S.lod0Triangles.toLocaleString('en-GB')} triangles (buildings and walls — surfaces and props stream per tile)`);
  check(out, 'distant LOD collapses the district to massing',
    S.lod2Triangles < 12_000 && S.lod2Triangles * 8 < S.lod0Triangles,
    `${S.lod2Triangles.toLocaleString('en-GB')} triangles at LOD2 vs ${S.lod0Triangles.toLocaleString('en-GB')} at LOD0`);

  /* 21. a tile only draws what it touches */
  const sampleBounds = { minX: -4200, minZ: 1100, maxX: -3200, maxZ: 2100 };
  const drawn = buildingsInBounds(sampleBounds);
  const stray = drawn.filter(b => {
    const box = b.polygon;
    return box.every(p => p.x < sampleBounds.minX || p.x > sampleBounds.maxX || p.z < sampleBounds.minZ || p.z > sampleBounds.maxZ);
  });
  check(out, 'a tile only draws the buildings it touches', stray.length === 0,
    `${drawn.length} buildings in a sample tile · ${stray.length} drawn outside it`);

  /* 22. minimum plot and garden rules hold */
  const smallPlots = PLOTS.filter(p => p.area < ESTATE_LIMITS.minPlotArea).length;
  const densePlots = PLOTS.filter(p => p.gardenFraction < ESTATE_LIMITS.minGardenFraction).length;
  check(out, 'plot rules: minimum size and a garden on every built plot',
    smallPlots === 0 && densePlots === 0,
    `${smallPlots} undersized plots · ${densePlots} plots under ${Math.round(ESTATE_LIMITS.minGardenFraction * 100)}% garden`);

  /* 23. props are all inside or beside the reservation */
  const strayProps = W_PROPS.filter(p => boundaryDistance(p) < -120).length;
  check(out, 'props stay on the hill', strayProps === 0, `${strayProps} props more than 120 m outside the limit`);

  return out;
}

export function wealthyPasses(): boolean {
  return auditWealthy().every(c => c.ok);
}

export { polygonArea, gateRoutes };
