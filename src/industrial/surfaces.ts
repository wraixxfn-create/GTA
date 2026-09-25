/**
 * Ground surfaces of the flats: carriageways, shoulders, junction tables, yard pads,
 * dock aprons, the rail with its ballast and sleepers, level-crossing panels, and the
 * gravel skirt that carries the graded slab down to the natural ground at the fence.
 *
 * Pieces reuse the downtown surface vocabulary (and its single merged material), so a
 * tile's ground is a handful of draw calls. Everything is emitted per bounds; the
 * streaming layer never builds ground it cannot see.
 */
import type { Point } from '../world/data';
import type { Piece, SurfaceKind } from '../city/surfaces';
import { add, distance2d, dot, leftNormal, normalize, polygonCentroid, regularPolygon, scale, sub } from '../city/geometry2d';
import { terrainHeight } from '../world/geometry';
import { IND_POLYGON, fromGrid, toGrid, hash01, indGround, conditionAt } from './frame';
import { IND_NETWORK, LEVEL_CROSSINGS, positionAt, derivativeAt } from './plan';
import { RAIL_LINES, RAIL_STATIONS, RAIL_CORRIDOR, YARD_TRACKS, yardTrackPoints, YARD_TRACK_SPAN } from './rail';
import { IND_BUILDINGS, IND_YARDS } from './buildings';

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
const PAD = 26;

function touches(bounds: Bounds, points: readonly { x: number; z: number }[]): boolean {
  for (const p of points) {
    if (p.x >= bounds.minX - PAD && p.x <= bounds.maxX + PAD &&
      p.z >= bounds.minZ - PAD && p.z <= bounds.maxZ + PAD) return true;
  }
  return false;
}

/* ── carriageways ────────────────────────────────────────────────────────────── */

const CARRIAGEWAY: Record<string, SurfaceKind> = {
  haulway: 'asphalt', collector: 'asphalt', boulevard: 'asphalt', arterial: 'asphalt',
  secondary: 'asphalt', service: 'concrete', yard: 'gravel',
};

function streetPieces(pieces: Piece[], bounds: Bounds): void {
  for (const street of IND_NETWORK.streets) {
    const half = street.width / 2;
    const shoulder = street.shoulder;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (!touches(bounds, [a, b])) continue;
      const dir = normalize({ x: b.x - a.x, z: b.z - a.z });
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
      const worn = street.terrace || conditionAt({ x: a.x, z: a.z }) === 'abandoned';
      const kind = CARRIAGEWAY[street.kind] ?? 'asphalt';
      quad(-half, half, worn && kind === 'asphalt' ? 'asphalt-worn' : kind, 0.07, 0.4 + hash01(i, street.samples.length, 3) * 0.3);
      // Shoulders: gravel verges that carry trucks' wheels and hide the slab edge.
      quad(-half - shoulder, -half, 'gravel', 0.04, 0.5);
      quad(half, half + shoulder, 'gravel', 0.04, 0.5);
    }
  }
}

function laneMarkings(pieces: Piece[], bounds: Bounds): void {
  for (const street of IND_NETWORK.streets) {
    if (street.kind === 'service' || street.kind === 'yard') continue;
    const half = street.width / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (!touches(bounds, [a, b])) continue;
      // No paint across a level crossing or inside a junction table.
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (LEVEL_CROSSINGS.some(c => distance2d(c.point, mid) < 16)) continue;
      if (IND_NETWORK.junctions.some(j => distance2d(j.point, mid) < half + 8)) continue;
      const dir = normalize({ x: b.x - a.x, z: b.z - a.z });
      const n = leftNormal(dir);
      const stripe = (lateral: number, width: number, kind: SurfaceKind): void => {
        pieces.push({
          kind, tint: 0.5,
          points: [
            { x: a.x + n.x * (lateral - width / 2), z: a.z + n.z * (lateral - width / 2), y: a.y + 0.09 },
            { x: b.x + n.x * (lateral - width / 2), z: b.z + n.z * (lateral - width / 2), y: b.y + 0.09 },
            { x: b.x + n.x * (lateral + width / 2), z: b.z + n.z * (lateral + width / 2), y: b.y + 0.09 },
            { x: a.x + n.x * (lateral + width / 2), z: a.z + n.z * (lateral + width / 2), y: a.y + 0.09 },
          ],
        });
      };
      // Edge lines on every signed route; centre dashes only on the four-lane hauls.
      stripe(-half + 0.8, 0.24, 'paint-white');
      stripe(half - 0.8, 0.24, 'paint-white');
      if (street.lanes >= 4 && i % 2 === 0) {
        stripe(-0.35, 0.22, 'paint-yellow');
        stripe(0.35, 0.22, 'paint-yellow');
      }
    }
  }
}

