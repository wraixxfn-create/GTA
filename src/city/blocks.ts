/**
 * Blocks, parcels, alleys and open space.
 *
 * Every block is the rectangle between four streets, clipped to the perimeter distributor,
 * inset to the back edge of the sidewalk, and then carved by the older diagonal routes and
 * by its own service alley. What survives is cut into perimeter parcels around a shared
 * interior, which is how a dense district actually fills in: continuous street walls,
 * service behind, leftovers in the middle.
 *
 * Polygons carry a tag per edge so the generator always knows what a parcel faces —
 * a street, an alley, a legacy boulevard or a neighbour's wall.
 */
import type { Point } from '../world/data';
import { AVENUES, CELLS_U, CELLS_V, STREETS, cellNoise } from './grid';
import { NETWORK, type Street } from './streets';
import { SITES, siteAtCell, type Site, type SitePart } from './sites';
import {
  CITY_LIMITS, RING_POLYGON, fromGrid, hash01, makeRandom, toGrid, zoneAt, type ZoneId,
} from './frame';
import {
  add, clipLeft, distance2d, ensureCCW, insetConvex, longestEdge, normalize, polygonArea,
  polygonCentroid, polygonPerimeter, scale, sub,
} from './geometry2d';

export type EdgeTag = string; // 'u:8' | 'v:6' | 'ring' | 'legacy:a19' | 'alley:3-7' | 'interior'
export type TaggedPoly = { points: Point[]; tags: EdgeTag[] };

export type Use =
  | 'office' | 'retail' | 'apartment' | 'hotel' | 'civic' | 'museum'
  | 'parking' | 'service' | 'mixed' | 'market' | 'transit';

export type Alley = {
  id: string;
  name: string;
  a: Point;
  b: Point;
  width: number;
  cell: { i: number; j: number };
};

export type Parcel = {
  id: string;
  polygon: Point[];
  /** Which carved piece and which perimeter band of that piece the lot came from. */
  serial: number;
  band: number;
  /** The street-facing side: buildings are oriented to it and entered from it. */
  frontage: { a: Point; b: Point; length: number; dir: Point; normal: Point };
  tag: EdgeTag;
  streetId: string | null;
  use: Use;
  zone: ZoneId;
  depth: number;
  area: number;
  cell: { i: number; j: number };
  site?: string;
  /** Set-back from the frontage for a forecourt, entrance or café terrace. */
  setback: number;
};

export type OpenSpace = {
  id: string;
  polygon: Point[];
  kind: 'courtyard' | 'parking' | 'plaza' | 'lawn' | 'apron' | 'cobbles' | 'terrace' | 'verge';
  feature: 'none' | 'fountain' | 'pavilion' | 'amphitheatre' | 'bosque' | 'playground' | 'market' | 'sculpture' | 'portecochere' | 'terrace' | 'trees' | 'planting';
  site?: string;
  cell?: { i: number; j: number };
  /** Below-ground parking levels, where the space sits over a garage. */
  garage?: { levels: number; depth: number };
};

export type Block = {
  id: string;
  cell: { i: number; j: number };
  /** Buildable area of the block before carving. */
  area: number;
  pieces: TaggedPoly[];
  alley?: Alley;
};

/* ── tagged polygon primitives ─────────────────────────────────────────────────── */

export function makeTagged(points: readonly Point[], tag: EdgeTag): TaggedPoly {
  const poly = ensureCCW(points);
  return { points: poly, tags: poly.map(() => tag) };
}

/** Sutherland–Hodgman clip that keeps the provenance of every edge. */
export function clipTagged(poly: TaggedPoly, a: Point, b: Point, tag: EdgeTag): TaggedPoly {
  const d = sub(b, a);
  const side = (p: Point) => d.x * (p.z - a.z) - d.z * (p.x - a.x);
  const points: Point[] = [], tags: EdgeTag[] = [];
  for (let i = 0; i < poly.points.length; i++) {
    const p = poly.points[i], q = poly.points[(i + 1) % poly.points.length];
    const tag = poly.tags[i];
    const sp = side(p), sq = side(q);
    if (sp >= 0) { points.push(p); tags.push(tag); }
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      const x = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
      if (sp >= 0) { points.push(x); tags.push(tag); }      // leaving: clip line starts here
      else { points.push(x); tags.push(tag); }              // entering: original edge continues
    }
  }
  // The new edge running along the clip line belongs to the clip.
  const out: TaggedPoly = { points, tags };
  if (points.length >= 3) {
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      if (side(points[i]) < 1e-9 && side(next) < 1e-9) tags[i] = tag;
    }
  }
  return out;
}

