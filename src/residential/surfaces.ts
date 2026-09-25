/**
 * Ground surfaces of the Residential Valley: carriageways with pavements, the zebra
 * crossings, junction tables, turning circles, Market Alley's service apron, the
 * gardens and drives of ordinary plots, and the landmark grounds of Mill Green,
 * Market Row, Warfield Hall and Rosecourt.
 *
 * Pieces reuse the downtown surface vocabulary (and its single merged material), so a
 * tile's ground is a handful of draw calls. Everything is emitted per bounds; the
 * streaming layer never builds ground it cannot see.
 */
import type { Point } from '../world/data';
import type { Piece, SurfaceKind } from '../city/surfaces';
import { distance2d, leftNormal, normalize, polygonArea, polygonCentroid, sub, add, scale } from '../city/geometry2d';
import { CURB_HEIGHT, resGround, RES_POLYGON, makeRandom } from './frame';
import { RES_NETWORK, positionAt, streetAt, derivativeAt, streetNormal, type Street } from './plan';
import { GROUNDS, FENCES, type Ground, type GroundKind, type FenceRun } from './sites';
import { CROSSINGS, PARKING_BAYS, BUS_STOPS } from './traffic';
import { RES_BUILDINGS } from './buildings';

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
    points: points.map(p => ({ x: p.x, z: p.z, y: (level ?? resGround(p.x, p.z)) + lift })),
  });
}

/* ── carriageways and pavements ───────────────────────────────────────────────── */

const CARRIAGEWAY: Record<Street['kind'], SurfaceKind> = {
  arterial: 'asphalt', collector: 'asphalt', local: 'asphalt-worn', terrace: 'asphalt-worn',
  close: 'asphalt-worn', alley: 'concrete', pedestrian: 'paving-warm', legacy: 'asphalt',
};

function streetPieces(pieces: Piece[], bounds: Bounds): void {
  for (const street of RES_NETWORK.streets) {
    const half = street.width / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
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
      quad(-half, half, CARRIAGEWAY[street.kind], 0.07, 0.45 + (i % 7) * 0.02);
      // Pavements with a kerb rise; alleys and paths get a flush edge strip.
      if (street.sidewalk > 0) {
        const w = street.sidewalk;
        quad(-half - w, -half, 'paving', 0.07 + CURB_HEIGHT, 0.5 + (i % 5) * 0.02);
        quad(half, half + w, 'paving', 0.07 + CURB_HEIGHT, 0.5 + (i % 5) * 0.02);
        // Grass verge strip outside the pavement on the residential streets.
        if (street.kind === 'local' || street.kind === 'close' || street.kind === 'arterial') {
          quad(-half - w - 1.4, -half - w, 'grass', 0.05, 0.55);
          quad(half + w, half + w + 1.4, 'grass', 0.05, 0.55);
        }
      } else if (street.kind === 'pedestrian') {
        quad(-half - 0.5, -half, 'grass', 0.05, 0.55);
        quad(half, half + 0.5, 'grass', 0.05, 0.55);
      }
    }
  }
}

/** Lane markings on the arterials and collectors only. Terraces stay unmarked. */
function laneMarkings(pieces: Piece[], bounds: Bounds): void {
  for (const street of RES_NETWORK.streets) {
    if (street.kind !== 'arterial' && street.kind !== 'collector' && street.kind !== 'legacy') continue;
    const half = street.width / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (!touches(bounds, [a, b])) continue;
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      // Dashed centre line.
      if (i % 2 === 0) {
        pieces.push({
          kind: 'paint-white', tint: 0.5,
          points: [
            { x: a.x - n.x * 0.08, z: a.z - n.z * 0.08, y: a.y + 0.09 },
            { x: b.x - n.x * 0.08, z: b.z - n.z * 0.08, y: b.y + 0.09 },
            { x: b.x + n.x * 0.08, z: b.z + n.z * 0.08, y: b.y + 0.09 },
            { x: a.x + n.x * 0.08, z: a.z + n.z * 0.08, y: a.y + 0.09 },
          ],
        });
      }
      // Edge lines.
      for (const lateral of [-half + 0.5, half - 0.5]) {
        pieces.push({
          kind: 'paint-white', tint: 0.5,
          points: [
            { x: a.x + n.x * (lateral - 0.09), z: a.z + n.z * (lateral - 0.09), y: a.y + 0.09 },
            { x: b.x + n.x * (lateral - 0.09), z: b.z + n.z * (lateral - 0.09), y: b.y + 0.09 },
            { x: b.x + n.x * (lateral + 0.09), z: b.z + n.z * (lateral + 0.09), y: b.y + 0.09 },
            { x: a.x + n.x * (lateral + 0.09), z: a.z + n.z * (lateral + 0.09), y: a.y + 0.09 },
          ],
        });
      }
    }
  }
}

