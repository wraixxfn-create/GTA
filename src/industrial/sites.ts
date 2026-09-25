/**
 * Parcels of the flats: the space between the streets becomes fenced industrial plots.
 *
 * Layout is worked out in the works grid (axis-aligned rectangles), then carried into
 * world space and clipped to the district. Grid streets bound the cells; anchors and the
 * rail corridors are subtracted as rectangles; the regional routes and Riverside Drive —
 * which run free of the grid — mask whatever they cross, leaving the setback strips that
 * read as fence lines. What remains is split into plots small enough to hold one hall,
 * one shed row or one open yard each.
 */
import type { Point } from '../world/data';
import {
  ensureCCW, polygonArea, polygonCentroid, pointToSegment, clipLeft, insetConvex, splitConvex,
  add, scale, leftNormal,
} from '../city/geometry2d';
import { IND_POLYGON, WORKS_LIMITS, fromGrid, toGrid, hash01, zoneAt, conditionAt,
  type IndZoneId, type Condition } from './frame';
import { ANCHORS } from './identity';
import { IND_NETWORK, type IndStreet } from './plan';
import { RAIL_LINES, RAIL_STATIONS, RAIL_CORRIDOR, lineHalfWidth } from './rail';

export type YardContent =
  | 'containers' | 'scrap' | 'logs' | 'trailers' | 'trucks' | 'vans' | 'aggregate'
  | 'pipe' | 'barrels' | 'pallets' | 'machinery' | 'wrecks' | 'frames' | 'plant' | 'parking';

export type SiteUse =
  | 'factory' | 'warehouse' | 'workshop' | 'office' | 'yard' | 'parking'
  | 'construction' | 'derelict';

export type Site = {
  id: string;
  polygon: Point[];
  centre: Point;
  area: number;
  zone: IndZoneId;
  condition: Condition;
  use: SiteUse;
  yard: YardContent | null;
  /** The street the plot's gates and dock doors face, with the outward normal. */
  frontage: { streetId: string; point: Point; dir: Point } | null;
  grid: { u0: number; u1: number; v0: number; v1: number };
};

/* ── cells: everything between two neighbouring street lines ─────────────────── */

const WAY_OFFSETS = [-1040, -560, -80, 400];
const ROAD_OFFSETS = [-1060, -620, -160, 300, 760, 1220];
// Fringe bands: slivers between the outer grid line and the district fence.
const U_BANDS: [number, number][] = [[-1240, -1040], [-1040, -560], [-560, -80], [-80, 400], [400, 990], [990, 1140]];
const V_BANDS: [number, number][] = [[-1240, -1060], [-1060, -620], [-620, -160], [-160, 300], [300, 760], [760, 1220], [1220, 1370]];

type GridRect = { u0: number; u1: number; v0: number; v1: number };

/** Half-width of the corridor a street line carves out of the cell it bounds. */
function streetHalfAt(offset: number, axis: 'u' | 'v'): number {
  for (const street of IND_NETWORK.streets) {
    if (street.axis !== axis || street.offset === undefined) continue;
    if (Math.abs(street.offset - offset) > 0.5) continue;
    return street.width / 2 + street.shoulder + 11;
  }
  return 12;
}