function insetTagged(poly: TaggedPoly, distanceFor: (tag: EdgeTag) => number): TaggedPoly {
  let result = poly;
  for (let i = 0; i < poly.points.length && result.points.length >= 3; i++) {
    const tag = poly.tags[i];
    const d = distanceFor(tag);
    if (d <= 0) continue;
    const a = poly.points[i], b = poly.points[(i + 1) % poly.points.length];
    const n = normalize({ x: -(b.z - a.z), z: b.x - a.x });
    result = clipTagged(result, add(a, scale(n, d)), add(b, scale(n, d)), tag);
  }
  return result;
}

/** Keep the half-plane dot(p, n) >= c, used for strip depths and corner mitres. */
function clipInequality(poly: TaggedPoly, n: Point, c: number, tag: EdgeTag): TaggedPoly {
  const len2 = n.x * n.x + n.z * n.z;
  if (len2 < 1e-12) return poly;
  const base = scale(n, c / len2);
  const dir = { x: n.z, z: -n.x };
  return clipTagged(poly, base, add(base, dir), tag);
}

/** Split a convex polygon by a corridor; both halves inherit the corridor as frontage. */
function carveCorridor(poly: TaggedPoly, a: Point, b: Point, halfWidth: number, tag: EdgeTag): TaggedPoly[] {
  const dir = normalize(sub(b, a));
  const n = { x: -dir.z, z: dir.x };
  const left = clipTagged(poly, add(a, scale(n, halfWidth)), add(b, scale(n, halfWidth)), tag);
  const right = clipTagged(poly, add(b, scale(n, -halfWidth)), add(a, scale(n, -halfWidth)), tag);
  return [left, right].filter(p => p.points.length >= 3 && polygonArea(p.points) > 40);
}

/* ── street corridors ──────────────────────────────────────────────────────────── */

/** Distance from the centre-line to the back of the sidewalk: the building line. */
const corridorHalf = (street: Street): number => street.width / 2 + Math.max(street.sidewalk, 0);
const RING = NETWORK.streets.find(s => s.id === 'ring')!;
const RING_HALF = corridorHalf(RING) + 2;

const CELL_STREETS = new Map<string, { u0: Street; u1: Street; v0: Street; v1: Street }>();
for (let i = 0; i < CELLS_U; i++) for (let j = 0; j < CELLS_V; j++) {
  CELL_STREETS.set(`${i}:${j}`, {
    u0: NETWORK.streetById.get(`u${i}`)!, u1: NETWORK.streetById.get(`u${i + 1}`)!,
    v0: NETWORK.streetById.get(`v${j}`)!, v1: NETWORK.streetById.get(`v${j + 1}`)!,
  });
}

/** Legacy boulevards and gateway approaches that cut across the grid. */
const CUTTERS = NETWORK.streets.filter(s => s.axis === 'free' && s.id !== 'ring');

/**
 * The grid is straight through the district but its outer ends are filleted into the ring.
 * Parcels are clipped on the straight grid, so those short curved landings need one extra
 * right-of-way cut; otherwise the first 50–100 m of a street would curve under the first
 * row of buildings. Keep only the curved runs, not the rest of each grid street.
 */
