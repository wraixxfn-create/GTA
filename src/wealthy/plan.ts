/**
 * The Vantage Heights street network: a luxury boulevard, two winding hillside roads, a
 * scenic cliff route, a collector on the downtown-facing terrace, private drives and the
 * estate lanes inside each gated compound — plus the six regional routes carried through
 * the district on their authored alignments so the hill stays wired into the world graph.
 *
 * This is the anti-grid. Downtown is a 13° lattice of blocks; the works are a 4° lattice
 * of superblocks. Here the roads follow contours instead: hairpins on the fall line,
 * dead-ended lanes on turning circles, and three roundabouts rather than a single set of
 * traffic lights. Nothing on the hill is signalled, and the district carries a fraction of
 * downtown's traffic — that contrast is the design.
 *
 * Every dead end is a declared terminal (a turning circle or a viewpoint), and every road
 * that reaches the reservation limit does so at a declared gate.
 */
import { ROAD_WIDTH, type Point } from '../world/data';
import { SAMPLED_ROADS } from '../world/roads';
import { pointInPolygon, sampleCurve } from '../world/geometry';
import { W_POLYGON, hillGround, boundaryDistance, toGrid } from './frame';
import { LANDMARK_ESTATES, estatePolygon } from './identity';
import {
  distance2d, leftNormal, normalize, pointInPolygon as inPoly, pointToSegment, sub,
} from '../city/geometry2d';

export type StreetKind =
  | 'boulevard'   // landscaped four-lane arrival route
  | 'collector'   // two-lane distributor on the terrace
  | 'scenic'      // cliff and viewpoint road with lay-bys
  | 'ridge'       // winding hillside road, hairpins on the fall line
  | 'private'     // quiet residential drive, one address per frontage
  | 'lane'        // estate lane inside a gated compound
  | 'pedestrian'  // walk or covered mall
  | 'arterial'    // regional arterial carried through
  | 'secondary';  // regional secondary carried through

export type StreetSample = { x: number; z: number; y: number; t: number; span: number };
export type TravelDirection = 0 | 1 | -1;

export type Street = {
  id: string;
  name: string;
  kind: StreetKind;
  samples: StreetSample[];
  spans: { min: number; max: number }[];
  length: number;
  width: number;
  shoulder: number;
  /** Planted median, metres. Only the boulevard has one. */
  median: number;
  lanes: number;
  laneWidth: number;
  oneWay: TravelDirection;
  speed: number;
  /** A regional alignment carried through the district on its authored centre-line. */
  legacy: boolean;
  /** Part of the signed scenic route: gets lay-bys, viewpoint pads and balustrades. */
  scenic: boolean;
  /** Estate this street serves; drives the gate name and the fencing. */
  estate?: string;
};

export type JunctionArm = {
  streetId: string;
  t: number;
  side: 1 | -1;
  dir: Point;
  kind: StreetKind;
  lanes: number;
  oneWay: TravelDirection;
  entry: boolean;
  exit: boolean;
};
export type JunctionControl = 'roundabout' | 'stop' | 'yield' | 'none' | 'gate' | 'gateway' | 'terminal';
export type Junction = {
  id: string;
  point: Point;
  y: number;
  arms: JunctionArm[];
  streets: string[];
  control: JunctionControl;
  shape: 'cross' | 'tee' | 'bend' | 'terminal' | 'gate' | 'gateway' | 'roundabout' | 'viewpoint';
  /** Roundabout island radius, when this junction is one. */
  island?: number;
  label?: string;
};
export type StreetEdge = {
  id: string;
  streetId: string;
  from: string;
  to: string;
  travel: TravelDirection;
  length: number;
  lanes: number;
  index: number;
};

