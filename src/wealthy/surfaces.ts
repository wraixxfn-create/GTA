/**
 * Ground surfaces of Vantage Heights: carriageways with planted verges, the boulevard's
 * median, roundabout islands, junction tables, drives and forecourts, lawns and formal
 * gardens, tennis courts and the pools.
 *
 * Pieces reuse the downtown surface vocabulary (and its single merged material), so a
 * tile's ground is a handful of draw calls. Everything is emitted per bounds; the
 * streaming layer never builds ground it cannot see.
 *
 * The layering is deliberate: the lawn of a plot is laid first, then the drive and
 * forecourt on top of it, then the pool terrace, so the same ground reads as one garden
 * with a drive through it rather than as three separate slabs.
 */
import type { Point } from '../world/data';
import type { Piece, SurfaceKind } from '../city/surfaces';
import { distance2d, leftNormal, normalize, polygonArea, polygonCentroid, sub } from '../city/geometry2d';
import { terrainHeight } from '../world/geometry';
import { CURB_HEIGHT, hillGround, makeRandom, W_POLYGON } from './frame';
import { W_NETWORK, positionAt, type Street } from './plan';
import { W_GARDENS, W_GATES, W_WATERS, terraceFill, type Garden, type Water } from './buildings';

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
const PAD = 30;

function touches(bounds: Bounds, points: readonly { x: number; z: number }[]): boolean {
  for (const p of points) {
    if (p.x >= bounds.minX - PAD && p.x <= bounds.maxX + PAD &&
      p.z >= bounds.minZ - PAD && p.z <= bounds.maxZ + PAD) return true;
  }
  return false;
}

function push(pieces: Piece[], kind: SurfaceKind, points: readonly { x: number; z: number }[], lift: number, tint: number, level?: number): void {
  if (points.length < 3) return;
  pieces.push({
    kind, tint,
    points: points.map(p => ({
      x: p.x, z: p.z,
      y: (level ?? hillGround(p.x, p.z)) + lift,
    })),
  });
}

/* ── carriageways ─────────────────────────────────────────────────────────────── */

const CARRIAGEWAY: Record<Street['kind'], SurfaceKind> = {
  boulevard: 'asphalt', collector: 'asphalt', scenic: 'asphalt', ridge: 'asphalt',
  private: 'concrete', lane: 'concrete', pedestrian: 'paving',
  arterial: 'asphalt', secondary: 'asphalt',
};

function streetPieces(pieces: Piece[], bounds: Bounds): void {
  for (const street of W_NETWORK.streets) {
    const half = street.width / 2;
    const median = street.median / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (!touches(bounds, [a, b])) continue;
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      const quad = (l0: number, l1: number, kind: SurfaceKind, lift: number, tint: number): void => {
        pieces.push({
          kind, tint,
          points: [
            { x: a.x + n.x * l0, z: a.z + n.z * l0, y: a.y + lift },
            { x: b.x + n.x * l0, z: b.z + n.z * l0, y: b.y + lift },
            { x: b.x + n.x * l1, z: b.z + n.z * l1, y: b.y + lift },
            { x: a.x + n.x * l1, z: a.z + n.z * l1, y: a.y + lift },
          ],
        });
      };
      const kind = CARRIAGEWAY[street.kind];
      if (median > 0) {
        // Two carriageways either side of a planted median: the boulevard's signature.
        quad(-half, -median - 0.6, kind, 0.07, 0.5);
        quad(median + 0.6, half, kind, 0.07, 0.5);
        quad(-median, median, 'grass', 0.1, 0.55);
      } else {
        quad(-half, half, kind, 0.07, 0.45 + (i % 7) * 0.02);
      }
      // Planted verges rather than kerbside parking: the hill has no parked rows.
      const verge = Math.min(street.shoulder, 3.4);
      quad(-half - verge, -half, street.kind === 'pedestrian' ? 'paving-warm' : 'grass', 0.04, 0.5);
      quad(half, half + verge, street.kind === 'pedestrian' ? 'paving-warm' : 'grass', 0.04, 0.5);
    }
  }
}

/** Sparse markings: edge lines on the boulevard and collector only. Nothing is signed. */
function laneMarkings(pieces: Piece[], bounds: Bounds): void {
  for (const street of W_NETWORK.streets) {
    if (street.kind !== 'boulevard' && street.kind !== 'collector' && street.kind !== 'arterial') continue;
    const half = street.width / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (!touches(bounds, [a, b])) continue;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (W_NETWORK.junctions.some(j => distance2d(j.point, mid) < (j.island ?? 0) + street.width / 2 + 10)) continue;
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      for (const lateral of [-half + 0.7, half - 0.7]) {
        pieces.push({
          kind: 'paint-white', tint: 0.5,
          points: [
            { x: a.x + n.x * (lateral - 0.11), z: a.z + n.z * (lateral - 0.11), y: a.y + 0.09 },
            { x: b.x + n.x * (lateral - 0.11), z: b.z + n.z * (lateral - 0.11), y: b.y + 0.09 },
            { x: b.x + n.x * (lateral + 0.11), z: b.z + n.z * (lateral + 0.11), y: b.y + 0.09 },
            { x: a.x + n.x * (lateral + 0.11), z: a.z + n.z * (lateral + 0.11), y: a.y + 0.09 },
          ],
        });
      }
    }
  }
}

