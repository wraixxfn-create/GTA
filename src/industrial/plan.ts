/**
 * The industrial street network: haulways, warehouse roads, yard stubs, the regional
 * routes that survive inside the district, and the junction graph built from their
 * intersections.
 *
 * The works grid is the downtown grid's opposite: four north–south ways and six
 * east–west roads at 460–520 m spacing leave superblocks ten times a downtown block,
 * which the plan then fills with one or two narrow service roads each. Anchor
 * facilities carve their own frontages out of the grid lines, the rail corridor cuts
 * wherever it runs, and regional routes (Sound Parkway, Inner Belt, Port Connector,
 * Dock Road, Tidal Road) are carried through on their authored alignments so the
 * district stays wired into the world graph. Dead ends are legal here — a yard stub
 * with a turnaround is how a works is actually served — but every end is a declared
 * terminal or a district gate, never a dangling centre-line.
 */
import { ROAD_WIDTH, type Point } from '../world/data';
import { SAMPLED_ROADS } from '../world/roads';
import { pointInPolygon, nearestRiver } from '../world/geometry';
import { IND_POLYGON, indGround, fromGrid, toGrid, AXIS_U, AXIS_V } from './frame';
import { ANCHORS } from './identity';
import { RAIL_LINES, RAIL_STATIONS, RAIL_CORRIDOR, lineHalfWidth, buildLevelCrossings, type LevelCrossing } from './rail';
import { convexSpan, distance2d, normalize, pointToSegment, sub } from '../city/geometry2d';

export type IndStreetKind =
  | 'haulway'    // wide truck route, four lanes
  | 'collector'  // two-lane works road
  | 'service'    // narrow warehouse road, docks and gates
  | 'yard'       // yard access stub, often dead-ended on a turnaround
  | 'boulevard'  // regional arterial carried through the district
  | 'arterial'   // gateway connector to a regional route
  | 'secondary'; // regional secondary carried through

export type IndStreetSample = { x: number; z: number; y: number; t: number; span: number };
export type TravelDirection = 0 | 1 | -1;

export type IndStreet = {
  id: string;
  name: string;
  kind: IndStreetKind;
  axis: 'u' | 'v' | 'free';
  offset?: number;
  spans: { min: number; max: number }[];
  samples: IndStreetSample[];
  length: number;
  width: number;
  shoulder: number;
  lanes: number;
  laneWidth: number;
  oneWay: TravelDirection;
  /** Signed truck route: part of the through network for heavy vehicles. */
  truck: boolean;
  loop: false;
  legacy: boolean;
  speed: number;
  /** Runs on the river terrace rather than the graded flats. */
  terrace: boolean;
};

export type IndJunctionArm = {
  streetId: string;
  t: number;
  side: 1 | -1;
  dir: Point;
  kind: IndStreetKind;
  lanes: number;
  oneWay: TravelDirection;
  entry: boolean;
  exit: boolean;
};
export type IndJunctionControl = 'signal' | 'stop' | 'yield' | 'none' | 'gateway' | 'terminal';
export type IndJunction = {
  id: string;
  point: Point;
  y: number;
  arms: IndJunctionArm[];
  streets: string[];
  control: IndJunctionControl;
  shape: 'cross' | 'tee' | 'bend' | 'terminal' | 'gateway';
  signalGroup?: string;
};
export type IndStreetEdge = {
  id: string;
  streetId: string;
  from: string;
  to: string;
  travel: TravelDirection;
  length: number;
  lanes: number;
  index: number;
};

const PROFILE: Record<IndStreetKind, { width: number; shoulder: number; lanes: number; speed: number; truck: boolean }> = {
  haulway: { width: 26, shoulder: 2.6, lanes: 4, speed: 55, truck: true },
  collector: { width: 16, shoulder: 1.9, lanes: 2, speed: 40, truck: true },
  service: { width: 11, shoulder: 1.3, lanes: 2, speed: 25, truck: true },
  yard: { width: 8.5, shoulder: 1.1, lanes: 1, speed: 15, truck: true },
  boulevard: { width: 23, shoulder: 2.4, lanes: 4, speed: 55, truck: true },
  arterial: { width: 23, shoulder: 2.4, lanes: 4, speed: 55, truck: true },
  secondary: { width: 15, shoulder: 1.8, lanes: 2, speed: 40, truck: true },
};