const CURVED_GRID = new Map<string, { street: Street; runs: Point[][] }>();
for (const street of NETWORK.streets) {
  if ((street.axis !== 'u' && street.axis !== 'v') || street.offset === undefined) continue;
  const coordinate = street.axis === 'u' ? 'u' : 'v';
  const deviations = street.samples.map(sample => Math.abs(toGrid(sample)[coordinate] - street.offset!));
  const runs: Point[][] = [];
  let start = -1, end = -1;
  const flush = () => {
    if (start >= 0 && end >= start) {
      const from = Math.max(0, start - 1), to = Math.min(street.samples.length - 1, end + 1);
      runs.push(street.samples.slice(from, to + 1).map(p => ({ x: p.x, z: p.z })));
    }
    start = end = -1;
  };
  deviations.forEach((deviation, index) => {
    if (deviation > 2) {
      if (start < 0) start = index;
      end = index;
    } else if (start >= 0 && index > end + 1) flush();
  });
  flush();
  if (runs.length) CURVED_GRID.set(street.id, { street, runs });
}

/** Fit straight chords through a cutting route inside one polygon. */
function chords(polygon: TaggedPoly, street: Street): { a: Point; b: Point }[] {
  const inside = street.samples.filter(p => pointInside(p, polygon.points));
  if (inside.length < 2) {
    const near = street.samples.filter(p => distance2d(p, polygonCentroid(polygon.points)) < 260);
    if (near.length < 2) return [];
    return fitChords(near);
  }
  return fitChords(inside);
}
function chordsFromRun(run: readonly Point[], polygon: TaggedPoly): { a: Point; b: Point }[] {
  const inside = run.filter(p => pointInside(p, polygon.points));
  if (inside.length >= 2) return fitChords(inside);
  const near = run.filter(p => distance2d(p, polygonCentroid(polygon.points)) < 260);
  return near.length >= 2 ? fitChords(near) : [];
}
function carveCurvedGrid(pieces: TaggedPoly[], streetIds: readonly string[]): TaggedPoly[] {
  for (const id of streetIds) {
    const route = CURVED_GRID.get(id);
    if (!route) continue;
    for (const run of route.runs) {
      const next: TaggedPoly[] = [];
      for (const piece of pieces) {
        const lines = chordsFromRun(run, piece);
        if (!lines.length) { next.push(piece); continue; }
        let current = [piece];
        for (const chord of lines) {
          const carved: TaggedPoly[] = [];
          for (const candidate of current) {
            carved.push(...carveCorridor(candidate, chord.a, chord.b, corridorHalf(route.street) + 1.5, `curve:${id}`));
          }
          current = carved;
        }
        next.push(...current);
      }
      pieces = next;
    }
  }
  return pieces;
}
function pointInside(p: Point, polygon: readonly Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) < -1e-9) return false;
  }
  return true;
}
/** Recursively split a run of centre-line points into chords that stay within tolerance. */
function fitChords(points: readonly Point[], tolerance = 1.4, depth = 0): { a: Point; b: Point }[] {
  const a = points[0], b = points[points.length - 1];
  if (depth > 3 || points.length < 3) return [{ a, b }];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let worst = 0, index = -1;
  points.forEach((p, i) => {
    const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
    if (d > worst) { worst = d; index = i; }
  });
  if (worst <= tolerance) return [{ a, b }];
  return [
    ...fitChords(points.slice(0, index + 1), tolerance, depth + 1),
    ...fitChords(points.slice(index), tolerance, depth + 1),
  ];
}

/* ── block assembly ────────────────────────────────────────────────────────────── */

function cellPolygon(i: number, j: number): TaggedPoly {
  const u0 = AVENUES[i].offset, u1 = AVENUES[i + 1].offset;
  const v0 = STREETS[j].offset, v1 = STREETS[j + 1].offset;
  const corners = [fromGrid(u0, v0), fromGrid(u1, v0), fromGrid(u1, v1), fromGrid(u0, v1)];
  const poly = ensureCCW(corners);
  // Tag each edge with the street it faces: corner order is preserved by ensureCCW for
  // an axis-aligned rectangle, so identify edges by which coordinate they hold constant.
  // Identify each edge in grid space, never in world x/z: the grid is rotated, so a
  // world-space comparison picks the wrong street for cells far from the grid origin and
  // the block is then pulled back by the wrong corridor width.
  const tags: EdgeTag[] = poly.map((p, index) => {
    const q = poly[(index + 1) % poly.length];
    const a = toGrid(p), b = toGrid(q);
    if (Math.abs(a.u - b.u) < Math.abs(a.v - b.v)) {
      const u = (a.u + b.u) / 2;
      return Math.abs(u - u0) < Math.abs(u - u1) ? `u:${i}` : `u:${i + 1}`;
    }
    const v = (a.v + b.v) / 2;
    return Math.abs(v - v0) < Math.abs(v - v1) ? `v:${j}` : `v:${j + 1}`;
  });
  return { points: poly, tags };
}