/* ── junctions, roundabouts and gates ─────────────────────────────────────────── */

function junctionPieces(pieces: Piece[], bounds: Bounds): void {
  for (const junction of W_NETWORK.junctions) {
    if (!touches(bounds, [junction.point])) continue;
    if (junction.control === 'roundabout' && junction.island) {
      const islandRadius = junction.island;
      const radius = islandRadius + 8;
      const ring = Array.from({ length: 22 }, (_, i) => {
        const angle = (i / 22) * Math.PI * 2;
        return { x: junction.point.x + Math.cos(angle) * radius, z: junction.point.z + Math.sin(angle) * radius };
      });
      push(pieces, 'asphalt', ring, 0.08, 0.5, junction.y);
      const island = Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2;
        return { x: junction.point.x + Math.cos(angle) * islandRadius, z: junction.point.z + Math.sin(angle) * islandRadius };
      });
      push(pieces, 'grass', island, 0.24, 0.55, junction.y);
      continue;
    }
    const reach = Math.max(9, ...junction.arms.map(arm => {
      const street = W_NETWORK.streetById.get(arm.streetId);
      return street ? street.width / 2 + street.shoulder : 8;
    }));
    const sides = Math.max(6, junction.arms.length + 4);
    const table = Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2;
      return { x: junction.point.x + Math.cos(angle) * reach, z: junction.point.z + Math.sin(angle) * reach };
    });
    push(pieces, junction.shape === 'viewpoint' ? 'paving-warm' : 'asphalt', table, 0.08, 0.5, junction.y);
  }
}

/** Gate plazas: dressed stone in front of every gate, so a gate reads as an entrance. */
function gatePieces(pieces: Piece[], bounds: Bounds): void {
  for (const gate of W_GATES) {
    if (!touches(bounds, [gate.point])) continue;
    const n = leftNormal(gate.dir);
    const half = gate.width / 2 + 4;
    const depth = gate.kind === 'district' ? 16 : 12;
    const corner = (along: number, across: number): Point => ({
      x: gate.point.x + gate.dir.x * along + n.x * across,
      z: gate.point.z + gate.dir.z * along + n.z * across,
    });
    push(pieces, 'paving-warm', [corner(-2, -half), corner(depth, -half), corner(depth, half), corner(-2, half)],
      0.12, 0.5, gate.level);
  }
}

/* ── grounds ──────────────────────────────────────────────────────────────────── */

const GARDEN_SURFACE: Record<Garden['kind'], SurfaceKind> = {
  lawn: 'grass', formal: 'grass', woodland: 'grass', orchard: 'grass', kitchen: 'grass',
  practice: 'grass', tennis: 'paint-green',
  drive: 'gravel', forecourt: 'gravel',
  terrace: 'paving-warm', plaza: 'paving',
};
/** Layer order: the lawn goes down first and everything else is laid over it. */
const GARDEN_LAYER: Record<Garden['kind'], number> = {
  lawn: 0.14, woodland: 0.14, formal: 0.18, orchard: 0.18, kitchen: 0.18, practice: 0.18,
  tennis: 0.2, drive: 0.22, forecourt: 0.22, terrace: 0.24, plaza: 0.24,
};

function gardenPieces(pieces: Piece[], bounds: Bounds): void {
  for (const garden of W_GARDENS) {
    if (!touches(bounds, garden.polygon)) continue;
    push(pieces, GARDEN_SURFACE[garden.kind], garden.polygon, GARDEN_LAYER[garden.kind], garden.tint, garden.level);
    // Formal gardens get a clipped hedge border and a centre bed.
    if (garden.kind === 'formal' && garden.polygon.length >= 4) {
      const centre = polygonCentroid(garden.polygon);
      const bed = garden.polygon.map(p => ({
        x: centre.x + (p.x - centre.x) * 0.42, z: centre.z + (p.z - centre.z) * 0.42,
      }));
      push(pieces, 'paint-green', bed, 0.26, 0.6, garden.level);
    }
  }
}

function waterPieces(pieces: Piece[], bounds: Bounds): void {
  for (const water of W_WATERS) {
    if (!touches(bounds, water.polygon)) continue;
    push(pieces, 'water', water.polygon, water.kind === 'fountain' ? 0.3 : 0.28, 0.5, water.level);
  }
}