/* ── junction tables ─────────────────────────────────────────────────────────── */

function hull(points: Point[]): Point[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.z - q.z);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function junctionPieces(pieces: Piece[], bounds: Bounds): void {
  for (const junction of IND_NETWORK.junctions) {
    if (!touches(bounds, [junction.point])) continue;
    if (junction.control === 'terminal') {
      // A turnaround disc of gravel where the lane ends on a fence.
      const street = IND_NETWORK.streetById.get(junction.arms[0].streetId)!;
      const r = street.width / 2 + street.shoulder + 4;
      pieces.push({
        kind: 'gravel', tint: 0.5,
        points: regularPolygon(junction.point, r, 12).map(p => ({ x: p.x, z: p.z, y: junction.y + 0.06 })),
      });
      continue;
    }
    const corners: Point[] = [];
    for (const arm of junction.arms) {
      const street = IND_NETWORK.streetById.get(arm.streetId)!;
      const half = street.width / 2 + 0.5;
      const back = arm.t + arm.side * (half + 1);
      const p = positionAt(street, back);
      const d = derivativeAt(street, back);
      const n = leftNormal(d);
      corners.push({ x: p.x + n.x * half, z: p.z + n.z * half }, { x: p.x - n.x * half, z: p.z - n.z * half });
      corners.push({ x: p.x + d.x * arm.side * half + n.x * half, z: p.z + d.z * arm.side * half + n.z * half });
      corners.push({ x: p.x + d.x * arm.side * half - n.x * half, z: p.z + d.z * arm.side * half - n.z * half });
    }
    corners.push(junction.point);
    const table = hull(corners);
    if (table.length < 3) continue;
    pieces.push({
      kind: junction.shape === 'gateway' ? 'concrete' : 'asphalt', tint: 0.5,
      points: table.map(p => ({ x: p.x, z: p.z, y: junction.y + 0.065 })),
    });
  }
}

/* ── rail: ballast, sleepers, rails, yard and level crossings ────────────────── */

const GAUGE = 1.435;

function trackPieces(points: readonly Point[], pieces: Piece[], bounds: Bounds, detail: boolean): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (!touches(bounds, [a, b])) continue;
    const dir = normalize(sub(b, a));
    const n = leftNormal(dir);
    const ya = indGround(a.x, a.z), yb = indGround(b.x, b.z);
    const strip = (l0: number, l1: number, kind: SurfaceKind, lift: number, tint: number): void => {
      pieces.push({
        kind, tint,
        points: [
          { x: a.x + n.x * l0, z: a.z + n.z * l0, y: ya + lift },
          { x: b.x + n.x * l0, z: b.z + n.z * l0, y: yb + lift },
          { x: b.x + n.x * l1, z: b.z + n.z * l1, y: yb + lift },
          { x: a.x + n.x * l1, z: a.z + n.z * l1, y: ya + lift },
        ],
      });
    };
    strip(-2.6, 2.6, 'gravel', 0.1, 0.42);            // ballast
    strip(-GAUGE / 2 - 0.14, -GAUGE / 2 + 0.14, 'deck', 0.2, 0.2); // running rail
    strip(GAUGE / 2 - 0.14, GAUGE / 2 + 0.14, 'deck', 0.2, 0.2);
    if (!detail) continue;
    // Sleepers every 2 m, short sections only get them near the camera.
    const len = distance2d(a, b);
    const steps = Math.max(1, Math.round(len / 2));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const c = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      pieces.push({
        kind: 'cobbles', tint: 0.25,
        points: [
          { x: c.x + n.x * -1.9 + dir.x * -0.24, z: c.z + n.z * -1.9 + dir.z * -0.24, y: ya + 0.14 },
          { x: c.x + n.x * -1.9 + dir.x * 0.24, z: c.z + n.z * -1.9 + dir.z * 0.24, y: ya + 0.14 },
          { x: c.x + n.x * 1.9 + dir.x * 0.24, z: c.z + n.z * 1.9 + dir.z * 0.24, y: ya + 0.14 },
          { x: c.x + n.x * 1.9 + dir.x * -0.24, z: c.z + n.z * 1.9 + dir.z * -0.24, y: ya + 0.14 },
        ],
      });
    }
  }
}

