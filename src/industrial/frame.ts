/**
 * The industrial frame: footprint, survey-grid basis, ground datum, condition and land-use
 * zoning, and the deterministic randomness every generator in the district shares.
 *
 * The district is a different survey from downtown on purpose: a coarse 4° works grid of
 * haulways and warehouse roads laid over superblocks ten times the size of a downtown
 * block, graded onto the riverward flats. Names, companies and landmarks are invented for
 * this region; nothing is modelled on a real industrial city.
 */
import { DISTRICTS, type Point } from '../world/data';
import { industrialFloorWeight, terrainHeight } from '../world/geometry';
import { convexSignedDistance, ensureCCW, polygonBounds, polygonCentroid, type Bounds } from '../city/geometry2d';

export const INDUSTRIAL = DISTRICTS.find(d => d.id === 'industrial')!;

/** Built-up limit. The district reservation is the works limit; assets stay inside it. */
export const IND_POLYGON: readonly Point[] = ensureCCW(INDUSTRIAL.polygon);
export const IND_BOUNDS: Bounds = polygonBounds(IND_POLYGON);

/**
 * Works-grid basis. The axis is only 4° off east — the old county section line the rail
 * and haulways follow — against downtown's 13° grid: the two districts visibly do not
 * share a survey.
 */
export const GRID_ANGLE = (4 * Math.PI) / 180;
export const GRID_ORIGIN: Point = polygonCentroid(IND_POLYGON);
export const AXIS_U: Point = { x: Math.cos(GRID_ANGLE), z: Math.sin(GRID_ANGLE) };
export const AXIS_V: Point = { x: -Math.sin(GRID_ANGLE), z: Math.cos(GRID_ANGLE) };

export function fromGrid(u: number, v: number): Point {
  return {
    x: GRID_ORIGIN.x + AXIS_U.x * u + AXIS_V.x * v,
    z: GRID_ORIGIN.z + AXIS_U.z * u + AXIS_V.z * v,
  };
}
export function toGrid(p: Point): { u: number; v: number } {
  const dx = p.x - GRID_ORIGIN.x, dz = p.z - GRID_ORIGIN.z;
  return { u: dx * AXIS_U.x + dz * AXIS_U.z, v: dx * AXIS_V.x + dz * AXIS_V.z };
}
export function gridBounds(polygon: readonly Point[]): { minU: number; maxU: number; minV: number; maxV: number } {
  const b = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const p of polygon) {
    const g = toGrid(p);
    b.minU = Math.min(b.minU, g.u); b.maxU = Math.max(b.maxU, g.u);
    b.minV = Math.min(b.minV, g.v); b.maxV = Math.max(b.maxV, g.v);
  }
  return b;
}
export const IND_GRID_BOUNDS = gridBounds(IND_POLYGON);