/* ── junctions and crossings ──────────────────────────────────────────────────── */

function junctionPieces(pieces: Piece[], bounds: Bounds): void {
  for (const junction of RES_NETWORK.junctions) {
    if (!touches(bounds, [junction.point])) continue;
    if (junction.shape === 'turning-circle' && junction.island) {
      const radius = junction.island + 4.5;
      const ring = Array.from({ length: 20 }, (_, i) => {
        const angle = (i / 20) * Math.PI * 2;
        return { x: junction.point.x + Math.cos(angle) * radius, z: junction.point.z + Math.sin(angle) * radius };
      });
      push(pieces, 'asphalt-worn', ring, 0.08, 0.5, junction.y);
      const island = Array.from({ length: 16 }, (_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        return { x: junction.point.x + Math.cos(angle) * junction.island!, z: junction.point.z + Math.sin(angle) * junction.island! };
      });
      push(pieces, 'grass', island, 0.2, 0.55, junction.y);
      continue;
    }
    const reach = Math.max(8, ...junction.arms.map(arm => {
      const street = RES_NETWORK.streetById.get(arm.streetId);
      return street ? street.width / 2 + street.sidewalk : 7;
    }));
    const sides = Math.max(6, junction.arms.length + 4);
    const table = Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2;
      return { x: junction.point.x + Math.cos(angle) * reach, z: junction.point.z + Math.sin(angle) * reach };
    });
    push(pieces, junction.control === 'gateway' ? 'paving-warm' : 'asphalt', table, 0.08, 0.5, junction.y);
  }
}

function crossingPieces(pieces: Piece[], bounds: Bounds): void {
  for (const crossing of CROSSINGS) {
    if (!touches(bounds, [crossing.a, crossing.b])) continue;
    const dir = normalize(sub(crossing.b, crossing.a));
    const n = leftNormal(dir);
    const length = distance2d(crossing.a, crossing.b);
    const stripes = Math.max(3, Math.floor(length / 1.1));
    for (let i = 0; i < stripes; i++) {
      const t0 = i / stripes + 0.08, t1 = (i + 1) / stripes - 0.08;
      const a0 = add(crossing.a, scale(dir, length * t0));
      const a1 = add(crossing.a, scale(dir, length * t1));
      const half = crossing.width / 2;
      push(pieces, 'paint-white', [
        { x: a0.x + n.x * half, z: a0.z + n.z * half },
        { x: a1.x + n.x * half, z: a1.z + n.z * half },
        { x: a1.x - n.x * half, z: a1.z - n.z * half },
        { x: a0.x - n.x * half, z: a0.z - n.z * half },
      ], 0.1, 0.55);
    }
  }
}

/* ── grounds ──────────────────────────────────────────────────────────────────── */

const GROUND_SURFACE: Record<GroundKind, SurfaceKind> = {
  lawn: 'grass', garden: 'grass', park: 'grass', pond: 'water', playground: 'gravel',
  court: 'paint-green', parking: 'asphalt-worn', plaza: 'paving', kickabout: 'grass',
  path: 'paving-warm', allotments: 'gravel',
};
const GROUND_LAYER: Record<GroundKind, number> = {
  lawn: 0.13, garden: 0.13, park: 0.13, pond: 0.16, playground: 0.17, court: 0.18,
  parking: 0.17, plaza: 0.17, kickabout: 0.14, path: 0.18, allotments: 0.16,
};

function groundPieces(pieces: Piece[], bounds: Bounds): void {
  for (const ground of GROUNDS) {
    if (!touches(bounds, ground.polygon)) continue;
    push(pieces, GROUND_SURFACE[ground.kind], ground.polygon, GROUND_LAYER[ground.kind], ground.tint, ground.level);
  }
}

/** Drives and paths cut into the plot gardens: the front path to every door. */
function drivePieces(pieces: Piece[], bounds: Bounds): void {
  for (const building of RES_BUILDINGS) {
    if (building.use !== 'house' && building.use !== 'apartment' && building.kind !== 'school') continue;
    if (!touches(bounds, [building.door.point, building.centre])) continue;
    const dir = building.door.dir;
    const n = leftNormal(dir);
    const from = building.door.point;
    const to = { x: from.x + dir.x * -5.5, z: from.z + dir.z * -5.5 };
    const half = building.use === 'house' ? 0.9 : 1.6;
    push(pieces, building.use === 'apartment' ? 'paving' : 'concrete', [
      { x: from.x + n.x * half, z: from.z + n.z * half },
      { x: to.x + n.x * half, z: to.z + n.z * half },
      { x: to.x - n.x * half, z: to.z - n.z * half },
      { x: from.x - n.x * half, z: from.z - n.z * half },
    ], 0.19, 0.45);
  }
}

