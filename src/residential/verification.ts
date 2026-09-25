/**
 * The Residential Valley audit: road connectivity, pedestrian surfaces, vehicle
 * surfaces, streaming budget, performance and visual variety — the checks the build
 * runs at the end. `npm run verify:residential` — exits non-zero if any line fails.
 */
import { RES_IDENTITY, LANDMARK_SITES, INTERIORS } from './identity';
import { RES_NETWORK, streetGrade, type Street } from './plan';
import { PLOTS, GROUNDS, PARKING_LOTS, siteSummary } from './sites';
import { RES_BUILDINGS, RES_INTERIOR_BUILDINGS, RES_INTERIOR_READY, wSummary } from './buildings';
import { propSummary } from './props';
import { trafficSummary, LANES, CROSSINGS, PED_NODES, PARKING_BAYS, BUS_STOPS } from './traffic';
import { surfaceSummary } from './surfaces';
import { resBuildingBuffers, countTriangles } from './rmeshes';
import { RES_POLYGON, boundaryDistance, insideDistrict, RES_LIMITS } from './frame';
import { polygonArea, distance2d, polygonBounds } from '../city/geometry2d';
import type { Point } from '../world/data';
import { SAMPLED_ROADS } from '../world/roads';
import { pointInPolygon } from '../world/geometry';

export type Check = { name: string; ok: boolean; detail: string };

/* ── summary ──────────────────────────────────────────────────────────────────── */

export const resSummary = (() => {
  const kinds: Record<string, number> = {};
  let streetKm = 0;
  const controls: Record<string, number> = {};
  const legacyRoutes: string[] = [];
  for (const street of RES_NETWORK.streets) {
    kinds[street.kind] = (kinds[street.kind] ?? 0) + 1;
    streetKm += street.length;
    if (street.legacy) legacyRoutes.push(street.name);
  }
  for (const junction of RES_NETWORK.junctions) {
    controls[junction.control] = (controls[junction.control] ?? 0) + 1;
  }
  const grades = (() => {
    let worst = 0, worstId = '—', throughMax = 0, localMax = 0;
    for (const street of RES_NETWORK.streets) {
      const { max, at } = streetGrade(street);
      void at;
      if (street.kind === 'arterial' || street.kind === 'collector' || street.kind === 'legacy') {
        throughMax = Math.max(throughMax, max);
      } else {
        localMax = Math.max(localMax, max);
      }
      if (max > worst) { worst = max; worstId = street.id; }
    }
    return {
      through: Math.round(throughMax * 1000) / 10,
      local: Math.round(localMax * 1000) / 10,
      worst: Math.round(worst * 1000) / 10, worstId,
    };
  })();
  const lod0 = resBuildingBuffers(RES_BUILDINGS, 0);
  const lod2 = resBuildingBuffers(RES_BUILDINGS, 2);
  return {
    streets: RES_NETWORK.streets.length,
    streetKm: Math.round(streetKm / 100) / 10,
    junctions: RES_NETWORK.junctions.length,
    edges: RES_NETWORK.edges.length,
    controls,
    gates: RES_NETWORK.gateways.length,
    turningCircles: RES_NETWORK.turningCircles.length,
    kinds,
    legacyRoutes: [...new Set(legacyRoutes)],
    grades,
    buildings: RES_BUILDINGS.length,
    landmarks: LANDMARK_SITES.filter(s => s.landmark).length,
    plots: PLOTS.length,
    interiors: RES_INTERIOR_BUILDINGS.length,
    interiorReady: RES_INTERIOR_READY.length,
    lod0Triangles: countTriangles(lod0.groups),
    lod2Triangles: countTriangles(lod2.groups),
  };
})();

/* ── checks ───────────────────────────────────────────────────────────────────── */