/** Deterministic hash-based randomness: the same district is generated on every run. */
export function makeRandom(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 0) % 16777216) / 16777216;
  };
}
/** Stable 0..1 value from integer coordinates; no allocation, no ordering effects. */
export function hash01(a: number, b: number, c = 0): number {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * Ground datum. The flats are graded as a works pad: the world function levels every
 * noise octave inside the footprint (see `industrialFloorWeight`), and the finished
 * floor sits a crown above that so gates meet the regional continuations without a step.
 * The river terrace on the east flank keeps its natural relief — the pad follows it down
 * instead of fighting it, which is why some plots are marked rough and stay open.
 */
export const IND_SLAB = 1.4;
export const CURB_HEIGHT = 0.16;
const PAD_RAMP = 130;
export function padWeight(x: number, z: number): number {
  const d = convexSignedDistance(IND_POLYGON, { x, z });
  if (d <= 0) return 0;
  if (d >= PAD_RAMP) return 1;
  const t = d / PAD_RAMP;
  return t * t * (3 - 2 * t);
}
export function indGround(x: number, z: number): number {
  return terrainHeight(x, z) + IND_SLAB * padWeight(x, z);
}
export function gradingWeight(x: number, z: number): number {
  return industrialFloorWeight(x, z);
}
/** Local relief over a footprint: rough plots drape, level plots build big sheds on pads. */
export function localRelief(x: number, z: number, radius = 26): number {
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
    const h = indGround(x + dx, z + dz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return hi - lo;
}

/* ── zoning ─────────────────────────────────────────────────────────────────────── */

export type IndZoneId =
  | 'offices'       // works administration, gate plazas, worker facilities
  | 'warehousing'   // rows of distribution sheds with dock aprons
  | 'heavy'         // factory halls, stacks, pipe runs, transformer yards
  | 'utility'       // substations, generator halls, tanks
  | 'repair'        // workshops, fleet depots, motor pools
  | 'logistics'     // big-box freight hubs, trailer parks, fuel points
  | 'containers'    // gated container stacks, reach tracks
  | 'scrap'         // salvage yards, bales, magnet cranes
  | 'construction'  // active building sites, plant yards
  | 'bulk'          // open storage, aggregate bays, silo rows
  | 'riverside';    // river terrace: derelict yards, brownfield, riparian buffer

/** Condition drives materials, props and story: the district is not uniformly new. */
export type Condition = 'active' | 'renovated' | 'construction' | 'abandoned';

type Zone = { id: IndZoneId; center: Point; radius: number; weight: number };
const ZONES: readonly Zone[] = [
  { id: 'offices', center: fromGrid(-820, 560), radius: 480, weight: 1.05 },
  { id: 'warehousing', center: fromGrid(-830, -80), radius: 460, weight: 1 },
  { id: 'warehousing', center: fromGrid(-560, 1000), radius: 420, weight: .95 },
  { id: 'utility', center: fromGrid(-945, -772), radius: 430, weight: 1.02 },
  { id: 'heavy', center: fromGrid(-320, -830), radius: 520, weight: 1.06 },
  { id: 'repair', center: fromGrid(-405, 527), radius: 420, weight: 1 },
  { id: 'logistics', center: fromGrid(-300, 980), radius: 480, weight: 1.04 },
  { id: 'logistics', center: fromGrid(180, 540), radius: 400, weight: .9 },
  { id: 'containers', center: fromGrid(380, 1020), radius: 460, weight: 1.1 },
  { id: 'scrap', center: fromGrid(725, 100), radius: 430, weight: 1.05 },
  { id: 'construction', center: fromGrid(760, 565), radius: 400, weight: 1.05 },
  { id: 'bulk', center: fromGrid(620, 1020), radius: 380, weight: .95 },
  { id: 'riverside', center: fromGrid(950, -100), radius: 420, weight: 1 },
  { id: 'riverside', center: fromGrid(940, 700), radius: 420, weight: 1 },
];
export function zoneAt(p: Point): IndZoneId {
  let best: IndZoneId = 'bulk', bestScore = -Infinity;
  for (const zone of ZONES) {
    const d = Math.hypot(p.x - zone.center.x, p.z - zone.center.z);
    const score = (1 - d / zone.radius) * zone.weight;
    if (score > bestScore) { bestScore = score; best = zone.id; }
  }
  return best;
}

/**
 * Condition by position: the north-west works are the renovated generation, the river
 * terrace is the abandoned generation, the south-east is under construction, and the
 * logistics south is simply active. Per-plot hashing breaks the fields up afterwards.
 */
export function conditionAt(p: Point): Condition {
  const g = toGrid(p);
  let best: Condition = 'active', bestScore = -Infinity;
  const fields: { id: Condition; u: number; v: number; r: number; w: number }[] = [
    { id: 'renovated', u: -350, v: -800, r: 620, w: 1.0 },   // the re-roofed steel works
    { id: 'renovated', u: -820, v: 560, r: 520, w: 1.05 },   // Westworks Administration
    { id: 'abandoned', u: 790, v: 180, r: 640, w: 1.08 },   // the scrap yard and river terrace
    { id: 'construction', u: 760, v: 565, r: 480, w: 1.06 },// Eastbank civil works site
    { id: 'active', u: 0, v: 600, r: 1800, w: .62 },
  ];
  for (const field of fields) {
    const d = Math.hypot(g.u - field.u, g.v - field.v);
    const score = (1 - d / field.r) * field.w;
    if (score > bestScore) { bestScore = score; best = field.id; }
  }
  return best;
}

export const WORKS_LIMITS = {
  /** Nothing rivals the downtown skyline: stacks and silos are the tall structures. */
  maxOrdinaryHeight: 34,
  maxLandmarkHeight: 96,
  minPlotArea: 900,
  minBuildingWidth: 9,
  minBuildingDepth: 7,
} as const;
