/**
 * The downtown street network: grid lines, the perimeter distributor, the older regional
 * routes that survive inside the district, and the junction graph built from their
 * intersections.
 *
 * The graph is the single source of truth for road surfaces, lanes, footways, crossings,
 * parcels and future traffic AI: nothing is placed by eye, everything is derived from
 * these centre-lines.
 */
import { ROAD_WIDTH, type Point } from '../world/data';
import { SAMPLED_ROADS } from '../world/roads';
import { pointInPolygon, sampleCurve } from '../world/geometry';
import {
  CITY_POLYGON, GRID_ANGLE, GRID_POLYGON, RING_POLYGON, cityGround, fromGrid, AXIS_U, AXIS_V,
} from './frame';
import { AVENUES, STREETS, type LinePlan, type StreetKind } from './grid';
import { SITES } from './sites';
import { convexSpan, distance2d, lineIntersection } from './geometry2d';

export type StreetSample = {
  x: number; z: number; y: number; t: number;
  /** Index of the continuous run this sample belongs to; never interpolate across it. */
  span: number;
};
export type TravelDirection = 0 | 1 | -1;

export type Street = {
  id: string;
  name: string;
  kind: StreetKind;
  axis: 'u' | 'v' | 'free';
  /** Grid offset for plan lines: u for avenues, v for streets. */
  offset?: number;
  plan?: LinePlan;
  /** Intervals along the line that survive site cut-outs, in the sample `t` space. */
  spans: { min: number; max: number }[];
  samples: StreetSample[];
  length: number;
  width: number;
  sidewalk: number;
  lanes: number;
  laneWidth: number;
  oneWay: TravelDirection;
  transit: boolean;
  cycle: boolean;
  parking: boolean;
  loop: boolean;
  /** Continues outside the district as a regional route. */
  legacy: boolean;
  speed: number;
};

export type JunctionArm = {
  streetId: string;
  /** Parameter along the street's own samples. */
  t: number;
  /** Which side of the junction the arm leaves from, along the street's own axis. */
  side: 1 | -1;
  /** Unit direction leaving the junction along the street. */
  dir: Point;
  kind: StreetKind;
  lanes: number;
  oneWay: TravelDirection;
  /** Vehicles may drive from this arm into the junction. */
  entry: boolean;
  /** Vehicles may leave the junction along this arm. */
  exit: boolean;
};
export type JunctionControl = 'signal' | 'stop' | 'yield' | 'none' | 'gateway' | 'access';
export type Junction = {
  id: string;
  point: Point;
  y: number;
  arms: JunctionArm[];
  streets: string[];
  control: JunctionControl;
  shape: 'cross' | 'tee' | 'bend' | 'terminal' | 'gateway' | 'access';
  signalGroup?: string;
};
export type StreetEdge = {
  id: string;
  streetId: string;
  from: string;
  to: string;
  /** Direction of travel allowed (0 = both). */
  travel: TravelDirection;
  length: number;
  lanes: number;
  index: number;
};

const SPEED: Record<StreetKind, number> = {
  boulevard: 60, avenue: 50, street: 30, lane: 30, pedestrian: 0,
  transit: 40, alley: 15, service: 20, ring: 50,
};
const SAMPLE_SPACING = 22;

function sampleLine(points: readonly Point[], spacing: number, closed: boolean): StreetSample[] {
  const out: StreetSample[] = [];
  const count = closed ? points.length : points.length - 1;
  let travelled = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const length = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push({ x, z, y: cityGround(x, z), t: travelled + length * t, span: 0 });
    }
    travelled += length;
  }
  if (!closed) {
    const last = points[points.length - 1];
    out.push({ x: last.x, z: last.z, y: cityGround(last.x, last.z), t: travelled, span: 0 });
  } else {
    const first = out[0];
    out.push({ x: first.x, z: first.z, y: first.y, t: travelled, span: 0 });
  }
  return out;
}

/** Remove [from,to] intervals from a span list. */
function subtract(span: { min: number; max: number }, cuts: { min: number; max: number }[]): { min: number; max: number }[] {
  let pieces = [{ ...span }];
  for (const cut of cuts) {
    const next: { min: number; max: number }[] = [];
    for (const piece of pieces) {
      if (cut.max <= piece.min || cut.min >= piece.max) { next.push(piece); continue; }
      if (cut.min > piece.min) next.push({ min: piece.min, max: Math.min(piece.max, cut.min) });
      if (cut.max < piece.max) next.push({ min: Math.max(piece.min, cut.max), max: piece.max });
    }
    pieces = next;
  }
  return pieces.filter(p => p.max - p.min > 12);
}

/* ── Perimeter distributor geometry: arc parameter, frames, landing separation ────── */

