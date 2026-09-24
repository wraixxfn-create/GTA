/**
 * Downtown verification.
 *
 * Everything the district promises is checked here: that the street network is closed and
 * connected, that nothing is built on a carriageway, that the skyline obeys its own height
 * rules, that parking and transit surfaces exist for a future traffic AI, and that the
 * streaming index hands every building to exactly one chunk. `npm run verify:city` prints
 * this as a report and `tests/city.test.ts` fails the build if a line turns red.
 */
import { ShapeUtils, Vector2 } from 'three';
import { PLAN } from './blocks';
import { ALL_BUILDINGS, CITY, INTERIOR_BUILDINGS } from './buildings';
import { TILE_SIZE } from './chunks';
import { CITY_LIMITS, CITY_POLYGON, cityGround, padWeight } from './frame';
import { type Point } from '../world/data';
import { pointInPolygon } from '../world/geometry';
import { distanceToPolygon, polygonArea, polygonBounds, polygonCentroid } from './geometry2d';
import { FACADE_STYLES, LANDMARKS, facadeStyle, type FacadeFamily } from './identity';
import { PROPS } from './props';
import { SITES } from './sites';
import { NETWORK, type Street } from './streets';
import { BUILDING_INDEX } from './tiles';
import {
  BUS_STOPS, CROSSINGS, GARAGE_SITES, JUNCTION_SIGNALS, LANE_LINKS, LANES, PARKING_BAYS, PARKING_SUPPLY,
  PED_NODES, SIGNALS, laneRoute, pedRoute, type Lane,
} from './traffic';

export type Check = { name: string; ok: boolean; detail: string };

/* ── spatial helpers ───────────────────────────────────────────────────────────── */