function streetForTag(tag: EdgeTag): Street | null {
  if (tag === 'ring') return RING;
  if (tag.startsWith('curve:')) return NETWORK.streetById.get(tag.slice(6)) ?? null;
  const [axis, index] = tag.split(':');
  if (axis === 'u' || axis === 'v') return NETWORK.streetById.get(`${axis}${index}`) ?? null;
  return null;
}

/** Clip a cell to the distributor, pull it back to the building line, carve cutters. */
function blockPieces(i: number, j: number, distanceFor: (tag: EdgeTag) => number): TaggedPoly[] {
  let poly = cellPolygon(i, j);
  // Clip to the perimeter distributor: anything outside it is planted verge.
  for (let k = 0; k < RING_POLYGON.length && poly.points.length >= 3; k++) {
    const a = RING_POLYGON[k], b = RING_POLYGON[(k + 1) % RING_POLYGON.length];
    poly = clipTagged(poly, a, b, 'ring');
  }
  if (poly.points.length < 3 || polygonArea(poly.points) < 200) return [];
  poly = insetTagged(poly, distanceFor);
  if (poly.points.length < 3 || polygonArea(poly.points) < 200) return [];

  // Older diagonal routes cut through the grid; carve them out.
  let pieces = [poly];
  for (const cutter of CUTTERS) {
    const next: TaggedPoly[] = [];
    for (const piece of pieces) {
      const found = chords(piece, cutter);
      if (!found.length) { next.push(piece); continue; }
      let survivors = [piece];
      for (const chord of found) {
        const carved: TaggedPoly[] = [];
        for (const survivor of survivors) {
          carved.push(...carveCorridor(survivor, chord.a, chord.b, corridorHalf(cutter) + 1.5, `legacy:${cutter.id}`));
        }
        survivors = carved;
      }
      next.push(...(survivors.length ? survivors : [piece]));
    }
    pieces = next;
  }
  // The perimeter fillets are localized; carve only their actual sampled geometry. A
  // straight grid corridor was already inset above, so this changes only the places where
  // its centre-line bends inward into the adjoining block.
  pieces = carveCurvedGrid(pieces, [`u${i}`, `u${i + 1}`, `v${j}`, `v${j + 1}`]);
  return pieces.filter(p => p.points.length >= 3 && polygonArea(p.points) > CITY_LIMITS.minParcelArea * 1.6);
}

/* ── parcel cutting ────────────────────────────────────────────────────────────── */

/** Distance from an edge's line to the farthest corner: how deep a parcel there can be. */
function availableDepth(poly: TaggedPoly, index: number): number {
  const a = poly.points[index], b = poly.points[(index + 1) % poly.points.length];
  const n = normalize({ x: -(b.z - a.z), z: b.x - a.x });
  let deepest = 0;
  for (const p of poly.points) deepest = Math.max(deepest, (p.x - a.x) * n.x + (p.z - a.z) * n.z);
  return deepest;
}

const USE_BY_ZONE: Record<ZoneId, Use[]> = {
  core: ['office', 'office', 'retail', 'mixed'],
  financial: ['office', 'office', 'retail', 'mixed'],
  midtown: ['office', 'mixed', 'retail', 'apartment'],
  civic: ['civic', 'office', 'retail', 'mixed'],
  historic: ['retail', 'market', 'mixed', 'apartment'],
  retail: ['retail', 'retail', 'mixed', 'market'],
  residential: ['apartment', 'apartment', 'retail', 'mixed'],
  service: ['parking', 'service', 'office', 'mixed'],
};
/** Frontage width bands by use: shops are narrow, office towers take a whole frontage. */
const LOT_WIDTH: Record<Use, [number, number]> = {
  office: [30, 58], retail: [12, 26], apartment: [22, 40], hotel: [36, 62],
  civic: [34, 70], museum: [40, 80], parking: [32, 62], service: [28, 54],
  mixed: [18, 34], market: [20, 36], transit: [50, 90],
};
const USE_BY_FRONTAGE: Record<string, Use> = {
  alley: 'service', ring: 'mixed',
};