const PROFILE: Record<StreetKind, {
  width: number; shoulder: number; median: number; lanes: number; speed: number; grade: number;
}> = {
  boulevard: { width: 21, shoulder: 3.4, median: 4.2, lanes: 4, speed: 50, grade: .07 },
  collector: { width: 15, shoulder: 2.2, median: 0, lanes: 2, speed: 40, grade: .08 },
  scenic: { width: 11, shoulder: 2.6, median: 0, lanes: 2, speed: 40, grade: .10 },
  ridge: { width: 11, shoulder: 1.9, median: 0, lanes: 2, speed: 35, grade: .10 },
  private: { width: 9.5, shoulder: 1.5, median: 0, lanes: 1, speed: 25, grade: .12 },
  lane: { width: 8.5, shoulder: 1.3, median: 0, lanes: 1, speed: 20, grade: .12 },
  pedestrian: { width: 8, shoulder: 1.0, median: 0, lanes: 0, speed: 8, grade: .12 },
  arterial: { width: 22, shoulder: 2.4, median: 0, lanes: 4, speed: 55, grade: .08 },
  secondary: { width: 14, shoulder: 1.8, median: 0, lanes: 2, speed: 45, grade: .10 },
};
export const STREET_PROFILE = PROFILE;

const SAMPLE_SPACING = 18;
const CURVE_SPACING = 26;

function sampleLine(points: readonly Point[], spacing = SAMPLE_SPACING, t0 = 0): StreetSample[] {
  const out: StreetSample[] = [];
  let travelled = t0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push({ x, z, y: hillGround(x, z), t: travelled + length * t, span: 0 });
    }
    travelled += length;
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z, y: hillGround(last.x, last.z), t: travelled, span: 0 });
  return out;
}

/** Winding hillside alignments are authored as control points and smoothed, never as chords. */
function smoothLine(points: readonly Point[]): Point[] {
  return sampleCurve(points, CURVE_SPACING);
}

type StreetOptions = {
  legacy?: boolean;
  scenic?: boolean;
  estate?: string;
  width?: number;
  minSpan?: number;
  spacing?: number;
  smooth?: boolean;
};

function makeStreet(id: string, name: string, kind: StreetKind, points: readonly Point[], opts: StreetOptions = {}): Street {
  const profile = PROFILE[kind];
  const line = sampleLine(opts.smooth === false ? [...points] : smoothLine(points), opts.spacing ?? SAMPLE_SPACING);
  const spans = line.length ? [{ min: line[0].t, max: line[line.length - 1].t }] : [];
  if (spans.length && line[line.length - 1].t - line[0].t < (opts.minSpan ?? 60)) {
    return emptyStreet(id, name, kind, opts);
  }
  const width = opts.width ?? profile.width;
  return {
    id, name, kind, samples: line, spans,
    length: spans.reduce((sum, s) => sum + (s.max - s.min), 0),
    width, shoulder: profile.shoulder, median: profile.median, lanes: profile.lanes,
    laneWidth: profile.lanes ? width / profile.lanes : 0,
    oneWay: 0, speed: profile.speed,
    legacy: opts.legacy ?? false, scenic: opts.scenic ?? false, estate: opts.estate,
  };
}
function emptyStreet(id: string, name: string, kind: StreetKind, opts: StreetOptions = {}): Street {
  const profile = PROFILE[kind];
  return {
    id, name, kind, samples: [], spans: [], length: 0,
    width: opts.width ?? profile.width, shoulder: profile.shoulder, median: profile.median,
    lanes: profile.lanes, laneWidth: 0, oneWay: 0, speed: profile.speed,
    legacy: opts.legacy ?? false, scenic: opts.scenic ?? false, estate: opts.estate,
  };
}

/* ── authored alignments ──────────────────────────────────────────────────────── */

const p = (x: number, z: number): Point => ({ x, z });

/**
 * Vantage Boulevard. The arrival route: it leaves the downtown gate, climbs the east
 * terrace with the city behind it, and ends on the roundabout at the crown where every
 * regional route on the hill already meets. A planted median and a double avenue of
 * trees run its whole length.
 */
const BOULEVARD_POINTS: readonly Point[] = [
  p(-3630, 1700), p(-3420, 1764), p(-3180, 1826), p(-2930, 1866),
  p(-2690, 1854), p(-2470, 1782), p(-2300, 1710), p(-2196, 1694),
];