function cells(): GridRect[] {
  const out: GridRect[] = [];
  for (const [u0, u1] of U_BANDS) {
    for (const [v0, v1] of V_BANDS) {
      const cell: GridRect = { u0, u1, v0, v1 };
      // Trim the corridors of the bounding grid lines. Fringe bands keep their full
      // width on the fence side; the polygon clip takes care of the rest.
      if (WAY_OFFSETS.includes(u0)) cell.u0 += streetHalfAt(u0, 'u');
      if (WAY_OFFSETS.includes(u1)) cell.u1 -= streetHalfAt(u1, 'u');
      if (ROAD_OFFSETS.includes(v0)) cell.v0 += streetHalfAt(v0, 'v');
      if (ROAD_OFFSETS.includes(v1)) cell.v1 -= streetHalfAt(v1, 'v');
      if (cell.u1 - cell.u0 > 40 && cell.v1 - cell.v0 > 40) out.push(cell);
    }
  }
  // Service roads and yard stubs split the superblocks they cross, down the middle.
  const split: GridRect[] = [];
  for (const cell of out) {
    let pieces = [cell];
    for (const street of IND_NETWORK.streets) {
      if (street.kind !== 'service' && street.kind !== 'yard') continue;
      const next: GridRect[] = [];
      for (const piece of pieces) {
        const cut = serviceCut(street, piece);
        if (!cut) { next.push(piece); continue; }
        if (cut.axis === 'u') {
          if (cut.lo - piece.u0 > 40) next.push({ ...piece, u1: cut.lo });
          if (piece.u1 - cut.hi > 40) next.push({ ...piece, u0: cut.hi });
        } else {
          if (cut.lo - piece.v0 > 40) next.push({ ...piece, v1: cut.lo });
          if (piece.v1 - cut.hi > 40) next.push({ ...piece, v0: cut.hi });
        }
      }
      pieces = next;
    }
    split.push(...pieces);
  }
  return split;
}

/** Where a straight service lane crosses a cell: the band it occupies, per axis. */
function serviceCut(street: IndStreet, cell: GridRect): { axis: 'u' | 'v'; lo: number; hi: number } | null {
  const a = toGrid(street.samples[0]);
  const b = toGrid(street.samples[street.samples.length - 1]);
  const half = street.width / 2 + street.shoulder + 11;
  const horizontal = Math.abs(b.v - a.v) < Math.abs(b.u - a.u); // runs along u
  if (horizontal) {
    const v = (a.v + b.v) / 2;
    if (v <= cell.v0 + 8 || v >= cell.v1 - 8) return null;
    const overlap = Math.min(b.u, cell.u1) - Math.max(a.u, cell.u0);
    if (overlap < (cell.u1 - cell.u0) * 0.55) return null;
    return { axis: 'v', lo: v - half, hi: v + half };
  }
  const u = (a.u + b.u) / 2;
  if (u <= cell.u0 + 8 || u >= cell.u1 - 8) return null;
  const overlap = Math.min(b.v, cell.v1) - Math.max(a.v, cell.v0);
  if (overlap < (cell.v1 - cell.v0) * 0.55) return null;
  return { axis: 'u', lo: u - half, hi: u + half };
}

/* ── obstacles: anchors and the classification yard, as grid rectangles ──────── */

const OBSTACLES: GridRect[] = ANCHORS.map(a => ({
  u0: a.rect.u0 - 4, u1: a.rect.u1 + 4, v0: a.rect.v0 - 4, v1: a.rect.v1 + 4,
}));
// The classification yard owns its rectangle of ground outright.
for (const yard of RAIL_STATIONS) {
  const g = toGrid(yard.point);
  OBSTACLES.push({ u0: g.u - RAIL_CORRIDOR.yard - 4, u1: g.u + RAIL_CORRIDOR.yard + 4, v0: g.v - 334, v1: g.v + 334 });
}

function subtractRects(cell: GridRect): GridRect[] {
  let pieces = [cell];
  for (const obstacle of OBSTACLES) {
    const next: GridRect[] = [];
    for (const piece of pieces) {
      if (obstacle.u0 >= piece.u1 || obstacle.u1 <= piece.u0 ||
        obstacle.v0 >= piece.v1 || obstacle.v1 <= piece.v0) { next.push(piece); continue; }
      if (obstacle.u0 > piece.u0) next.push({ u0: piece.u0, u1: obstacle.u0, v0: piece.v0, v1: piece.v1 });
      if (obstacle.u1 < piece.u1) next.push({ u0: obstacle.u1, u1: piece.u1, v0: piece.v0, v1: piece.v1 });
      if (obstacle.v0 > piece.v0) next.push({ u0: Math.max(piece.u0, obstacle.u0), u1: Math.min(piece.u1, obstacle.u1), v0: piece.v0, v1: obstacle.v0 });
      if (obstacle.v1 < piece.v1) next.push({ u0: Math.max(piece.u0, obstacle.u0), u1: Math.min(piece.u1, obstacle.u1), v0: obstacle.v1, v1: piece.v1 });
    }
    pieces = next;
  }
  return pieces;
}