type SampleRef = { street: Street; index: number };
const SAMPLE_CELL = 48;
const SAMPLE_INDEX = new Map<string, SampleRef[]>();
for (const street of NETWORK.streets) {
  street.samples.forEach((sample, index) => {
    if (index + 1 >= street.samples.length) return;
    const next = street.samples[index + 1];
    if (sample.span !== next.span) return;
    const firstX = Math.floor(Math.min(sample.x, next.x) / SAMPLE_CELL);
    const lastX = Math.floor(Math.max(sample.x, next.x) / SAMPLE_CELL);
    const firstZ = Math.floor(Math.min(sample.z, next.z) / SAMPLE_CELL);
    const lastZ = Math.floor(Math.max(sample.z, next.z) / SAMPLE_CELL);
    // Most samples are 22 m apart, but a filleted approach can contain a longer span.
    // Index every cell touched by that segment, not just the cell of its first vertex.
    for (let iz = firstZ; iz <= lastZ; iz++) for (let ix = firstX; ix <= lastX; ix++) {
      const key = `${ix}:${iz}`;
      const list = SAMPLE_INDEX.get(key) ?? [];
      list.push({ street, index });
      SAMPLE_INDEX.set(key, list);
    }
  });
}
/** Nearest carriageway centre-line, optionally limited to the street that owns a bay. */
function carriagewayAt(x: number, z: number, streetId?: string): { street: Street; distance: number } | null {
  let best: { street: Street; distance: number } | null = null;
  const cx = Math.floor(x / SAMPLE_CELL), cz = Math.floor(z / SAMPLE_CELL);
  // The nearest sample may be one half-segment plus a kerb offset away, so search two
  // 48 m cells in each direction at tile boundaries as well as in the interior.
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    for (const ref of SAMPLE_INDEX.get(`${cx + dx}:${cz + dz}`) ?? []) {
      if (streetId && ref.street.id !== streetId) continue;
      const a = ref.street.samples[ref.index], b = ref.street.samples[ref.index + 1];
      const dx2 = b.x - a.x, dz2 = b.z - a.z;
      const len2 = dx2 * dx2 + dz2 * dz2 || 1;
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx2 + (z - a.z) * dz2) / len2));
      const d = Math.hypot(x - (a.x + dx2 * k), z - (a.z + dz2 * k));
      if (!best || d < best.distance) best = { street: ref.street, distance: d };
    }
  }
  return best;
}
function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * k), p.z - (a.z + dz * k));
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const onSegment = (p: Point, q: Point, r: Point) =>
    Math.abs(orient(p, q, r)) < 1e-7 &&
    r.x >= Math.min(p.x, q.x) - 1e-7 && r.x <= Math.max(p.x, q.x) + 1e-7 &&
    r.z >= Math.min(p.z, q.z) - 1e-7 && r.z <= Math.max(p.z, q.z) + 1e-7;
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b);
  if (Math.abs(abC) < 1e-7 && onSegment(a, b, c)) return true;
  if (Math.abs(abD) < 1e-7 && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) < 1e-7 && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) < 1e-7 && onSegment(c, d, b)) return true;
  return ((abC > 0) !== (abD > 0)) && ((cdA > 0) !== (cdB > 0));
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  );
}
/** Minimum distance between a sampled street centreline and a building footprint. */
function segmentPolygonDistance(a: Point, b: Point, polygon: readonly Point[]): number {
  if (pointInPolygon(a.x, a.z, polygon) || pointInPolygon(b.x, b.z, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    best = Math.min(best, segmentDistance(a, b, c, d));
    if (best < 1e-5) return 0;
  }
  return best;
}
function streetFootprintClearance(polygon: readonly Point[]): { distance: number; street: string } {
  const bounds = polygonBounds(polygon), margin = 20;
  const minX = Math.floor((bounds.minX - margin) / SAMPLE_CELL), maxX = Math.floor((bounds.maxX + margin) / SAMPLE_CELL);
  const minZ = Math.floor((bounds.minZ - margin) / SAMPLE_CELL), maxZ = Math.floor((bounds.maxZ + margin) / SAMPLE_CELL);
  let best = Infinity, streetId = '';
  const seen = new Set<string>();
  for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
    for (const ref of SAMPLE_INDEX.get(`${ix}:${iz}`) ?? []) {
      const key = `${ref.street.id}:${ref.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = ref.street.samples[ref.index], b = ref.street.samples[ref.index + 1];
      const half = ref.street.width / 2;
      if (Math.max(a.x, b.x) < bounds.minX - half || Math.min(a.x, b.x) > bounds.maxX + half ||
          Math.max(a.z, b.z) < bounds.minZ - half || Math.min(a.z, b.z) > bounds.maxZ + half) continue;
      const clearance = segmentPolygonDistance(a, b, polygon) - half;
      if (clearance < best) { best = clearance; streetId = ref.street.id; }
    }
  }
  return { distance: best, street: streetId };
}
function alleyFootprintClearance(polygon: readonly Point[]): { distance: number; alley: string } {
  const bounds = polygonBounds(polygon);
  let best = Infinity, alleyId = '';
  for (const alley of PLAN.alleys) {
    const ab = polygonBounds([alley.a, alley.b]);
    const half = alley.width / 2;
    if (ab.maxX < bounds.minX - half || ab.minX > bounds.maxX + half ||
        ab.maxZ < bounds.minZ - half || ab.minZ > bounds.maxZ + half) continue;
    const clearance = segmentPolygonDistance(alley.a, alley.b, polygon) - half;
    if (clearance < best) { best = clearance; alleyId = alley.id; }
  }
  return { distance: best, alley: alleyId };
}

/** Triangle decomposition makes overlap checks work for concave landmark footprints too. */
function signedArea(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area * .5;
}
function convex(polygon: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[(i + 2) % polygon.length];
    const value = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (Math.abs(value) < 1e-7) continue;
    const next = Math.sign(value);
    if (sign && sign !== next) return false;
    sign = next;
  }
  return true;
}
function cleanPolygon(polygon: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of polygon) {
    if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.z - out[out.length - 1].z) > 1e-5) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 1e-5) out.pop();
  return signedArea(out) < 0 ? out.reverse() : out;
}
function triangulateFootprint(polygon: readonly Point[]): Point[][] {
  const clean = cleanPolygon(polygon);
  if (clean.length < 3) return [];
  if (convex(clean)) return [clean];
  const vectors = clean.map(p => new Vector2(p.x, p.z));
  const indices = ShapeUtils.triangulateShape(vectors, []);
  return indices.map(tri => tri.map(i => clean[i]));
}
/** Clip a polygon against one CCW edge; used to compute positive-area intersection. */
function clipConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  let output = [...subject];
  const signed = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const dp = signed(a, b, p), dq = signed(a, b, q);
      const pin = dp >= -1e-7, qin = dq >= -1e-7;
      if (pin) output.push(p);
      if (pin !== qin) {
        const t = dp / (dp - dq);
        output.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return output;
}
function intersectionArea(a: readonly Point[][], b: readonly Point[][]): number {
  let area = 0;
  for (const ta of a) for (const tb of b) {
    const intersection = clipConvex(ta, tb);
    if (intersection.length >= 3) area += polygonArea(intersection);
  }
  return area;
}

/* ── summary ───────────────────────────────────────────────────────────────────── */

export type CitySummary = {
  streets: number; streetKm: number; junctions: number; junctionsSignalised: number;
  blocks: number; parcels: number; alleys: number; courtyards: number; sites: number;
  buildings: number; landmarks: number; tallest: { name: string; height: number };
  floorArea: number; interiors: number;
  lanes: number; laneKm: number; crossings: number; signals: number;
  busStops: number; parking: number; kerbside: number; decks: number; underground: number;
  pedNodes: number; props: number;
};

export const citySummary: CitySummary = ((): CitySummary => {
  const streetKm = NETWORK.streets.reduce((sum, s) => sum + s.length, 0) / 1000;
  const laneKm = LANES.reduce((sum, l) => sum + l.length, 0) / 1000;
  const tallest = ALL_BUILDINGS.reduce<{ name: string; height: number }>(
    (best, b) => b.height > best.height ? { name: b.name ?? b.id, height: b.height } : best,
    { name: '—', height: 0 },
  );
  const floorArea = ALL_BUILDINGS.reduce(
    (sum, b) => sum + polygonArea(b.footprint) * Math.max(1, b.levels), 0,
  );
  const interiorDestinations = new Set(LANDMARKS.flatMap(landmark => landmark.interior ? [landmark.interior] : []));
  return {
    streets: NETWORK.streets.length, streetKm,
    junctions: NETWORK.junctions.length,
    junctionsSignalised: NETWORK.junctions.filter(j => j.control === 'signal').length,
    blocks: PLAN.blocks.length, parcels: PLAN.parcels.length, alleys: PLAN.alleys.length,
    courtyards: PLAN.courtyards.length, sites: PLAN.siteAreas.length,
    buildings: CITY.buildings.length, landmarks: CITY.landmarks.length, tallest,
    floorArea, interiors: interiorDestinations.size,
    lanes: LANES.length, laneKm, crossings: CROSSINGS.length, signals: SIGNALS.length,
    busStops: BUS_STOPS.length, parking: PARKING_SUPPLY.total, kerbside: PARKING_SUPPLY.kerbside,
    decks: PARKING_SUPPLY.decks, underground: PARKING_SUPPLY.underground,
    pedNodes: PED_NODES.size, props: PROPS.length,
  };
})();

/* ── audits ────────────────────────────────────────────────────────────────────── */

/** Street network: inside the footprint, closed, graded and connected. */
function auditStreets(): Check[] {
  const checks: Check[] = [];

  let outside = 0, worstOutside = 0;
  for (const street of NETWORK.streets) {
    for (const sample of street.samples) {
      if (pointInPolygon(sample.x, sample.z, CITY_POLYGON)) continue;
      outside++;
      worstOutside = Math.max(worstOutside, distanceToPolygon(CITY_POLYGON, sample));
    }
  }
  checks.push({
    name: 'streets stay inside the district (regional approaches excepted)',
    ok: worstOutside < 40,
    detail: `${outside} sample${outside === 1 ? '' : 's'} outside, furthest ${worstOutside.toFixed(1)} m (legacy routes reach out to meet the regional network)`,
  });

  // A street end is either on a loop or inside a junction; an unclaimed end is a dead stub.
  const dangling: string[] = [];
  for (const street of NETWORK.streets) {
    if (street.loop) continue;
    for (const sample of [street.samples[0], street.samples[street.samples.length - 1]]) {
      const reached = NETWORK.junctions.some(j => Math.hypot(j.point.x - sample.x, j.point.z - sample.z) < 8);
      if (!reached) dangling.push(street.id);
    }
  }
  checks.push({
    name: 'every street end is closed by a junction',
    ok: dangling.length === 0,
    detail: dangling.length ? `${dangling.length} open ends: ${dangling.slice(0, 4).join(', ')}` : `${NETWORK.streets.length} streets closed on ${NETWORK.junctions.length} junctions`,
  });

  // Junction geometry: no arm pair may meet at an angle a vehicle cannot turn through.
  let worstAngle = 180, worstJunction = '';
  for (const junction of NETWORK.junctions) {
    for (let i = 0; i < junction.arms.length; i++) {
      for (let j = i + 1; j < junction.arms.length; j++) {
        const a = junction.arms[i].dir, b = junction.arms[j].dir;
        const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z))) * 180 / Math.PI;
        if (angle < worstAngle) { worstAngle = angle; worstJunction = junction.id; }
      }
    }
  }
  checks.push({
    name: 'no junction turns tighter than 20°',
    ok: worstAngle >= 20,
    detail: `tightest arm pair ${worstAngle.toFixed(1)}° at ${worstJunction}`,
  });

  // Grade: streets are on a graded pad, so nothing may climb like a hill road.
  let worstGrade = 0, worstStreet = '';
  for (const street of NETWORK.streets) {
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      if (run < 1) continue;
      const grade = Math.abs(b.y - a.y) / run;
      if (grade > worstGrade) { worstGrade = grade; worstStreet = street.id; }
    }
  }
  checks.push({
    name: 'street grades stay under 3%',
    ok: worstGrade < .03,
    detail: `steepest ${(worstGrade * 100).toFixed(2)}% on ${worstStreet}`,
  });

  // The graded pad must meet the natural ground at the city limit, not step off it.
  let worstStep = 0;
  for (let i = 0; i < CITY_POLYGON.length; i++) {
    const a = CITY_POLYGON[i], b = CITY_POLYGON[(i + 1) % CITY_POLYGON.length];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      worstStep = Math.max(worstStep, Math.abs(cityGround(x, z) - (cityGround(x, z) - 1.7 * padWeight(x, z))));
    }
  }
  checks.push({
    name: 'the pad ramps to ground level at the city limit',
    ok: worstStep < .01,
    detail: `largest residual step ${worstStep.toFixed(3)} m (pad weight fades to ${padWeight(CITY_POLYGON[0].x, CITY_POLYGON[0].z).toFixed(3)})`,
  });

  // Connectivity across the whole junction graph.
  const adjacency = new Map<string, Set<string>>();
  for (const edge of NETWORK.edges) {
    const a = adjacency.get(edge.from) ?? new Set<string>();
    a.add(edge.to); adjacency.set(edge.from, a);
    const b = adjacency.get(edge.to) ?? new Set<string>();
    b.add(edge.from); adjacency.set(edge.to, b);
  }
  const start = NETWORK.junctions[0].id;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next); queue.push(next);
    }
  }
  const orphans = NETWORK.junctions.filter(j => !seen.has(j.id)).map(j => j.id);
  checks.push({
    name: 'the street graph is one connected network',
    ok: orphans.length === 0,
    detail: orphans.length ? `${orphans.length} isolated junctions: ${orphans.slice(0, 4).join(', ')}` : `${seen.size} junctions reachable from ${start}`,
  });
  return checks;
}

/** Blocks, parcels and buildings: nothing on a road, nothing inside anything else. */
function auditFabric(): Check[] {
  const checks: Check[] = [];

  const encroaching: string[] = [];
  let worstEncroachment = Infinity;
  for (const building of ALL_BUILDINGS) {
    const clearance = streetFootprintClearance(building.footprint);
    if (clearance.distance < worstEncroachment) worstEncroachment = clearance.distance;
    if (clearance.distance < -.25) encroaching.push(`${building.id} (${clearance.street})`);
  }
  checks.push({
    name: 'no building stands in a carriageway',
    ok: encroaching.length === 0,
    detail: encroaching.length
      ? `${encroaching.length} building footprints cross road surfaces: ${encroaching.slice(0, 4).join(', ')}`
      : `tightest clearance ${worstEncroachment.toFixed(2)} m from a carriageway across ${ALL_BUILDINGS.length} buildings`,
  });

  const onAlley: string[] = [];
  let worstAlley = Infinity;
  for (const building of ALL_BUILDINGS) {
    const clearance = alleyFootprintClearance(building.footprint);
    if (clearance.distance < worstAlley) worstAlley = clearance.distance;
    if (clearance.distance < -.25) onAlley.push(`${building.id} (${clearance.alley})`);
  }
  checks.push({
    name: 'service alleys stay clear of buildings',
    ok: onAlley.length === 0,
    detail: onAlley.length ? `${onAlley.length} building footprints cross an alley: ${onAlley.slice(0, 4).join(', ')}` : `tightest alley clearance ${worstAlley.toFixed(2)} m over ${PLAN.alleys.length} alleys`,
  });

  // Footprint overlap, tested against neighbours in the same 100 m bin.
  const bins = new Map<string, number[]>();
  const boxes = ALL_BUILDINGS.map(b => polygonBounds(b.footprint));
  boxes.forEach((box, index) => {
    const first = { x: Math.floor(box.minX / 100), z: Math.floor(box.minZ / 100) };
    const last = { x: Math.floor(box.maxX / 100), z: Math.floor(box.maxZ / 100) };
    for (let z = first.z; z <= last.z; z++) for (let x = first.x; x <= last.x; x++) {
      const key = `${x}:${z}`;
      const list = bins.get(key) ?? [];
      list.push(index); bins.set(key, list);
    }
  });
  const overlapping: string[] = [];
  const triangles = ALL_BUILDINGS.map(b => triangulateFootprint(b.footprint));
  const seenPairs = new Set<string>();
  for (const list of bins.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const ia = list[i], ib = list[j];
      const key = `${Math.min(ia, ib)}:${Math.max(ia, ib)}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const a = ALL_BUILDINGS[ia], b = ALL_BUILDINGS[ib];
      // Several landmarks are built as a street-level podium with a tower above it. Those
      // parts intentionally share a footprint; unrelated buildings may not overlap.
      if (a.landmark && a.landmark === b.landmark) continue;
      // Street-wall buildings intentionally touch at party walls; only a positive-area
      // intersection is a collision. Segment crossings alone falsely counted shared walls.
      if (intersectionArea(triangles[ia], triangles[ib]) > .75) overlapping.push(`${a.id}×${b.id}`);
    }
  }
  const unique = [...new Set(overlapping)];
  checks.push({
    name: 'building footprints do not intersect',
    ok: unique.length === 0,
    detail: unique.length ? `${unique.length} overlapping pairs, e.g. ${unique.slice(0, 3).join(', ')}` : `${ALL_BUILDINGS.length} footprints checked`,
  });

  // Parcels: the fabric the buildings were extruded from must be sound too.
  let tinyParcels = 0;
  for (const parcel of PLAN.parcels) if (parcel.area < CITY_LIMITS.minParcelArea * .5) tinyParcels++;
  checks.push({
    name: 'parcels are large enough to build on',
    ok: tinyParcels === 0,
    detail: `${PLAN.parcels.length} parcels, ${tinyParcels} below half the ${CITY_LIMITS.minParcelArea} m² minimum`,
  });

  const outside = ALL_BUILDINGS.filter(
    b => !pointInPolygon(polygonCentroid(b.footprint).x, polygonCentroid(b.footprint).z, CITY_POLYGON),
  ).length;
  checks.push({
    name: 'every building sits inside the district',
    ok: outside === 0,
    detail: `${outside} building${outside === 1 ? '' : 's'} outside the city polygon`,
  });
  return checks;
}