/** Ridge Road: the high winding road along the summit, ending on a viewpoint terrace. */
const RIDGE_POINTS: readonly Point[] = [
  p(-3630, 1700), p(-3810, 1636), p(-3990, 1548), p(-4180, 1502),
  p(-4360, 1548), p(-4470, 1682), p(-4484, 1852), p(-4400, 1988),
];

/** Serpentine Drive: hairpins down the south fall line from the crown to the club. */
const SERPENTINE_POINTS: readonly Point[] = [
  p(-3630, 1700), p(-3540, 1876), p(-3646, 2054), p(-3512, 2226),
  p(-3596, 2408), p(-3452, 2576), p(-3512, 2756), p(-3404, 2928),
];

/** Bluff Rise: the scenic cliff route, from the west gate down to the south gate. */
const BLUFF_POINTS: readonly Point[] = [
  p(-4704, 1372), p(-4648, 1596), p(-4566, 1826), p(-4524, 2074),
  p(-4424, 2296), p(-4286, 2496), p(-4126, 2696), p(-3948, 2876), p(-3780, 3040),
];

/** Marchmont Avenue: the collector on the downtown-facing terrace. */
const MARCHMONT_POINTS: readonly Point[] = [
  p(-2396, 988), p(-2310, 1196), p(-2216, 1428), p(-2164, 1662),
  p(-2186, 1900), p(-2266, 2138), p(-2400, 2378), p(-2516, 2620), p(-2558, 2860), p(-2578, 3236),
];

/** Private drives: one address per frontage, each ending on a turning circle. */
const PRIVATE_ROADS: { id: string; name: string; estate: string; points: readonly Point[] }[] = [
  { id: 'crown-lane', name: 'Crown Lane', estate: 'crown', points: [p(-3760, 1620), p(-3940, 1566), p(-4120, 1580), p(-4262, 1660)] },
  { id: 'wych-elm-lane', name: 'Wych Elm Lane', estate: 'wych-elm', points: [p(-3180, 1826), p(-3306, 2004), p(-3236, 2150), p(-3176, 2298)] },
  { id: 'ashcombe-lane', name: 'Ashcombe Lane', estate: 'ashcombe', points: [p(-2400, 2378), p(-2600, 2400), p(-2760, 2440), p(-2880, 2500)] },
  { id: 'larchmere-lane', name: 'Larchmere Lane', estate: 'larchmere', points: [p(-4424, 2296), p(-4302, 2358), p(-4176, 2470)] },
  { id: 'orchard-rise', name: 'Orchard Rise', estate: 'village', points: [p(-2516, 2620), p(-2450, 2740), p(-2430, 2860)] },
  { id: 'terrace-lane', name: 'Terrace Lane', estate: 'marchmont', points: [p(-2216, 1428), p(-2400, 1480), p(-2566, 1560), p(-2706, 1606)] },
  { id: 'kestrel-way', name: 'Kestrel Way', estate: 'wych-elm', points: [p(-3262, 2104), p(-3380, 2220), p(-3300, 2330), p(-3196, 2372)] },
  { id: 'silverbrook-lane', name: 'Silverbrook Lane', estate: 'ashcombe', points: [p(-2640, 2404), p(-2622, 2504), p(-2700, 2560)] },
];