/** Halve big pieces until every plot can hold one building or one yard use. */
function subdivide(rect: GridRect): GridRect[] {
  const seed = Math.round(rect.u0 * 3.1 + rect.v0 * 7.7);
  const out: GridRect[] = [];
  const walk = (piece: GridRect, depth: number): void => {
    const du = piece.u1 - piece.u0, dv = piece.v1 - piece.v0;
    const long = Math.max(du, dv);
    if (long <= 170 || depth >= 3 || du * dv < 2 * WORKS_LIMITS.minPlotArea) { out.push(piece); return; }
    const jitter = 0.42 + hash01(seed, depth, 11) * 0.16;
    if (du >= dv) {
      const at = piece.u0 + du * jitter;
      walk({ ...piece, u1: at }, depth + 1);
      walk({ ...piece, u0: at }, depth + 1);
    } else {
      const at = piece.v0 + dv * jitter;
      walk({ ...piece, v1: at }, depth + 1);
      walk({ ...piece, v0: at }, depth + 1);
    }
  };
  walk(rect, 0);
  return out;
}

/* ── world-space masking: free streets, the rail, yard tracks, the fence line ── */

const POLYGON_INSET = insetConvex([...IND_POLYGON], 10);

type CorridorLine = { a: Point; b: Point; reach: number };

/** The corridor, if any, that owns the ground under `p`. */
function blockedLine(p: Point): CorridorLine | null {
  let best: CorridorLine & { d: number } | null = null;
  for (const street of IND_NETWORK.streets) {
    const reach = street.width / 2 + street.shoulder + 6;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      const hit = pointToSegment(p, a, b);
      if (hit.distance < reach && (!best || hit.distance < best.d)) best = { a, b, reach, d: hit.distance };
    }
  }
  if (best) return best;
  for (const line of RAIL_LINES) {
    const reach = lineHalfWidth(line) + 14;
    for (let i = 0; i + 1 < line.points.length; i++) {
      const hit = pointToSegment(p, line.points[i], line.points[i + 1]);
      if (hit.distance < reach && (!best || hit.distance < best.d)) best = { a: line.points[i], b: line.points[i + 1], reach, d: hit.distance };
    }
  }
  return best;
}

function inAnchor(p: Point): boolean {
  const g = toGrid(p);
  return ANCHORS.some(a => g.u > a.rect.u0 - 6 && g.u < a.rect.u1 + 6 && g.v > a.rect.v0 - 6 && g.v < a.rect.v1 + 6);
}

function probesOf(polygon: readonly Point[]): Point[] {
  const centre = polygonCentroid(polygon);
  return [...polygon, centre,
    ...polygon.map((p, i) => ({ x: (p.x + polygon[(i + 1) % polygon.length].x) / 2, z: (p.z + polygon[(i + 1) % polygon.length].z) / 2 }))];
}

/**
 * Free corridors — the regional routes and Riverside Drive — split a plot instead of
 * dropping it: both sides of the road are kept, the road band itself is not. The split
 * recurses, so a cell crossed by two diagonals ends up as three buildable pieces.
 */