function useFor(tag: EdgeTag, zone: ZoneId, random: () => number): Use {
  if (tag.startsWith('alley:') || tag.startsWith('legacy:')) {
    return random() < .55 ? 'service' : 'parking';
  }
  const pool = USE_BY_ZONE[zone];
  return pool[Math.floor(random() * pool.length)];
}

function cutParcels(
  piece: TaggedPoly, cell: { i: number; j: number }, serial: number, random: () => number,
  out: { parcels: Parcel[]; courtyards: OpenSpace[] },
): void {
  const count = piece.points.length;
  const centre = polygonCentroid(piece.points);
  const zone = zoneAt(centre);
  const depths = piece.points.map((_, index) => {
    const tag = piece.tags[index];
    const street = streetForTag(tag);
    const cap = tag.startsWith('alley:') ? 14 : street?.kind === 'pedestrian' ? 22 : 30;
    return Math.max(8, Math.min(cap, availableDepth(piece, index) * .46));
  });
  // Perimeter bands. Corners are split along the mitre between two neighbouring
  // frontages, so the bands tile the block edge: continuous street wall, no overlaps.
  const bands: { poly: TaggedPoly; index: number }[] = [];
  for (let index = 0; index < count; index++) {
    const a = piece.points[index], b = piece.points[(index + 1) % piece.points.length];
    const n = normalize({ x: -(b.z - a.z), z: b.x - a.x });
    const offset = a.x * n.x + a.z * n.z + depths[index];
    let band: TaggedPoly = clipInequality(piece, { x: -n.x, z: -n.z }, -offset, piece.tags[index]);
    // Mitre against every other edge, not just the neighbours: on a tapered or
    // corner-sliced block the opposite frontages can otherwise meet in the middle.
    for (let neighbour = 0; neighbour < count; neighbour++) {
      if (neighbour === index) continue;
      const na = piece.points[neighbour], nb = piece.points[(neighbour + 1) % piece.points.length];
      const nn = normalize({ x: -(nb.z - na.z), z: nb.x - na.x });
      const nOffset = na.x * nn.x + na.z * nn.z + depths[neighbour];
      band = clipInequality(band, sub(nn, n), nOffset - offset, piece.tags[index]);
    }
    if (band.points.length >= 3 && polygonArea(band.points) > CITY_LIMITS.minParcelArea * .7) {
      bands.push({ poly: band, index });
    }
  }
  // Whatever the bands did not take is the block interior.
  let interior: TaggedPoly = piece;
  for (let index = 0; index < count && interior.points.length >= 3; index++) {
    const a = piece.points[index], b = piece.points[(index + 1) % piece.points.length];
    const n = normalize({ x: -(b.z - a.z), z: b.x - a.x });
    interior = clipTagged(interior, add(a, scale(n, depths[index])), add(b, scale(n, depths[index])), 'interior');
  }
  if (interior.points.length >= 3 && polygonArea(interior.points) > 120) {
    out.courtyards.push({
      id: `court-${cell.i}-${cell.j}-${serial}`,
      polygon: interior.points,
      kind: random() < .5 ? 'parking' : 'courtyard',
      feature: random() < .35 ? 'trees' : 'none',
      cell,
    });
  }

  for (const band of bands) {
    const index = band.index;
    const tag = piece.tags[index];
    const a = piece.points[index], b = piece.points[(index + 1) % piece.points.length];
    const dir = normalize(sub(b, a));
    const total = distance2d(a, b);
    let use = useFor(tag, zone, random);
    if (USE_BY_FRONTAGE[tag.split(':')[0]] && tag !== 'ring') use = USE_BY_FRONTAGE[tag.split(':')[0]];
    const [minWidth, maxWidth] = LOT_WIDTH[use];
    // Lay out frontages of mixed width so a street wall never looks like a fence.
    let cursor = 0;
    let lot = 0;
    while (cursor < total - 6) {
      const remaining = total - cursor;
      let width = minWidth + random() * (maxWidth - minWidth);
      if (remaining - width < minWidth * .8) width = remaining;
      if (remaining < minWidth * .7) break;
      const from = cursor, to = Math.min(total, cursor + width);
      const start = add(a, scale(dir, from));
      const end = add(a, scale(dir, to));
      const n = { x: -dir.z, z: dir.x };
      // Cut the band perpendicular to the street at each lot boundary.
      let lotPoly: TaggedPoly = clipTagged(band.poly, start, add(start, scale(n, -400)), tag);
      lotPoly = clipTagged(lotPoly, end, add(end, scale(n, 400)), 'interior');
      if (lotPoly.points.length >= 3 && polygonArea(lotPoly.points) > CITY_LIMITS.minParcelArea * .8) {
        const front = frontageOf(lotPoly, start, end);
        if (front) {
          const street = streetForTag(tag);
          out.parcels.push({
            id: `p-${cell.i}-${cell.j}-${serial}-${index}-${lot}`,
            polygon: lotPoly.points,
            serial, band: index,
            frontage: front,
            tag, streetId: tag.startsWith('legacy:') ? tag.slice(7) : street?.id ?? null,
            use: sameUseRun(random) ? use : use,
            zone, depth: depths[index],
            area: polygonArea(lotPoly.points),
            cell,
            setback: 0,
          });
        }
      }
      cursor = to;
      lot++;
      if (lot > 24) break;
    }
  }
}
/** Most lots keep the frontage use; the odd one changes so streets are not uniform. */
function sameUseRun(random: () => number): boolean { return random() < .85; }