const SAMPLE_SPACING = 22;
const WAY_OFFSETS = [-1040, -560, -80, 400];
const ROAD_OFFSETS = [-1060, -620, -160, 300, 760, 1220];
const WAY_KIND: Record<number, IndStreetKind> = { 2: 'haulway' };           // Gantry Way
const ROAD_KIND: Record<number, IndStreetKind> = { 2: 'haulway', 4: 'haulway' }; // Foundry Rd, Haulgate Rd

function sampleLine(points: readonly Point[], spacing: number, t0 = 0): IndStreetSample[] {
  const out: IndStreetSample[] = [];
  let travelled = t0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push({ x, z, y: indGround(x, z), t: travelled + length * t, span: 0 });
    }
    travelled += length;
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z, y: indGround(last.x, last.z), t: travelled, span: 0 });
  return out;
}

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

/* ── anchor and rail corridors over grid lines ─────────────────────────────────── */

type AnchorRect = { u0: number; u1: number; v0: number; v1: number; id: string };
const ANCHOR_RECTS: AnchorRect[] = ANCHORS.map(a => ({ ...a.rect, id: a.id }));

/** Cuts an anchor or rail corridor makes in a grid line's t-space. */
function lineCuts(axis: 'u' | 'v', offset: number, half: number): { min: number; max: number }[] {
  const cuts: { min: number; max: number }[] = [];
  for (const rect of ANCHOR_RECTS) {
    const [c0, c1] = axis === 'u' ? [rect.u0, rect.u1] : [rect.v0, rect.v1];
    const [t0, t1] = axis === 'u' ? [rect.v0, rect.v1] : [rect.u0, rect.u1];
    if (offset + half > c0 && offset - half < c1) cuts.push({ min: t0 - half, max: t1 + half });
  }
  // The classification yard is a fenced rectangle of tracks: streets stop at it and
  // everything else crosses the rail on the level, declared in rail.ts. Rail lines
  // therefore do NOT cut street spans — a works district lives with level crossings.
  for (const yard of RAIL_STATIONS) {
    const gy = toGrid(yard.point);
    const c0 = axis === 'u' ? gy.u - RAIL_CORRIDOR.yard : gy.v - 330;
    const c1 = axis === 'u' ? gy.u + RAIL_CORRIDOR.yard : gy.v + 330;
    const t0 = axis === 'u' ? gy.v - 330 : gy.u - RAIL_CORRIDOR.yard;
    const t1 = axis === 'u' ? gy.v + 330 : gy.u + RAIL_CORRIDOR.yard;
    if (offset + half > c0 && offset - half < c1) cuts.push({ min: t0 - half, max: t1 + half });
  }
  return cuts;
}

/**
 * Terrain veto over a sampled centre-line: anything at river level, inside the
 * build set-back from the water edge, or steeper than a loaded truck should meet,
 * is cut out of the span list. The river owns its bank; the streets stay dry.
 */
function terrainCuts(samples: readonly IndStreetSample[], legacy: boolean): { min: number; max: number }[] {
  if (legacy) return [];
  const cuts: { min: number; max: number }[] = [];
  let run: { min: number; max: number } | null = null;
  const close = () => { if (run) { cuts.push({ min: run.min - 24, max: run.max + 24 }); run = null; } };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const river = nearestRiver(s.x, s.z);
    const nearWater = river.distance < river.width + 55;
    const lowGround = s.y < Math.max(11.5, river.level + 1.4);
    let steep = false;
    const n = samples[i + 1];
    if (n && n.span === s.span) {
      const d = Math.hypot(n.x - s.x, n.z - s.z) || 1;
      steep = Math.abs(n.y - s.y) / d > 0.095;
    }
    if (nearWater || lowGround || steep) {
      if (!run) run = { min: s.t, max: s.t };
      else run.max = s.t;
    } else close();
  }
  close();
  return cuts;
}

function makeStreet(
  id: string, name: string, kind: IndStreetKind, axis: 'u' | 'v' | 'free',
  points: Point[], spansIn: { min: number; max: number }[], offset?: number, legacy = false, t0 = 0,
  minSpan = 150,
): IndStreet {
  let spans = spansIn;
  const profile = PROFILE[kind];
  // `points` is the full centre-line; `spans` select which t-intervals of it are laid.
  const full = sampleLine(points, SAMPLE_SPACING, t0);
  const kept = spans.flatMap(span => subtract(span, terrainCuts(full, legacy)))
    .filter(span => span.max - span.min > minSpan);
  const samples: IndStreetSample[] = [];
  kept.forEach((span, index) => {
    for (const sample of full) {
      if (sample.t < span.min - 1e-6 || sample.t > span.max + 1e-6) continue;
      samples.push({ ...sample, span: index });
    }
  });
  spans = kept;
  if (!samples.length) spans = [];
  let terrace = false;
  for (let i = 0; i < samples.length; i += 4) {
    if (samples[i].y < 26) { terrace = true; break; }
  }
  return {
    id, name, kind, axis, offset, spans, samples,
    length: spans.reduce((sum, s) => sum + (s.max - s.min), 0),
    width: profile.width, shoulder: profile.shoulder, lanes: profile.lanes,
    laneWidth: profile.lanes ? profile.width / profile.lanes : 0,
    oneWay: 0, truck: profile.truck, loop: false, legacy, speed: profile.speed, terrace,
  };
}

