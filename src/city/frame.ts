/**
 * The downtown frame: footprint, street-grid basis, ground datum, zoning and the
 * deterministic randomness every generator in the district shares.
 *
 * Nothing here is copied from a real city. The grid axis, block rhythm, street names
 * and landmarks are authored for this region so the district reads as one place with
 * its own plan rather than a generic grid dropped on the map.
 */
import { DISTRICTS, type Point } from '../world/data';
import { cityFloorWeight, terrainHeight } from '../world/geometry';
import {
  convexSignedDistance, ensureCCW, insetConvex, polygonBounds, polygonCentroid, type Bounds,
} from './geometry2d';

export const DOWNTOWN = DISTRICTS.find(d => d.id === 'downtown')!;

/** Built-up limit. The district reservation is the city limit; assets stay inside it. */
export const CITY_POLYGON: readonly Point[] = ensureCCW(DOWNTOWN.polygon);
/**
 * Perimeter distributor ("The Parade") centreline. The street grid is clipped to it so
 * every grid line terminates on a through route instead of ending in a dead end, and the
 * strip between it and the city limit stays planted.
 */
export const RING_POLYGON: readonly Point[] = insetConvex(CITY_POLYGON, 46);
/** Street grid extent: grid lines end exactly on the ring centreline. */
export const GRID_POLYGON: readonly Point[] = RING_POLYGON;
export const CITY_BOUNDS: Bounds = polygonBounds(CITY_POLYGON);

/**
 * Street grid basis. The axis is rotated off east so avenues run with the long axis of
 * the reservation (ESE–WNW) instead of fighting it; crosses are near-perpendicular.
 */
export const GRID_ANGLE = (13 * Math.PI) / 180;
export const GRID_ORIGIN: Point = polygonCentroid(CITY_POLYGON);
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

/** Grid bounds of a polygon, used to lay out the street lines over the whole footprint. */
export function gridBounds(polygon: readonly Point[]): { minU: number; maxU: number; minV: number; maxV: number } {
  const b = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const p of polygon) {
    const g = toGrid(p);
    b.minU = Math.min(b.minU, g.u); b.maxU = Math.max(b.maxU, g.u);
    b.minV = Math.min(b.minV, g.v); b.maxV = Math.max(b.maxV, g.v);
  }
  return b;
}
export const CITY_GRID_BOUNDS = gridBounds(GRID_POLYGON);

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
 * Ground datum. The city sits on a graded pad at the same crown height the regional
 * arterials already use, so a street leaving the district meets its continuation
 * outside without a step.
 */
export const SLAB_HEIGHT = 1.7;
export const SIDEWALK_RISE = 0.17;
export const CURB_HEIGHT = SIDEWALK_RISE;
export const PLAZA_RISE = 0.06;
/**
 * The graded pad does not stop at the city limit with a step: it ramps back down to the
 * natural ground across the planted margin, so a regional road arriving at the district
 * meets its continuation inside without a kerb in the air. Everything built on a parcel
 * sits well inside the ramp and is therefore dead level.
 */
const PAD_RAMP = 120;
function rawPadWeight(x: number, z: number): number {
  const d = convexSignedDistance(CITY_POLYGON, { x, z });
  if (d <= 0) return 0;
  if (d >= PAD_RAMP) return 1;
  const t = d / PAD_RAMP;
  return t * t * (3 - 2 * t);
}
/** Pad weight is sampled on a coarse grid because every vertex of the district asks for it. */
const PAD_CELL = 4;
const PAD_MIN_X = Math.floor((CITY_BOUNDS.minX - 160) / PAD_CELL) * PAD_CELL;
const PAD_MIN_Z = Math.floor((CITY_BOUNDS.minZ - 160) / PAD_CELL) * PAD_CELL;
const PAD_COLS = Math.ceil((CITY_BOUNDS.maxX - CITY_BOUNDS.minX + 320) / PAD_CELL) + 1;
const PAD_ROWS = Math.ceil((CITY_BOUNDS.maxZ - CITY_BOUNDS.minZ + 320) / PAD_CELL) + 1;
const PAD_CACHE = new Float32Array(PAD_COLS * PAD_ROWS).fill(-1);
function padSample(ix: number, iz: number): number {
  const cx = Math.min(PAD_COLS - 1, Math.max(0, ix));
  const cz = Math.min(PAD_ROWS - 1, Math.max(0, iz));
  const index = cz * PAD_COLS + cx;
  let value = PAD_CACHE[index];
  if (value < 0) {
    value = rawPadWeight(PAD_MIN_X + cx * PAD_CELL, PAD_MIN_Z + cz * PAD_CELL);
    PAD_CACHE[index] = value;
  }
  return value;
}
export function padWeight(x: number, z: number): number {
  const fx = (x - PAD_MIN_X) / PAD_CELL, fz = (z - PAD_MIN_Z) / PAD_CELL;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const a = padSample(ix, iz), b = padSample(ix + 1, iz);
  const c = padSample(ix, iz + 1), d = padSample(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
export function cityGround(x: number, z: number): number {
  return terrainHeight(x, z) + SLAB_HEIGHT * padWeight(x, z);
}
export function gradingWeight(x: number, z: number): number {
  return cityFloorWeight(x, z);
}

export type ZoneId = 'core' | 'financial' | 'midtown' | 'civic' | 'historic' | 'retail' | 'residential' | 'service';

/**
 * Zoning is a weighted Voronoi over authored centres rather than a hard map: land use
 * bleeds into the neighbouring zone at the edges, which is what makes the skyline and
 * the street-level mix change gradually instead of in bands.
 */
type Zone = { id: ZoneId; center: Point; radius: number; weight: number };
export const CORE_CENTER: Point = fromGrid(90, -40);
const ZONES: readonly Zone[] = [
  { id: 'core', center: fromGrid(90, -40), radius: 520, weight: 1 },
  { id: 'financial', center: fromGrid(430, -140), radius: 430, weight: 1.02 },
  { id: 'civic', center: fromGrid(-280, 300), radius: 430, weight: 1 },
  { id: 'historic', center: fromGrid(-620, 620), radius: 420, weight: .98 },
  { id: 'retail', center: fromGrid(-60, 430), radius: 400, weight: 1 },
  { id: 'residential', center: fromGrid(560, 470), radius: 470, weight: 1 },
  { id: 'residential', center: fromGrid(-700, -420), radius: 430, weight: 1 },
  { id: 'service', center: fromGrid(120, -680), radius: 380, weight: .95 },
  { id: 'midtown', center: fromGrid(0, 0), radius: 1400, weight: .55 },
];
export function zoneAt(p: Point): ZoneId {
  let best: ZoneId = 'midtown', bestScore = -Infinity;
  for (const zone of ZONES) {
    const d = Math.hypot(p.x - zone.center.x, p.z - zone.center.z);
    const score = (1 - d / zone.radius) * zone.weight;
    if (score > bestScore) { bestScore = score; best = zone.id; }
  }
  return best;
}
export function zoneOf(u: number, v: number): ZoneId {
  return zoneAt(fromGrid(u, v));
}

/** Distance to the financial core drives height: the skyline peaks in one place. */
export function coreDistance(x: number, z: number): number {
  return Math.hypot(x - CORE_CENTER.x, z - CORE_CENTER.z);
}

export const CITY_LIMITS = {
  /** Buildings above this height need a landmark site; keeps the skyline believable. */
  maxTowerHeight: 300,
  maxOrdinaryHeight: 132,
  minParcelArea: 95,
  minBuildingWidth: 6.5,
  minBuildingDepth: 6.5,
} as const;