const RING_SEGMENTS = RING_POLYGON.map((a, i) => {
  const b = RING_POLYGON[(i + 1) % RING_POLYGON.length];
  return { a, b, length: distance2d(a, b) };
});
const RING_CUMULATIVE: number[] = [0];
for (let i = 0; i < RING_SEGMENTS.length; i++) RING_CUMULATIVE.push(RING_CUMULATIVE[i] + RING_SEGMENTS[i].length);
const RING_LENGTH = RING_CUMULATIVE[RING_CUMULATIVE.length - 1];

/** Nearest point on the ring as an arc-length position, for spacing out junctions. */
function ringLocate(point: Point): { s: number; point: Point; index: number } {
  let best = { s: 0, point: RING_POLYGON[0], index: 0, distance: Infinity };
  for (let i = 0; i < RING_SEGMENTS.length; i++) {
    const { a, b } = RING_SEGMENTS[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const p = { x: a.x + dx * t, z: a.z + dz * t };
    const d = distance2d(point, p);
    if (d < best.distance) best = { s: RING_CUMULATIVE[i] + t * RING_SEGMENTS[i].length, point: p, index: i, distance: d };
  }
  return best;
}
function ringPoint(s: number): Point {
  const arc = ((s % RING_LENGTH) + RING_LENGTH) % RING_LENGTH;
  for (let i = 0; i < RING_SEGMENTS.length; i++) {
    if (arc <= RING_CUMULATIVE[i + 1] || i === RING_SEGMENTS.length - 1) {
      const t = (arc - RING_CUMULATIVE[i]) / RING_SEGMENTS[i].length;
      const { a, b } = RING_SEGMENTS[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return RING_POLYGON[0];
}
/** Direction, inward normal and corner clearance of the ring at a point. */
function ringFrame(point: Point): { dir: Point; normal: Point; cornerDistance: number } {
  const found = ringLocate(point);
  const { a, b } = RING_SEGMENTS[found.index];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / len, z: dz / len };
  const normal = { x: -dir.z, z: dir.x };
  return {
    dir,
    normal,
    cornerDistance: Math.min(
      Math.hypot(point.x - a.x, point.z - a.z),
      Math.hypot(point.x - b.x, point.z - b.z),
    ),
  };
}

type Landing = { key: string; s: number };

/**
 * Grid lines meet the ring every 150–190 m, but two of them can land within a few metres
 * of each other near a corner. Their junctions are nudged apart along the distributor —
 * the approach curve absorbs the shift — so every junction stays a readable T.
 */
function separateLandings(landings: Landing[]): Map<string, number> {
  const moves = new Map<string, number>();
  const current = (l: Landing) => l.s + (moves.get(l.key) ?? 0);
  const CORNER = 34, APART = 30;
  for (let pass = 0; pass < 4; pass++) {
    for (const landing of landings) {
      const s = current(landing);
      for (const corner of RING_CUMULATIVE.slice(0, -1)) {
        let delta = s - corner;
        if (delta > RING_LENGTH / 2) delta -= RING_LENGTH;
        if (delta < -RING_LENGTH / 2) delta += RING_LENGTH;
        if (Math.abs(delta) < CORNER) {
          moves.set(landing.key, (moves.get(landing.key) ?? 0) + Math.sign(delta || 1) * (CORNER - Math.abs(delta)));
        }
      }
    }
    for (let i = 0; i < landings.length; i++) {
      for (let j = i + 1; j < landings.length; j++) {
        const a = current(landings[i]), b = current(landings[j]);
        let delta = b - a;
        if (delta > RING_LENGTH / 2) delta -= RING_LENGTH;
        if (delta < -RING_LENGTH / 2) delta += RING_LENGTH;
        if (Math.abs(delta) >= APART) continue;
        const push = (APART - Math.abs(delta)) / 2 + 1;
        const dir = Math.sign(delta || 1);
        moves.set(landings[i].key, (moves.get(landings[i].key) ?? 0) - dir * push);
        moves.set(landings[j].key, (moves.get(landings[j].key) ?? 0) + dir * push);
      }
    }
  }
  return moves;
}

/** Quadratic Bézier sampler: no overshoot past the landing, unlike a spline endpoint. */
function quadBezier(p0: Point, c: Point, p2: Point, steps: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, k = 1 - t;
    out.push({
      x: k * k * p0.x + 2 * k * t * c.x + t * t * p2.x,
      z: k * k * p0.z + 2 * k * t * c.z + t * t * p2.z,
    });
  }
  return out;
}

/**
 * Control point of the approach fillet: the intersection of the straight run and the
 * perpendicular at the landing, which makes the curve tangent-continuous at both ends.
 */
function filletControl(straight: Point, dir: Point, landing: Point, normal: Point): Point {
  const hit = lineIntersection(straight, dir, landing, normal);
  if (hit) {
    const s = (hit.x - straight.x) * dir.x + (hit.z - straight.z) * dir.z;
    const u = (hit.x - landing.x) * normal.x + (hit.z - landing.z) * normal.z;
    if (s > 34 && s < 300 && u > 22 && u < 220) return hit;
  }
  return { x: landing.x + normal.x * 54, z: landing.z + normal.z * 54 };
}

/**
 * A grid line that meets the distributor at a shallow angle would produce a junction
 * hundreds of metres long, so its last stretch curves in to arrive square. Real districts
 * solve this the same way: the minor street jogs before the distributor.
 */
function approachPoints(landing: Point, straight: Point, dir: Point): Point[] {
  const frame = ringFrame(landing);
  if (Math.abs(dir.x * frame.dir.x + dir.z * frame.dir.z) < Math.cos(25 * Math.PI / 180)) return [straight, landing];
  const control = filletControl(straight, dir, landing, frame.normal);
  return quadBezier(straight, control, landing, 13);
}

const GRID_JOG = 120;

function gridStreet(plan: LinePlan, landings?: Map<string, Point>): Street {
  const axis = plan.axis;
  const origin = axis === 'u' ? fromGrid(plan.offset, 0) : fromGrid(0, plan.offset);
  const dir = axis === 'u' ? AXIS_V : AXIS_U;
  const span = convexSpan(GRID_POLYGON, origin, dir) ?? { min: 0, max: 1 };
  // Sites swallow whole blocks, so the streets between them disappear too.
  const cuts: { min: number; max: number }[] = [];
  for (const site of SITES) {
    if (axis === 'u') {
      if (plan.index > site.i0 && plan.index <= site.i1) {
        cuts.push({ min: STREETS[site.j0].offset, max: STREETS[site.j1 + 1].offset });
      }
    } else if (plan.index > site.j0 && plan.index <= site.j1) {
      cuts.push({ min: AVENUES[site.i0].offset, max: AVENUES[site.i1 + 1].offset });
    }
  }
  const spans = subtract(span, cuts);
  const at = (t: number): Point => axis === 'u' ? fromGrid(plan.offset, t) : fromGrid(t, plan.offset);
  const landingFor = (index: number, end: 'min' | 'max', fallback: Point): Point =>
    landings?.get(`${plan.axis}${plan.index}:${index}:${end}`) ?? fallback;
  const samples: StreetSample[] = [];
  spans.forEach((piece, index) => {
    const length = piece.max - piece.min;
    // Only the two outer ends of a street land on the distributor. Ends created by a
    // landmark site must stay straight: curving them would swing the street off its line.
    const startOnRing = Math.abs(piece.min - span.min) < .5;
    const endOnRing = Math.abs(piece.max - span.max) < .5;
    const headEnd = Math.min(GRID_JOG, length * .35);
    const points: Point[] = [];
    const startStraight = at(piece.min + headEnd);
    const endStraight = at(piece.max - headEnd);
    if (headEnd > 24 && startOnRing) {
      const start = landingFor(index, 'min', at(piece.min));
      points.push(...approachPoints(start, startStraight, dir).reverse());
    } else points.push(at(piece.min));
    const steps = Math.max(1, Math.ceil(distance2d(points[points.length - 1], endStraight) / SAMPLE_SPACING));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      points.push({
        x: startStraight.x + (endStraight.x - startStraight.x) * t,
        z: startStraight.z + (endStraight.z - startStraight.z) * t,
      });
    }
    if (headEnd > 24 && endOnRing) {
      const end = landingFor(index, 'max', at(piece.max));
      points.push(...approachPoints(end, endStraight, dir).slice(1));
    } else points.push(at(piece.max));
    let previous = -Infinity;
    for (const p of points) {
      // Sample parameter must stay monotonic along the street even where an approach
      // curve doubles back in the grid axis; lookups rely on it.
      const raw = (p.x - origin.x) * dir.x + (p.z - origin.z) * dir.z;
      const t = Math.max(raw, previous);
      previous = t;
      samples.push({ x: p.x, z: p.z, y: cityGround(p.x, p.z), t, span: index });
    }
  });
  // Spans are re-derived from the samples: an approach curve bends a few metres off the
  // straight grid line, and the span must describe the street that actually exists.
  const rebuilt = spans.map((_, index) => {
    let min = Infinity, max = -Infinity;
    for (const sample of samples) {
      if (sample.span !== index) continue;
      min = Math.min(min, sample.t); max = Math.max(max, sample.t);
    }
    return { min, max };
  });
  const length = rebuilt.reduce((sum, p) => sum + (p.max - p.min), 0);
  return {
    id: `${axis}${plan.index}`, name: plan.name, kind: plan.kind, axis,
    offset: plan.offset, plan, spans: rebuilt, samples, length,
    width: plan.width, sidewalk: plan.sidewalk, lanes: plan.lanes,
    laneWidth: plan.lanes ? plan.width / plan.lanes : 0,
    oneWay: plan.oneWay, transit: plan.transit, cycle: plan.cycle, parking: plan.parking,
    loop: false, legacy: false, speed: SPEED[plan.kind],
  };
}

/** Grid spans are settled first, then landings are spaced out, then streets are built. */
function buildGridStreets(): Street[] {
  const plans: LinePlan[] = [...AVENUES, ...STREETS];
  const drafts = plans.map(plan => {
    const axis = plan.axis;
    const origin = axis === 'u' ? fromGrid(plan.offset, 0) : fromGrid(0, plan.offset);
    const dir = axis === 'u' ? AXIS_V : AXIS_U;
    const bounds = convexSpan(GRID_POLYGON, origin, dir) ?? { min: 0, max: 1 };
    const cuts: { min: number; max: number }[] = [];
    for (const site of SITES) {
      if (axis === 'u') {
        if (plan.index > site.i0 && plan.index <= site.i1) cuts.push({ min: STREETS[site.j0].offset, max: STREETS[site.j1 + 1].offset });
      } else if (plan.index > site.j0 && plan.index <= site.j1) {
        cuts.push({ min: AVENUES[site.i0].offset, max: AVENUES[site.i1 + 1].offset });
      }
    }
    return { plan, origin, dir, bounds, spans: subtract(bounds, cuts) };
  });
  const landings: Landing[] = [];
  const raw = new Map<string, Point>();
  for (const draft of drafts) {
    const at = (t: number): Point => draft.plan.axis === 'u'
      ? fromGrid(draft.plan.offset, t) : fromGrid(t, draft.plan.offset);
    draft.spans.forEach((piece, index) => {
      for (const end of ['min', 'max'] as const) {
        if (Math.abs(piece[end] - draft.bounds[end]) >= .5) continue; // interior end at a site
        const point = at(piece[end]);
        const key = `${draft.plan.axis}${draft.plan.index}:${index}:${end}`;
        raw.set(key, point);
        landings.push({ key, s: ringLocate(point).s });
      }
    });
  }
  const moves = separateLandings(landings);
  const resolved = new Map<string, Point>();
  for (const landing of landings) {
    if (resolved.has(landing.key)) continue;
    const move = moves.get(landing.key) ?? 0;
    resolved.set(landing.key, Math.abs(move) < 0.5 ? raw.get(landing.key)! : ringPoint(landing.s + move));
  }
  return drafts.map(draft => gridStreet(draft.plan, resolved));
}

/** The perimeter distributor, closed on itself, sampling the ring polygon. */
function ringStreet(): Street {
  const samples = sampleLine(RING_POLYGON, SAMPLE_SPACING, true);
  const plan: LinePlan = {
    index: -1, axis: 'u', offset: 0, name: 'The Parade', kind: 'ring',
    width: 22, sidewalk: 5.2, lanes: 4, oneWay: 0, transit: false, cycle: false, parking: true,
  };
  return {
    id: 'ring', name: 'The Parade', kind: 'ring', axis: 'free', spans: [{ min: 0, max: samples[samples.length - 1].t }],
    samples, length: samples[samples.length - 1].t,
    width: plan.width, sidewalk: plan.sidewalk, lanes: plan.lanes, laneWidth: plan.width / plan.lanes,
    oneWay: 0, transit: false, cycle: false, parking: true,
    loop: true, legacy: false, speed: SPEED.ring, plan,
  };
}

/** Regional routes already authored in the foundation, continued through the district. */
function legacyWidth(kind: string): { width: number; kind: StreetKind; lanes: number; sidewalk: number } {
  if (kind === 'highway') return { width: 30, kind: 'boulevard', lanes: 6, sidewalk: 6 };
  if (kind === 'arterial') return { width: ROAD_WIDTH.arterial, kind: 'boulevard', lanes: 4, sidewalk: 5.4 };
  if (kind === 'secondary') return { width: ROAD_WIDTH.secondary, kind: 'street', lanes: 2, sidewalk: 4.2 };
  return { width: ROAD_WIDTH.local, kind: 'service', lanes: 1, sidewalk: 3 };
}
/**
 * Acute angle between a route and the nearer grid axis. A regional route that runs almost
 * parallel to the grid would produce impossibly skewed intersections, so it keeps only the
 * length between the city limit and the ring and leaves the cross-town run to the grid
 * (Lantern Avenue and Meridian Avenue take over those corridors).
 */
function gridCrossingAngle(dir: Point): number {
  const a = Math.atan2(dir.z, dir.x);
  const acute = (r: number) => {
    let d = Math.abs(((r % Math.PI) + Math.PI) % Math.PI);
    if (d > Math.PI / 2) d = Math.PI - d;
    return d * 180 / Math.PI;
  };
  return Math.min(acute(a - GRID_ANGLE), acute(a - GRID_ANGLE - Math.PI / 2));
}

function legacyStreets(): Street[] {
  const streets: Street[] = [];
  for (const sampled of SAMPLED_ROADS) {
    const samples = sampled.samples;
    const first = samples[0], last = samples[samples.length - 1];
    const through = gridCrossingAngle({ x: last.x - first.x, z: last.z - first.z }) >= 23;
    const inside = (p: Point) => pointInPolygon(p.x, p.z, CITY_POLYGON);
    // Keep every run that is inside the city, and — for shallow routes — only outside
    // the perimeter distributor, where the grid has already taken over.
    const keep: boolean[] = samples.map(p => inside(p) && (through || !pointInPolygon(p.x, p.z, RING_POLYGON)));
    let run: number[] = [];
    const runs: number[][] = [];
    keep.forEach((k, i) => {
      if (k) run.push(i);
      else if (run.length) { runs.push(run); run = []; }
    });
    if (run.length) runs.push(run);
    runs.forEach(indices => {
      if (indices.length < 2) return;
      const start = indices[0], end = indices[indices.length - 1];
      const points: Point[] = [];
      // Extend half a sample past each end so the route meets its continuation outside
      // the district and the ring without a gap.
      if (start > 0) points.push(midpoint(samples[start - 1], samples[start]));
      for (let i = start; i <= end; i++) points.push({ x: samples[i].x, z: samples[i].z });
      if (end < samples.length - 1) points.push(midpoint(samples[end], samples[end + 1]));
      if (points.length < 2) return;
      const line = sampleLine(points, SAMPLE_SPACING, false);
      if (line[line.length - 1].t < 25) return;
      // A shallow route may still run along the planted strip between the ring and the
      // city limit (the old Bayfront alignment does exactly that). The ring serves that
      // corridor, so only true crossings of the strip are kept.
      if (!through && line[line.length - 1].t > 150) return;
      const spec = legacyWidth(sampled.road.type);
      streets.push({
        id: `legacy-${sampled.road.id}-${streets.length}`, name: sampled.road.name, kind: spec.kind, axis: 'free',
        spans: [{ min: 0, max: line[line.length - 1].t }], samples: line,
        length: line[line.length - 1].t,
        width: spec.width, sidewalk: spec.sidewalk, lanes: spec.lanes, laneWidth: spec.width / spec.lanes,
        oneWay: 0, transit: false, cycle: false, parking: false,
        loop: false, legacy: true, speed: SPEED[spec.kind],
      });
    });
  }
  return streets;
}
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/**
 * Gateways. Every regional route that reaches the city limit must have somewhere to go:
 * routes kept above become diagonals or short stubs, the rest are met at the boundary by
 * a connector running in to the perimeter distributor. Without this, a regional road
 * would arrive at the district edge and stop dead.
 */
function gatewayConnectors(existing: readonly Street[]): Street[] {
  const streets: Street[] = [];
  const covered = new Set<string>();
  for (const street of existing) {
    if (!street.legacy) continue;
    for (const sample of [street.samples[0], street.samples[street.samples.length - 1]]) {
      for (const point of existing.flatMap(() => [sample])) {
        void point;
      }
    }
  }
  for (const sampled of SAMPLED_ROADS) {
    const ins = sampled.samples.map(p => pointInPolygon(p.x, p.z, CITY_POLYGON));
    const firstInside = ins.indexOf(true);
    const lastInside = ins.lastIndexOf(true);
    if (firstInside < 0) continue;
    const spec = legacyWidth(sampled.road.type);
    // Ends that already reach a legacy street inside the district need no connector.
    for (const [index, neighbour] of [[firstInside, firstInside - 1], [lastInside, lastInside + 1]] as const) {
      if (index < 0 || neighbour < 0 || neighbour >= sampled.samples.length) continue;
      const entry = boundaryPoint(sampled.samples[neighbour], sampled.samples[index]);
      if (!entry) continue;
      const connected = existing.some(street => street.legacy &&
        street.samples.some(p => Math.hypot(p.x - entry.x, p.z - entry.z) < 90));
      if (connected) continue;
      const target = nearestOnRing(entry);
      if (!target) continue;
      const key = `${Math.round(entry.x / 40)}:${Math.round(entry.z / 40)}`;
      if (covered.has(key)) continue;
      covered.add(key);
      const samples = sampleLine([entry, target], SAMPLE_SPACING, false);
      if (samples[samples.length - 1].t < 12) continue;
      streets.push({
        id: `gate-${sampled.road.id}-${streets.length}`, name: `${sampled.road.name} Approach`, kind: spec.kind, axis: 'free',
        spans: [{ min: 0, max: samples[samples.length - 1].t }], samples, length: samples[samples.length - 1].t,
        width: spec.width, sidewalk: spec.sidewalk, lanes: spec.lanes, laneWidth: spec.width / spec.lanes,
        oneWay: 0, transit: false, cycle: false, parking: false,
        loop: false, legacy: true, speed: SPEED[spec.kind],
      });
    }
  }
  return streets;
}

/** Bisect the last outside / first inside pair to land on the city limit. */
function boundaryPoint(outside: Point, inside: Point): Point | null {
  let lo = 0, hi = 1;
  if (!pointInPolygon(outside.x, outside.z, CITY_POLYGON)) { /* expected */ }
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: outside.x + (inside.x - outside.x) * mid, z: outside.z + (inside.z - outside.z) * mid };
    if (pointInPolygon(p.x, p.z, CITY_POLYGON)) hi = mid; else lo = mid;
  }
  const t = (lo + hi) / 2;
  const p = { x: outside.x + (inside.x - outside.x) * t, z: outside.z + (inside.z - outside.z) * t };
  return pointInPolygon(p.x, p.z, CITY_POLYGON) || distance2d(p, inside) < 2 ? p : null;
}

