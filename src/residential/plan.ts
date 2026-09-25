/**
 * The Residential Valley street network: two main roads, four collectors, the local
 * streets of eight different neighbourhoods, the service alleys behind the high street,
 * and the six regional routes carried through the district on their authored
 * alignments so the valley stays wired into the world graph.
 *
 * This is the working-class counterpart to the hillside's anti-grid and the works'
 * superblocks. Millgate is a walkable core of short blocks around the mill crossroads;
 * Chapel Fields is long Victorian terrace strips; Willowbank bends with the contour in
 * interwar semis; Rosecourt is a postwar estate stepped around its flats; Larkspur and
 * Orchard Close are 1990s cul-de-sacs with turning circles; Beechwood curves; Sunnybank
 * is the school quarter. Every dead end is a declared turning circle and every street
 * that reaches the reservation limit does so at a declared gate.
 */
import { ROAD_WIDTH, type Point } from '../world/data';
import { SAMPLED_ROADS } from '../world/roads';
import { pointInPolygon, nearestRiver } from '../world/geometry';
import { RES_POLYGON, resGround, boundaryDistance } from './frame';
import { distance2d, leftNormal, normalize, pointToSegment, sub } from '../city/geometry2d';

export type StreetKind =
  | 'arterial'    // main road through the valley: two lanes each way, parking, trees
  | 'collector'   // neighbourhood distributor: two lanes, parking
  | 'local'       // ordinary residential street
  | 'terrace'     // narrow Victorian terrace street, parked cars both sides
  | 'close'       // 1990s cul-de-sac, ends on a turning circle
  | 'alley'       // service alley behind the shopfronts
  | 'pedestrian'  // park path or shopping walk
  | 'legacy';     // regional arterial/secondary carried through

export type StreetSample = { x: number; z: number; y: number; t: number };
export type TravelDirection = 0 | 1 | -1;

export type Street = {
  id: string;
  name: string;
  kind: StreetKind;
  samples: StreetSample[];
  spans: { min: number; max: number }[];
  length: number;
  width: number;
  sidewalk: number;
  lanes: number;
  laneWidth: number;
  oneWay: TravelDirection;
  speed: number;
  /** Kerbside parking is the valley's default: terraces and locals carry it. */
  parking: boolean;
  legacy: boolean;
  /** A regional alignment carried through the district on its authored centre-line. */
  hood?: string;
};

export type JunctionArm = {
  streetId: string;
  t: number;
  side: 1 | -1;
  dir: Point;
  kind: StreetKind;
  lanes: number;
  oneWay: TravelDirection;
};
export type JunctionControl = 'signal' | 'stop' | 'yield' | 'none' | 'gate' | 'gateway' | 'terminal' | 'turning-circle';
export type Junction = {
  id: string;
  point: Point;
  y: number;
  arms: JunctionArm[];
  streets: string[];
  control: JunctionControl;
  shape: 'cross' | 'tee' | 'bend' | 'terminal' | 'gate' | 'gateway' | 'turning-circle';
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

const PROFILE: Record<StreetKind, { width: number; sidewalk: number; lanes: number; speed: number; parking: boolean }> = {
  arterial: { width: 14, sidewalk: 3.2, lanes: 4, speed: 50, parking: true },
  collector: { width: 10, sidewalk: 2.6, lanes: 2, speed: 40, parking: true },
  local: { width: 8.5, sidewalk: 2.2, lanes: 2, speed: 30, parking: true },
  terrace: { width: 7, sidewalk: 1.8, lanes: 1, speed: 25, parking: true },
  close: { width: 7, sidewalk: 1.8, lanes: 1, speed: 20, parking: true },
  alley: { width: 5, sidewalk: 0, lanes: 1, speed: 15, parking: false },
  pedestrian: { width: 3.5, sidewalk: 0, lanes: 0, speed: 8, parking: false },
  legacy: { width: 12, sidewalk: 2.4, lanes: 2, speed: 55, parking: false },
};

const SAMPLE_SPACING = 14;

function sampleLine(points: readonly Point[], t0 = 0): StreetSample[] {
  const out: StreetSample[] = [];
  let travelled = t0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_SPACING));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      out.push({ x, z, y: resGround(x, z), t: travelled + length * t });
    }
    travelled += length;
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z, y: resGround(last.x, last.z), t: travelled });
  return out;
}