function frontageOf(poly: TaggedPoly, a: Point, b: Point) {
  let best: { a: Point; b: Point; length: number } | null = null;
  for (let i = 0; i < poly.points.length; i++) {
    const p = poly.points[i], q = poly.points[(i + 1) % poly.points.length];
    // The frontage is the edge closest to the stretch of street this lot was cut from.
    const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    if (distance2d(mid, a) + distance2d(mid, b) > distance2d(a, b) + 4) continue;
    const length = distance2d(p, q);
    if (!best || length > best.length) best = { a: p, b: q, length };
  }
  if (!best || best.length < CITY_LIMITS.minBuildingWidth * .6) return null;
  const dir = normalize(sub(best.b, best.a));
  return { a: best.a, b: best.b, length: best.length, dir, normal: { x: -dir.z, z: dir.x } };
}

/* ── alleys ────────────────────────────────────────────────────────────────────── */

const ALLEY_WIDTH = 7.5;

function alleyFor(i: number, j: number, polygon: TaggedPoly, random: () => number): { alley: Alley; pieces: TaggedPoly[] } | null {
  const centre = polygonCentroid(polygon.points);
  const long = longestEdge(polygon.points);
  const length = long.length;
  if (length < 118) return null;
  const u0 = AVENUES[i].offset, u1 = AVENUES[i + 1].offset;
  const v0 = STREETS[j].offset, v1 = STREETS[j + 1].offset;
  const cellU = Math.abs(u1 - u0), cellV = Math.abs(v1 - v0);
  // Split the long dimension: the alley runs across the block, connecting the two
  // streets on the short ends, exactly as the original subdivision left it.
  const alongU = cellU >= cellV;
  const mid = alongU ? (u0 + u1) / 2 : (v0 + v1) / 2;
  const a = alongU ? fromGrid(mid, v0) : fromGrid(u0, mid);
  const b = alongU ? fromGrid(mid, v1) : fromGrid(u1, mid);
  const tag = `alley:${i}-${j}`;
  const pieces = carveCorridor(polygon, a, b, ALLEY_WIDTH / 2 + 1.6, tag);
  if (pieces.length < 2) return null;
  void centre; void random;
  return {
    alley: { id: tag.slice(6), name: `${STREETS[j].name.replace(/ (Street|Avenue|Row|Walk)$/, '')} Service Way`, a, b, width: ALLEY_WIDTH, cell: { i, j } },
    pieces,
  };
}