/** Estate lanes generated inside the gated compounds: short, quiet, dead-ended. */
function estateLanes(): Street[] {
  const out: Street[] = [];
  const compounds: { id: string; points: readonly Point[]; lanes: readonly (readonly Point[])[] }[] = [
    {
      id: 'wych-elm', points: [p(-3480, 2020), p(-3120, 2060), p(-3020, 2300), p(-3300, 2460)],
      lanes: [
        [p(-3306, 2004), p(-3420, 2080), p(-3460, 2180)],
        [p(-3236, 2150), p(-3360, 2220), p(-3420, 2320)],
        [p(-3176, 2298), p(-3260, 2360), p(-3200, 2450)],
      ],
    },
    {
      id: 'ashcombe', points: [p(-2900, 2240), p(-2620, 2260), p(-2560, 2500), p(-2840, 2560)],
      lanes: [
        [p(-2600, 2400), p(-2660, 2300), p(-2790, 2280)],
        [p(-2760, 2440), p(-2820, 2340), p(-2880, 2300)],
      ],
    },
    {
      id: 'larchmere', points: [p(-4520, 2260), p(-4240, 2300), p(-4160, 2540), p(-4440, 2600)],
      lanes: [
        [p(-4302, 2358), p(-4380, 2440), p(-4460, 2480)],
        [p(-4176, 2470), p(-4280, 2520), p(-4380, 2560)],
      ],
    },
    {
      id: 'crown', points: [p(-4300, 1580), p(-3960, 1640), p(-3900, 1860), p(-4260, 1900)],
      lanes: [
        [p(-4120, 1580), p(-4180, 1680), p(-4260, 1740)],
        [p(-3940, 1566), p(-3960, 1700), p(-4040, 1800)],
      ],
    },
  ];
  let index = 0;
  for (const compound of compounds) {
    for (const points of compound.lanes) {
      const street = makeStreet(`lane-${index++}`, `${compound.id === 'wych-elm' ? 'Wych Elm' : compound.id === 'ashcombe' ? 'Ashcombe' : compound.id === 'larchmere' ? 'Larchmere' : 'Crown'} Mews`,
        'lane', points, { estate: compound.id, minSpan: 50 });
      if (street.samples.length) out.push(street);
    }
  }
  return out;
}

/** The pedestrian mall through the arcade, and the cliff-edge walk. */
function pedestrianStreets(): Street[] {
  const out: Street[] = [];
  const arcade = LANDMARK_ESTATES.find(e => e.id === 'belvedere-arcade')!;
  const poly = estatePolygon(arcade);
  // The mall runs the long axis of the arcade, between the two shop blocks.
  const a = { x: (poly[0].x + poly[1].x) / 2, z: (poly[0].z + poly[1].z) / 2 };
  const b = { x: (poly[2].x + poly[3].x) / 2, z: (poly[2].z + poly[3].z) / 2 };
  const street = makeStreet('belvedere-walk', 'Belvedere Walk', 'pedestrian', [a, b], { minSpan: 40, smooth: false });
  if (street.samples.length) out.push(street);
  const walk = makeStreet('cliff-walk', 'The Cliff Walk', 'pedestrian', [
    p(-4560, 2140), p(-4470, 2330), p(-4350, 2500), p(-4210, 2650),
  ], { scenic: true, minSpan: 60 });
  if (walk.samples.length) out.push(walk);
  return out;
}

/* ── regional routes carried through ──────────────────────────────────────────── */

function legacyKind(type: string): StreetKind {
  if (type === 'arterial') return 'arterial';
  if (type === 'secondary') return 'secondary';
  return 'lane';
}
const LEGACY_IDS = ['a03', 'a14', 'a15', 'a16', 'a17', 'r10'];

function legacyStreets(): Street[] {
  const streets: Street[] = [];
  for (const sampled of SAMPLED_ROADS) {
    if (!LEGACY_IDS.includes(sampled.road.id)) continue;
    const samples = sampled.samples;
    const inside = samples.map(q => pointInPolygon(q.x, q.z, W_POLYGON));
    // A route can clip a corner of the reservation; keep the longest run inside it.
    let bestStart = -1, bestEnd = -1, runStart = -1;
    for (let i = 0; i < inside.length; i++) {
      if (inside[i] && runStart < 0) runStart = i;
      if ((!inside[i] || i === inside.length - 1) && runStart >= 0) {
        const end = inside[i] ? i : i - 1;
        if (end - runStart > bestEnd - bestStart) { bestStart = runStart; bestEnd = end; }
        runStart = -1;
      }
    }
    if (bestStart < 0 || bestEnd - bestStart < 2) continue;
    const points: Point[] = [];
    // Extend half a sample past each end so the route meets its continuation outside the
    // reservation without a gap or a step.
    if (bestStart > 0) points.push({ x: (samples[bestStart - 1].x + samples[bestStart].x) / 2, z: (samples[bestStart - 1].z + samples[bestStart].z) / 2 });
    for (let i = bestStart; i <= bestEnd; i++) points.push({ x: samples[i].x, z: samples[i].z });
    if (bestEnd < samples.length - 1) points.push({ x: (samples[bestEnd].x + samples[bestEnd + 1].x) / 2, z: (samples[bestEnd].z + samples[bestEnd + 1].z) / 2 });
    const line = sampleLine(points, SAMPLE_SPACING);
    if (line[line.length - 1].t < 60) continue;
    const kind = legacyKind(sampled.road.type);
    const street: Street = {
      id: `legacy-${sampled.road.id}`, name: sampled.road.name, kind,
      samples: line, spans: [{ min: line[0].t, max: line[line.length - 1].t }],
      length: line[line.length - 1].t - line[0].t,
      // Regional alignments keep their outside width so the ribbon matches at the gate.
      width: Math.max(PROFILE[kind].width, ROAD_WIDTH[sampled.road.type as keyof typeof ROAD_WIDTH] ?? PROFILE[kind].width),
      shoulder: PROFILE[kind].shoulder, median: 0, lanes: PROFILE[kind].lanes,
      laneWidth: 0, oneWay: 0, speed: PROFILE[kind].speed, legacy: true, scenic: false,
    };
    street.laneWidth = street.width / street.lanes;
    streets.push(street);
  }
  return streets;
}