function maskPiece(polygon: Point[], depth = 0): Point[][] {
  if (polygon.length < 3 || polygonArea(polygon) < 600) return [];
  const probe = probesOf(polygon).find(p => blockedLine(p) !== null);
  if (!probe) return [polygon];
  if (depth >= 5) return [];
  const corridor = blockedLine(probe)!;
  const dir = { x: corridor.b.x - corridor.a.x, z: corridor.b.z - corridor.a.z };
  const l = Math.hypot(dir.x, dir.z) || 1;
  const n = leftNormal({ x: dir.x / l, z: dir.z / l });
  const off = scale(n, corridor.reach);
  // Two cuts along the corridor: the left outer piece, the band, the right outer
  // piece. The band is dropped; the outer pieces recurse against everything else.
  const [sideA, rest] = splitConvex(polygon, add(corridor.a, off), add(corridor.b, off));
  const [, sideB] = splitConvex(rest,
    { x: corridor.a.x - off.x, z: corridor.a.z - off.z },
    { x: corridor.b.x - off.x, z: corridor.b.z - off.z });
  const keep: Point[][] = [];
  for (const piece of [sideA, sideB]) {
    if (piece.length >= 3) keep.push(...maskPiece(piece, depth + 1));
  }
  return keep;
}

const USE_BY_ZONE: Record<IndZoneId, SiteUse> = {
  heavy: 'factory', warehousing: 'warehouse', logistics: 'warehouse', repair: 'workshop',
  offices: 'office', utility: 'yard', containers: 'yard', scrap: 'yard', bulk: 'yard',
  construction: 'construction', riverside: 'derelict',
};
const YARD_BY_ZONE: Record<IndZoneId, YardContent> = {
  heavy: 'machinery', warehousing: 'pallets', logistics: 'trailers', repair: 'vans',
  offices: 'parking', utility: 'machinery', containers: 'containers', scrap: 'scrap',
  bulk: 'aggregate', construction: 'plant', riverside: 'wrecks',
};

/* ── the layout ──────────────────────────────────────────────────────────────── */

export const SITES: readonly Site[] = (() => {
  const out: Site[] = [];
  for (const cell of cells()) {
    for (const rect of subtractRects(cell)) {
      for (const piece of subdivide(rect)) {
        // Grid rect → world quad → district clip.
        let polygon = ensureCCW([
          fromGrid(piece.u0, piece.v0), fromGrid(piece.u1, piece.v0),
          fromGrid(piece.u1, piece.v1), fromGrid(piece.u0, piece.v1),
        ]);
        for (let i = 0; i < POLYGON_INSET.length && polygon.length; i++) {
          polygon = clipLeft(polygon, POLYGON_INSET[i], POLYGON_INSET[(i + 1) % POLYGON_INSET.length]);
        }
        if (polygon.length < 3) continue;
        // Free corridors (regional routes, Riverside Drive, the rail) split the plot;
        // the setback strip they leave reads as the fence line every works has anyway.
        for (const masked of maskPiece(polygon)) {
        const polygon2 = masked;
        if (polygon2.length < 3) continue;
        const centre = polygonCentroid(polygon2);
        if (inAnchor(centre)) continue;
        const area = polygonArea(polygon2);
        if (area < WORKS_LIMITS.minPlotArea) continue;
        // East of Riverside Drive the ground belongs to the river terrace: reserved
        // brownfield for the future waterfront, never a works plot.
        const zone = toGrid(centre).u > 855 ? 'riverside' as const : zoneAt(centre);
        const hash = hash01(Math.round(centre.x / 37), Math.round(centre.z / 37), 5);
        let use = USE_BY_ZONE[zone];
        let yard: YardContent | null = YARD_BY_ZONE[zone];
        // A little tenancy variety: some storage plots are truck parks, some heavy
        // plots are fabricators' yards, and derelict ground stays empty.
        if (use === 'warehouse' && hash < 0.22) { use = 'parking'; yard = hash < 0.1 ? 'trucks' : 'trailers'; }
        if (use === 'factory' && hash > 0.82) { use = 'yard'; yard = 'frames'; }
        if (use === 'yard' && zone === 'bulk' && hash > 0.7) { use = 'warehouse'; yard = 'aggregate'; }
        let condition = conditionAt(centre);
        if (zone === 'construction') condition = 'construction';
        if (zone === 'riverside') condition = 'abandoned';
        if (use === 'derelict') condition = 'abandoned';
        // Per-plot grain on the condition fields: a neglected tenant here and there.
        if (condition === 'active' && hash > 0.93) condition = 'abandoned';
        if (condition === 'renovated' && hash < 0.05) condition = 'active';
        if (condition === 'abandoned' && zone !== 'riverside' && zone !== 'scrap' && hash > 0.7) condition = 'active';
        if (condition === 'construction' && zone !== 'construction' && hash < 0.6) condition = 'active';
        // Frontage: the street the plot's fence line actually meets. Measured from the
        // plot corners, not its centre — deep plots still gate onto their street.
        const bbox = {
          minX: Math.min(...polygon2.map(q => q.x)) - 40, maxX: Math.max(...polygon2.map(q => q.x)) + 40,
          minZ: Math.min(...polygon2.map(q => q.z)) - 40, maxZ: Math.max(...polygon2.map(q => q.z)) + 40,
        };
        let frontage: Site['frontage'] = null;
        let bestEdge = Infinity;
        for (const street of IND_NETWORK.streets) {
          const half = street.width / 2 + street.shoulder;
          for (let i = 0; i + 1 < street.samples.length; i++) {
            const a = street.samples[i], b = street.samples[i + 1];
            if (a.span !== b.span) continue;
            if (Math.max(a.x, b.x) < bbox.minX || Math.min(a.x, b.x) > bbox.maxX ||
              Math.max(a.z, b.z) < bbox.minZ || Math.min(a.z, b.z) > bbox.maxZ) continue;
            for (const corner of polygon2) {
              const hit = pointToSegment(corner, a, b);
              const edge = hit.distance - half;
              if (edge >= bestEdge) continue;
              bestEdge = edge;
              const point = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
              const dx = centre.x - point.x, dz = centre.z - point.z;
              const l = Math.hypot(dx, dz) || 1;
              frontage = { streetId: street.id, point, dir: { x: dx / l, z: dz / l } };
            }
          }
        }
        if (bestEdge > 22) frontage = null;
        out.push({
          id: `site${out.length}`, polygon: polygon2, centre, area, zone, condition, use, yard, frontage,
          grid: { ...piece },
        });
        }
      }
    }
  }
  return out;
})();