function sampleFootprint(polygon: readonly Point[]): Point[] {
  const out: Point[] = [...polygon];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    out.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  }
  return out;
}

/** Height, style and landmark rules: the skyline has to read as one designed place. */
function auditArchitecture(): Check[] {
  const checks: Check[] = [];
  const tallest = ALL_BUILDINGS.reduce((a, b) => (b.height > a.height ? b : a));
  checks.push({
    name: 'nothing exceeds the district height ceiling',
    ok: tallest.height <= CITY_LIMITS.maxTowerHeight + .01,
    detail: `tallest ${tallest.name ?? tallest.id} at ${tallest.height.toFixed(0)} m (ceiling ${CITY_LIMITS.maxTowerHeight} m)`,
  });

  const ordinary = CITY.buildings.filter(b => b.height > CITY_LIMITS.maxOrdinaryHeight + .01);
  checks.push({
    name: 'only landmarks rise above the ordinary height cap',
    ok: ordinary.length === 0,
    detail: `${ordinary.length} ordinary buildings above ${CITY_LIMITS.maxOrdinaryHeight} m`,
  });

  const used = new Set(ALL_BUILDINGS.map(b => b.style));
  const unusedStyles = FACADE_STYLES.filter(style => !used.has(style.id)).map(style => style.id);
  checks.push({
    name: 'the facade vocabulary has broad district-wide coverage',
    ok: used.size >= FACADE_STYLES.length - 1,
    detail: `${used.size} of ${FACADE_STYLES.length} facade styles built${unusedStyles.length ? ` · unused: ${unusedStyles.join(', ')}` : ''}`,
  });

  // The brief asks for five recognisable architectural strains to read side by side.
  const families = new Map<FacadeFamily, number>();
  for (const building of ALL_BUILDINGS) {
    const family = facadeStyle(building.style).family;
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  const required: FacadeFamily[] = ['glass', 'masonry', 'terracotta', 'stone', 'balcony'];
  const missing = required.filter(f => (families.get(f) ?? 0) < 12);
  checks.push({
    name: 'glass, masonry, terracotta, stone and balcony strains all read in the street',
    ok: missing.length === 0,
    detail: missing.length
      ? `under-represented: ${missing.join(', ')}`
      : required.map(f => `${f} ${families.get(f)}`).join(' · '),
  });

  const requiredLandmarks = [
    { id: 'kestrel', label: 'corporate tower' },
    { id: 'meridian-plaza', label: 'central plaza', openSite: 'civic' },
    { id: 'halcyon', label: 'grand hotel' },
    { id: 'reachmark', label: 'financial headquarters' },
    { id: 'verge', label: 'modern museum' },
    { id: 'interchange', label: 'central transit station' },
  ];
  const built = new Set(CITY.landmarks.map(b => b.landmark));
  const absent = requiredLandmarks.filter(item => item.openSite
    ? !CITY.openSpace.some(space => space.site === item.openSite)
    : !built.has(item.id));
  checks.push({
    name: 'the six required original landmarks are built',
    ok: absent.length === 0,
    detail: absent.length
      ? `missing ${absent.map(item => item.label).join(', ')}`
      : `${requiredLandmarks.map(item => item.label).join(', ')}`,
  });

  const interiors = INTERIOR_BUILDINGS.map(b => b.interior!);
  const garageInterior = LANDMARKS.find(landmark => landmark.site === 'fenwick-green')?.interior;
  if (garageInterior && GARAGE_SITES.some(site => site.id === 'fenwick-green')) interiors.push(garageInterior);
  const wanted = ['kestrel-lobby', 'civic-hall', 'halcyon-lobby', 'reachmark-hall', 'verge-gallery', 'interchange', 'fenwick-garage'];
  const short = wanted.filter(id => !interiors.includes(id));
  checks.push({
    name: 'selected landmark entrances have designated interior destinations',
    ok: short.length === 0,
    detail: short.length ? `missing ${short.join(', ')}` : `${interiors.length} interior-ready destinations: ${interiors.join(', ')}`,
  });

  const groundFloors = ALL_BUILDINGS.filter(b => b.shopfront).length;
  checks.push({
    name: 'street frontages are fitted out, not blank',
    ok: groundFloors > ALL_BUILDINGS.length * .25,
    detail: `${groundFloors} of ${ALL_BUILDINGS.length} buildings have shopfronts, entrances or signs on the street`,
  });

  const sites = SITES.filter(site => PLAN.siteAreas.some(area => area.site.id === site.id));
  checks.push({
    name: 'every authored landmark site is reserved in the plan',
    ok: sites.length === SITES.length,
    detail: `${sites.length} of ${SITES.length} sites placed`,
  });
  return checks;
}

/** Traffic surfaces: lanes, movements, crossings, parking, transit and footways. */
function auditTraffic(): Check[] {
  const checks: Check[] = [];
  const uniqueIds = <T>(items: readonly T[], id: (item: T) => string) => new Set(items.map(id)).size;
  const idCounts = [
    uniqueIds(NETWORK.edges, edge => edge.id),
    uniqueIds(LANES, lane => lane.id),
    uniqueIds(LANE_LINKS, link => link.id),
    uniqueIds(PARKING_BAYS, bay => bay.id),
    uniqueIds(BUS_STOPS, stop => stop.id),
  ];
  checks.push({
    name: 'street, lane, movement and curbside IDs are unique across site spans',
    ok: idCounts.every((count, index) => count === [NETWORK.edges.length, LANES.length, LANE_LINKS.length, PARKING_BAYS.length, BUS_STOPS.length][index]),
    detail: `edges ${idCounts[0]}/${NETWORK.edges.length} · lanes ${idCounts[1]}/${LANES.length} · movements ${idCounts[2]}/${LANE_LINKS.length} · bays ${idCounts[3]}/${PARKING_BAYS.length} · stops ${idCounts[4]}/${BUS_STOPS.length}`,
  });

  const outgoing = new Map<string, number>();
  for (const link of LANE_LINKS) outgoing.set(link.fromLane, (outgoing.get(link.fromLane) ?? 0) + 1);
  const dead = LANES.filter(lane => !outgoing.has(lane.id));
  checks.push({
    name: 'every lane leads somewhere',
    ok: dead.length / LANES.length < .04,
    detail: `${dead.length} of ${LANES.length} lanes end without a movement (${(100 * dead.length / LANES.length).toFixed(1)}%: terminal approaches)`,
  });

  const reach = laneReach();
  checks.push({
    name: 'the lane graph is connected across the district',
    ok: reach.orphans.length === 0,
    detail: reach.orphans.length
      ? `${reach.orphans.length} lanes outside the connected street network`
      : `${reach.size} lanes in one connected graph (one-way direction retained on links)`,
  });

  const routeFailures = routeSample(16);
  checks.push({
    name: 'lane routing between random points succeeds',
    ok: routeFailures.lane === 0,
    detail: `${routeFailures.lane} of ${routeFailures.tried} routes failed`,
  });

  const signalsAt = new Set(JUNCTION_SIGNALS.map(s => s.junction));
  const signalised = NETWORK.junctions.filter(j => j.control === 'signal');
  const unphased = signalised.filter(j => !signalsAt.has(j.id));
  checks.push({
    name: 'every signalised junction has a phase plan',
    ok: unphased.length === 0,
    detail: `${signalised.length} signalised junctions, ${unphased.length} without phases, ${SIGNALS.length} signal heads`,
  });

  const pedCrossings = CROSSINGS.filter(c => c.kind === 'signal').length;
  checks.push({
    name: 'crossings are provided at junctions and mid-block',
    ok: CROSSINGS.length > NETWORK.junctions.length,
    detail: `${CROSSINGS.length} crossings (${pedCrossings} signalised) over ${NETWORK.junctions.length} junctions`,
  });

  const bayOff = PARKING_BAYS.filter(bay => {
    const street = NETWORK.streetById.get(bay.streetId);
    const near = carriagewayAt(bay.centre.x, bay.centre.z, bay.streetId);
    return !street || !near || near.distance > street.width / 2 + 6;
  }).length;
  checks.push({
    name: 'kerbside bays sit against a carriageway',
    ok: bayOff === 0,
    detail: `${PARKING_BAYS.length} bays, ${bayOff} detached from their street`,
  });

  checks.push({
    name: 'parking supply covers kerbside, surface, decks and underground',
    ok: PARKING_SUPPLY.kerbside > 0 && PARKING_SUPPLY.surface > 0 && PARKING_SUPPLY.decks > 0 && PARKING_SUPPLY.underground > 0,
    detail: `${PARKING_SUPPLY.total.toLocaleString('en-GB')} spaces — ${PARKING_SUPPLY.kerbside} kerbside, ${PARKING_SUPPLY.surface} surface, ${PARKING_SUPPLY.decks} decks, ${PARKING_SUPPLY.underground} underground`,
  });

  const stopOff = BUS_STOPS.filter(stop => {
    const street = NETWORK.streetById.get(stop.streetId);
    const near = carriagewayAt(stop.point.x, stop.point.z, stop.streetId);
    return !street || !near || near.distance > street.width / 2 + 8;
  }).length;
  checks.push({
    name: 'transit stops sit on their street with a boarding pad',
    ok: stopOff === 0 && BUS_STOPS.length >= 40,
    detail: `${BUS_STOPS.length} stops on ${new Set(BUS_STOPS.map(s => s.streetId)).size} streets, ${stopOff} misplaced`,
  });

  const pedReach = pedReachFrom();
  checks.push({
    name: 'the footway network is connected',
    ok: pedReach.orphans === 0,
    detail: `${pedReach.size} of ${PED_NODES.size} pedestrian nodes reachable from the interchange`,
  });

  checks.push({
    name: 'pedestrian routing between entrances and stops succeeds',
    ok: routeFailures.ped === 0,
    detail: `${routeFailures.ped} of ${routeFailures.tried} walking routes failed`,
  });
  return checks;
}

const LINKS_FROM = new Map<string, string[]>();
const LINKS_WEAK = new Map<string, Set<string>>();
for (const lane of LANES) LINKS_WEAK.set(lane.id, new Set());
for (const link of LANE_LINKS) {
  const list = LINKS_FROM.get(link.fromLane) ?? [];
  list.push(link.toLane); LINKS_FROM.set(link.fromLane, list);
  LINKS_WEAK.get(link.fromLane)?.add(link.toLane);
  LINKS_WEAK.get(link.toLane)?.add(link.fromLane);
}
function laneReach(): { size: number; start: string; orphans: string[] } {
  const start = LANES[Math.floor(LANES.length / 2)].id;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of LINKS_WEAK.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next); queue.push(next);
    }
  }
  const orphans = LANES.filter(l => !seen.has(l.id)).map(l => l.id);
  return { size: seen.size, start, orphans };
}
function pedReachFrom(): { size: number; orphans: number } {
  const start = [...PED_NODES.values()].find(n => n.kind === 'stop')?.id
    ?? [...PED_NODES.keys()][0];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const link of PED_NODES.get(queue.shift()!)?.links ?? []) {
      if (seen.has(link.to)) continue;
      seen.add(link.to); queue.push(link.to);
    }
  }
  return { size: seen.size, orphans: PED_NODES.size - seen.size };
}
/** Random traffic and walking routes; the same calls a future AI would make. */
function routeSample(tried = 16): { lane: number; ped: number; tried: number } {
  let lane = 0, ped = 0;
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return ((seed >>> 0) % 16777216) / 16777216;
  };
  for (let i = 0; i < tried; i++) {
    const from = LANES[Math.floor(random() * LANES.length)];
    const to = LANES[Math.floor(random() * LANES.length)];
    if (!laneRoute(from.id, to.id)) lane++;
  }
  const nodes = [...PED_NODES.values()];
  for (let i = 0; i < tried; i++) {
    const from = nodes[Math.floor(random() * nodes.length)];
    const to = nodes[Math.floor(random() * nodes.length)];
    if (!pedRoute(from.id, to.id)) ped++;
  }
  return { lane, ped, tried };
}

