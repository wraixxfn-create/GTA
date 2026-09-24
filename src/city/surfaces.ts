/**
 * Ground surfaces: carriageways, footways, kerbs, junction tables, crossings, markings,
 * courtyards, plazas, parks and the planted verge.
 *
 * Everything the player can walk or drive on is emitted as flat convex pieces with a
 * surface kind. The same pieces feed the rendered mesh and the navigation surfaces, so
 * the drivable area and the painted area can never disagree.
 */
import type { Point } from '../world/data';
import {
  CITY_POLYGON, RING_POLYGON, SIDEWALK_RISE, cityGround, hash01,
} from './frame';
import { NETWORK, streetAt, type Junction, type Street } from './streets';
import { PLAN } from './blocks';
import { CITY } from './buildings';
import { CROSSINGS, PARKING_BAYS, junctionReachFor } from './traffic';
import {
  clipLeft, distance2d, distanceToPolygon, ensureCCW, lerp2, normalize, polygonArea,
  polygonBounds, polygonCentroid, sub,
} from './geometry2d';

export type SurfaceKind =
  | 'asphalt' | 'asphalt-worn' | 'concrete' | 'paving' | 'paving-warm' | 'cobbles'
  | 'paint-white' | 'paint-yellow' | 'paint-red' | 'paint-green'
  | 'grass' | 'gravel' | 'water' | 'void' | 'deck';

export type Piece = {
  kind: SurfaceKind;
  points: { x: number; z: number; y: number }[];
  tint: number;
};

export const SURFACE_COLOR: Record<SurfaceKind, [number, number, number]> = {
  asphalt: [.255, .268, .278], 'asphalt-worn': [.286, .293, .295],
  concrete: [.575, .566, .538], paving: [.632, .600, .545], 'paving-warm': [.664, .596, .497],
  cobbles: [.454, .428, .392], 'paint-white': [.90, .88, .83], 'paint-yellow': [.79, .68, .30],
  'paint-red': [.62, .28, .24], 'paint-green': [.29, .45, .30],
  grass: [.353, .447, .318], gravel: [.415, .400, .365],
  water: [.36, .56, .58], void: [.05, .05, .05], deck: [.38, .39, .38],
};

const CHUNK_PAD = 8;

function rise(x: number, z: number, extra = 0): number { return cityGround(x, z) + extra; }
function ring(points: readonly Point[], extra = 0, seed = 0, kind?: SurfaceKind): Piece['points'] {
  const lift = kind ? liftOf(kind, extra) : extra;
  void 0;
  return points.map(p => ({ x: p.x, z: p.z, y: rise(p.x, p.z, lift) + Math.abs(hash01(Math.round(p.x), Math.round(p.z), seed)) * .006 }));
}

/* ── street ribbons ────────────────────────────────────────────────────────────── */

type Interval = { min: number; max: number };

/** Trim each span by the junction tables so the ribbons meet them exactly. */
function carriagewayIntervals(street: Street): { span: Interval; pieces: Interval[] }[] {
  const intervals = new Map<number, Interval[]>();
  street.spans.forEach((span, index) => intervals.set(index, [{ min: span.min, max: span.max }]));
  for (const junction of NETWORK.junctions) {
    if (!junction.streets.includes(street.id)) continue;
    const arm = junction.arms.find(a => a.streetId === street.id);
    if (!arm) continue;
    const reach = junctionReachFor(junction, junction.arms.indexOf(arm)) + 1.2;
    street.spans.forEach((span, index) => {
      const pieces = intervals.get(index)!;
      const next: Interval[] = [];
      for (const piece of pieces) {
        if (arm.t + reach <= piece.min || arm.t - reach >= piece.max) { next.push(piece); continue; }
        if (arm.t - reach > piece.min) next.push({ min: piece.min, max: arm.t - reach });
        if (arm.t + reach < piece.max) next.push({ min: arm.t + reach, max: piece.max });
      }
      intervals.set(index, next);
    });
  }
  return street.spans.map((span, index) => ({ span, pieces: intervals.get(index) ?? [] }));
}