/* ── generation ────────────────────────────────────────────────────────────────── */

export type CityPlan = {
  blocks: Block[];
  parcels: Parcel[];
  courtyards: OpenSpace[];
  alleys: Alley[];
  siteAreas: { site: Site; parts: { part: SitePart; polygon: Point[]; tag: EdgeTag }[]; polygons: Point[][] }[];
  verge: OpenSpace[];
};

/** Distance from a tagged edge back to the building line. */
function distanceFor(tag: EdgeTag): number {
  if (tag === 'ring') return RING_HALF;
  const street = streetForTag(tag);
  if (street) return corridorHalf(street) + .8;
  return 0;
}

export const PLAN: CityPlan = (() => {
  const random = makeRandom(0x51f3d);
  const blocks: Block[] = [];
  const parcels: Parcel[] = [];
  const courtyards: OpenSpace[] = [];
  const alleys: Alley[] = [];
  const siteAreas: CityPlan['siteAreas'] = [];

  for (let i = 0; i < CELLS_U; i++) {
    for (let j = 0; j < CELLS_V; j++) {
      const site = siteAtCell(i, j);
      if (site) continue;
      const pieces = blockPieces(i, j, distanceFor);
      if (!pieces.length) continue;
      const block: Block = {
        id: `b-${i}-${j}`, cell: { i, j },
        area: pieces.reduce((sum, p) => sum + polygonArea(p.points), 0),
        pieces: [],
      };
      const wantsAlley = pieces.length === 1 && cellNoise(i, j, 7) < .62;
      for (const piece of pieces) {
        // Keep alleys in intact block cells. A diagonal cut or a curved perimeter landing
        // can split the block; extending one nominal centre-line through both fragments
        // would draw a service way beneath unrelated parcels.

        const attempt = wantsAlley ? alleyFor(i, j, piece, random) : null;
        if (attempt) {
          alleys.push(attempt.alley);
          block.pieces.push(...attempt.pieces);
          block.alley = attempt.alley;
        } else {
          block.pieces.push(piece);
        }
      }
      block.pieces.forEach((piece, serial) =>
        cutParcels(piece, { i, j }, serial, random, { parcels, courtyards }));
      blocks.push(block);
    }
  }

  // Landmark sites: their own rectangle, their own parts.
  for (const site of SITES) {
    const sitePoints = ensureCCW([
      fromGrid(AVENUES[site.i0].offset, STREETS[site.j0].offset),
      fromGrid(AVENUES[site.i1 + 1].offset, STREETS[site.j0].offset),
      fromGrid(AVENUES[site.i1 + 1].offset, STREETS[site.j1 + 1].offset),
      fromGrid(AVENUES[site.i0].offset, STREETS[site.j1 + 1].offset),
    ]);
    // Sites consume whole cells, but not the surrounding public rights-of-way. Tag the
    // four boundary lines by their actual street so the same sidewalk setback applies to
    // landmark plots as to ordinary parcels.
    let poly: TaggedPoly = {
      points: sitePoints,
      tags: sitePoints.map((p, index) => {
        const q = sitePoints[(index + 1) % sitePoints.length];
        const a = toGrid(p), b = toGrid(q);
        if (Math.abs(a.u - b.u) < Math.abs(a.v - b.v)) {
          const u = (a.u + b.u) / 2;
          return Math.abs(u - AVENUES[site.i0].offset) < Math.abs(u - AVENUES[site.i1 + 1].offset)
            ? `u:${site.i0}` : `u:${site.i1 + 1}`;
        }
        const v = (a.v + b.v) / 2;
        return Math.abs(v - STREETS[site.j0].offset) < Math.abs(v - STREETS[site.j1 + 1].offset)
          ? `v:${site.j0}` : `v:${site.j1 + 1}`;
      }),
    };
    for (let k = 0; k < RING_POLYGON.length && poly.points.length >= 3; k++) {
      const a = RING_POLYGON[k], b = RING_POLYGON[(k + 1) % RING_POLYGON.length];
      poly = clipTagged(poly, a, b, 'ring');
    }
    poly = insetTagged(poly, distanceFor);
    let survivors = [poly];
    for (const cutter of CUTTERS) {
      const next: TaggedPoly[] = [];
      for (const survivor of survivors) {
        const found = chords(survivor, cutter);
        if (!found.length) { next.push(survivor); continue; }
        let current = [survivor];
        for (const chord of found) {
          const carved: TaggedPoly[] = [];
          for (const piece of current) carved.push(...carveCorridor(piece, chord.a, chord.b, corridorHalf(cutter) + 1.5, `legacy:${cutter.id}`));
          current = carved;
        }
        next.push(...(current.length ? current : [survivor]));
      }
      survivors = next;
    }
    const siteGridStreets = [
      ...Array.from({ length: site.i1 - site.i0 + 2 }, (_, offset) => `u${site.i0 + offset}`),
      ...Array.from({ length: site.j1 - site.j0 + 2 }, (_, offset) => `v${site.j0 + offset}`),
    ];
    // Internal streets are swallowed by a site, but their curved ring approaches remain
    // live outside the site cut. Protect every actual curved approach, not just the outer
    // rectangle, so the podium cannot sit over the last few metres of a road.
    survivors = carveCurvedGrid(survivors, siteGridStreets);
    const parts: CityPlan['siteAreas'][number]['parts'] = [];
    for (const piece of survivors) {
      if (piece.points.length < 3) continue;
      const bounds = pieceBounds(piece.points, site);
      for (const part of site.parts) {
        const polygon = partPolygon(piece.points, bounds, part.rect);
        if (polygonArea(polygon) < 60) continue;
        parts.push({ part, polygon, tag: 'site' });
      }
    }
    siteAreas.push({
      site,
      parts,
      polygons: survivors.filter(s => s.points.length >= 3).map(s => s.points),
    });
  }

  return { blocks, parcels, courtyards, alleys, siteAreas, verge: [] };
})();