function gridLine(axis: 'u' | 'v', offset: number, index: number, kind: IndStreetKind, name: string): IndStreet | null {
  const dir = axis === 'u' ? AXIS_V : AXIS_U;
  const at = (t: number): Point => axis === 'u' ? fromGrid(offset, t) : fromGrid(t, offset);
  const origin = at(0);
  const span = convexSpan(IND_POLYGON, origin, dir);
  if (!span) return null;
  const half = PROFILE[kind].width / 2 + PROFILE[kind].shoulder;
  const spans = subtract(span, lineCuts(axis, offset, half));
  if (!spans.length) return null;
  // Sample arc length is measured from at(span.min); t0 shifts sample t into span t-space.
  const street = makeStreet(`${axis}${index}`, name, kind, axis, [at(span.min), at(span.max)], spans, offset, false, span.min, 150);
  return street.spans.length ? street : null;
}

/* ── free-form streets ─────────────────────────────────────────────────────────── */

const RIVERSIDE_POINTS: readonly Point[] = [
  fromGrid(878, -618), fromGrid(884, -300), fromGrid(872, 60), fromGrid(852, 380),
  fromGrid(830, 640), fromGrid(792, 880), fromGrid(764, 962),
];

function freeStreets(): IndStreet[] {
  const samples = sampleLine(RIVERSIDE_POINTS, SAMPLE_SPACING);
  const street = makeStreet('riverside', 'Riverside Drive', 'collector', 'free',
    RIVERSIDE_POINTS.map(p => ({ x: p.x, z: p.z })), [{ min: 0, max: samples[samples.length - 1].t }]);
  return [street];
}

/* ── regional routes carried through ───────────────────────────────────────────── */

function legacyKind(type: string): IndStreetKind {
  if (type === 'arterial') return 'boulevard';
  if (type === 'secondary') return 'secondary';
  return 'yard';
}
const LEGACY_IDS = ['a07', 'a08', 'a21', 'a23', 'a09'];

function legacyStreets(): IndStreet[] {
  const streets: IndStreet[] = [];
  for (const sampled of SAMPLED_ROADS) {
    if (!LEGACY_IDS.includes(sampled.road.id)) continue;
    const samples = sampled.samples;
    const ins = samples.map(p => pointInPolygon(p.x, p.z, IND_POLYGON));
    const first = ins.indexOf(true), last = ins.lastIndexOf(true);
    if (first < 0 || last - first < 2) continue;
    const points: Point[] = [];
    // Extend half a sample past each end so the route meets its continuation outside
    // the district without a gap.
    if (first > 0) points.push({ x: (samples[first - 1].x + samples[first].x) / 2, z: (samples[first - 1].z + samples[first].z) / 2 });
    for (let i = first; i <= last; i++) points.push({ x: samples[i].x, z: samples[i].z });
    if (last < samples.length - 1) points.push({ x: (samples[last].x + samples[last + 1].x) / 2, z: (samples[last].z + samples[last + 1].z) / 2 });
    const line = sampleLine(points, SAMPLE_SPACING);
    if (line[line.length - 1].t < 60) continue;
    const kind = legacyKind(sampled.road.type);
    const street = makeStreet(
      `legacy-${sampled.road.id}`, sampled.road.name, kind, 'free', points,
      [{ min: 0, max: line[line.length - 1].t }], undefined, true, 0, 60,
    );
    // Regional alignments keep their outside width so the ribbon matches at the gate.
    street.width = Math.max(PROFILE[kind].width, ROAD_WIDTH[sampled.road.type as keyof typeof ROAD_WIDTH] ?? PROFILE[kind].width);
    street.laneWidth = street.width / street.lanes;
    streets.push(street);
  }
  return streets;
}