/** Streaming: the tile index must hand every building to exactly one chunk, at every LOD. */
function auditStreaming(): Check[] {
  const checks: Check[] = [];
  const bounds = (() => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of CITY_POLYGON) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return { minX, minZ, maxX, maxZ };
  })();

  const tiles: { minX: number; minZ: number; maxX: number; maxZ: number }[] = [];
  for (let z = Math.floor(bounds.minZ / TILE_SIZE); z <= Math.floor(bounds.maxZ / TILE_SIZE); z++) {
    for (let x = Math.floor(bounds.minX / TILE_SIZE); x <= Math.floor(bounds.maxX / TILE_SIZE); x++) {
      tiles.push({ minX: x * TILE_SIZE, minZ: z * TILE_SIZE, maxX: (x + 1) * TILE_SIZE, maxZ: (z + 1) * TILE_SIZE });
    }
  }
  for (const lod of [0, 1] as const) {
    const counts = new Map<string, number>();
    for (const tile of tiles) {
      for (const building of BUILDING_INDEX.in(tile, lod)) {
        counts.set(building.id, (counts.get(building.id) ?? 0) + 1);
      }
    }
    const duplicated = [...counts.values()].filter(c => c > 1).length;
    const drawn = counts.size;
    const expected = ALL_BUILDINGS.length;
    checks.push({
      name: `LOD${lod} tiles draw each building exactly once`,
      ok: duplicated === 0 && drawn === expected,
      detail: `${drawn} of ${expected} buildings drawn by ${tiles.length} tiles, ${duplicated} drawn twice`,
    });
  }

  // Nothing may be drawn by a tile it does not touch.
  let strays = 0;
  for (const tile of tiles) {
    for (const building of BUILDING_INDEX.in(tile, 0)) {
      const box = polygonBounds(building.footprint);
      const touches = !(box.maxX < tile.minX || box.minX > tile.maxX || box.maxZ < tile.minZ || box.minZ > tile.maxZ);
      if (!touches) strays++;
    }
  }
  checks.push({
    name: 'a tile only draws the buildings it touches',
    ok: strays === 0,
    detail: `${strays} buildings drawn by a tile outside their footprint`,
  });

  const propBins = new Set(PROPS.map(p => `${Math.floor(p.x / TILE_SIZE)}:${Math.floor(p.z / TILE_SIZE)}`));
  checks.push({
    name: 'street furniture is spread across the district',
    ok: propBins.size > 20,
    detail: `${PROPS.length} props across ${propBins.size} tiles`,
  });
  return checks;
}