/** Grid-space bounds of a site polygon, so its parts can be placed proportionally. */
function pieceBounds(points: readonly Point[], site: Site): { u0: number; u1: number; v0: number; v1: number } {
  const u0 = AVENUES[site.i0].offset, u1 = AVENUES[site.i1 + 1].offset;
  const v0 = STREETS[site.j0].offset, v1 = STREETS[site.j1 + 1].offset;
  const du = Math.abs(u1 - u0), dv = Math.abs(v1 - v0);
  return {
    u0: Math.min(u0, u1) + du * .06, u1: Math.max(u0, u1) - du * .06,
    v0: Math.min(v0, v1) + dv * .06, v1: Math.max(v0, v1) - dv * .06,
  };
}

function partPolygon(points: readonly Point[], bounds: { u0: number; u1: number; v0: number; v1: number }, rect: SitePart['rect']): Point[] {
  const u0 = bounds.u0 + (bounds.u1 - bounds.u0) * rect.u0;
  const u1 = bounds.u0 + (bounds.u1 - bounds.u0) * rect.u1;
  const v0 = bounds.v0 + (bounds.v1 - bounds.v0) * rect.v0;
  const v1 = bounds.v0 + (bounds.v1 - bounds.v0) * rect.v1;
  let poly: Point[] = [fromGrid(u0, v0), fromGrid(u1, v0), fromGrid(u1, v1), fromGrid(u0, v1)];
  // Parts stay inside whatever the cutters left of the site.
  for (let k = 0; k < points.length && poly.length >= 3; k++) {
    const a = points[k], b = points[(k + 1) % points.length];
    poly = clipLeft(poly, a, b);
  }
  return poly;
}

/** Deterministic per-parcel variation shared by buildings, signs and facades. */
export function parcelNoise(parcel: Parcel, salt = 0): number {
  return hash01(Math.round(parcel.frontage.a.x), Math.round(parcel.frontage.a.z), salt);
}
export function blockPerimeter(block: Block): number {
  return block.pieces.reduce((sum, p) => sum + polygonPerimeter(p.points), 0);
}
export { corridorHalf, RING_HALF as RING_CORRIDOR };