/** Snap a street end onto a nearby line so a gate never stops metres short of a road. */
function snapEnds(streets: IndStreet[]): void {
  for (const street of streets) {
    if (!street.legacy && street.id !== 'riverside') continue;
    for (const end of [0, 1] as const) {
      const samples = street.samples;
      const tip = end === 0 ? samples[0] : samples[samples.length - 1];
      const next = end === 0 ? samples[1] : samples[samples.length - 2];
      const dir = normalize(sub(tip, next));
      let best: { point: Point; distance: number } | null = null;
      for (const other of streets) {
        if (other === street) continue;
        for (let i = 0; i + 1 < other.samples.length; i++) {
          const a = other.samples[i], b = other.samples[i + 1];
          if (a.span !== b.span) continue;
          const hit = pointToSegment(tip, a, b);
          if (hit.distance > 48 || hit.distance < 1e-6) continue;
          const point = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
          // Only extend forward, never fold the centre-line back on itself.
          if ((point.x - tip.x) * dir.x + (point.z - tip.z) * dir.z < 0) continue;
          if (!best || hit.distance < best.distance) best = { point, distance: hit.distance };
        }
      }
      if (best && best.distance > 3) {
        // Re-sample the extended centre-line end to end so t stays monotonic and the
        // street's single span covers everything.
        const pts = samples.map(q => ({ x: q.x, z: q.z }));
        if (end === 0) pts.unshift(best.point); else pts.push(best.point);
        const fresh = sampleLine(pts, SAMPLE_SPACING);
        street.samples = fresh;
        street.spans = [{ min: fresh[0].t, max: fresh[fresh.length - 1].t }];
        street.length = fresh[fresh.length - 1].t - fresh[0].t;
      }
    }
  }
}

/**
 * Gates. A regional route that ends on the district limit without meeting a street
 * gets a short connector into the works grid, so no route arrives and stops dead.
 */
function gatewayConnectors(streets: readonly IndStreet[]): IndStreet[] {
  const out: IndStreet[] = [];
  for (const street of streets) {
    if (!street.legacy) continue;
    for (const end of [0, 1] as const) {
      const tip = end === 0 ? street.samples[0] : street.samples[street.samples.length - 1];
      // If the route's own tail already meets another street, the crossing junction
      // carries the gate; a connector would just double-lay pavement.
      const tail = end === 0 ? street.samples.slice(0, 6) : street.samples.slice(-6);
      const junctioned = streets.some(other => other !== street &&
        other.samples.some(q => tail.some(w => distance2d(q, w) < 26)));
      if (junctioned) continue;
      let best: { point: Point; distance: number } | null = null;
      for (const other of streets) {
        if (other === street) continue;
        for (let i = 0; i + 1 < other.samples.length; i++) {
          const a = other.samples[i], b = other.samples[i + 1];
          if (a.span !== b.span) continue;
          const hit = pointToSegment(tip, a, b);
          if (hit.distance > 320) continue;
          const point = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
          if (!best || hit.distance < best.distance) best = { point, distance: hit.distance };
        }
      }
      if (!best || best.distance < 20) continue;
      const connector = makeStreet(
        `gate-${street.id}-${out.length}`, `${street.name} Link`, 'arterial', 'free',
        [tip, best.point], [{ min: 0, max: best.distance }], undefined, false, 0, 20,
      );
      if (connector.spans.length) out.push(connector);
    }
  }
  return out;
}

/* ── superblock service roads and yard stubs ───────────────────────────────────── */

type CellKey = { u0: number; u1: number; v0: number; v1: number };
function blockedByCorridor(a: Point, b: Point, extra = 0): boolean {
  for (const rect of ANCHOR_RECTS) {
    for (const c of [a, b]) {
      const g = toGrid(c);
      if (g.u > rect.u0 - 26 - extra && g.u < rect.u1 + 26 + extra && g.v > rect.v0 - 26 - extra && g.v < rect.v1 + 26 + extra) return true;
    }
  }
  for (const line of RAIL_LINES) {
    const reach = lineHalfWidth(line) + 14 + extra;
    // Rail centre-lines are densified to ~18 m, so a vertex near the segment means
    // the candidate crosses the corridor.
    for (const q of line.points) {
      if (pointToSegment(q, a, b).distance < reach) return true;
    }
  }
  return false;
}
function insideDistrict(p: Point, margin = 34): boolean {
  if (!pointInPolygon(p.x, p.z, IND_POLYGON)) return false;
  // Keep off the boundary fence line.
  let nearest = Infinity;
  for (let i = 0; i < IND_POLYGON.length; i++) {
    nearest = Math.min(nearest, pointToSegment(p, IND_POLYGON[i], IND_POLYGON[(i + 1) % IND_POLYGON.length]).distance);
  }
  return nearest > margin;
}