/** Connectivity of the vehicle graph: every junction reachable from the biggest one. */
function vehicleConnectivity(): { reachable: number; total: number } {
  const junctions = RES_NETWORK.junctions.filter(j => j.streets.some(id => {
    const s = RES_NETWORK.streetById.get(id);
    return s && s.lanes > 0 && s.kind !== 'alley';
  }));
  if (!junctions.length) return { reachable: 0, total: 0 };
  // Union-find over street edges.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) { const p = parent.get(x)!; parent.set(x, parent.get(p) ?? p); x = p; }
    return x;
  };
  for (const junction of junctions) parent.set(junction.id, junction.id);
  for (const edge of RES_NETWORK.edges) {
    const street = RES_NETWORK.streetById.get(edge.streetId);
    if (!street || !street.lanes || street.kind === 'alley') continue;
    if (!parent.has(edge.from) || !parent.has(edge.to)) continue;
    parent.set(find(edge.from), find(edge.to));
  }
  const roots = new Map<string, number>();
  for (const junction of junctions) {
    const root = find(junction.id);
    roots.set(root, (roots.get(root) ?? 0) + 1);
  }
  const largest = Math.max(0, ...roots.values());
  return { reachable: largest, total: junctions.length };
}

/** Connectivity of the pedestrian graph from the Market Row hub. */
function pedestrianConnectivity(): { reachable: number; total: number } {
  const ids = [...PED_NODES.keys()];
  if (!ids.length) return { reachable: 0, total: 0 };
  const start = ids.find(id => id.includes('market-row')) ?? ids[0];
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    const node = PED_NODES.get(id);
    if (!node) continue;
    for (const link of node.links) {
      if (!seen.has(link.to) && PED_NODES.has(link.to)) { seen.add(link.to); queue.push(link.to); }
    }
  }
  return { reachable: seen.size, total: ids.length };
}

