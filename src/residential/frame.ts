/**
 * The Residential Valley frame: footprint, street-grid basis, ground datum, zoning and
 * the deterministic randomness every generator in the district shares.
 *
 * A middle-class neighbourhood on the broad valley floor between the mountains and the
 * city: apartment blocks, townhouse terraces, small houses, local shops, schools, parks
 * and everyday facilities. Lived-in, not luxurious. Nothing here is copied from a real
 * town — the survey, the neighbourhood names and the shop signs are authored for this
 * region so the district reads as one place with its own history.
 */
import { DISTRICTS, type Point } from '../world/data';
import { terrainHeight, residentialFloorWeight } from '../world/geometry';
import {
  convexSignedDistance, ensureCCW, polygonBounds, polygonCentroid, pointToSegment,
  type Bounds,
} from '../city/geometry2d';

export const RESIDENTIAL = DISTRICTS.find(d => d.id === 'residential')!;

/** Built-up limit. Assets stay inside the reservation polygon. */
export const RES_POLYGON: readonly Point[] = ensureCCW(RESIDENTIAL.polygon);
export const RES_BOUNDS: Bounds = polygonBounds(RES_POLYGON);

/**
 * Survey basis. 19° off east — the township baseline the residential streets follow,
 * distinct from downtown (13°), the works (4°) and the hillside estates (26°).
 */
export const GRID_ANGLE = (19 * Math.PI) / 180;
export const GRID_ORIGIN: Point = polygonCentroid(RES_POLYGON);
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
export const RES_GRID_BOUNDS = gridBounds(RES_POLYGON);

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

/* ── ground datum ─────────────────────────────────────────────────────────────── */

/**
 * Ground datum. The valley floor is graded like the city pad — high-frequency relief
 * removed inside the footprint (see `residentialFloorWeight`), a thin crown over it —
 * so streets run level and the regional routes carried through meet their continuations
 * outside the limit without a step.
 */
export const RES_SLAB = 1.5;
export const CURB_HEIGHT = 0.14;
export function padWeight(x: number, z: number): number { return residentialFloorWeight(x, z); }
export function resGround(x: number, z: number): number {
  return terrainHeight(x, z) + RES_SLAB * padWeight(x, z);
}
export function gradingWeight(x: number, z: number): number { return residentialFloorWeight(x, z); }