let serviceCounter = 0;
function serviceStreets(): IndStreet[] {
  const out: IndStreet[] = [];
  const cells: CellKey[] = [];
  for (let i = 0; i + 1 < WAY_OFFSETS.length; i++) {
    for (let j = 0; j + 1 < ROAD_OFFSETS.length; j++) {
      cells.push({ u0: WAY_OFFSETS[i], u1: WAY_OFFSETS[i + 1], v0: ROAD_OFFSETS[j], v1: ROAD_OFFSETS[j + 1] });
    }
  }
  // The east column: between Gantry Way and the river terrace, row by row.
  for (let j = 0; j + 1 < ROAD_OFFSETS.length; j++) {
    cells.push({ u0: 400, u1: 990, v0: ROAD_OFFSETS[j], v1: ROAD_OFFSETS[j + 1] });
  }
  for (const cell of cells) {
    const du = cell.u1 - cell.u0, dv = cell.v1 - cell.v0;
    const centreU = (cell.u0 + cell.u1) / 2, centreV = (cell.v0 + cell.v1) / 2;
    const centre = fromGrid(centreU, centreV);
    if (!pointInPolygon(centre.x, centre.z, IND_POLYGON)) continue;
    const alongU = du >= dv;
    // A single service road through the middle of the superblock, ending on the two
    // bounding streets — skipped where an anchor, the rail or the district edge owns it.
    if (du > 330 && dv > 260) {
      const [a, b] = alongU
        ? [fromGrid(cell.u0, centreV), fromGrid(cell.u1, centreV)]
        : [fromGrid(centreU, cell.v0), fromGrid(centreU, cell.v1)];
      if (insideDistrict(a) && insideDistrict(b) && !blockedByCorridor(a, b)) {
        const samples = sampleLine([a, b], SAMPLE_SPACING);
        if (samples[samples.length - 1].t < 120) continue;
        const street = makeStreet(`svc${serviceCounter++}`, serviceName(cell), 'service', 'free', [a, b],
          [{ min: 0, max: samples[samples.length - 1].t }], undefined, false, 0, 120);
        out.push(street);
        continue;
      }
    }
    // Otherwise a yard stub: dead-ended on a turnaround, serving the plots it passes.
    const stubLength = alongU ? Math.min(240, du * .55) : Math.min(240, dv * .55);
    if (stubLength < 90) continue;
    const start = alongU ? fromGrid(cell.u0, centreV) : fromGrid(centreU, cell.v0);
    const end = alongU ? fromGrid(cell.u0 + stubLength, centreV) : fromGrid(centreU, cell.v0 + stubLength);
    if (!insideDistrict(end, 44) || blockedByCorridor(start, end)) continue;
    const samples = sampleLine([start, end], SAMPLE_SPACING);
    if (samples[samples.length - 1].t < 80) continue;
    const street = makeStreet(`yard${serviceCounter++}`, serviceName(cell), 'yard', 'free', [start, end],
      [{ min: 0, max: samples[samples.length - 1].t }], undefined, false, 0, 80);
    out.push(street);
  }
  return out;
}
const SERVICE_NAMES = ['Works Lane', 'Depot Lane', 'Yard Lane', 'Shed Lane', 'Belt Lane', 'Siding Lane', 'Pallet Lane', 'Drum Lane', 'Gauge Lane', 'Anvil Lane', 'Wagon Lane', 'Pier Lane'];
function serviceName(cell: CellKey): string {
  const index = Math.abs(Math.round(cell.u0 * 7 + cell.v0 * 13)) % SERVICE_NAMES.length;
  return SERVICE_NAMES[index];
}

/* ── junctions and edges ───────────────────────────────────────────────────────── */