/** Terrain veto: the valley is graded, but the river bank still owns its edge. */
function trimToTerrain(samples: StreetSample[]): StreetSample[] {
  return samples.filter(s => {
    const river = nearestRiver(s.x, s.z);
    return river.distance > river.width + 30 && s.y > river.level + 1;
  });
}

type StreetOptions = { legacy?: boolean; width?: number; parking?: boolean; minSpan?: number; hood?: string };

function makeStreet(id: string, name: string, kind: StreetKind, points: readonly Point[], opts: StreetOptions = {}): Street {
  const profile = PROFILE[kind];
  let line = sampleLine(points);
  if (kind !== 'legacy' && kind !== 'pedestrian') line = trimToTerrain(line);
  const spans = line.length ? [{ min: line[0].t, max: line[line.length - 1].t }] : [];
  if (spans.length && line[line.length - 1].t - line[0].t < (opts.minSpan ?? 40)) {
    return emptyStreet(id, name, kind, opts);
  }
  const width = opts.width ?? profile.width;
  return {
    id, name, kind, samples: line, spans,
    length: spans.reduce((sum, s) => sum + (s.max - s.min), 0),
    width, sidewalk: profile.sidewalk, lanes: profile.lanes,
    laneWidth: profile.lanes ? width / profile.lanes : 0,
    oneWay: 0, speed: profile.speed,
    parking: opts.parking ?? profile.parking,
    legacy: opts.legacy ?? false, hood: opts.hood,
  };
}
function emptyStreet(id: string, name: string, kind: StreetKind, opts: StreetOptions = {}): Street {
  const profile = PROFILE[kind];
  const width = opts.width ?? profile.width;
  return {
    id, name, kind, samples: [], spans: [], length: 0,
    width, sidewalk: profile.sidewalk, lanes: profile.lanes,
    laneWidth: 0, oneWay: 0, speed: profile.speed,
    parking: opts.parking ?? profile.parking,
    legacy: opts.legacy ?? false, hood: opts.hood,
  };
}

const p = (x: number, z: number): Point => ({ x, z });

/* ── authored alignments ──────────────────────────────────────────────────────── */

/** Grand Valley Road: the east–west spine of the valley, lined with trees and parking. */
const GRAND_VALLEY: readonly Point[] = [
  p(-2520, -1385), p(-2050, -1420), p(-1550, -1460), p(-1050, -1520),
  p(-750, -1560), p(-350, -1600), p(150, -1640), p(550, -1620), p(735, -1580),
];

/** Mill Street: the north–south spine past the old mill crossroads. */
const MILL_ST: readonly Point[] = [
  p(-560, -2810), p(-640, -2400), p(-700, -2000), p(-750, -1560),
  p(-760, -1150), p(-720, -750), p(-680, -430),
];

/** Collectors. */
const CHAPEL_LANE: readonly Point[] = [p(-2420, -1880), p(-1950, -1860), p(-1450, -1900), p(-1000, -1950), p(-700, -1980)];
const BROOK_LANE: readonly Point[] = [p(-1850, -750), p(-1450, -720), p(-1050, -700), p(-720, -680), p(-350, -660), p(50, -640), p(450, -620), p(650, -640)];
const MAPLE_WAY: readonly Point[] = [p(350, -2350), p(320, -1950), p(300, -1550), p(300, -1150), p(320, -750), p(350, -550)];
const QUARRY_ROAD: readonly Point[] = [p(-2280, -1520), p(-2300, -1900), p(-2320, -2300), p(-2300, -2620)];

/** Millgate: the walkable core grid between Brook Lane and the freeway. */
const SLATE_ST: readonly Point[] = [p(-1300, -580), p(-1305, -900), p(-1310, -1240)];
const WEAVER_ST: readonly Point[] = [p(-1080, -1250), p(-1065, -1560), p(-1055, -1880)];
const COOPER_ST: readonly Point[] = [p(-450, -580), p(-445, -900), p(-440, -1240)];
const FYFE_ST: readonly Point[] = [p(-1305, -1245), p(-1060, -1250), p(-750, -1255), p(-440, -1248)];
const BAKERS_LANE: readonly Point[] = [p(-1055, -1885), p(-750, -1895), p(-445, -1888)];
const MARKET_ROW: readonly Point[] = [p(-1300, -760), p(-1050, -750), p(-750, -745), p(-450, -750)];