/**
 * Snap a street end onto a nearby centre-line so a gate or a turning circle never stops
 * metres short of the road it is meant to meet. Private drives and estate lanes are
 * authored to within a few tens of metres of their parent road; this closes the gap and
 * re-samples so `t` stays monotonic across a single span.
 */
function snapEnds(streets: Street[]): void {
  const SNAP = 90;
  for (const street of streets) {
    if (street.legacy || street.kind === 'pedestrian') continue;
    for (const end of [0, 1] as const) {
      const samples = street.samples;
      if (samples.length < 2) continue;
      const tip = end === 0 ? samples[0] : samples[samples.length - 1];
      const next = end === 0 ? samples[1] : samples[samples.length - 2];
      const dir = normalize(sub(tip, next));
      let best: { point: Point; distance: number } | null = null;
      for (const other of streets) {
        if (other === street || !other.samples.length) continue;
        for (let i = 0; i + 1 < other.samples.length; i++) {
          const a = other.samples[i], b = other.samples[i + 1];
          if (a.span !== b.span) continue;
          const hit = pointToSegment(tip, a, b);
          if (hit.distance > SNAP || hit.distance < 1e-6) continue;
          const point = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
          // Only extend forward, never fold the centre-line back on itself.
          if ((point.x - tip.x) * dir.x + (point.z - tip.z) * dir.z < 0) continue;
          if (!best || hit.distance < best.distance) best = { point, distance: hit.distance };
        }
      }
      if (!best || best.distance < 4) continue;
      const points = samples.map(q => ({ x: q.x, z: q.z }));
      if (end === 0) points.unshift(best.point); else points.push(best.point);
      const fresh = sampleLine(points, SAMPLE_SPACING);
      street.samples = fresh;
      street.spans = [{ min: fresh[0].t, max: fresh[fresh.length - 1].t }];
      street.length = fresh[fresh.length - 1].t - fresh[0].t;
    }
  }
}

/* ── sampling helpers ─────────────────────────────────────────────────────────── */

