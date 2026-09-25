/**
 * The Vantage Heights frame: footprint, survey basis, ground datum, terracing, zoning
 * and the deterministic randomness every generator in the district shares.
 *
 * This is the third constructed district and deliberately nothing like the other two.
 * Downtown is a graded plate with a 13° block grid; the industrial flats are a graded
 * works pad on a 4° survey. Vantage Heights keeps its hill: the ground datum is the
 * natural terrain (44–132 m) and the district is cut into it — terraced pads, retaining
 * walls, hairpins and a survey axis of 26° that belongs to neither neighbour.
 *
 * Names here are invented for Morrow Reach. No estate, club, hotel or street is modelled
 * on a real place or on another game's map.
 */
import { DISTRICTS, type Point } from '../world/data';
import { terrainHeight, pointInPolygon as inWorld } from '../world/geometry';
import {
  convexSignedDistance, ensureCCW, polygonBounds, polygonCentroid,
  pointToSegment, type Bounds,
} from '../city/geometry2d';

export const WEALTHY = DISTRICTS.find(d => d.id === 'wealthy')!;

/** Built-up limit. Assets stay inside the reservation polygon. */
export const W_POLYGON: readonly Point[] = ensureCCW(WEALTHY.polygon);
export const W_BOUNDS: Bounds = polygonBounds(W_POLYGON);

/**
 * Survey basis. 26° off east — the old estate survey that follows the ridge, shared by
 * neither downtown (13°) nor the works (4°). Plot frontages and garden walls align to it;
 * the through roads do not, because hillside roads follow contours instead of a grid.
 */
export const GRID_ANGLE = (26 * Math.PI) / 180;
export const GRID_ORIGIN: Point = polygonCentroid(W_POLYGON);
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
export const W_GRID_BOUNDS = gridBounds(W_POLYGON);

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

/* ── ground ───────────────────────────────────────────────────────────────────── */

/**
 * Ground datum. Unlike downtown and the flats, nothing here is graded flat: the hill is
 * the point. Streets follow the contour, and every building stands on a *terrace* — a
 * small level pad cut into the slope with a retaining wall on its downhill side. The
 * dressed ground therefore sits barely above the natural surface, which is also why the
 * regional routes carried through the district meet their continuations outside it
 * without a step.
 */
export const HILL_SLAB = 1.6;
export const CURB_HEIGHT = 0.14;
/** A hair of crown so paving never z-fights the terrain it is laid on. */
export function hillGround(x: number, z: number): number {
  return terrainHeight(x, z) + HILL_SLAB;
}
/** Level datum of a terrace: the natural ground at its centre, dressed. */
export function padLevel(points: readonly Point[]): number {
  const c = polygonCentroid(points);
  return terrainHeight(c.x, c.z) + HILL_SLAB + 0.05;
}
/** True where the natural ground falls below a terrace datum — the wall side. */
export function fillDepth(x: number, z: number, level: number): number {
  return level - terrainHeight(x, z);
}
/** Local relief across a footprint: steep plots get terraced or stay as gardens. */
export function localRelief(x: number, z: number, radius = 22): number {
  let lo = Infinity, hi = -Infinity;
  for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
    const h = terrainHeight(x + dx, z + dz);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return hi - lo;
}
/** Mean downhill aspect of a footprint: terraces and pools face that way. */
export function downhillDir(x: number, z: number, radius = 24): Point {
  const gx = (terrainHeight(x + radius, z) - terrainHeight(x - radius, z)) / (2 * radius);
  const gz = (terrainHeight(x, z + radius) - terrainHeight(x, z - radius)) / (2 * radius);
  const l = Math.hypot(gx, gz) || 1;
  return { x: -gx / l, z: -gz / l };
}

export function insideDistrict(p: Point, margin = 0): boolean {
  if (!inWorld(p.x, p.z, W_POLYGON)) return false;
  if (margin <= 0) return true;
  return boundaryDistance(p) > margin;
}
export function boundaryDistance(p: Point): number {
  let nearest = Infinity;
  for (let i = 0; i < W_POLYGON.length; i++) {
    nearest = Math.min(nearest, pointToSegment(p, W_POLYGON[i], W_POLYGON[(i + 1) % W_POLYGON.length]).distance);
  }
  return nearest;
}
/** Positive inside the reservation, metres; negative outside. */
export function districtSignedDistance(p: Point): number {
  return convexSignedDistance(W_POLYGON, p);
}