function withinSpans(street: IndStreet, t: number): boolean {
  return street.spans.some(s => t >= s.min - 1e-6 && t <= s.max + 1e-6);
}
export function streetAt(street: IndStreet, t: number): IndStreetSample {
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
export function positionAt(street: IndStreet, t: number): Point {
  const s = streetAt(street, t);
  return { x: s.x, z: s.z };
}
export function derivativeAt(street: IndStreet, t: number): Point {
  const a = streetAt(street, Math.max(street.samples[0].t, t - 3));
  const b = streetAt(street, Math.min(street.samples[street.samples.length - 1].t, t + 3));
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type Crossing = { a: string; b: string; ta: number; tb: number; point: Point };
function crossings(a: IndStreet, b: IndStreet): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < a.samples.length - 1; i++) {
    const a0 = a.samples[i], a1 = a.samples[i + 1];
    if (a0.span !== a1.span || a1.t - a0.t < 1e-6) continue;
    const ad = { x: (a1.x - a0.x) / (a1.t - a0.t), z: (a1.z - a0.z) / (a1.t - a0.t) };
    for (let j = 0; j < b.samples.length - 1; j++) {
      const b0 = b.samples[j], b1 = b.samples[j + 1];
      if (b0.span !== b1.span || b1.t - b0.t < 1e-6) continue;
      if (Math.max(a0.x, a1.x) < Math.min(b0.x, b1.x) - 2 || Math.max(b0.x, b1.x) < Math.min(a0.x, a1.x) - 2 ||
        Math.max(a0.z, a1.z) < Math.min(b0.z, b1.z) - 2 || Math.max(b0.z, b1.z) < Math.min(a0.z, a1.z) - 2) continue;
      const bd = { x: (b1.x - b0.x) / (b1.t - b0.t), z: (b1.z - b0.z) / (b1.t - b0.t) };
      const den = ad.x * bd.z - ad.z * bd.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((b0.x - a0.x) * bd.z - (b0.z - a0.z) * bd.x) / den;
      const s = ((b0.x - a0.x) * ad.z - (b0.z - a0.z) * ad.x) / den;
      if (t < -0.5 || t > a1.t - a0.t + 0.5 || s < -0.5 || s > b1.t - b0.t + 0.5) continue;
      const ta = clamp(a0.t + t, a0.t, a1.t), tb = clamp(b0.t + s, b0.t, b1.t);
      const pa = streetAt(a, ta), pb = streetAt(b, tb);
      if (distance2d(pa, pb) > 3) continue;
      out.push({ a: a.id, b: b.id, ta, tb, point: { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 } });
    }
  }
  return out;
}

export type IndNetwork = {
  streets: IndStreet[];
  junctions: IndJunction[];
  edges: IndStreetEdge[];
  streetById: Map<string, IndStreet>;
  junctionById: Map<string, IndJunction>;
  gateways: IndJunction[];
};

function boundaryDistance(p: Point): number {
  let nearest = Infinity;
  for (let i = 0; i < IND_POLYGON.length; i++) {
    nearest = Math.min(nearest, pointToSegment(p, IND_POLYGON[i], IND_POLYGON[(i + 1) % IND_POLYGON.length]).distance);
  }
  return nearest;
}