/**
 * Terrace skirts: where a plot's level datum stands above the natural ground, a gravel
 * batter carries the surface back down so nothing floats on a cliff edge.
 */
function terraceSkirts(pieces: Piece[], bounds: Bounds): void {
  const seen = new Set<string>();
  for (const garden of W_GARDENS) {
    if (garden.kind !== 'lawn' && garden.kind !== 'woodland') continue;
    if (!touches(bounds, garden.polygon)) continue;
    const key = garden.owner;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const { point, depth } of terraceFill(garden.polygon, garden.level)) {
      if (depth < 0.7) continue;
      const centre = polygonCentroid(garden.polygon);
      const outward = normalize(sub(point, centre));
      const reach = Math.min(16, 3 + depth * 2.2);
      const outer = { x: point.x + outward.x * reach, z: point.z + outward.z * reach };
      const n = leftNormal(outward);
      pieces.push({
        kind: 'gravel', tint: 0.4,
        points: [
          { x: point.x - n.x * 4, z: point.z - n.z * 4, y: garden.level + 0.02 },
          { x: point.x + n.x * 4, z: point.z + n.z * 4, y: garden.level + 0.02 },
          { x: outer.x + n.x * 4, z: outer.z + n.z * 4, y: Math.max(terrainHeight(outer.x, outer.z), garden.level - depth) + 0.02 },
          { x: outer.x - n.x * 4, z: outer.z - n.z * 4, y: Math.max(terrainHeight(outer.x, outer.z), garden.level - depth) + 0.02 },
        ],
      });
    }
  }
}

/** The reservation's own edge: a dressed verge carrying the district down to the hill. */
function boundarySkirt(pieces: Piece[], bounds: Bounds): void {
  for (let i = 0; i < W_POLYGON.length; i++) {
    const a = W_POLYGON[i], b = W_POLYGON[(i + 1) % W_POLYGON.length];
    const dir = normalize(sub(b, a));
    const inward = leftNormal(dir);
    const n = { x: -inward.x, z: -inward.z };
    const length = distance2d(a, b);
    const steps = Math.ceil(length / 26);
    for (let s = 0; s < steps; s++) {
      const p0 = { x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) };
      const p1 = { x: a.x + (b.x - a.x) * ((s + 1) / steps), z: a.z + (b.z - a.z) * ((s + 1) / steps) };
      if (!touches(bounds, [p0, p1])) continue;
      const o0 = { x: p0.x + n.x * 12, z: p0.z + n.z * 12 };
      const o1 = { x: p1.x + n.x * 12, z: p1.z + n.z * 12 };
      pieces.push({
        kind: 'grass', tint: 0.35,
        points: [
          { x: p0.x, z: p0.z, y: hillGround(p0.x, p0.z) + 0.02 },
          { x: p1.x, z: p1.z, y: hillGround(p1.x, p1.z) + 0.02 },
          { x: o1.x, z: o1.z, y: terrainHeight(o1.x, o1.z) + 0.02 },
          { x: o0.x, z: o0.z, y: terrainHeight(o0.x, o0.z) + 0.02 },
        ],
      });
    }
  }
}

/* ── the entry point ──────────────────────────────────────────────────────────── */

export function piecesForBounds(bounds: Bounds, opts: { markings?: boolean; detail?: boolean } = {}): Piece[] {
  const pieces: Piece[] = [];
  streetPieces(pieces, bounds);
  junctionPieces(pieces, bounds);
  terraceSkirts(pieces, bounds);
  gardenPieces(pieces, bounds);
  waterPieces(pieces, bounds);
  if (opts.detail) gatePieces(pieces, bounds);
  boundarySkirt(pieces, bounds);
  if (opts.markings) laneMarkings(pieces, bounds);
  return pieces;
}

export const surfaceSummary = (() => {
  const sample: Bounds = { minX: -4200, minZ: 1100, maxX: -3200, maxZ: 2100 };
  const pieces = piecesForBounds(sample, { markings: true, detail: true });
  const byKind: Record<string, number> = {};
  for (const piece of pieces) byKind[piece.kind] = (byKind[piece.kind] ?? 0) + 1;
  let road = 0, ground = 0, water = 0;
  for (const piece of pieces) {
    const area = polygonArea(piece.points);
    if (piece.kind === 'water') water += area;
    else if (piece.kind === 'grass' || piece.kind === 'gravel' || piece.kind === 'paving-warm' || piece.kind === 'paving' || piece.kind === 'paint-green') ground += area;
    else road += area;
  }
  return {
    pieces: pieces.length,
    kinds: Object.keys(byKind).length,
    byKind,
    roadHa: Math.round(road / 10000 * 100) / 100,
    groundHa: Math.round(ground / 10000 * 100) / 100,
    waterHa: Math.round(water / 10000 * 100) / 100,
    sampleKm2: 1,
  };
})();

export { CURB_HEIGHT, positionAt, makeRandom };