function withinSpans(street: Street, t: number): boolean {
  return street.spans.some(s => t >= s.min - 1e-6 && t <= s.max + 1e-6);
}
export function streetAt(street: Street, t: number): StreetSample {
  const samples = street.samples;
  if (!samples.length) return { x: 0, z: 0, y: 0, t, span: 0 };
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
  if (!street.samples.length) return { x: 1, z: 0 };
  const a = streetAt(street, Math.max(street.samples[0].t, t - 3));
  const b = streetAt(street, Math.min(street.samples[street.samples.length - 1].t, t + 3));
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* ── the network ──────────────────────────────────────────────────────────────── */

export type Network = {
  streets: Street[];
  junctions: Junction[];
  edges: StreetEdge[];
  streetById: Map<string, Street>;
  junctionById: Map<string, Junction>;
  gateways: Junction[];
  estateGates: Junction[];
  roundabouts: Junction[];
  viewpoints: Junction[];
};

type Crossing = { a: string; b: string; ta: number; tb: number; point: Point };

function crossings(a: Street, b: Street): Crossing[] {
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

/** Authored roundabouts: three on the hill, and not one set of traffic lights. */
const ROUNDABOUTS: { id: string; label: string; point: Point; island: number }[] = [
  { id: 'rb-crown', label: 'Crown Roundabout', point: p(-3630, 1700), island: 21 },
  { id: 'rb-marchmont', label: 'Marchmont Circus', point: p(-2196, 1694), island: 16 },
  { id: 'rb-village', label: 'Belvedere Circus', point: p(-2516, 2620), island: 14 },
];

export const W_NETWORK: Network = (() => {
  const streets: Street[] = [];
  streets.push(makeStreet('boulevard', 'Vantage Boulevard', 'boulevard', BOULEVARD_POINTS));
  streets.push(makeStreet('ridge-road', 'Ridge Road', 'ridge', RIDGE_POINTS, { scenic: true }));
  streets.push(makeStreet('serpentine', 'Serpentine Drive', 'ridge', SERPENTINE_POINTS));
  streets.push(makeStreet('bluff-rise', 'Bluff Rise', 'scenic', BLUFF_POINTS, { scenic: true, estate: 'larchmere' }));
  streets.push(makeStreet('marchmont', 'Marchmont Avenue', 'collector', MARCHMONT_POINTS, { estate: 'marchmont' }));
  for (const road of PRIVATE_ROADS) {
    streets.push(makeStreet(road.id, road.name, 'private', road.points, { estate: road.estate, minSpan: 60 }));
  }
  streets.push(...estateLanes());
  streets.push(...pedestrianStreets());
  streets.push(...legacyStreets());
  snapEnds(streets);

  const live = streets.filter(s => s.samples.length > 1);
  const streetById = new Map(live.map(s => [s.id, s]));

  /* 1. crossings, clustered into junctions */
  const raw: Crossing[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) raw.push(...crossings(live[i], live[j]));
  }
  // A span end that stops against another street's flank is still a junction: the
  // regional routes converge on the crown without their centre-lines quite intersecting.
  for (const a of live) {
    for (const span of a.spans) {
      for (const t of [span.min, span.max]) {
        const q = positionAt(a, t);
        for (const b of live) {
          if (b === a) continue;
          let bestHit: { distance: number; tb: number; point: Point } | null = null;
          for (let i = 0; i + 1 < b.samples.length; i++) {
            const b0 = b.samples[i], b1 = b.samples[i + 1];
            if (b0.span !== b1.span) continue;
            const hit = pointToSegment(q, b0, b1);
            if (hit.distance > b.width / 2 + b.shoulder + 8) continue;
            if (!bestHit || hit.distance < bestHit.distance) {
              bestHit = {
                distance: hit.distance, tb: b0.t + (b1.t - b0.t) * hit.t,
                point: { x: b0.x + (b1.x - b0.x) * hit.t, z: b0.z + (b1.z - b0.z) * hit.t },
              };
            }
          }
          if (!bestHit) continue;
          const duplicate = raw.some(c =>
            ((c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)) &&
            Math.hypot(c.point.x - bestHit!.point.x, c.point.z - bestHit!.point.z) < 55);
          if (!duplicate) raw.push({ a: a.id, b: b.id, ta: t, tb: bestHit.tb, point: bestHit.point });
        }
      }
    }
  }
  type Cluster = { point: Point; x: number; z: number; count: number; members: Crossing[] };
  const clusters: Cluster[] = [];
  for (const crossing of raw) {
    let placed = false;
    for (const cluster of clusters) {
      if (Math.hypot(cluster.x - crossing.point.x, cluster.z - crossing.point.z) > 16) continue;
      cluster.x = (cluster.x * cluster.count + crossing.point.x) / (cluster.count + 1);
      cluster.z = (cluster.z * cluster.count + crossing.point.z) / (cluster.count + 1);
      cluster.point = { x: cluster.x, z: cluster.z };
      cluster.count++; cluster.members.push(crossing);
      placed = true; break;
    }
    if (!placed) clusters.push({ point: { ...crossing.point }, x: crossing.point.x, z: crossing.point.z, count: 1, members: [crossing] });
  }

  const junctions: Junction[] = [];
  clusters.forEach((cluster, index) => {
    const arms: JunctionArm[] = [];
    const streetIds = new Set<string>();
    for (const member of cluster.members) streetIds.add(member.a), streetIds.add(member.b);
    for (const streetId of streetIds) {
      const street = streetById.get(streetId);
      if (!street) continue;
      let best: { t: number; distance: number } | null = null;
      for (const member of cluster.members) {
        const t = member.a === streetId ? member.ta : member.b === streetId ? member.tb : null;
        if (t === null) continue;
        const q = positionAt(street, t);
        const distance = Math.hypot(q.x - cluster.x, q.z - cluster.z);
        if (!best || distance < best.distance) best = { t, distance };
      }
      if (!best) continue;
      const t = best.t;
      const dir = derivativeAt(street, t);
      for (const side of [1, -1] as const) {
        if (!withinSpans(street, t + side * 1.5)) continue;
        arms.push({
          streetId, t, side, dir: { x: dir.x * side, z: dir.z * side },
          kind: street.kind, lanes: street.lanes, oneWay: street.oneWay,
          entry: street.oneWay === 0 || street.oneWay === -side,
          exit: street.oneWay === 0 || street.oneWay === side,
        });
      }
    }
    if (arms.length < 2) return;
    const wide = arms.filter(a => a.kind === 'boulevard' || a.kind === 'arterial' || a.kind === 'collector').length;
    // An estate lane meeting a through road is a gate: the compound's only entrance.
    const gated = arms.some(a => a.kind === 'lane') && arms.some(a => a.kind !== 'lane' && a.kind !== 'pedestrian');
    const control: JunctionControl = gated ? 'gate' : wide >= 2 ? 'yield' : arms.length > 2 ? 'yield' : 'none';
    junctions.push({
      id: `wj-${index}`, point: cluster.point, y: hillGround(cluster.point.x, cluster.point.z),
      arms, streets: [...streetIds], control,
      shape: gated ? 'gate' : arms.length >= 4 ? 'cross' : arms.length === 3 ? 'tee' : 'bend',
      label: gated ? 'Estate Gate' : undefined,
    });
  });

  /* 2. roundabouts replace the signals this district does not have */
  for (const rb of ROUNDABOUTS) {
    const arms: JunctionArm[] = [];
    const streetIds = new Set<string>();
    for (const street of live) {
      let best: { t: number; distance: number } | null = null;
      for (const sample of street.samples) {
        const d = Math.hypot(sample.x - rb.point.x, sample.z - rb.point.z);
        if (d > rb.island + street.width / 2 + street.shoulder + 26) continue;
        if (!best || d < best.distance) best = { t: sample.t, distance: d };
      }
      if (!best) continue;
      streetIds.add(street.id);
      const t = best.t;
      const dir = derivativeAt(street, t);
      for (const side of [1, -1] as const) {
        if (!withinSpans(street, t + side * 1.5)) continue;
        arms.push({
          streetId: street.id, t, side, dir: { x: dir.x * side, z: dir.z * side },
          kind: street.kind, lanes: street.lanes, oneWay: street.oneWay,
          entry: street.oneWay === 0 || street.oneWay === -side,
          exit: street.oneWay === 0 || street.oneWay === side,
        });
      }
    }
    if (arms.length < 3) continue;
    // The roundabout supersedes any crossing junction on its island.
    for (let i = junctions.length - 1; i >= 0; i--) {
      if (Math.hypot(junctions[i].point.x - rb.point.x, junctions[i].point.z - rb.point.z) < rb.island + 34) {
        junctions.splice(i, 1);
      }
    }
    junctions.push({
      id: rb.id, point: rb.point, y: hillGround(rb.point.x, rb.point.z),
      arms, streets: [...streetIds], control: 'roundabout', shape: 'roundabout',
      island: rb.island, label: rb.label,
    });
  }

  /* 3. unclaimed street ends: gates at the limit, viewpoints and turning circles inside */
  let endCount = 0;
  for (const street of live) {
    for (const span of street.spans) {
      for (const [t, end] of [[span.min, 'start'], [span.max, 'end']] as const) {
        const q = positionAt(street, t);
        const bd = boundaryDistance(q);
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
        // An end that lands on an existing node joins it instead of growing a twin:
        // two regional routes meeting on the limit are one gate, not two.
        const claimedBy = junctions.find(j => Math.hypot(j.point.x - q.x, j.point.z - q.z) < 42);
        if (claimedBy) {
          if (!claimedBy.streets.includes(street.id)) {
            claimedBy.arms.push(...arms);
            claimedBy.streets.push(street.id);
          }
          if (bd < 70 && claimedBy.control !== 'gateway' && claimedBy.control !== 'roundabout') {
            claimedBy.control = 'gateway';
            claimedBy.shape = 'gateway';
            claimedBy.label = 'District Gate';
          }
          continue;
        }
        const gate = bd < 70 && street.width >= 9;
        const viewpoint = street.scenic && bd > 120;
        junctions.push({
          id: `wj-end-${endCount++}-${street.id}-${end}`, point: q, y: hillGround(q.x, q.z),
          arms, streets: [street.id],
          control: gate ? 'gateway' : 'terminal',
          shape: gate ? 'gateway' : viewpoint ? 'viewpoint' : 'terminal',
          label: gate ? 'District Gate' : viewpoint ? 'Viewpoint' : undefined,
        });
      }
    }
  }
  const junctionById = new Map<string, Junction>();
  for (const junction of junctions) junctionById.set(junction.id, junction);

  /* 4. edges between consecutive junctions on each street span */
  const edges: StreetEdge[] = [];
  for (const street of live) {
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
        if (len < 6) continue;
        edges.push({
          id: `${street.id}-e${edgeIndex}`, streetId: street.id, from: start.id, to: finish.id,
          travel: street.oneWay, length: len, lanes: street.lanes, index: edgeIndex,
        });
        edgeIndex++;
      }
    }
  }

  return {
    streets: live, junctions, edges, streetById, junctionById,
    gateways: junctions.filter(j => j.control === 'gateway'),
    estateGates: junctions.filter(j => j.control === 'gate'),
    roundabouts: junctions.filter(j => j.control === 'roundabout'),
    viewpoints: junctions.filter(j => j.shape === 'viewpoint'),
  };
})();