/* ── zoning ───────────────────────────────────────────────────────────────────── */

/**
 * Land use by position. The district is not one estate but six: a crown of ridge
 * mansions, three gated compounds, a hotel-and-apartments terrace facing downtown, a
 * cliff-edge enclave, a members' club and a small luxury village on the south gate.
 */
export type EstateId =
  | 'crown'          // ridge mansions and the hillside landmark house
  | 'wych-elm'       // gated community on the central shelf
  | 'ashcombe'       // gated community on the south shelf
  | 'larchmere'      // gated cliff-edge enclave
  | 'marchmont'      // hotel, luxury apartments, arcade — the downtown-facing terrace
  | 'clublands'      // the country club and its grounds
  | 'village'        // the small luxury high street on the south approach
  | 'parkland';      // open landscaped ground, viewpoints, drives with no plots

type Zone = { id: EstateId; center: Point; radius: number; weight: number };
const ZONES: readonly Zone[] = [
  { id: 'crown', center: { x: -4140, z: 1520 }, radius: 880, weight: 1.06 },
  { id: 'wych-elm', center: { x: -3230, z: 2120 }, radius: 700, weight: 1.04 },
  { id: 'ashcombe', center: { x: -2740, z: 2380 }, radius: 620, weight: 1 },
  { id: 'larchmere', center: { x: -4330, z: 2380 }, radius: 720, weight: 1.02 },
  { id: 'marchmont', center: { x: -2210, z: 1560 }, radius: 760, weight: 1.05 },
  { id: 'clublands', center: { x: -3230, z: 2950 }, radius: 720, weight: 1 },
  { id: 'village', center: { x: -2520, z: 2870 }, radius: 520, weight: 1.03 },
  { id: 'parkland', center: { x: -3560, z: 1180 }, radius: 560, weight: .62 },
  { id: 'parkland', center: { x: -4520, z: 2760 }, radius: 520, weight: .6 },
];

export function zoneAt(p: Point): EstateId {
  let best: EstateId = 'parkland', bestScore = -Infinity;
  for (const zone of ZONES) {
    const d = Math.hypot(p.x - zone.center.x, p.z - zone.center.z);
    const score = (1 - d / zone.radius) * zone.weight;
    if (score > bestScore) { bestScore = score; best = zone.id; }
  }
  return best;
}
export const ZONE_IDS: readonly EstateId[] = ['crown', 'wych-elm', 'ashcombe', 'larchmere', 'marchmont', 'clublands', 'village', 'parkland'];

/**
 * Generation by position. Vantage Heights reads as three layers of money: the ridge
 * crown and the cliff enclave are the old estates (stone, walled, hedged); Marchmont is
 * the new glass generation; the village and the club sit between them.
 */
export type Vintage = 'estate' | 'modern' | 'classic';
export function vintageAt(p: Point): Vintage {
  const g = toGrid(p);
  const fields: { id: Vintage; u: number; v: number; r: number; w: number }[] = [
    { id: 'estate', u: -620, v: 120, r: 760, w: 1.06 },   // the crown, stone and walled
    { id: 'estate', u: -880, v: 900, r: 640, w: 1.02 },   // the cliff enclave
    { id: 'modern', u: 470, v: -120, r: 760, w: 1.08 },   // Marchmont glass
    { id: 'classic', u: 60, v: 1250, r: 900, w: .96 },    // the village and club
    { id: 'classic', u: -200, v: 500, r: 1500, w: .55 },
  ];
  let best: Vintage = 'classic', bestScore = -Infinity;
  for (const field of fields) {
    const d = Math.hypot(g.u - field.u, g.v - field.v);
    const score = (1 - d / field.r) * field.w;
    if (score > bestScore) { bestScore = score; best = field.id; }
  }
  return best;
}

export const ESTATE_LIMITS = {
  /** Nothing here is a tower block: the hotel crown is the tallest structure. */
  maxOrdinaryHeight: 26,
  maxLandmarkHeight: 58,
  minPlotArea: 1400,
  minBuildingWidth: 11,
  minBuildingDepth: 9,
  /** Gardens are the fabric of the district, not the leftover. */
  minGardenFraction: 0.42,
} as const;

/** How far a scenic road's viewpoint terrace reaches out from its centre-line. */
export const VIEWPOINT_REACH = 26;