function streetPieces(street: Street, pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  const pedestrian = street.kind === 'pedestrian';
  const half = street.width / 2;
  const sw = Math.max(street.sidewalk, 0);
  for (const { pieces: intervals } of carriagewayIntervals(street)) {
    for (const interval of intervals) {
      const length = interval.max - interval.min;
      if (length < 3) continue;
      const steps = Math.max(1, Math.ceil(length / 26));
      for (let i = 0; i < steps; i++) {
        const t0 = interval.min + length * (i / steps);
        const t1 = interval.min + length * ((i + 1) / steps);
        const a = streetAt(street, t0), b = streetAt(street, t1);
        const dir = normalize(sub(b, a));
        const n = { x: -dir.z, z: dir.x };
        if (Math.max(a.x, b.x) < bounds.minX - CHUNK_PAD || Math.min(a.x, b.x) > bounds.maxX + CHUNK_PAD) continue;
        if (Math.max(a.z, b.z) < bounds.minZ - CHUNK_PAD || Math.min(a.z, b.z) > bounds.maxZ + CHUNK_PAD) continue;
        const corner = (side: number, inner: number, outer: number): Point[] => [
          { x: a.x + n.x * inner * side, z: a.z + n.z * inner * side },
          { x: b.x + n.x * inner * side, z: b.z + n.z * inner * side },
          { x: b.x + n.x * outer * side, z: b.z + n.z * outer * side },
          { x: a.x + n.x * outer * side, z: a.z + n.z * outer * side },
        ];
        const surfaceKind: SurfaceKind = pedestrian ? 'paving' : street.kind === 'alley' ? 'asphalt-worn' : 'asphalt';
        pieces.push({ kind: surfaceKind, points: ring(corner(1, 0, half), 0, 1, surfaceKind), tint: .5 });
        pieces.push({ kind: surfaceKind, points: ring(corner(-1, 0, half), 0, 1, surfaceKind), tint: .5 });
        if (sw > .3) {
          for (const side of [1, -1] as const) {
            pieces.push({ kind: 'concrete', points: ring(corner(side, half, half + sw), 0, 5, 'concrete'), tint: .5 });
          }
        }
        for (const side of [1, -1] as const) {
          // Kerb face: a vertical strip at the back of the footway.
          const p0 = { x: a.x + n.x * half * side, z: a.z + n.z * half * side };
          const p1 = { x: b.x + n.x * half * side, z: b.z + n.z * half * side };
          const outward = sw > .3 ? half + sw : half;
          const q0 = { x: a.x + n.x * outward * side, z: a.z + n.z * outward * side };
          const q1 = { x: b.x + n.x * outward * side, z: b.z + n.z * outward * side };
          pieces.push({
            kind: 'concrete',
            points: [
              { x: p0.x, z: p0.z, y: rise(p0.x, p0.z) },
              { x: p1.x, z: p1.z, y: rise(p1.x, p1.z) },
              { x: q1.x, z: q1.z, y: rise(q1.x, q1.z, SIDEWALK_RISE) },
              { x: q0.x, z: q0.z, y: rise(q0.x, q0.z, SIDEWALK_RISE) },
            ],
            tint: .35,
          });
        }
      }
    }
  }
}

/* ── junctions ─────────────────────────────────────────────────────────────────── */