/** Chapel Fields: Victorian terrace strips. */
const ALMA_TCE: readonly Point[] = [p(-2420, -1555), p(-2050, -1565), p(-1720, -1585)];
const CRANMER_TCE: readonly Point[] = [p(-2405, -1805), p(-2050, -1815), p(-1725, -1835)];
const WESLEY_TCE: readonly Point[] = [p(-2385, -2055), p(-2050, -2065), p(-1730, -2085)];
const CHAPEL_ROW: readonly Point[] = [p(-2150, -1525), p(-2135, -1855), p(-2120, -2160)];
const FRIAR_ST: readonly Point[] = [p(-1830, -1545), p(-1815, -1865), p(-1800, -2185)];

/** Willowbank: interwar semis on a crescent and two closes. */
const WILLOW_CRESCENT: readonly Point[] = [p(-850, -2255), p(-1050, -2325), p(-1350, -2355), p(-1600, -2325), p(-1755, -2255)];
const WILLOW_CLOSE: readonly Point[] = [p(-1250, -2405), p(-1285, -2555), p(-1355, -2655)];
const ORCHARD_CLOSE: readonly Point[] = [p(-960, -2455), p(-925, -2605), p(-855, -2685)];

/** Rosecourt: the postwar estate around the landmark flats. */
const ROSECOURT_WAY: readonly Point[] = [p(-700, -2355), p(-450, -2335), p(-200, -2355), p(60, -2385)];
const FELL_WAY: readonly Point[] = [p(-500, -2285), p(-485, -2555), p(-465, -2760)];

/** Larkspur: the 1990s estate, one drive and two closes. */
const LARKSPUR_DRIVE: readonly Point[] = [p(255, -2105), p(355, -2255), p(455, -2455), p(555, -2605), p(655, -2685)];
const SPARROW_CLOSE: readonly Point[] = [p(385, -2355), p(305, -2425), p(255, -2525)];
const KESTREL_CLOSE: readonly Point[] = [p(525, -2525), p(605, -2455), p(685, -2405)];

/** Beechwood: the curvy interwar estate in the east. */
const BEECHWOOD_RISE: readonly Point[] = [p(255, -1255), p(355, -1405), p(455, -1555), p(555, -1705), p(605, -1885)];
const ELM_ROAD: readonly Point[] = [p(155, -1355), p(235, -1505), p(325, -1655), p(385, -1825)];

/** Sunnybank: the school quarter. */
const SCHOOL_ST: readonly Point[] = [p(-355, -955), p(55, -935), p(355, -905), p(605, -925)];
const SUNNYBANK_CLOSE: readonly Point[] = [p(105, -1055), p(55, -1155), p(-45, -1215)];

/** Service alleys behind the shopfronts and through the core blocks. */
const MARKET_ALLEY: readonly Point[] = [p(-1295, -870), p(-1050, -865), p(-750, -862), p(-455, -868)];
const MILL_ALLEY: readonly Point[] = [p(-905, -1085), p(-895, -1420), p(-888, -1785)];
const COOPER_ALLEY: readonly Point[] = [p(-600, -600), p(-595, -900), p(-590, -1235)];
const ALMA_MEWS: readonly Point[] = [p(-2415, -1680), p(-2050, -1690), p(-1722, -1708)];
const CRANMER_MEWS: readonly Point[] = [p(-2398, -1930), p(-2050, -1940), p(-1728, -1958)];
const BAKERS_CUT: readonly Point[] = [p(-1058, -1720), p(-750, -1728), p(-448, -1718)];

/** Park paths through Mill Green. */
const GREEN_PATH_W: readonly Point[] = [p(-1545, -1660), p(-1400, -1850), p(-1180, -2040)];
const GREEN_PATH_E: readonly Point[] = [p(-1180, -1660), p(-1310, -1850), p(-1178, -2040)];