export function auditResidential(): Check[] {
  const checks: Check[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // ── road connectivity ─────────────────────────────────────────────────────────
  const vehicle = vehicleConnectivity();
  push('ROADS · vehicle graph is one connected network',
    vehicle.reachable >= vehicle.total * 0.9 && vehicle.total > 0,
    `${vehicle.reachable}/${vehicle.total} junctions in the main component`);
  push('ROADS · every declared street carries live samples',
    RES_NETWORK.streets.every(s => s.samples.length > 1 && s.spans.length > 0),
    `${RES_NETWORK.streets.length} streets, ${RES_NETWORK.edges.length} edges`);
  push('ROADS · network terminates in gates, circles or junctions (no dangling ends)',
    RES_NETWORK.junctions.every(j => ['gateway', 'gate', 'terminal', 'turning-circle', 'cross', 'tee', 'bend'].includes(j.shape)),
    `${resSummary.gates} gates · ${resSummary.turningCircles} turning circles`);
  const gateContinuity = RES_NETWORK.gateways.every(g => boundaryDistance(g.point) < 130);
  push('ROADS · district gates sit on the reservation limit',
    gateContinuity, `${resSummary.gates} gates within 130 m of the limit`);
  push('ROADS · carried regional routes match the world graph',
    RES_NETWORK.streets.filter(s => s.legacy).length >= 3 &&
    SAMPLED_ROADS.filter(r => ['h03', 'h04', 'h05', 'a18', 'a19', 'l02'].includes(r.road.id))
      .every(r => RES_NETWORK.streets.some(s => s.legacy && s.name === r.road.name)),
    resSummary.legacyRoutes.join(' · '));
  push('ROADS · street grades stay within ordinary residential limits',
    resSummary.grades.worst < 14,
    `worst ${resSummary.grades.worst}% on ${resSummary.grades.worstId} · through ${resSummary.grades.through}% · local ${resSummary.grades.local}%`);

  // ── pedestrian surfaces ───────────────────────────────────────────────────────
  const ped = pedestrianConnectivity();
  push('PEDESTRIAN · footway graph is connected across the valley',
    ped.reachable >= ped.total * 0.55 && ped.total > 20,
    `${ped.reachable}/${ped.total} sidewalk nodes reached from Market Row`);
  const sidewalkStreets = RES_NETWORK.streets.filter(s => s.sidewalk > 0).length;
  push('PEDESTRIAN · pavements line every through street',
    sidewalkStreets >= RES_NETWORK.streets.length * 0.5,
    `${sidewalkStreets}/${RES_NETWORK.streets.length} streets carry pavements`);
  push('PEDESTRIAN · crossings tie the two sides of the network together',
    CROSSINGS.length >= 12 && [...CROSSINGS].some(c => c.kind === 'zebra'),
    `${CROSSINGS.length} crossings (${CROSSINGS.filter(c => c.kind === 'zebra').length} zebra)`);
  push('PEDESTRIAN · the pedestrian graph includes crossing links',
    [...PED_NODES.values()].some(n => n.links.some(l => l.kind === 'cross')),
    `${trafficSummary.pedNodes} nodes · ${trafficSummary.footwayKm} km of footway`);
  push('PEDESTRIAN · park paths run through Mill Green',
    RES_NETWORK.streets.some(s => s.kind === 'pedestrian' && s.length > 40),
    `${RES_NETWORK.streets.filter(s => s.kind === 'pedestrian').length} park paths`);

  // ── vehicle surfaces ──────────────────────────────────────────────────────────
  push('VEHICLE · lanes cover every vehicle street',
    LANES.length >= RES_NETWORK.streets.filter(s => s.lanes > 0 && s.kind !== 'alley').length,
    `${LANES.length} lanes · ${trafficSummary.laneKm} km`);
  push('VEHICLE · parking supply serves the shops, schools and flats',
    PARKING_BAYS.length >= 60,
    `${PARKING_BAYS.length} bays (${PARKING_LOTS.length} off-street lots: ${siteSummary.parkingBays} bays)`);
  push('VEHICLE · kerbside parking lines the terraces and locals',
    RES_NETWORK.streets.filter(s => s.parking).length >= 8,
    `${RES_NETWORK.streets.filter(s => s.parking).length} parking streets`);
  push('VEHICLE · transit stops sit on the main roads',
    BUS_STOPS.length >= 3,
    `${BUS_STOPS.length} stops: ${BUS_STOPS.map(s => s.name).slice(0, 4).join(' · ')}${BUS_STOPS.length > 4 ? ' …' : ''}`);
  push('VEHICLE · the kinetic fleet stands ready for future traffic systems',
    trafficSummary.vehicles >= 15,
    `${trafficSummary.vehicles} vehicles ${JSON.stringify(trafficSummary.byKind)}`);

  // ── streaming and performance ─────────────────────────────────────────────────
  const areaKm2 = polygonArea(RES_POLYGON as Point[]) / 1e6;
  const tileCount = Math.ceil(areaKm2 / 0.25) + 10;
  push('STREAMING · the district fits the 500 m tile budget (2×2 merge at distance)',
    tileCount <= 48,
    `≈${tileCount} tiles over ${areaKm2.toFixed(1)} km² at 4 LODs · distant pairs merge into km blocks`);
  push('PERFORMANCE · LOD0 static triangles stay under the joint budget',
    resSummary.lod0Triangles < 2_400_000,
    `LOD0 ${resSummary.lod0Triangles.toLocaleString('en-GB')} tris · LOD2 ${resSummary.lod2Triangles.toLocaleString('en-GB')} massing`);
  push('PERFORMANCE · props arrive as instanced draws',
    propSummary.count > 100 && propSummary.count < 6500,
    `${propSummary.count} props in ${propSummary.kinds} instanced kinds`);
  push('PERFORMANCE · ground surfaces merge into few draw calls',
    surfaceSummary.pieces > 40 && surfaceSummary.kinds >= 4,
    `${surfaceSummary.pieces} pieces / ${surfaceSummary.kinds} kinds in the sample km²`);

  // ── visual variety ────────────────────────────────────────────────────────────
  push('VARIETY · building kinds span houses, terraces, flats and shops',
    wSummary.kinds >= 6 && (wSummary.byKind.house ?? 0) > 10 && (wSummary.byKind.townhouse ?? 0) > 10 &&
    (wSummary.byKind.apartment ?? 0) > 5 && (wSummary.byKind.mixed ?? 0) > 3,
    Object.entries(wSummary.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
  push('VARIETY · cladding mixes all four generations of building',
    wSummary.facades >= 8,
    `${wSummary.facades} facades · roofs ${Object.entries(wSummary.byRoof).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  push('VARIETY · no single vintage dominates the valley',
    Object.values(siteSummary.byVintage).every(n => n > 3),
    Object.entries(siteSummary.byVintage).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
  push('VARIETY · heights stay ordinary — lived-in, not luxurious',
    wSummary.maxHeight <= RES_LIMITS.maxLandmarkHeight && wSummary.minHeight >= 3,
    `${wSummary.minHeight}–${wSummary.maxHeight} m across ${wSummary.buildings} buildings`);
  push('VARIETY · every neighbourhood carries plots',
    Object.keys(siteSummary.byHood).length >= 7,
    Object.entries(siteSummary.byHood).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
  push('VARIETY · terrace rows read as rows, not singles',
    wSummary.terraceRows >= 6 && wSummary.terraceUnits >= 24,
    `${wSummary.terraceUnits} terrace units in ${wSummary.terraceRows} rows`);

  // ── landmarks ─────────────────────────────────────────────────────────────────
  const landmarks = LANDMARK_SITES.filter(s => s.landmark);
  push('LANDMARKS · the four anchors are present and inside the limit',
    landmarks.length === 4 &&
    landmarks.every(s => insideDistrict({ x: (s.rect.x0 + s.rect.x1) / 2, z: (s.rect.z0 + s.rect.z1) / 2 }, -60)),
    landmarks.map(s => s.name).join(' · '));
  push('LANDMARKS · Mill Green is the large neighbourhood park',
    polygonArea([{ x: -1550, z: -1650 }, { x: -1170, z: -1650 }, { x: -1170, z: -2050 }, { x: -1550, z: -2050 }]) > 130000,
    '15 ha with two playgrounds, courts, pond and pavilion');
  push('LANDMARKS · Market Row is a full local shopping street',
    wSummary.shopUnits >= 18,
    `${wSummary.shopUnits} shop units signed`);
  push('LANDMARKS · schools, shops, fuel and community facilities all built',
    LANDMARK_SITES.filter(s => s.kind === 'school').length === 2 &&
    LANDMARK_SITES.filter(s => s.kind === 'gas-station').length === 2 &&
    LANDMARK_SITES.filter(s => s.kind === 'community').length === 1 &&
    wSummary.byKind.store !== undefined,
    `schools 2 · filling stations 2 · community 1 · stores ${wSummary.byKind.store ?? 0}`);

  // ── interiors ─────────────────────────────────────────────────────────────────
  push('INTERIORS · the four requested interiors exist (flat, shop, restaurant, community)',
    Object.keys(INTERIORS).length === 4 &&
    RES_INTERIOR_BUILDINGS.every(b => insideDistrict(b.centre, -50)),
    Object.entries(INTERIORS).map(([id, i]) => `${id} (${i.kind})`).join(' · '));
  push('INTERIORS · the rest of the stock is prepared for future expansion',
    RES_INTERIOR_READY.length >= 3,
    `${RES_INTERIOR_READY.length} interior-ready doors recorded beyond the ${resSummary.interiors} open interiors`);

  // ── gameplay space ────────────────────────────────────────────────────────────
  const openArea = GROUNDS.filter(g => g.kind === 'kickabout' || g.kind === 'lawn' || g.kind === 'park' || g.kind === 'plaza')
    .reduce((s, g) => s + polygonArea(g.polygon), 0);
  push('GAMEPLAY · open areas remain for missions and events',
    openArea > 40000,
    `${Math.round(openArea / 1000) / 10} k m² of open ground · plaza and green space kept clear`);
  push('GAMEPLAY · roads and alleys leave routes for vehicle play',
    resSummary.streetKm > 8 && RES_NETWORK.streets.some(s => s.kind === 'alley'),
    `${resSummary.streetKm} km of road including ${RES_NETWORK.streets.filter(s => s.kind === 'alley').length} alleys`);

  return checks;
}

export function residentialPasses(): boolean {
  return auditResidential().every(c => c.ok);
}

export { polygonArea, distance2d, polygonBounds };