type Line = { a: Point; b: Point };
function offsetLine(junction: Junction, armIndex: number, lateral: number): Line {
  const arm = junction.arms[armIndex];
  const n = { x: -arm.dir.z, z: arm.dir.x };
  const base = { x: junction.point.x + arm.dir.x * 400, z: junction.point.z + arm.dir.z * 400 };
  return {
    a: { x: base.x + n.x * lateral, z: base.z + n.z * lateral },
    b: { x: base.x - arm.dir.x * 800 + n.x * lateral, z: base.z - arm.dir.z * 800 + n.z * lateral },
  };
}
function lineCross(l1: Line, l2: Line): Point | null {
  const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
  const den = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((l2.a.x - l1.a.x) * d2.z - (l2.a.z - l1.a.z) * d2.x) / den;
  return { x: l1.a.x + d1.x * t, z: l1.a.z + d1.z * t };
}
function hull(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The paved table where two or more streets meet, plus the footway that wraps it. */
export function junctionTable(junction: Junction): { table: Point[]; corners: Point[][] } {
  const byStreet = new Map<string, number[]>();
  junction.arms.forEach((arm, index) => {
    const list = byStreet.get(arm.streetId) ?? [];
    list.push(index);
    byStreet.set(arm.streetId, list);
  });
  const streets = [...byStreet.keys()];
  const widthOf = (streetId: string) => {
    const street = NETWORK.streetById.get(streetId)!;
    return street.width / 2;
  };
  const points: Point[] = [];
  if (streets.length === 1) {
    const arm = junction.arms[byStreet.get(streets[0])![0]];
    const half = widthOf(streets[0]);
    const n = { x: -arm.dir.z, z: arm.dir.x };
    points.push(
      { x: junction.point.x + n.x * half, z: junction.point.z + n.z * half },
      { x: junction.point.x - n.x * half, z: junction.point.z - n.z * half },
      { x: junction.point.x + arm.dir.x * 14 + n.x * half, z: junction.point.z + arm.dir.z * 14 + n.z * half },
      { x: junction.point.x + arm.dir.x * 14 - n.x * half, z: junction.point.z + arm.dir.z * 14 - n.z * half },
    );
  }
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      const armA = junction.arms[byStreet.get(streets[i])![0]];
      const armB = junction.arms[byStreet.get(streets[j])![0]];
      const halfA = widthOf(streets[i]), halfB = widthOf(streets[j]);
      for (const sideA of [1, -1] as const) {
        for (const sideB of [1, -1] as const) {
          const hit = lineCross(offsetLine(junction, junction.arms.indexOf(armA), halfA * sideA),
            offsetLine(junction, junction.arms.indexOf(armB), halfB * sideB));
          if (hit && distance2d(hit, junction.point) < 90) points.push(hit);
        }
      }
    }
  }
  const table = points.length >= 3 ? hull(points) : [
    { x: junction.point.x - 8, z: junction.point.z - 8 },
    { x: junction.point.x + 8, z: junction.point.z - 8 },
    { x: junction.point.x + 8, z: junction.point.z + 8 },
    { x: junction.point.x - 8, z: junction.point.z + 8 },
  ];
  // Footway corners: the outer corner of each arm pair, clipped back by the table.
  const corners: Point[][] = [];
  const order = junction.arms
    .map((arm, index) => ({ arm, index, angle: Math.atan2(arm.dir.z, arm.dir.x) }))
    .sort((a, b) => a.angle - b.angle);
  for (let i = 0; i < order.length; i++) {
    const current = order[i], next = order[(i + 1) % order.length];
    if (order.length < 2) break;
    const streetA = NETWORK.streetById.get(current.arm.streetId)!;
    const streetB = NETWORK.streetById.get(next.arm.streetId)!;
    if (streetA.kind === 'alley' || streetB.kind === 'alley') continue;
    const outA = streetA.width / 2 + Math.max(streetA.sidewalk, 1);
    const outB = streetB.width / 2 + Math.max(streetB.sidewalk, 1);
    const lineA = offsetLine(junction, current.index, outA * (current.arm.side === 1 ? 1 : -1));
    const lineB = offsetLine(junction, next.index, outB * (next.arm.side === 1 ? 1 : -1));
    const cornerPoint = lineCross(lineA, lineB);
    if (!cornerPoint || distance2d(cornerPoint, junction.point) > 120) continue;
    const reachA = junctionReachFor(junction, current.index) + 1.4;
    const reachB = junctionReachFor(junction, next.index) + 1.4;
    const pA = { x: junction.point.x + current.arm.dir.x * reachA, z: junction.point.z + current.arm.dir.z * reachA };
    const pB = { x: junction.point.x + next.arm.dir.x * reachB, z: junction.point.z + next.arm.dir.z * reachB };
    let polygon: Point[] = [cornerPoint, pA, junction.point, pB];
    // Trim the corner to the paved table so footway never covers the carriageway.
    for (let k = 0; k < table.length && polygon.length >= 3; k++) {
      const a = table[k], b = table[(k + 1) % table.length];
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const outward = sub(mid, junction.point);
      const towards = sub(cornerPoint, junction.point);
      if (outward.x * towards.x + outward.z * towards.z <= 0) continue;
      polygon = clipLeft(polygon, b, a);
    }
    if (polygon.length >= 3 && polygonArea(polygon) > 3) corners.push(polygon);
  }
  return { table, corners };
}