/** Parking bay markings for the off-street lots. */
function parkingPieces(pieces: Piece[], bounds: Bounds): void {
  for (const bay of PARKING_BAYS) {
    if (!bay.lot) continue;
    if (!touches(bounds, [bay.centre])) continue;
    const n = leftNormal(bay.dir);
    const half = bay.length / 2;
    push(pieces, 'paint-white', [
      { x: bay.centre.x + bay.dir.x * half + n.x * bay.width / 2, z: bay.centre.z + bay.dir.z * half + n.z * bay.width / 2 },
      { x: bay.centre.x + bay.dir.x * half - n.x * bay.width / 2, z: bay.centre.z + bay.dir.z * half - n.z * bay.width / 2 },
      { x: bay.centre.x - bay.dir.x * half - n.x * bay.width / 2, z: bay.centre.z - bay.dir.z * half - n.z * bay.width / 2 },
      { x: bay.centre.x - bay.dir.x * half + n.x * bay.width / 2, z: bay.centre.z - bay.dir.z * half + n.z * bay.width / 2 },
    ], 0.19, 0.5);
  }
}

function transitPieces(pieces: Piece[], bounds: Bounds): void {
  for (const stop of BUS_STOPS) {
    if (!touches(bounds, stop.pad.polygon)) continue;
    push(pieces, 'paving-warm', stop.pad.polygon, 0.2, 0.55);
  }
}

/** The reservation's own edge: a grass skirt carrying the pad down to the terrain. */
function boundarySkirt(pieces: Piece[], bounds: Bounds): void {
  for (let i = 0; i < RES_POLYGON.length; i++) {
    const a = RES_POLYGON[i], b = RES_POLYGON[(i + 1) % RES_POLYGON.length];
    const dir = normalize(sub(b, a));
    const inward = leftNormal(dir);
    const n = { x: -inward.x, z: -inward.z };
    const length = distance2d(a, b);
    const steps = Math.ceil(length / 30);
    for (let s = 0; s < steps; s++) {
      const p0 = { x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) };
      const p1 = { x: a.x + (b.x - a.x) * ((s + 1) / steps), z: a.z + (b.z - a.z) * ((s + 1) / steps) };
      if (!touches(bounds, [p0, p1])) continue;
      const o0 = { x: p0.x + n.x * 14, z: p0.z + n.z * 14 };
      const o1 = { x: p1.x + n.x * 14, z: p1.z + n.z * 14 };
      pieces.push({
        kind: 'grass', tint: 0.4,
        points: [
          { x: p0.x, z: p0.z, y: resGround(p0.x, p0.z) + 0.02 },
          { x: p1.x, z: p1.z, y: resGround(p1.x, p1.z) + 0.02 },
          { x: o1.x, z: o1.z, y: resGround(o1.x, o1.z) + 0.01 },
          { x: o0.x, z: o0.z, y: resGround(o0.x, o0.z) + 0.01 },
        ],
      });
    }
  }
}

/* ── the entry point ──────────────────────────────────────────────────────────── */

export function piecesForBounds(bounds: Bounds, opts: { markings?: boolean; detail?: boolean } = {}): Piece[] {
  const pieces: Piece[] = [];
  groundPieces(pieces, bounds);
  streetPieces(pieces, bounds);
  junctionPieces(pieces, bounds);
  if (opts.detail) drivePieces(pieces, bounds);
  if (opts.detail) parkingPieces(pieces, bounds);
  transitPieces(pieces, bounds);
  boundarySkirt(pieces, bounds);
  if (opts.markings) {
    laneMarkings(pieces, bounds);
    crossingPieces(pieces, bounds);
  }
  return pieces;
}

export const surfaceSummary = (() => {
  const sample: Bounds = { minX: -1500, minZ: -2400, maxX: -500, maxZ: -1400 };
  const pieces = piecesForBounds(sample, { markings: true, detail: true });
  const byKind: Record<string, number> = {};
  for (const piece of pieces) byKind[piece.kind] = (byKind[piece.kind] ?? 0) + 1;
  let road = 0, ground = 0, water = 0;
  for (const piece of pieces) {
    const area = polygonArea(piece.points);
    if (piece.kind === 'water') water += area;
    else if (piece.kind === 'grass' || piece.kind === 'gravel' || piece.kind === 'paving-warm' ||
      piece.kind === 'paving' || piece.kind === 'paint-green') ground += area;
    else road += area;
  }
  return {
    pieces: pieces.length,
    kinds: Object.keys(byKind).length,
    byKind,
    roadHa: Math.round(road / 10000 * 100) / 100,
    groundHa: Math.round(ground / 10000 * 100) / 100,
    waterHa: Math.round(water / 10000 * 100) / 100,
  };
})();

export { CURB_HEIGHT, positionAt, makeRandom, streetAt, derivativeAt, streetNormal };
export type { FenceRun };