/** Nearest point on the perimeter distributor centreline. */
export function nearestOnRing(point: Point): Point | null {
  let best: { point: Point; distance: number } | null = null;
  for (let i = 0; i < RING_POLYGON.length; i++) {
    const a = RING_POLYGON[i], b = RING_POLYGON[(i + 1) % RING_POLYGON.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const p = { x: a.x + dx * t, z: a.z + dz * t };
    const d = distance2d(point, p);
    if (!best || d < best.distance) best = { point: p, distance: d };
  }
  return best?.point ?? null;
}

type Crossing = { a: string; b: string; ta: number; tb: number; point: Point };

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function samplePoint(a: StreetSample, b: StreetSample, t: number): Point {
  const span = b.t - a.t || 1;
  const k = clamp((t - a.t) / span, 0, 1);
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
}

function crossings(a: Street, b: Street): Crossing[] {
  const out: Crossing[] = [];
  const bBox = (s: Street) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of s.samples) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  };
  const ba = bBox(a), bb = bBox(b);
  if (ba.maxX < bb.minX - 4 || bb.maxX < ba.minX - 4 || ba.maxZ < bb.minZ - 4 || bb.maxZ < ba.minZ - 4) return out;
  for (let i = 0; i < a.samples.length - 1; i++) {
    const a0 = a.samples[i], a1 = a.samples[i + 1];
    // Never join samples across a gap: a grid line interrupted by a landmark site is
    // two separate pieces of street, not one street with a hole.
    if (a1.t - a0.t < 1e-6 || a0.span !== a1.span) continue;
    const ad = { x: (a1.x - a0.x) / (a1.t - a0.t), z: (a1.z - a0.z) / (a1.t - a0.t) };
    for (let j = 0; j < b.samples.length - 1; j++) {
      const b0 = b.samples[j], b1 = b.samples[j + 1];
      if (b0.span !== b1.span) continue;
      if (Math.max(a0.x, a1.x) < Math.min(b0.x, b1.x) - 2 || Math.max(b0.x, b1.x) < Math.min(a0.x, a1.x) - 2 ||
        Math.max(a0.z, a1.z) < Math.min(b0.z, b1.z) - 2 || Math.max(b0.z, b1.z) < Math.min(a0.z, a1.z) - 2) continue;
      const bd = { x: (b1.x - b0.x) / (b1.t - b0.t), z: (b1.z - b0.z) / (b1.t - b0.t) };
      const hit = lineIntersection(a0, ad, b0, bd);
      if (!hit) continue;
      // Invert along the dominant axis, then clamp into the segment: the two centre-lines
      // may meet a few centimetres outside the sampled piece, and that still counts.
      const ta = clamp(a0.t + (Math.abs(ad.x) > Math.abs(ad.z) ? (hit.x - a0.x) / ad.x : (hit.z - a0.z) / ad.z), a0.t, a1.t);
      const tb = clamp(b0.t + (Math.abs(bd.x) > Math.abs(bd.z) ? (hit.x - b0.x) / bd.x : (hit.z - b0.z) / bd.z), b0.t, b1.t);
      const pa = samplePoint(a0, a1, ta), pb = samplePoint(b0, b1, tb);
      if (distance2d(pa, pb) > 3) continue;
      out.push({ a: a.id, b: b.id, ta, tb, point: { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 } });
    }
  }
  return out;
}