/** Worst sampled grade per street, for the road audit. */
export function streetGrade(street: Street): { max: number; at: Point } {
  let max = 0, at: Point = { x: 0, z: 0 };
  for (let i = 0; i + 1 < street.samples.length; i++) {
    const a = street.samples[i], b = street.samples[i + 1];
    if (a.span !== b.span) continue;
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const g = Math.abs(b.y - a.y) / d;
    if (g > max) { max = g; at = { x: a.x, z: a.z }; }
  }
  return { max, at };
}

export function nearestStreet(x: number, z: number, streets: readonly Street[] = W_NETWORK.streets):
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

/** Corridor test used by the plot layout and the building audit. */
export function insideStreetCorridor(q: Point, margin = 0, streets: readonly Street[] = W_NETWORK.streets): boolean {
  for (const street of streets) {
    if (street.kind === 'pedestrian') continue;
    const reach = street.width / 2 + street.shoulder + street.median / 2 + margin;
    for (let i = 0; i < street.samples.length - 1; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (pointToSegment(q, a, b).distance < reach) return true;
    }
  }
  return false;
}

/** The estate survey frame, exported for plot subdivision and the atlas. */
export function estateFrame(estateId: string): Point[] | null {
  const estate = LANDMARK_ESTATES.find(e => e.id === estateId);
  return estate ? estatePolygon(estate) : null;
}
export function gridOf(q: Point): { u: number; v: number } { return toGrid(q); }
export function streetNormal(street: Street, t: number): Point {
  return leftNormal(derivativeAt(street, t));
}
export function streetDirection(street: Street, t: number): Point { return derivativeAt(street, t); }
export { normalize, sub, inPoly };