/* ── spatial index (500 m tiles, matching the streaming layout) ──────────────── */

const TILE = 500;
const SITES_BY_TILE = new Map<string, number[]>();
for (const [index, site] of SITES.entries()) {
  const minX = Math.min(...site.polygon.map(p => p.x)), maxX = Math.max(...site.polygon.map(p => p.x));
  const minZ = Math.min(...site.polygon.map(p => p.z)), maxZ = Math.max(...site.polygon.map(p => p.z));
  for (let iz = Math.floor(minZ / TILE); iz <= Math.floor(maxZ / TILE); iz++) {
    for (let ix = Math.floor(minX / TILE); ix <= Math.floor(maxX / TILE); ix++) {
      const key = `${ix}:${iz}`;
      const list = SITES_BY_TILE.get(key) ?? [];
      list.push(index);
      SITES_BY_TILE.set(key, list);
    }
  }
}

export function sitesInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Site[] {
  const out: Site[] = [];
  const seen = new Set<number>();
  for (let iz = Math.floor(bounds.minZ / TILE); iz <= Math.floor(bounds.maxZ / TILE); iz++) {
    for (let ix = Math.floor(bounds.minX / TILE); ix <= Math.floor(bounds.maxX / TILE); ix++) {
      for (const index of SITES_BY_TILE.get(`${ix}:${iz}`) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const site = SITES[index];
        if (site.polygon.some(p => p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ)) out.push(site);
      }
    }
  }
  return out;
}

export const siteSummary = (() => {
  const byUse: Record<string, number> = {};
  const byCondition: Record<string, number> = {};
  let area = 0;
  for (const site of SITES) {
    byUse[site.use] = (byUse[site.use] ?? 0) + 1;
    byCondition[site.condition] = (byCondition[site.condition] ?? 0) + 1;
    area += site.area;
  }
  return { count: SITES.length, byUse, byCondition, areaHa: Math.round(area / 10000 * 10) / 10 };
})();