type AuthoredStreet = { id: string; name: string; kind: StreetKind; points: readonly Point[]; hood?: string; opts?: StreetOptions };
const AUTHORED: readonly AuthoredStreet[] = [
  { id: 'grand-valley', name: 'Grand Valley Road', kind: 'arterial', points: GRAND_VALLEY, hood: 'millgate' },
  { id: 'mill-st', name: 'Mill Street', kind: 'arterial', points: MILL_ST, hood: 'millgate' },
  { id: 'chapel-lane', name: 'Chapel Lane', kind: 'collector', points: CHAPEL_LANE, hood: 'chapel-fields' },
  { id: 'brook-lane', name: 'Brook Lane', kind: 'collector', points: BROOK_LANE, hood: 'millgate' },
  { id: 'maple-way', name: 'Maple Way', kind: 'collector', points: MAPLE_WAY, hood: 'beechwood' },
  { id: 'quarry-road', name: 'Quarry Road', kind: 'collector', points: QUARRY_ROAD, hood: 'chapel-fields' },
  // Millgate core
  { id: 'slate-st', name: 'Slate Street', kind: 'local', points: SLATE_ST, hood: 'millgate' },
  { id: 'weaver-st', name: 'Weaver Street', kind: 'local', points: WEAVER_ST, hood: 'millgate' },
  { id: 'cooper-st', name: 'Cooper Street', kind: 'local', points: COOPER_ST, hood: 'millgate' },
  { id: 'fyfe-st', name: 'Fyfe Street', kind: 'local', points: FYFE_ST, hood: 'millgate' },
  { id: 'bakers-lane', name: 'Bakers Lane', kind: 'local', points: BAKERS_LANE, hood: 'millgate' },
  { id: 'market-row', name: 'Market Row', kind: 'collector', points: MARKET_ROW, hood: 'millgate' },
  // Chapel Fields
  { id: 'alma-tce', name: 'Alma Terrace', kind: 'terrace', points: ALMA_TCE, hood: 'chapel-fields' },
  { id: 'cranmer-tce', name: 'Cranmer Terrace', kind: 'terrace', points: CRANMER_TCE, hood: 'chapel-fields' },
  { id: 'wesley-tce', name: 'Wesley Terrace', kind: 'terrace', points: WESLEY_TCE, hood: 'chapel-fields' },
  { id: 'chapel-row', name: 'Chapel Row', kind: 'local', points: CHAPEL_ROW, hood: 'chapel-fields' },
  { id: 'friar-st', name: 'Friar Street', kind: 'local', points: FRIAR_ST, hood: 'chapel-fields' },
  // Willowbank
  { id: 'willow-crescent', name: 'Willow Crescent', kind: 'local', points: WILLOW_CRESCENT, hood: 'willowbank' },
  { id: 'willow-close', name: 'Willow Close', kind: 'close', points: WILLOW_CLOSE, hood: 'willowbank' },
  { id: 'orchard-close', name: 'Orchard Close', kind: 'close', points: ORCHARD_CLOSE, hood: 'willowbank' },
  // Rosecourt
  { id: 'rosecourt-way', name: 'Rosecourt Way', kind: 'local', points: ROSECOURT_WAY, hood: 'rosecourt' },
  { id: 'fell-way', name: 'Fell Way', kind: 'local', points: FELL_WAY, hood: 'rosecourt' },
  // Larkspur
  { id: 'larkspur-drive', name: 'Larkspur Drive', kind: 'local', points: LARKSPUR_DRIVE, hood: 'larkspur' },
  { id: 'sparrow-close', name: 'Sparrow Close', kind: 'close', points: SPARROW_CLOSE, hood: 'larkspur' },
  { id: 'kestrel-close', name: 'Kestrel Close', kind: 'close', points: KESTREL_CLOSE, hood: 'larkspur' },
  // Beechwood
  { id: 'beechwood-rise', name: 'Beechwood Rise', kind: 'local', points: BEECHWOOD_RISE, hood: 'beechwood' },
  { id: 'elm-road', name: 'Elm Road', kind: 'local', points: ELM_ROAD, hood: 'beechwood' },
  // Sunnybank
  { id: 'school-st', name: 'School Street', kind: 'local', points: SCHOOL_ST, hood: 'sunnybank' },
  { id: 'sunnybank-close', name: 'Sunnybank Close', kind: 'close', points: SUNNYBANK_CLOSE, hood: 'sunnybank' },
  // Alleys and paths
  { id: 'market-alley', name: 'Market Alley', kind: 'alley', points: MARKET_ALLEY, opts: { minSpan: 30 } },
  { id: 'mill-alley', name: 'Mill Lane', kind: 'alley', points: MILL_ALLEY, opts: { minSpan: 30 } },
  { id: 'cooper-alley', name: 'Cooper Alley', kind: 'alley', points: COOPER_ALLEY, opts: { minSpan: 30 } },
  { id: 'alma-mews', name: 'Alma Mews', kind: 'alley', points: ALMA_MEWS, opts: { minSpan: 25 } },
  { id: 'cranmer-mews', name: 'Cranmer Mews', kind: 'alley', points: CRANMER_MEWS, opts: { minSpan: 25 } },
  { id: 'bakers-cut', name: 'Bakers Cut', kind: 'alley', points: BAKERS_CUT, opts: { minSpan: 25 } },
  { id: 'green-path-w', name: 'Mill Green Path', kind: 'pedestrian', points: GREEN_PATH_W, opts: { minSpan: 25 } },
  { id: 'green-path-e', name: 'Mill Green Path', kind: 'pedestrian', points: GREEN_PATH_E, opts: { minSpan: 25 } },
];