/** Local relief across a footprint: house pads and yards drape over gentle ground. */
export function localRelief(x: number, z: number, radius = 22): number {
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
    const h = resGround(x + dx, z + dz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return hi - lo;
}

export function insideDistrict(p: Point, margin = 0): boolean {
  let nearest = Infinity;
  for (let i = 0; i < RES_POLYGON.length; i++) {
    nearest = Math.min(nearest, pointToSegment(p, RES_POLYGON[i], RES_POLYGON[(i + 1) % RES_POLYGON.length]).distance);
  }
  return nearest > margin;
}
export function boundaryDistance(p: Point): number {
  let nearest = Infinity;
  for (let i = 0; i < RES_POLYGON.length; i++) {
    nearest = Math.min(nearest, pointToSegment(p, RES_POLYGON[i], RES_POLYGON[(i + 1) % RES_POLYGON.length]).distance);
  }
  return nearest;
}
/** Positive inside the reservation, metres; negative outside. */
export function districtSignedDistance(p: Point): number {
  return convexSignedDistance(RES_POLYGON, p);
}

/* ── zoning ───────────────────────────────────────────────────────────────────── */

/**
 * Land use by position. The valley is not one estate but eight neighbourhoods that
 * grew at different times: a mixed-use core around the old mill crossroads, Victorian
 * terraces under the chapel ridge, postwar apartment blocks, two schools, a curvy
 * interwar estate, a 1990s cul-de-sac estate, the big park and the market street.
 */
export type HoodId =
  | 'millgate'      // mixed-use core grid around the crossroads + Market Row
  | 'chapel-fields' // Victorian townhouse terraces in the north-west
  | 'warfield'      // community quarter south of Grand Avenue
  | 'willowbank'    // small interwar houses in the south-west
  | 'rosecourt'     // postwar estate with the landmark apartment complex
  | 'larkspur'      // 1990s cul-de-sac family houses in the south-east
  | 'beechwood'     // curvy interwar estate in the east
  | 'sunnybank';    // school ground and quiet closes in the north-east

type Hood = { id: HoodId; center: Point; radius: number; weight: number };
const HOODS: readonly Hood[] = [
  { id: 'millgate', center: { x: -880, z: -1420 }, radius: 560, weight: 1.06 },
  { id: 'chapel-fields', center: { x: -1850, z: -950 }, radius: 560, weight: 1.04 },
  { id: 'warfield', center: { x: -1200, z: -1900 }, radius: 420, weight: 1.02 },
  { id: 'willowbank', center: { x: -1550, z: -2350 }, radius: 540, weight: 1.0 },
  { id: 'rosecourt', center: { x: -450, z: -2300 }, radius: 470, weight: 1.03 },
  { id: 'larkspur', center: { x: 230, z: -2450 }, radius: 470, weight: 1.0 },
  { id: 'beechwood', center: { x: 450, z: -1350 }, radius: 520, weight: 1.02 },
  { id: 'sunnybank', center: { x: 300, z: -880 }, radius: 480, weight: 1.0 },
];
export function hoodAt(p: Point): HoodId {
  let best: HoodId = 'willowbank', bestScore = -Infinity;
  for (const hood of HOODS) {
    const d = Math.hypot(p.x - hood.center.x, p.z - hood.center.z);
    const score = (1 - d / hood.radius) * hood.weight;
    if (score > bestScore) { bestScore = score; best = hood.id; }
  }
  return best;
}
export function hoodOf(u: number, v: number): HoodId { return hoodAt(fromGrid(u, v)); }

/**
 * Generation by position. The valley reads as four eras of ordinary building: Victorian
 * brick near the chapel, interwar semis, postwar rebuild and 1990s infill — then
 * per-plot hashing breaks the fields up so no street is one vintage.
 */
export type Vintage = 'victorian' | 'interwar' | 'postwar' | 'nineties';
export function vintageAt(p: Point): Vintage {
  const fields: { id: Vintage; x: number; z: number; r: number; w: number }[] = [
    { id: 'victorian', x: -1850, z: -950, r: 620, w: 1.08 },   // the chapel terraces
    { id: 'victorian', x: -900, z: -1300, r: 420, w: 1.02 },   // mill workers' streets
    { id: 'interwar', x: -1550, z: -2350, r: 640, w: 1.06 },   // willowbank semis
    { id: 'interwar', x: 450, z: -1350, r: 560, w: 1.04 },     // beechwood
    { id: 'nineties', x: 230, z: -2450, r: 540, w: 1.07 },     // larkspur closes
    { id: 'postwar', x: -450, z: -2300, r: 520, w: 1.05 },     // rosecourt rebuild
    { id: 'postwar', x: -1200, z: -1850, r: 1800, w: .5 },     // general baseline
  ];
  let best: Vintage = 'postwar', bestScore = -Infinity;
  for (const field of fields) {
    const d = Math.hypot(p.x - field.x, p.z - field.z);
    const score = (1 - d / field.r) * field.w;
    if (score > bestScore) { bestScore = score; best = field.id; }
  }
  // Per-plot noise: renovated infill mixes through every era field.
  const h = hash01(Math.round(p.x), Math.round(p.z), 41);
  if (h < 0.14) return 'nineties';
  if (h < 0.24) return 'postwar';
  return best;
}

export const RES_LIMITS = {
  /** Nothing here is a tower: the Rosecourt block tops the district. */
  maxOrdinaryHeight: 22,
  maxLandmarkHeight: 30,
  minPlotArea: 120,
  minBuildingWidth: 6,
  minBuildingDepth: 7,
  /** Yards are part of the fabric: the garden behind a house is not the leftover. */
  minYardFraction: 0.3,
} as const;