function junctionPieces(junction: Junction, pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  if (junction.point.x < bounds.minX - 60 || junction.point.x > bounds.maxX + 60) return;
  if (junction.point.z < bounds.minZ - 60 || junction.point.z > bounds.maxZ + 60) return;
  const { table, corners } = junctionTable(junction);
  const paved = junction.arms.some(arm => NETWORK.streetById.get(arm.streetId)?.kind === 'pedestrian');
  const tableKind: SurfaceKind = paved ? 'paving' : 'asphalt';
  pieces.push({ kind: tableKind, points: ring(table, 0, 2, tableKind), tint: .5 });
  for (const corner of corners) pieces.push({ kind: 'concrete', points: ring(corner, 0, 6, 'concrete'), tint: .5 });
}

/* ── markings ──────────────────────────────────────────────────────────────────── */

function quadBetween(a: Point, b: Point, normal: Point, halfWidth: number, extra: number, kind: SurfaceKind, pieces: Piece[], tint = .5): void {
  pieces.push({
    kind,
    points: [
      { x: a.x + normal.x * halfWidth, z: a.z + normal.z * halfWidth, y: rise(a.x + normal.x * halfWidth, a.z + normal.z * halfWidth, extra) },
      { x: b.x + normal.x * halfWidth, z: b.z + normal.z * halfWidth, y: rise(b.x + normal.x * halfWidth, b.z + normal.z * halfWidth, extra) },
      { x: b.x - normal.x * halfWidth, z: b.z - normal.z * halfWidth, y: rise(b.x - normal.x * halfWidth, b.z - normal.z * halfWidth, extra) },
      { x: a.x - normal.x * halfWidth, z: a.z - normal.z * halfWidth, y: rise(a.x - normal.x * halfWidth, a.z - normal.z * halfWidth, extra) },
    ],
    tint,
  });
}

const PAINT = 0.035;