/* ── regional routes carried through ──────────────────────────────────────────── */

function legacyKind(type: string): StreetKind { return 'legacy'; }
const LEGACY_IDS = ['h03', 'h04', 'h05', 'a18', 'a19', 'l02'];

function legacyStreets(): Street[] {
  const streets: Street[] = [];
  for (const sampled of SAMPLED_ROADS) {
    if (!LEGACY_IDS.includes(sampled.road.id)) continue;
    const samples = sampled.samples;
    const ins = samples.map(q => pointInPolygon(q.x, q.z, RES_POLYGON));
    // A route can clip a corner of the reservation; keep the longest run inside it.
    let bestStart = -1, bestEnd = -1, runStart = -1;
    for (let i = 0; i < ins.length; i++) {
      if (ins[i] && runStart < 0) runStart = i;
      if ((!ins[i] || i === ins.length - 1) && runStart >= 0) {
        const end = ins[i] ? i : i - 1;
        if (end - runStart > bestEnd - bestStart) { bestStart = runStart; bestEnd = end; }
        runStart = -1;
      }
    }
    if (bestStart < 0 || bestEnd - bestStart < 2) continue;
    const points: Point[] = [];
    // Extend half a sample past each end so the route meets its continuation outside
    // the reservation without a gap or a step.
    if (bestStart > 0) points.push({ x: (samples[bestStart - 1].x + samples[bestStart].x) / 2, z: (samples[bestStart - 1].z + samples[bestStart].z) / 2 });
    for (let i = bestStart; i <= bestEnd; i++) points.push({ x: samples[i].x, z: samples[i].z });
    if (bestEnd < samples.length - 1) points.push({ x: (samples[bestEnd].x + samples[bestEnd + 1].x) / 2, z: (samples[bestEnd].z + samples[bestEnd + 1].z) / 2 });
    const line = sampleLine(points);
    if (line[line.length - 1].t < 60) continue;
    const kind = legacyKind(sampled.road.type);
    const street: Street = {
      id: `legacy-${sampled.road.id}`, name: sampled.road.name, kind,
      samples: line, spans: [{ min: line[0].t, max: line[line.length - 1].t }],
      length: line[line.length - 1].t - line[0].t,
      // Regional alignments keep their outside width so the ribbon matches at the gate.
      width: Math.max(PROFILE[kind].width, ROAD_WIDTH[sampled.road.type as keyof typeof ROAD_WIDTH] ?? PROFILE[kind].width),
      sidewalk: PROFILE[kind].sidewalk,
      lanes: sampled.road.type === 'highway' ? 4 : 2,
      laneWidth: 0, oneWay: 0,
      speed: PROFILE[kind].speed,
      parking: false, legacy: true,
    };
    street.laneWidth = street.width / street.lanes;
    streets.push(street);
  }
  return streets;
}

/**
 * Snap a street end onto a nearby line so a close or terrace end never stops metres
 * short of the road it is meant to meet. Ends extend forward only, then re-sample so `t`
 * stays monotonic across a single span.
 */