export const IND_NETWORK: IndNetwork = (() => {
  const streets: IndStreet[] = [];
  WAY_OFFSETS.forEach((offset, index) => {
    const kind = WAY_KIND[index] ?? 'collector';
    const street = gridLine('u', offset, index, kind, ['Westworks Way', 'Bellmouth Way', 'Girderspan Way', 'Gantry Way'][index]);
    if (street) streets.push(street);
  });
  ROAD_OFFSETS.forEach((offset, index) => {
    const kind = ROAD_KIND[index] ?? 'collector';
    const street = gridLine('v', offset, index, kind, ['Cinder Road', 'Furnace Road', 'Foundry Road', 'Tanner Road', 'Haulgate Road', 'Quayside Road'][index]);
    if (street) streets.push(street);
  });
  streets.push(...freeStreets());
  const legacy = legacyStreets();
  streets.push(...legacy);
  snapEnds(streets);
  streets.push(...gatewayConnectors(streets));
  streets.push(...serviceStreets());

  const streetById = new Map(streets.map(s => [s.id, s]));

  // 1. crossings, clustered into junctions
  const raw: Crossing[] = [];
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) raw.push(...crossings(streets[i], streets[j]));
  }
  // A span end that stops against another street's flank is still a junction: the
  // regional routes converge on Works Junction without centre-lines quite intersecting.
  for (const a of streets) {
    for (const span of a.spans) {
      for (const t of [span.min, span.max]) {
        const p = positionAt(a, t);
        for (const b of streets) {
          if (b === a) continue;
          let bestHit: { distance: number; tb: number; point: Point } | null = null;
          for (let i = 0; i + 1 < b.samples.length; i++) {
            const b0 = b.samples[i], b1 = b.samples[i + 1];
            if (b0.span !== b1.span) continue;
            const hit = pointToSegment(p, b0, b1);
            if (hit.distance > b.width / 2 + b.shoulder + 8) continue;
            if (!bestHit || hit.distance < bestHit.distance) {
              bestHit = {
                distance: hit.distance,
                tb: b0.t + (b1.t - b0.t) * hit.t,
                point: { x: b0.x + (b1.x - b0.x) * hit.t, z: b0.z + (b1.z - b0.z) * hit.t },
              };
            }
          }
          if (bestHit) {
            const duplicate = raw.some(c =>
              ((c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)) &&
              Math.hypot(c.point.x - bestHit!.point.x, c.point.z - bestHit!.point.z) < 60);
            if (!duplicate) raw.push({ a: a.id, b: b.id, ta: t, tb: bestHit.tb, point: bestHit.point });
          }
        }
      }
    }
  }
  type Cluster = { point: Point; x: number; z: number; count: number; members: Crossing[] };
  const clusters: Cluster[] = [];
  for (const crossing of raw) {
    let placed = false;
    for (const cluster of clusters) {
      if (Math.hypot(cluster.x - crossing.point.x, cluster.z - crossing.point.z) > 14) continue;
      cluster.x = (cluster.x * cluster.count + crossing.point.x) / (cluster.count + 1);
      cluster.z = (cluster.z * cluster.count + crossing.point.z) / (cluster.count + 1);
      cluster.point = { x: cluster.x, z: cluster.z };
      cluster.count++;
      cluster.members.push(crossing);
      placed = true;
      break;
    }
    if (!placed) clusters.push({ point: crossing.point, x: crossing.point.x, z: crossing.point.z, count: 1, members: [crossing] });
  }
  // Converging routes produce several near-coincident crossings: weld clusters that
  // landed within arm's reach of each other into one junction.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (Math.hypot(clusters[i].x - clusters[j].x, clusters[i].z - clusters[j].z) > 26) continue;
        const keep = clusters[i], drop = clusters[j];
        const count = keep.count + drop.count;
        keep.x = (keep.x * keep.count + drop.x * drop.count) / count;
        keep.z = (keep.z * keep.count + drop.z * drop.count) / count;
        keep.point = { x: keep.x, z: keep.z };
        keep.count = count;
        keep.members.push(...drop.members);
        clusters.splice(j, 1);
        j--;
      }
    }
  }

  // A route that kinks at a district gate can cross the same street twice within a
  // few tens of metres; weld clusters spanning identical street sets into one node.
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (Math.hypot(clusters[i].x - clusters[j].x, clusters[i].z - clusters[j].z) > 60) continue;
      const setOf = (c: Cluster) => [...new Set(c.members.flatMap(m => [m.a, m.b]))].sort().join(',');
      if (setOf(clusters[i]) !== setOf(clusters[j])) continue;
      const keep = clusters[i], drop = clusters[j];
      const count = keep.count + drop.count;
      keep.x = (keep.x * keep.count + drop.x * drop.count) / count;
      keep.z = (keep.z * keep.count + drop.z * drop.count) / count;
      keep.point = { x: keep.x, z: keep.z };
      keep.count = count;
      keep.members.push(...drop.members);
      clusters.splice(j, 1);
      j--;
    }
  }

  const junctions: IndJunction[] = [];
  clusters.forEach((cluster, i) => {
    const byStreet = new Map<string, { t: number }[]>();
    for (const member of cluster.members) {
      for (const [id, t] of [[member.a, member.ta], [member.b, member.tb]] as const) {
        const list = byStreet.get(id) ?? [];
        list.push({ t });
        byStreet.set(id, list);
      }
    }
    const arms: IndJunctionArm[] = [];
    for (const [streetId, hits] of byStreet) {
      const street = streetById.get(streetId)!;
      const t = hits.reduce((sum, h) => sum + h.t, 0) / hits.length;
      const forward = derivativeAt(street, t);
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
    const vehicleArms = arms.filter(a => a.lanes > 0);
    const streetsHere = [...new Set(arms.map(a => a.streetId))];
    const laneRank = [...new Set(vehicleArms.map(a => a.streetId))]
      .map(id => streetById.get(id)!.lanes).sort((x, y) => y - x);
    const major = streetsHere.some(id => {
      const kind = streetById.get(id)!.kind;
      return kind === 'haulway' || kind === 'boulevard' || kind === 'arterial';
    });
    // Signals only where two four-lane routes really cross; the works grid otherwise
    // runs on stop and yield, and gate junctions take their control from the boundary.
    const onBoundary = boundaryDistance(cluster.point) < 40;
    const isGate = onBoundary && streetsHere.some(id => streetById.get(id)!.legacy);
    const control: IndJunctionControl =
      isGate ? 'gateway'
        : vehicleArms.length <= 1 ? 'none'
          : (laneRank[0] >= 4 && (laneRank[1] ?? 0) >= 4 && vehicleArms.length >= 4) ? 'signal'
            : major && vehicleArms.length >= 3 ? 'stop'
              : 'yield';
    const shape: IndJunction['shape'] = isGate ? 'gateway'
      : arms.length >= 4 ? 'cross' : arms.length === 3 ? 'tee' : 'bend';
    const junction: IndJunction = {
      id: `ij${i}`, point: cluster.point, y: indGround(cluster.point.x, cluster.point.z),
      arms, streets: streetsHere, control, shape,
    };
    if (junction.control === 'signal') junction.signalGroup = `isg${i}`;
    junctions.push(junction);
  });

  // 2. unclaimed street ends: gates at the district limit, terminals inside it
  let endJunctionCount = 0;
  for (const street of streets) {
    for (const span of street.spans) {
      for (const [t, end] of [[span.min, 'start'], [span.max, 'end']] as const) {
        const p = positionAt(street, t);
        const bd = boundaryDistance(p);
        // An end that lands on an existing junction never gets a twin node; if the end
        // is at the district limit, the junction it lands on IS the gate.
        const claimedBy = junctions.find(j => j.streets.includes(street.id) &&
          Math.hypot(j.point.x - p.x, j.point.z - p.z) < 40);
        if (claimedBy) {
          if (bd < 30 && claimedBy.control !== 'gateway') {
            claimedBy.control = 'gateway';
            claimedBy.shape = 'gateway';
            delete claimedBy.signalGroup;
          }
          continue;
        }
        const dir = derivativeAt(street, t);
        const arms: IndJunctionArm[] = [];
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
        // A gate is where the district's traffic leaves it: wide streets and the
        // regional routes at the limit. A lane ending on a fence is a turnaround.
        const nearBoundary = boundaryDistance(p) < 70;
        const gate = (nearBoundary && street.width >= 15) || (street.legacy && boundaryDistance(p) < 110);
        junctions.push({
          id: `ij-end-${endJunctionCount++}-${street.id}-${end}`, point: p, y: indGround(p.x, p.z),
          arms, streets: [street.id],
          control: gate ? 'gateway' : 'terminal',
          shape: gate ? 'gateway' : 'terminal',
        });
      }
    }
  }
  const junctionById = new Map<string, IndJunction>();
  for (const junction of junctions) junctionById.set(junction.id, junction);

  // 3. edges between consecutive junctions on each street span
  const edges: IndStreetEdge[] = [];
  for (const street of streets) {
    const cuts = new Map<string, number>();
    let edgeIndex = 0;
    for (const junction of junctions) {
      if (!junction.streets.includes(street.id)) continue;
      const arm = junction.arms.find(a => a.streetId === street.id);
      if (!arm) continue;
      cuts.set(junction.id, arm.t);
    }
    for (const span of street.spans) {
      const ordered = [...cuts.entries()]
        .map(([id, t]) => ({ id, t }))
        .filter(c => c.t >= span.min - 0.01 && c.t <= span.max + 0.01)
        .sort((a, b) => a.t - b.t);
      for (let i = 0; i + 1 < ordered.length; i++) {
        const start = ordered[i], finish = ordered[i + 1];
        const len = Math.abs(finish.t - start.t);
        if (len < 8) continue;
        edges.push({
          id: `${street.id}-e${edgeIndex}`, streetId: street.id, from: start.id, to: finish.id,
          travel: street.oneWay, length: len, lanes: street.lanes, index: edgeIndex,
        });
        edgeIndex++;
      }
    }
  }

  return {
    streets, junctions, edges, streetById, junctionById,
    gateways: junctions.filter(j => j.control === 'gateway'),
  };
})();

/** Declared rail/road level crossings, computed once the network exists. */
export const LEVEL_CROSSINGS: readonly LevelCrossing[] = buildLevelCrossings(IND_NETWORK.streets);

export function nearestIndStreet(x: number, z: number, streets: readonly IndStreet[] = IND_NETWORK.streets):
  { street: IndStreet; t: number; distance: number; point: Point } | null {
  let best: { street: IndStreet; t: number; distance: number; point: Point } | null = null;
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