function laneMarkings(street: Street, pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  if (street.kind === 'pedestrian' || street.kind === 'alley' || street.width < 9) return;
  const laneWidth = street.width / Math.max(1, Math.round(street.width / 3.35));
  for (const { pieces: intervals } of carriagewayIntervals(street)) {
    for (const interval of intervals) {
      const length = interval.max - interval.min;
      if (length < 20) continue;
      const dashes = Math.floor(length / 12);
      for (let d = 0; d < dashes; d++) {
        const t0 = interval.min + 6 + d * 12;
        const t1 = Math.min(interval.max - 2, t0 + 4);
        if (t1 - t0 < 1) continue;
        const a = streetAt(street, t0), b = streetAt(street, t1);
        if (Math.max(a.x, b.x) < bounds.minX || Math.min(a.x, b.x) > bounds.maxX) continue;
        if (Math.max(a.z, b.z) < bounds.minZ || Math.min(a.z, b.z) > bounds.maxZ) continue;
        const dir = normalize(sub(b, a));
        const n = { x: -dir.z, z: dir.x };
        if (street.oneWay === 0) {
          // Double yellow centre line on two-way streets.
          for (const offset of [-0.25, 0.25]) {
            quadBetween(
              { x: a.x + n.x * offset, z: a.z + n.z * offset },
              { x: b.x + n.x * offset, z: b.z + n.z * offset },
              { x: dir.x, z: dir.z }, 0, PAINT, 'paint-yellow', pieces, .6);
          }
        }
        const lanes = Math.max(1, Math.round(street.width / 3.35));
        const perSide = street.oneWay === 0 ? Math.floor(lanes / 2) : lanes;
        for (let i = 1; i < perSide; i++) {
          const lateral = (street.oneWay === 0 ? i : -street.width / 2 + i * laneWidth);
          for (const side of street.oneWay === 0 ? [1, -1] as const : [1] as const) {
            const offset = street.oneWay === 0 ? lateral * side : lateral;
            quadBetween(
              { x: a.x + n.x * offset, z: a.z + n.z * offset },
              { x: b.x + n.x * offset, z: b.z + n.z * offset },
              { x: dir.x, z: dir.z }, 0, PAINT, 'paint-white', pieces, .55);
          }
        }
        if (street.transit) {
          // Red surfaced kerb lane for buses and trams.
          const offset = (street.width / 2 - 1.9) * (street.oneWay === 0 ? 1 : 1);
          quadBetween(
            { x: a.x + n.x * offset, z: a.z + n.z * offset },
            { x: b.x + n.x * offset, z: b.z + n.z * offset },
            n, 1.7, PAINT * .5, 'paint-red', pieces, .28);
        }
        if (street.cycle) {
          const offset = -(street.width / 2 - 1.7);
          quadBetween(
            { x: a.x + n.x * offset, z: a.z + n.z * offset },
            { x: b.x + n.x * offset, z: b.z + n.z * offset },
            n, 1.3, PAINT * .5, 'paint-green', pieces, .3);
        }
      }
    }
  }
}

function crossingPieces(pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  for (const crossing of CROSSINGS) {
    if (Math.max(crossing.a.x, crossing.b.x) < bounds.minX || Math.min(crossing.a.x, crossing.b.x) > bounds.maxX) continue;
    if (Math.max(crossing.a.z, crossing.b.z) < bounds.minZ || Math.min(crossing.a.z, crossing.b.z) > bounds.maxZ) continue;
    const dir = normalize(sub(crossing.b, crossing.a));
    const along = { x: -dir.z, z: dir.x };
    const length = distance2d(crossing.a, crossing.b);
    const bars = Math.max(3, Math.round(length / 1.5));
    const depth = crossing.width / 2;
    for (let i = 0; i < bars; i++) {
      const centre = lerp2(crossing.a, crossing.b, (i + .5) / bars);
      const barHalf = (length / bars) * .28;
      const a = { x: centre.x + dir.x * barHalf, z: centre.z + dir.z * barHalf };
      const b = { x: centre.x - dir.x * barHalf, z: centre.z - dir.z * barHalf };
      quadBetween(a, b, along, depth, PAINT, crossing.kind === 'side-street' ? 'paint-white' : 'paint-white', pieces, .82);
    }
  }
}

function parkingPieces(pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  for (const bay of PARKING_BAYS) {
    if (bay.centre.x < bounds.minX || bay.centre.x > bounds.maxX) continue;
    if (bay.centre.z < bounds.minZ || bay.centre.z > bounds.maxZ) continue;
    const n = { x: -bay.dir.z, z: bay.dir.x };
    const a = { x: bay.centre.x - bay.dir.x * bay.length / 2, z: bay.centre.z - bay.dir.z * bay.length / 2 };
    const b = { x: bay.centre.x + bay.dir.x * bay.length / 2, z: bay.centre.z + bay.dir.z * bay.length / 2 };
    // Three painted sides of a stall, open towards the kerb.
    quadBetween(a, b, n, 0, PAINT, 'paint-white', pieces, .6);
    for (const end of [a, b]) {
      quadBetween(end, { x: end.x + n.x * bay.width, z: end.z + n.z * bay.width }, { x: bay.dir.x, z: bay.dir.z }, 0, PAINT, 'paint-white', pieces, .6);
    }
  }
}

/* ── open space, courtyards, verge ─────────────────────────────────────────────── */

export type VoidRect = { polygon: Point[] };