function snapEnds(streets: Street[]): void {
  const SNAP = 70;
  for (const street of streets) {
    if (street.legacy || street.kind === 'alley' || street.kind === 'pedestrian') continue;
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
      const fresh = sampleLine(points);
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
  if (!samples.length) return { x: 0, z: 0, y: 0, t };
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: a.y + (b.y - a.y) * k, t };
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
export function streetNormal(street: Street, t: number): Point {
  return leftNormal(derivativeAt(street, t));
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* ── the network ──────────────────────────────────────────────────────────────── */

export type ResNetwork = {
  streets: Street[];
  junctions: Junction[];
  edges: StreetEdge[];
  streetById: Map<string, Street>;
  junctionById: Map<string, Junction>;
  gateways: Junction[];
  turningCircles: Junction[];
};

type Crossing = { a: string; b: string; ta: number; tb: number; point: Point };

function crossings(a: Street, b: Street): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 0; i < a.samples.length - 1; i++) {
    const a0 = a.samples[i], a1 = a.samples[i + 1];
    if (a1.t - a0.t < 1e-6) continue;
    const ad = { x: (a1.x - a0.x) / (a1.t - a0.t), z: (a1.z - a0.z) / (a1.t - a0.t) };
    for (let j = 0; j < b.samples.length - 1; j++) {
      const b0 = b.samples[j], b1 = b.samples[j + 1];
      if (b1.t - b0.t < 1e-6) continue;
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

/** Declared turning circles at every close end — the 1990s estate's shape. */
const TURNING_CIRCLES: { id: string; streetId: string; end: 0 | 1; radius: number }[] = [
  { id: 'tc-willow', streetId: 'willow-close', end: 1, radius: 8.5 },
  { id: 'tc-orchard', streetId: 'orchard-close', end: 1, radius: 8.5 },
  { id: 'tc-sparrow', streetId: 'sparrow-close', end: 1, radius: 8 },
  { id: 'tc-kestrel', streetId: 'kestrel-close', end: 1, radius: 8 },
  { id: 'tc-sunnybank', streetId: 'sunnybank-close', end: 1, radius: 8 },
  { id: 'tc-larkspur', streetId: 'larkspur-drive', end: 1, radius: 8.5 },
  { id: 'tc-beechwood', streetId: 'beechwood-rise', end: 1, radius: 8 },
];

export const RES_NETWORK: ResNetwork = (() => {
  const streets: Street[] = [];
  for (const authored of AUTHORED) {
    streets.push(makeStreet(authored.id, authored.name, authored.kind, authored.points, {
      ...authored.opts, hood: authored.hood,
    }));
  }
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
  // regional routes converge without their centre-lines quite intersecting.
  for (const a of live) {
    for (const span of a.spans) {
      for (const t of [span.min, span.max]) {
        const q = positionAt(a, t);
        for (const b of live) {
          if (b === a) continue;
          let bestHit: { distance: number; tb: number; point: Point } | null = null;
          for (let i = 0; i + 1 < b.samples.length; i++) {
            const b0 = b.samples[i], b1 = b.samples[i + 1];
            const hit = pointToSegment(q, b0, b1);
            if (hit.distance > b.width / 2 + b.sidewalk + 8) continue;
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
  type Cluster = { x: number; z: number; count: number; members: Crossing[] };
  const clusters: Cluster[] = [];
  for (const crossing of raw) {
    let placed = false;
    for (const cluster of clusters) {
      if (Math.hypot(cluster.x - crossing.point.x, cluster.z - crossing.point.z) > 18) continue;
      cluster.x = (cluster.x * cluster.count + crossing.point.x) / (cluster.count + 1);
      cluster.z = (cluster.z * cluster.count + crossing.point.z) / (cluster.count + 1);
      cluster.count++; cluster.members.push(crossing);
      placed = true; break;
    }
    if (!placed) clusters.push({ x: crossing.point.x, z: crossing.point.z, count: 1, members: [crossing] });
  }

  const junctions: Junction[] = [];
  clusters.forEach((cluster, index) => {
    const point = { x: cluster.x, z: cluster.z };
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
        });
      }
    }
    if (arms.length < 2) return;
    const wide = arms.filter(a => a.kind === 'arterial' || a.kind === 'legacy' || a.kind === 'collector').length;
    // Signals only where two busy roads really cross — the mill crossroads and the
    // Grand Valley crossings with the carried-through freeway; everything else is
    // stop or yield, the valley's everyday traffic management.
    const legacyArms = arms.filter(a => a.kind === 'legacy').length;
    const control: JunctionControl =
      wide >= 3 && legacyArms >= 1 ? 'signal'
        : wide >= 2 && arms.length >= 4 ? 'signal'
          : arms.some(a => a.kind === 'arterial') ? 'stop'
            : arms.length > 2 ? 'yield' : 'none';
    junctions.push({
      id: `rj-${index}`, point, y: resGround(point.x, point.z),
      arms, streets: [...streetIds], control,
      shape: arms.length >= 4 ? 'cross' : arms.length === 3 ? 'tee' : 'bend',
    });
  });

  /* 2. turning circles: declared terminals at the closes' ends */
  let circleCount = 0;
  for (const circle of TURNING_CIRCLES) {
    const street = streetById.get(circle.streetId);
    if (!street || !street.spans.length) continue;
    const span = street.spans[0];
    const t = circle.end === 0 ? span.min : span.max;
    const q = positionAt(street, t);
    // Only declare a circle if nothing else already junctions the end.
    if (junctions.some(j => Math.hypot(j.point.x - q.x, j.point.z - q.z) < 45)) continue;
    const dir = derivativeAt(street, t);
    const arms: JunctionArm[] = [];
    const side = circle.end === 0 ? 1 : -1;
    if (withinSpans(street, t + side * 1.5)) {
      arms.push({
        streetId: street.id, t, side: side as 1 | -1, dir: { x: dir.x * side, z: dir.z * side },
        kind: street.kind, lanes: street.lanes, oneWay: street.oneWay,
      });
    }
    junctions.push({
      id: circle.id || `tc-${circleCount}`, point: q, y: resGround(q.x, q.z),
      arms, streets: [street.id],
      control: 'turning-circle', shape: 'turning-circle', island: circle.radius,
      label: 'Turning Circle',
    });
    circleCount++;
  }

  /* 3. unclaimed street ends: gates at the limit, plain terminals inside */
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
          });
        }
        if (!arms.length) continue;
        // An end that lands on an existing node joins it instead of growing a twin.
        const claimedBy = junctions.find(j => Math.hypot(j.point.x - q.x, j.point.z - q.z) < 45);
        if (claimedBy) {
          if (!claimedBy.streets.includes(street.id)) {
            claimedBy.arms.push(...arms);
            claimedBy.streets.push(street.id);
          }
          if (bd < 70 && claimedBy.control !== 'gateway' && claimedBy.control !== 'turning-circle') {
            claimedBy.control = 'gateway';
            claimedBy.shape = 'gateway';
            claimedBy.label = 'District Gate';
          }
          continue;
        }
        const gate = bd < 80 && street.width >= 8;
        junctions.push({
          id: `rj-end-${endCount++}-${street.id}-${end}`, point: q, y: resGround(q.x, q.z),
          arms, streets: [street.id],
          control: gate ? 'gateway' : 'terminal',
          shape: gate ? 'gateway' : 'terminal',
          label: gate ? 'District Gate' : undefined,
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
    turningCircles: junctions.filter(j => j.control === 'turning-circle'),
  };
})();

/** Corridor test used by the plot layout and the building audit. */
export function insideStreetCorridor(q: Point, margin = 0, streets: readonly Street[] = RES_NETWORK.streets): boolean {
  for (const street of streets) {
    const reach = street.width / 2 + street.sidewalk + margin;
    for (let i = 0; i < street.samples.length - 1; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (pointToSegment(q, a, b).distance < reach) return true;
    }
  }
  return false;
}

export function nearestResStreet(x: number, z: number, streets: readonly Street[] = RES_NETWORK.streets):
  { street: Street; t: number; distance: number; point: Point } | null {
  let best: { street: Street; t: number; distance: number; point: Point } | null = null;
  for (const street of streets) {
    for (let i = 0; i < street.samples.length - 1; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
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

/** Worst sampled grade per street, for the road audit. */
export function streetGrade(street: Street): { max: number; at: Point } {
  let max = 0, at: Point = { x: 0, z: 0 };
  for (let i = 0; i + 1 < street.samples.length; i++) {
    const a = street.samples[i], b = street.samples[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const g = Math.abs(b.y - a.y) / d;
    if (g > max) { max = g; at = { x: a.x, z: a.z }; }
  }
  return { max, at };
}