function railPieces(pieces: Piece[], bounds: Bounds, detail: boolean): void {
  for (const line of RAIL_LINES) trackPieces(line.points, pieces, bounds, detail && line.kind !== 'spur');
  // The classification yard: one gravel pad, then every reach track on top of it.
  const gy = yardGridRect();
  if (gy && touches(bounds, gy)) {
    pieces.push({
      kind: 'gravel', tint: 0.45,
      points: gy.map(p => ({ x: p.x, z: p.z, y: indGround(p.x, p.z) + 0.05 })),
    });
  }
  for (const track of YARD_TRACKS) {
    trackPieces(yardTrackPoints(track, YARD_TRACK_SPAN.fromV, YARD_TRACK_SPAN.toV), pieces, bounds, detail);
  }
  // Level crossings: concrete panels carry the road over the ballast.
  for (const crossing of LEVEL_CROSSINGS) {
    if (!touches(bounds, [crossing.point])) continue;
    const street = IND_NETWORK.streetById.get(crossing.streetId)!;
    const along = crossing.roadDir, across = leftNormal(along);
    const halfRoad = street.width / 2 + 1;
    const halfRail = 6.5;
    const corner = (sa: number, sr: number): Point => ({
      x: crossing.point.x + along.x * sa + across.x * sr,
      z: crossing.point.z + along.z * sa + across.z * sr,
    });
    const y = indGround(crossing.point.x, crossing.point.z) + 0.16;
    pieces.push({
      kind: 'concrete', tint: 0.5,
      points: [corner(-halfRail, -halfRoad), corner(halfRail, -halfRoad), corner(halfRail, halfRoad), corner(-halfRail, halfRoad)]
        .map(p => ({ x: p.x, z: p.z, y })),
    });
    if (detail) {
      for (const side of [-1, 1] as const) {
        pieces.push({
          kind: 'paint-yellow', tint: 0.5,
          points: [corner(side * (halfRail + 1.4), -halfRoad + 0.5), corner(side * (halfRail + 2.6), -halfRoad + 0.5),
            corner(side * (halfRail + 2.6), halfRoad - 0.5), corner(side * (halfRail + 1.4), halfRoad - 0.5)]
            .map(p => ({ x: p.x, z: p.z, y: y + 0.02 })),
        });
      }
    }
  }
}

function yardGridRect(): Point[] | null {
  const station = RAIL_STATIONS[0];
  if (!station) return null;
  // The yard rectangle in works-grid space, carried to world corners.
  const g = toGridOf(station.point);
  return [
    fromGrid(g.u - RAIL_CORRIDOR.yard, g.v - 330), fromGrid(g.u + RAIL_CORRIDOR.yard, g.v - 330),
    fromGrid(g.u + RAIL_CORRIDOR.yard, g.v + 330), fromGrid(g.u - RAIL_CORRIDOR.yard, g.v + 330),
  ];
}
const toGridOf = (p: Point) => toGrid(p);

/* ── yards, aprons and docks ─────────────────────────────────────────────────── */

const YARD_SURFACE: Record<string, SurfaceKind> = {
  containers: 'concrete', pallets: 'concrete', trailers: 'concrete', trucks: 'concrete',
  vans: 'concrete', parking: 'concrete', machinery: 'concrete', plant: 'concrete',
  barrels: 'concrete', logs: 'gravel', pipe: 'gravel', frames: 'gravel',
  scrap: 'gravel', aggregate: 'gravel', wrecks: 'gravel',
};

function yardPieces(pieces: Piece[], bounds: Bounds, detail: boolean): void {
  for (const yard of IND_YARDS) {
    if (!touches(bounds, yard.polygon)) continue;
    const kind = YARD_SURFACE[yard.content] ?? 'gravel';
    const tint = yard.condition === 'abandoned' ? 0.28 : 0.45 + hash01(Math.round(yard.polygon[0].x), Math.round(yard.polygon[0].z), 2) * 0.25;
    pieces.push({
      kind: yard.condition === 'abandoned' && kind === 'concrete' ? 'asphalt-worn' : kind, tint,
      points: yard.polygon.map(p => ({ x: p.x, z: p.z, y: indGround(p.x, p.z) + 0.05 })),
    });
    if (!detail) continue;
    // Stall lines: trailer parks and truck courts are painted, container rows are not.
    if (yard.content !== 'trailers' && yard.content !== 'trucks' && yard.content !== 'vans' && yard.content !== 'parking') continue;
    const centre = polygonCentroid(yard.polygon);
    const stall = yard.content === 'trailers' ? 6 : yard.content === 'trucks' ? 4.6 : 3.2;
    for (let i = 0; i < yard.polygon.length; i++) {
      const a = yard.polygon[i], b = yard.polygon[(i + 1) % yard.polygon.length];
      const len = distance2d(a, b);
      if (len < stall * 3) continue;
      const along = normalize(sub(b, a));
      let across = leftNormal(along);
      if (dot(across, sub(centre, a)) < 0) across = scale(across, -1); // point inward
      const count = Math.min(30, Math.floor(len / stall));
      const depth = Math.min(15, Math.max(6, len / 4));
      for (let k = 1; k < count; k++) {
        const base = add(a, scale(along, k * stall));
        const p0 = add(base, scale(across, 1));
        const p1 = add(base, scale(across, depth));
        pieces.push({
          kind: 'paint-white', tint: 0.4,
          points: [p0, add(p0, scale(along, 0.22)), add(p1, scale(along, 0.22)), p1]
            .map(p => ({ x: p.x, z: p.z, y: indGround(p.x, p.z) + 0.075 })),
        });
      }
    }
  }
}