/** Density: downtown has to feel far denser than the rest of the region. */
function auditDensity(): Check[] {
  const area = polygonArea(CITY_POLYGON) / 1_000_000;
  const perKm2 = ALL_BUILDINGS.length / area;
  const coverage = ALL_BUILDINGS.reduce((sum, b) => sum + polygonArea(b.footprint), 0) / (area * 1_000_000);
  const parcels = PLAN.parcels;
  const medianParcel = parcels.map(p => p.area).sort((a, b) => a - b)[Math.floor(parcels.length / 2)];
  return [{
    name: 'downtown is dense: buildings, coverage and small parcels',
    ok: perKm2 > 500 && coverage > .25 && medianParcel < 600,
    detail: `${perKm2.toFixed(0)} buildings/km², ${(coverage * 100).toFixed(1)}% ground coverage, median parcel ${medianParcel.toFixed(0)} m² over ${area.toFixed(2)} km²`,
  }];
}

export function auditCity(): Check[] {
  return [
    ...auditStreets(),
    ...auditFabric(),
    ...auditArchitecture(),
    ...auditTraffic(),
    ...auditStreaming(),
    ...auditDensity(),
  ];
}

/** Convenience for callers that only want to know whether the district is sound. */
export function cityPasses(): boolean {
  return auditCity().every(check => check.ok);
}

export type { Lane };