export type StreetNetwork = {
  streets: Street[];
  junctions: Junction[];
  edges: StreetEdge[];
  streetById: Map<string, Street>;
  junctionById: Map<string, Junction>;
  /** Streets that continue outside the district (regional routes). */
  gateways: Junction[];
};

export const NETWORK: StreetNetwork = (() => {
  const legacy = legacyStreets();
  const streets: Street[] = [
    ...buildGridStreets(),
    ringStreet(),
    ...legacy,
    ...gatewayConnectors(legacy),
  ];
  const streetById = new Map(streets.map(s => [s.id, s]));

  // 1. every crossing between two centre-lines
  const raw: Crossing[] = [];
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      raw.push(...crossings(streets[i], streets[j]));
    }
  }

  // 2. cluster crossing points that coincide (a street end landing on another street)
  type Cluster = { point: Point; x: number; z: number; count: number; members: Crossing[] };
  const clusters: Cluster[] = [];
  const cell = 6;
  const index = new Map<string, Cluster[]>();
  for (const crossing of raw) {
    const key = `${Math.floor(crossing.point.x / cell)}:${Math.floor(crossing.point.z / cell)}`;
    let placed = false;
    for (const near of [index.get(key) ?? [], index.get(`${Math.floor(crossing.point.x / cell) + 1}:${Math.floor(crossing.point.z / cell)}`) ?? [],
    index.get(`${Math.floor(crossing.point.x / cell) - 1}:${Math.floor(crossing.point.z / cell)}`) ?? [],
    index.get(`${Math.floor(crossing.point.x / cell)}:${Math.floor(crossing.point.z / cell) + 1}`) ?? [],
    index.get(`${Math.floor(crossing.point.x / cell)}:${Math.floor(crossing.point.z / cell) - 1}`) ?? []]) {
      for (const cluster of near) {
        if (Math.hypot(cluster.x - crossing.point.x, cluster.z - crossing.point.z) > 7) continue;
        cluster.x = (cluster.x * cluster.count + crossing.point.x) / (cluster.count + 1);
        cluster.z = (cluster.z * cluster.count + crossing.point.z) / (cluster.count + 1);
        cluster.point = { x: cluster.x, z: cluster.z };
        cluster.count++;
        cluster.members.push(crossing);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      const cluster: Cluster = { point: crossing.point, x: crossing.point.x, z: crossing.point.z, count: 1, members: [crossing] };
      clusters.push(cluster);
      const list = index.get(key) ?? [];
      list.push(cluster);
      index.set(key, list);
    }
  }

  // 3. junctions: arms taken from every street that passes through a cluster
  const junctions: Junction[] = [];
  const junctionById = new Map<string, Junction>();
  clusters.forEach((cluster, i) => {
    const byStreet = new Map<string, { t: number; point: Point }[]>();
    for (const member of cluster.members) {
      for (const [id, t] of [[member.a, member.ta], [member.b, member.tb]] as const) {
        const list = byStreet.get(id) ?? [];
        list.push({ t, point: cluster.point });
        byStreet.set(id, list);
      }
    }
    const arms: JunctionArm[] = [];
    for (const [streetId, hits] of byStreet) {
      const street = streetById.get(streetId)!;
      const t = hits.reduce((sum, h) => sum + h.t, 0) / hits.length;
      const forward = derivativeAt(street, t);
      // An arm exists on every side of the junction where the street continues. On a
      // one-way street that is an entry from behind and an exit ahead, never both.
      for (const side of [1, -1] as const) {
        if (!withinSpans(street, t + side * 1.5)) continue;
        arms.push({
          streetId, t, side, dir: { x: forward.x * side, z: forward.z * side },
          kind: street.kind, lanes: street.lanes, oneWay: street.oneWay,
          entry: street.oneWay === 0 || street.oneWay === -side,
          exit: street.oneWay === 0 || street.oneWay === side,
        });
      }
    }
    if (!arms.length) return;
    const vehicleArms = arms.filter(a => a.kind !== 'pedestrian' && a.lanes > 0);
    const streetsHere = [...new Set(arms.map(a => a.streetId))];
    const laneRank = [...new Set(vehicleArms.map(a => a.streetId))]
      .map(id => streetById.get(id)!.lanes)
      .sort((x, y) => y - x);
    const transit = streetsHere.some(id => streetById.get(id)!.transit);
    const legacy = streetsHere.some(id => streetById.get(id)!.legacy);
    const isEnd = streetsHere.some(id => {
      const street = streetById.get(id)!;
      const arm = arms.find(a => a.streetId === id)!;
      return !withinSpans(street, arm.t + arm.side * 60) && !street.loop;
    });
    const shape: Junction['shape'] =
      arms.length >= 4 ? 'cross' : arms.length === 3 ? 'tee' : arms.length === 2 ? 'bend' : 'terminal';
    // Signals are reserved for major-to-major junctions; everything else is stop or yield
    // controlled, the way a real grid keeps its minor streets minor.
    const control: JunctionControl =
      vehicleArms.length === 0 ? 'none'
        : vehicleArms.length <= 1 ? (legacy || isEnd ? 'gateway' : 'none')
          : ((laneRank[0] >= 4 && laneRank[1] >= 4) || laneRank[0] >= 6 || (transit && laneRank[0] >= 4)) ? 'signal'
            : vehicleArms.length >= 3 ? 'stop' : 'yield';
    const junction: Junction = {
      id: `j${i}`, point: cluster.point, y: cityGround(cluster.point.x, cluster.point.z),
      arms, streets: streetsHere,
      control,
      shape: shape === 'terminal' && control === 'gateway' ? 'gateway' : shape,
    };
    if (junction.control === 'signal') junction.signalGroup = `sg${i}`;
    junctions.push(junction);
    junctionById.set(junction.id, junction);
  });

  // 4. street ends that no crossing claimed: gateways onto the regional network
  for (const street of streets) {
    for (const span of street.spans) {
      for (const [t, end] of [[span.min, 'start'], [span.max, 'end']] as const) {
        if (street.loop) continue;
        const p = positionAt(street, t);
        const claimed = junctions.some(j => j.streets.includes(street.id) &&
          Math.hypot(j.point.x - p.x, j.point.z - p.z) < 12);
        if (claimed) continue;
        const dir = derivativeAt(street, t);
        const arms: JunctionArm[] = [];
        for (const side of [1, -1] as const) {
          if (!withinSpans(street, t + side * 1.5)) continue;
          arms.push({
            streetId: street.id, t, side, dir: { x: dir.x * side, z: dir.z * side },
            kind: street.kind, lanes: street.lanes, oneWay: street.oneWay,
            entry: street.oneWay === 0 || street.oneWay === -side,
            exit: street.oneWay === 0 || street.oneWay === side,
          });
        }
        if (!arms.length) continue;
        junctions.push({
          id: `j-end-${street.id}-${end}`, point: p, y: cityGround(p.x, p.z), arms, streets: [street.id],
          control: 'gateway', shape: 'gateway',
        });
      }
    }
  }
  for (const junction of junctions) junctionById.set(junction.id, junction);

  // 5. edges: consecutive junction crossings along each street, per span
  const edges: StreetEdge[] = [];
  for (const street of streets) {
    const cuts = new Map<string, number>();
    let edgeIndex = 0;
    for (const junction of junctions) {
      if (!junction.streets.includes(street.id)) continue;
      const arm = junction.arms.find(a => a.streetId === street.id);
      if (!arm) continue;
      const existing = cuts.get(junction.id);
      if (existing === undefined || Math.abs(existing - arm.t) < 1e-6) cuts.set(junction.id, arm.t);
    }
    for (const span of street.spans) {
      const ordered = [...cuts.entries()]
        .map(([id, t]) => ({ id, t }))
        .filter(c => c.t >= span.min - 0.01 && c.t <= span.max + 0.01)
        .sort((a, b) => a.t - b.t);
      const nodes = ordered.map(c => c.id);
      if (street.loop && nodes.length > 1) nodes.push(nodes[0]);
      for (let i = 0; i + 1 < nodes.length; i++) {
        const length = Math.abs(ordered[i + 1]?.t ?? 0);
        const start = ordered[i], end = ordered[i + 1];
        if (!start || !end) continue;
        const len = Math.abs(end.t - start.t);
        if (len < 8) continue;
        edges.push({
          // `i` restarts for every disconnected span; use a street-wide counter so edge,
          // lane and footway-node IDs stay unique across site cut-outs.
          id: `${street.id}-e${edgeIndex}`, streetId: street.id, from: start.id, to: end.id,
          travel: street.oneWay, length: len,
          lanes: street.lanes, index: edgeIndex,
        });
        edgeIndex++;
        void length;
      }
    }
  }

  return {
    streets, junctions, edges, streetById, junctionById,
    gateways: junctions.filter(j => j.control === 'gateway'),
  };
})();