/** Fill a polygon with a tiled grid so paving patterns and holes are both possible. */
export function fillPolygon(
  polygon: readonly Point[], kind: SurfaceKind, cell: number, pieces: Piece[],
  extra = 0, voids: readonly VoidRect[] = [], tint = .5,
): void {
  const bounds = polygonBounds(polygon);
  if (polygon.length < 3) return;
  const inside = (x: number, z: number): boolean => {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) return false;
    }
    return true;
  };
  for (let z = bounds.minZ; z < bounds.maxZ; z += cell) {
    for (let x = bounds.minX; x < bounds.maxX; x += cell) {
      const corners: Point[] = [
        { x, z }, { x: x + cell, z }, { x: x + cell, z: z + cell }, { x, z: z + cell },
      ];
      const centre = { x: x + cell / 2, z: z + cell / 2 };
      if (!inside(centre.x, centre.z)) continue;
      if (voids.some(v => inside2(v.polygon, centre))) continue;
      pieces.push({ kind, points: ring(corners, extra, 9, kind), tint });
    }
  }
}
function inside2(polygon: readonly Point[], p: Point): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x) < 0) return false;
  }
  return true;
}

const OPEN_SURFACE: Record<string, SurfaceKind> = {
  plaza: 'paving', lawn: 'grass', apron: 'asphalt', cobbles: 'cobbles', terrace: 'paving-warm',
  courtyard: 'gravel', parking: 'asphalt-worn', verge: 'grass',
};
/** Small vertical relief keeps coplanar surfaces (grass under a road, paint on asphalt)
 *  from fighting without gaps: each kind sits at a fixed height in the stack. */
const SURFACE_LIFT: Partial<Record<SurfaceKind, number>> = {
  grass: -.05, gravel: -.03, 'asphalt-worn': -.005, asphalt: 0, deck: 0,
  'paint-red': .01, 'paint-green': .012, 'paint-yellow': .035, 'paint-white': .04,
  paving: .06, 'paving-warm': .06, cobbles: .08, concrete: SIDEWALK_RISE, void: -.2, water: -.15,
};
const liftOf = (kind: SurfaceKind, extra: number): number => (extra || (SURFACE_LIFT[kind] ?? 0));

function openSpacePieces(pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  for (const space of CITY.openSpace) {
    const b = polygonBounds(space.polygon);
    if (b.maxX < bounds.minX || b.minX > bounds.maxX || b.maxZ < bounds.minZ || b.minZ > bounds.maxZ) continue;
    const kind = OPEN_SURFACE[space.kind] ?? 'paving';
    fillPolygon(space.polygon, kind, space.kind === 'lawn' ? 7 : 6, pieces, 0);
  }
  for (const courtyard of PLAN.courtyards) {
    const b = polygonBounds(courtyard.polygon);
    if (b.maxX < bounds.minX || b.minX > bounds.maxX || b.maxZ < bounds.minZ || b.minZ > bounds.maxZ) continue;
    fillPolygon(courtyard.polygon, courtyard.kind === 'parking' ? 'asphalt-worn' : 'gravel', 7, pieces, 0);
  }
}

/**
 * Verge: the planted margin between the perimeter distributor and the city limit. It is
 * filled on a coarse grid because it is landscape, not pavement.
 */