function dockAprons(pieces: Piece[], bounds: Bounds): void {
  for (const building of IND_BUILDINGS) {
    for (const door of building.doors) {
      if (door.kind !== 'dock') continue;
      const p = door.point;
      if (!touches(bounds, [p])) continue;
      const dir = door.dir;
      const n = leftNormal(dir);
      // The loading zone: a painted keep-clear box in front of every dock door.
      const corner = (sd: number, sn: number): Point => ({
        x: p.x + dir.x * sd + n.x * sn, z: p.z + dir.z * sd + n.z * sn,
      });
      const y = indGround(p.x, p.z) + 0.085;
      const bar = (a: Point, b: Point, c: Point, d: Point): void => {
        pieces.push({ kind: 'paint-yellow', tint: 0.5, points: [a, b, c, d].map(q => ({ x: q.x, z: q.z, y })) });
      };
      bar(corner(2, -door.width / 2 - 0.8), corner(2, -door.width / 2 - 0.5), corner(9, -door.width / 2 - 0.5), corner(9, -door.width / 2 - 0.8));
      bar(corner(2, door.width / 2 + 0.5), corner(2, door.width / 2 + 0.8), corner(9, door.width / 2 + 0.8), corner(9, door.width / 2 + 0.5));
      bar(corner(9, -door.width / 2 - 0.8), corner(9, door.width / 2 + 0.8), corner(9.3, door.width / 2 + 0.8), corner(9.3, -door.width / 2 - 0.8));
    }
  }
}

function apronPieces(pieces: Piece[], bounds: Bounds): void {
  // The graded slab ends at the fence; a gravel skirt carries the ground back down
  // to the natural surface so the district never floats on a cliff.
  for (let i = 0; i < IND_POLYGON.length; i++) {
    const a = IND_POLYGON[i], b = IND_POLYGON[(i + 1) % IND_POLYGON.length];
    const dir = normalize(sub(b, a));
    // The polygon is CCW, so the left normal faces inward; the skirt goes the other way.
    const inward = leftNormal(dir);
    const n = { x: -inward.x, z: -inward.z };
    const len = distance2d(a, b);
    const steps = Math.ceil(len / 24);
    for (let s = 0; s < steps; s++) {
      const p0 = { x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) };
      const p1 = { x: a.x + (b.x - a.x) * ((s + 1) / steps), z: a.z + (b.z - a.z) * ((s + 1) / steps) };
      if (!touches(bounds, [p0, p1])) continue;
      const o0 = { x: p0.x + n.x * 14, z: p0.z + n.z * 14 };
      const o1 = { x: p1.x + n.x * 14, z: p1.z + n.z * 14 };
      pieces.push({
        kind: 'gravel', tint: 0.35,
        points: [
          { x: p0.x, z: p0.z, y: indGround(p0.x, p0.z) + 0.02 },
          { x: p1.x, z: p1.z, y: indGround(p1.x, p1.z) + 0.02 },
          { x: o1.x, z: o1.z, y: Math.max(terrainHeight(o1.x, o1.z), indGround(o1.x, o1.z)) + 0.02 },
          { x: o0.x, z: o0.z, y: Math.max(terrainHeight(o0.x, o0.z), indGround(o0.x, o0.z)) + 0.02 },
        ],
      });
    }
  }
}

/* ── the entry point ─────────────────────────────────────────────────────────── */

export function piecesForBounds(bounds: Bounds, opts: { markings?: boolean; detail?: boolean } = {}): Piece[] {
  const pieces: Piece[] = [];
  streetPieces(pieces, bounds);
  junctionPieces(pieces, bounds);
  railPieces(pieces, bounds, opts.detail ?? false);
  yardPieces(pieces, bounds, opts.detail ?? false);
  apronPieces(pieces, bounds);
  if (opts.markings) laneMarkings(pieces, bounds);
  if (opts.detail) dockAprons(pieces, bounds);
  return pieces;
}