export function withinSpans(street: Street, t: number): boolean {
  let u = t;
  if (street.loop && street.length > 0) {
    u = ((t % street.length) + street.length) % street.length;
  }
  return street.spans.some(s => u >= s.min - 1e-6 && u <= s.max + 1e-6);
}
export function streetAt(street: Street, t: number): StreetSample {
  const samples = street.samples;
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const span = b.t - a.t || 1;
  const k = a.span === b.span ? (t - a.t) / span : 0;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k, t, span: a.span };
}
export function positionAt(street: Street, t: number): Point {
  const s = streetAt(street, t);
  return { x: s.x, z: s.z };
}
export function derivativeAt(street: Street, t: number): Point {
  const a = streetAt(street, Math.max(street.samples[0].t, t - 3));
  const b = streetAt(street, Math.min(street.samples[street.samples.length - 1].t, t + 3));
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}
/** The continuous run of samples a parameter belongs to. */
export function spanOf(street: Street, t: number): number {
  for (let i = 0; i < street.spans.length; i++) {
    const span = street.spans[i];
    if (t >= span.min - 1e-6 && t <= span.max + 1e-6) return i;
  }
  return 0;
}
export function streetElevation(street: Street, t: number): number {
  return streetAt(street, t).y;
}
/** Nearest point on any street centre-line, used by parcels, props and navigation. */
export function nearestStreet(x: number, z: number, streets: readonly Street[] = NETWORK.streets):
  { street: Street; t: number; distance: number; point: Point } | null {
  let best: { street: Street; t: number; distance: number; point: Point } | null = null;
  for (const street of streets) {
    for (let i = 0; i < street.samples.length - 1; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const px = a.x + dx * k, pz = a.z + dz * k;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.distance) best = { street, t: a.t + (b.t - a.t) * k, distance: d, point: { x: px, z: pz } };
    }
  }
  return best;
}