const RING_STREET = NETWORK.streets.find(s => s.id === 'ring')!;
const VERGE_CLEAR = RING_STREET.width / 2 + RING_STREET.sidewalk + 3;
function vergePieces(pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  const cell = 14;
  const start = { x: Math.floor(bounds.minX / cell) * cell, z: Math.floor(bounds.minZ / cell) * cell };
  for (let z = start.z; z < bounds.maxZ + cell; z += cell) {
    for (let x = start.x; x < bounds.maxX + cell; x += cell) {
      const centre = { x: x + cell / 2, z: z + cell / 2 };
      if (!inside2(CITY_POLYGON, centre)) continue;
      // Only the planted margin: outside the distributor's footway, inside the city limit.
      if (distanceToPolygon(RING_POLYGON, centre) > VERGE_CLEAR && inside2(RING_POLYGON, centre)) continue;
      if (distance2d(centre, polygonCentroid(RING_POLYGON)) < 200) continue;
      let clear = true;
      for (const street of NETWORK.streets) {
        if (street.id === 'ring') continue;
        const b = streetBounds(street);
        if (centre.x < b.minX - 20 || centre.x > b.maxX + 20 || centre.z < b.minZ - 20 || centre.z > b.maxZ + 20) continue;
        for (const sample of street.samples) {
          if (Math.abs(sample.x - centre.x) > 30 || Math.abs(sample.z - centre.z) > 30) continue;
          if (distance2d(sample, centre) < street.width / 2 + street.sidewalk + 2) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (!clear) continue;
      const corners: Point[] = [
        { x, z }, { x: x + cell, z }, { x: x + cell, z: z + cell }, { x, z: z + cell },
      ];
      pieces.push({ kind: 'grass', points: ring(corners, 0, 11, 'grass'), tint: .5 });
    }
  }
}

function alleyPieces(pieces: Piece[], bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
  for (const alley of PLAN.alleys) {
    const b = polygonBounds([alley.a, alley.b]);
    if (b.maxX < bounds.minX || b.minX > bounds.maxX || b.maxZ < bounds.minZ || b.minZ > bounds.maxZ) continue;
    const dir = normalize(sub(alley.b, alley.a));
    const n = { x: -dir.z, z: dir.x };
    const half = alley.width / 2;
    pieces.push({
      kind: 'asphalt-worn',
      points: ring([
        { x: alley.a.x + n.x * half, z: alley.a.z + n.z * half },
        { x: alley.b.x + n.x * half, z: alley.b.z + n.z * half },
        { x: alley.b.x - n.x * half, z: alley.b.z - n.z * half },
        { x: alley.a.x - n.x * half, z: alley.a.z - n.z * half },
      ], 0, 13, 'asphalt-worn'),
      tint: .5,
    });
  }
}

/* ── assembly ──────────────────────────────────────────────────────────────────── */

export function piecesForBounds(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  options: { markings: boolean; detail: boolean },
): Piece[] {
  const pieces: Piece[] = [];
  const centre = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
  const touch = (b: { minX: number; minZ: number; maxX: number; maxZ: number }) =>
    !(b.maxX < bounds.minX - 40 || b.minX > bounds.maxX + 40 || b.maxZ < bounds.minZ - 40 || b.minZ > bounds.maxZ + 40);
  void centre;
  for (const street of NETWORK.streets) {
    const b = streetBounds(street);
    if (!touch(b)) continue;
    streetPieces(street, pieces, bounds);
    if (options.markings) laneMarkings(street, pieces, bounds);
  }
  for (const junction of NETWORK.junctions) {
    if (junction.point.x < bounds.minX - 70 || junction.point.x > bounds.maxX + 70) continue;
    if (junction.point.z < bounds.minZ - 70 || junction.point.z > bounds.maxZ + 70) continue;
    junctionPieces(junction, pieces, bounds);
  }
  alleyPieces(pieces, bounds);
  openSpacePieces(pieces, bounds);
  vergePieces(pieces, bounds);
  if (options.markings) {
    crossingPieces(pieces, bounds);
    parkingPieces(pieces, bounds);
  }
  return pieces;
}

const STREET_BOUNDS = new Map<string, { minX: number; minZ: number; maxX: number; maxZ: number }>();
function streetBounds(street: Street) {
  let b = STREET_BOUNDS.get(street.id);
  if (!b) {
    b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (const p of street.samples) {
      b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
    }
    STREET_BOUNDS.set(street.id, b);
  }
  return b;
}

/** Triangulate a convex piece into the shared buffer format used by the mesh builder. */
export function pieceTriangles(piece: Piece): number {
  return Math.max(0, piece.points.length - 2);
}
export function pieceCentre(piece: Piece): Point {
  return polygonCentroid(piece.points);
}
export { ensureCCW };
