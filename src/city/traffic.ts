/**
 * Traffic preparation: lanes, junction movements, signals, crossings, kerbside parking,
 * transit stops and the pedestrian graph.
 *
 * Nothing here drives vehicles yet — this step builds the surfaces and the graph a future
 * traffic AI will read: every lane knows where it starts and ends, every junction knows
 * which movements it allows and which signal group controls them, every crossing connects
 * two footways, and every parking bay has a stall a car can occupy.
 */
import type { Point } from '../world/data';
import { NETWORK, streetAt, type Junction, type Street, type StreetEdge } from './streets';
import { PLAN } from './blocks';
import { CITY } from './buildings';
import { TRANSIT } from './identity';
import { hash01 } from './frame';
import { distance2d, lerp2, normalize, polygonArea, polygonCentroid, sub } from './geometry2d';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export type Movement = 'through' | 'left' | 'right' | 'u-turn';

export type Lane = {
  id: string;
  streetId: string;
  edgeId: string;
  /** Travel direction along the street's own axis. */
  direction: 1 | -1;
  /** 0 is the centre-line lane on a two-way street, or the kerb lane on a one-way. */
  index: number;
  width: number;
  kind: 'car' | 'bus' | 'cycle' | 'parking';
  points: { x: number; z: number; y: number }[];
  length: number;
  fromJunction: string;
  toJunction: string;
  speed: number;
};

export type LaneLink = {
  id: string;
  fromLane: string;
  toLane: string;
  junction: string;
  movement: Movement;
  points: { x: number; z: number; y: number }[];
  signalGroup?: string;
  yieldTo: string[];
};

export type Crossing = {
  id: string;
  a: Point;
  b: Point;
  width: number;
  kind: 'zebra' | 'signal' | 'side-street';
  junction?: string;
  streetId: string;
  /** Which side of the junction the crossing sits on. */
  armIndex: number;
};

export type Signal = {
  id: string;
  junction: string;
  point: Point;
  /** Facing direction: the direction vehicles approaching on the controlled arm see. */
  dir: Point;
  kind: 'vehicle' | 'pedestrian';
  armIndex: number;
};

export type JunctionSignal = {
  id: string;
  junction: string;
  /** Phase list: each phase frees a set of arm indices. */
  phases: { id: string; arms: number[]; pedestrian: number[]; seconds: number }[];
  offset: number;
};

export type ParkingBay = {
  id: string;
  centre: Point;
  dir: Point;
  length: number;
  width: number;
  streetId: string;
  side: 1 | -1;
};

export type BusStop = {
  id: string;
  point: Point;
  dir: Point;
  streetId: string;
  name: string;
  routes: string[];
  shelter: boolean;
  pad: { polygon: Point[] };
};

export type PedNode = {
  id: string;
  point: Point;
  kind: 'footway' | 'crossing' | 'corner' | 'entrance' | 'stop';
  links: { to: string; kind: 'walk' | 'cross' | 'ramp'; width: number }[];
};

/* ── junction geometry ─────────────────────────────────────────────────────────── */

/** How far a junction's paved area reaches along each arm, per street half-width. */
function armBoundary(junction: Junction, armIndex: number): number {
  const arm = junction.arms[armIndex];
  let reach = 5;
  for (let i = 0; i < junction.arms.length; i++) {
    if (i === armIndex) continue;
    const other = junction.arms[i];
    const sameStreet = other.streetId === arm.streetId;
    if (sameStreet) continue;
    const cross = Math.abs(arm.dir.x * other.dir.z - arm.dir.z * other.dir.x);
    const dot = Math.abs(arm.dir.x * other.dir.x + arm.dir.z * other.dir.z);
    if (dot > .995) continue;
    const otherStreet = NETWORK.streetById.get(other.streetId)!;
    const half = otherStreet.width / 2 + Math.max(1.5, otherStreet.sidewalk * .35);
    reach = Math.max(reach, clamp(half / Math.max(cross, .05), 5, 62));
  }
  return reach;
}

const BOUNDARY_CACHE = new Map<string, number>();
function boundaryOf(junction: Junction, armIndex: number): number {
  const key = `${junction.id}:${armIndex}`;
  let value = BOUNDARY_CACHE.get(key);
  if (value === undefined) {
    value = armBoundary(junction, armIndex);
    BOUNDARY_CACHE.set(key, value);
  }
  return value;
}

/** How far a junction's paved table reaches along one of its arms. */
export function junctionReachFor(junction: Junction, armIndex: number): number {
  return boundaryOf(junction, armIndex);
}

/* ── lanes ─────────────────────────────────────────────────────────────────────── */

const LANE_TARGET = 3.35;
const BUS_LANE_WIDTH = 3.9;

function laneOffsets(street: Street, direction: 1 | -1): { offset: number; kind: Lane['kind'] }[] {
  const half = street.width / 2;
  const lanes = Math.max(1, Math.round(street.width / LANE_TARGET));
  const width = street.width / lanes;
  const out: { offset: number; kind: Lane['kind'] }[] = [];
  const count = street.oneWay === 0 ? Math.max(1, Math.floor(lanes / 2)) : lanes;
  for (let i = 0; i < count; i++) {
    const offset = street.oneWay === 0
      ? (i + .5) * width * direction
      : -half + (i + .5) * width;
    const kerb = i === count - 1;
    let kind: Lane['kind'] = 'car';
    if (street.transit && kerb) kind = 'bus';
    else if (street.cycle && kerb) kind = 'cycle';
    else if (street.parking && kerb && street.oneWay !== 0) kind = 'parking';
    out.push({ offset, kind });
  }
  return out;
}

function sampleEdge(street: Street, from: number, to: number, lateral: number): Lane['points'] {
  const points: Lane['points'] = [];
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 8));
  for (let i = 0; i <= steps; i++) {
    const t = from + (to - from) * (i / steps);
    const centre = streetAt(street, t);
    const ahead = streetAt(street, Math.min(street.samples[street.samples.length - 1].t, t + 2));
    const dir = normalize({ x: ahead.x - centre.x, z: ahead.z - centre.z });
    points.push({
      x: centre.x + (-dir.z) * lateral,
      z: centre.z + (dir.x) * lateral,
      y: centre.y,
    });
  }
  return points;
}

export const LANES: Lane[] = [];
export const LANE_BY_ID = new Map<string, Lane>();
export const LANE_LINKS: LaneLink[] = [];
export const CROSSINGS: Crossing[] = [];
export const SIGNALS: Signal[] = [];
export const JUNCTION_SIGNALS: JunctionSignal[] = [];
export const PARKING_BAYS: ParkingBay[] = [];
export const BUS_STOPS: BusStop[] = [];
export const PED_NODES = new Map<string, PedNode>();

function buildLanes(): void {
  for (const edge of NETWORK.edges) {
    const street = NETWORK.streetById.get(edge.streetId)!;
    if (street.kind === 'pedestrian') continue;
    const fromJunction = NETWORK.junctionById.get(edge.from);
    const toJunction = NETWORK.junctionById.get(edge.to);
    if (!fromJunction || !toJunction) continue;
    const fromArm = fromJunction.arms.findIndex(a => a.streetId === street.id);
    const toArm = toJunction.arms.findIndex(a => a.streetId === street.id && a.side === -1);
    const startArm = fromArm >= 0 ? fromArm : 0;
    const endArm = toArm >= 0 ? toArm : 0;
    const enter = boundaryOf(fromJunction, startArm);
    const exit = boundaryOf(toJunction, endArm);
    const directions: (1 | -1)[] = street.oneWay === 0 ? [1, -1] : [street.oneWay];
    for (const direction of directions) {
      const offsets = laneOffsets(street, direction);
      offsets.forEach((lane, index) => {
        const start = direction === 1 ? fromJunction.arms[startArm].t + enter : toJunction.arms[endArm].t - exit;
        const end = direction === 1 ? toJunction.arms[endArm].t - exit : fromJunction.arms[startArm].t + enter;
        if (Math.abs(end - start) < 12) return;
        const points = sampleEdge(street, start, end, lane.offset);
        const length = points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) : 0, 0);
        const id = `${edge.id}-l${direction}-${index}`;
        const record: Lane = {
          id, streetId: street.id, edgeId: edge.id, direction, index,
          width: street.width / Math.max(1, Math.round(street.width / LANE_TARGET)),
          kind: lane.kind, points, length,
          fromJunction: direction === 1 ? edge.from : edge.to,
          toJunction: direction === 1 ? edge.to : edge.from,
          speed: street.speed,
        };
        LANES.push(record);
        LANE_BY_ID.set(id, record);
      });
    }
  }
}

function turnKind(from: Point, to: Point): Movement {
  const cross = from.x * to.z - from.z * to.x;
  const dot = from.x * to.x + from.z * to.z;
  const angle = Math.atan2(cross, dot) * 180 / Math.PI;
  if (Math.abs(angle) < 26) return 'through';
  if (Math.abs(angle) > 150) return 'u-turn';
  return angle > 0 ? 'left' : 'right';
}

function buildLinks(): void {
  for (const junction of NETWORK.junctions) {
    const incoming = LANES.filter(l => l.toJunction === junction.id);
    const outgoing = LANES.filter(l => l.fromJunction === junction.id);
    for (const from of incoming) {
      const start = from.points[from.points.length - 1];
      const inDir = normalize(sub(start, from.points[Math.max(0, from.points.length - 4)]));
      for (const to of outgoing) {
        if (to.streetId === from.streetId && to.direction === from.direction && to.edgeId === from.edgeId) continue;
        const end = to.points[0];
        const outDir = normalize(sub(to.points[Math.min(to.points.length - 1, 3)], end));
        const movement = turnKind(inDir, outDir);
        // Test the full carriageway, not one lane's width: a three-metre lane is still
        // part of a broad boulevard where a permitted U-turn can be designed.
        const fromStreet = NETWORK.streetById.get(from.streetId)!;
        if (movement === 'u-turn' && fromStreet.width < 16) continue;
        if (movement !== 'through' && to.kind === 'bus' && from.kind !== 'bus') continue;
        // Curve through the junction, biased towards the stop line rather than the centre.
        const control = junctionCentre(from, to, junction);
        const points: LaneLink['points'] = [];
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, k = 1 - t;
          points.push({
            x: k * k * start.x + 2 * k * t * control.x + t * t * end.x,
            z: k * k * start.z + 2 * k * t * control.z + t * t * end.z,
            y: k * k * start.y + 2 * k * t * control.y + t * t * end.y,
          });
        }
        // Movements that must give way: everything crossing the opposing through movement.
        const yieldTo = outgoing
          .filter(other => other.id !== to.id && turnKind(inDir, normalize(sub(other.points[Math.min(other.points.length - 1, 3)], other.points[0]))) === 'through')
          .map(other => other.id)
          .slice(0, 4);
        LANE_LINKS.push({
          id: `${from.id}>${to.id}`, fromLane: from.id, toLane: to.id, junction: junction.id,
          movement, points, signalGroup: junction.signalGroup,
          yieldTo: junction.control === 'signal' ? [] : yieldTo,
        });
      }
    }
  }
}

function junctionCentre(from: Lane, to: Lane, junction: Junction): { x: number; z: number; y: number } {
  const a = from.points[from.points.length - 1];
  const b = to.points[0];
  return {
    x: (a.x + b.x) / 2 * .55 + junction.point.x * .45,
    z: (a.z + b.z) / 2 * .55 + junction.point.z * .45,
    y: (a.y + b.y) / 2 * .5 + junction.y * .5,
  };
}

/* ── crossings, signals, parking, stops ────────────────────────────────────────── */

function buildCrossings(): void {
  for (const junction of NETWORK.junctions) {
    junction.arms.forEach((arm, armIndex) => {
      const street = NETWORK.streetById.get(arm.streetId)!;
      if (street.kind === 'alley') return;
      const reach = boundaryOf(junction, armIndex) + 1.6;
      const base = { x: junction.point.x + arm.dir.x * reach, z: junction.point.z + arm.dir.z * reach };
      const half = street.width / 2;
      const normal = { x: -arm.dir.z, z: arm.dir.x };
      const signal = junction.control === 'signal';
      CROSSINGS.push({
        id: `${junction.id}-x${armIndex}`,
        a: { x: base.x - normal.x * half, z: base.z - normal.z * half },
        b: { x: base.x + normal.x * half, z: base.z + normal.z * half },
        width: street.kind === 'boulevard' || street.kind === 'transit' ? 6 : 4.6,
        kind: signal ? 'signal' : street.kind === 'pedestrian' ? 'zebra' : 'side-street',
        junction: junction.id, streetId: street.id, armIndex,
      });
      if (signal) {
        // A signal head facing the approaching traffic, on the far right corner.
        const side = arm.dir;
        const corner = {
          x: base.x + normal.x * (half + street.sidewalk * .55) + side.x * 1.5,
          z: base.z + normal.z * (half + street.sidewalk * .55) + side.z * 1.5,
        };
        SIGNALS.push({
          id: `${junction.id}-s${armIndex}`, junction: junction.id,
          point: corner, dir: { x: -arm.dir.x, z: -arm.dir.z },
          kind: 'vehicle', armIndex,
        });
        const ped = {
          x: base.x + normal.x * (half + 1.4), z: base.z + normal.z * (half + 1.4),
        };
        SIGNALS.push({
          id: `${junction.id}-p${armIndex}`, junction: junction.id,
          point: ped, dir: { x: -normal.x, z: -normal.z }, kind: 'pedestrian', armIndex,
        });
      }
    });
    if (junction.control === 'signal') {
      // Standard two-phase control with an all-red clearance and a pedestrian walk.
      const vehicleArms = junction.arms
        .map((arm, index) => ({ arm, index }))
        .filter(({ arm }) => arm.kind !== 'pedestrian' && arm.lanes > 0);
      const alongU = vehicleArms.filter(({ arm }) => {
        const street = NETWORK.streetById.get(arm.streetId)!;
        return street.axis === 'u' || (street.axis === 'free' && Math.abs(arm.dir.x) < .6);
      });
      const alongV = vehicleArms.filter(({ arm }) => {
        const street = NETWORK.streetById.get(arm.streetId)!;
        return street.axis === 'v' || (street.axis === 'free' && Math.abs(arm.dir.x) >= .6);
      });
      const groups = [alongU, alongV].filter(g => g.length);
      JUNCTION_SIGNALS.push({
        id: `sg-${junction.id}`,
        junction: junction.id,
        phases: groups.map((group, index) => ({
          id: `phase${index}`,
          arms: group.map(({ index: armIndex }) => armIndex),
          pedestrian: group.map(({ index: armIndex }) => armIndex),
          seconds: 26 + Math.round(hash01(group.length, index, 3) * 14),
        })),
        offset: Math.round(hash01(Math.round(junction.point.x), Math.round(junction.point.z), 7) * 40),
      });
    }
  }
}

/** Kerbside bays on streets signed for parking, clear of junctions and crossings. */
function buildParking(): void {
  for (const street of NETWORK.streets) {
    if (!street.parking || street.kind === 'alley' || street.oneWay === 0 && street.width < 12) continue;
    let bayIndex = 0;
    for (const span of street.spans) {
      const total = span.max - span.min;
      const step = 6.1;
      const count = Math.floor((total - 90) / step);
      for (let i = 0; i < count; i++) {
        const t = span.min + 45 + i * step;
        const centre = streetAt(street, t);
        const ahead = streetAt(street, Math.min(span.max, t + 2));
        const dir = normalize({ x: ahead.x - centre.x, z: ahead.z - centre.z });
        // Keep clear of junctions: no bay within 26 m of a controlled crossing.
        if (NETWORK.junctions.some(j => j.streets.includes(street.id) &&
          distance2d(j.point, centre) < 26)) continue;
        const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
        const lateral = (street.width / 2 - 2.4) * (street.oneWay === 0 ? side : 0);
        PARKING_BAYS.push({
          id: `${street.id}-bay${bayIndex++}`,
          centre: { x: centre.x + (-dir.z) * lateral, z: centre.z + dir.x * lateral },
          dir, length: 5.4, width: 2.3, streetId: street.id, side,
        });
      }
    }
  }
}

const STOP_SPACING: Partial<Record<Street['kind'], number>> = {
  transit: 380, boulevard: 460, avenue: 620, street: 0, lane: 0,
  pedestrian: 0, alley: 0, service: 0, ring: 520,
};
function buildStops(): void {
  for (const street of NETWORK.streets) {
    const spacing = STOP_SPACING[street.kind] ?? 0;
    if (!spacing) continue;
    const routes = TRANSIT.routes;
    let index = 0, stopIndex = 0;
    for (const span of street.spans) {
      const total = span.max - span.min;
      const count = Math.max(1, Math.floor(total / spacing));
      for (let i = 0; i < count; i++) {
        const t = span.min + (i + .5) * (total / count);
        const centre = streetAt(street, t);
        const ahead = streetAt(street, Math.min(span.max, t + 2));
        const dir = normalize({ x: ahead.x - centre.x, z: ahead.z - centre.z });
        const side: 1 | -1 = index % 2 === 0 ? 1 : -1;
        const lateral = (street.width / 2 + street.sidewalk * .5) * side;
        const point = { x: centre.x + (-dir.z) * lateral, z: centre.z + dir.x * lateral };
        const pad = padPolygon(point, dir, 16, 3.4);
        BUS_STOPS.push({
          id: `${street.id}-stop${stopIndex++}`,
          point, dir, streetId: street.id,
          name: `${street.name.replace(/ (Street|Avenue|Row|Walk)$/, '')} ${side > 0 ? 'north' : 'south'} bound`,
          routes: routes.slice(0, 2 + (index % 3)),
          shelter: index % 2 === 0,
          pad: { polygon: pad },
        });
        index++;
      }
    }
  }
}
function padPolygon(centre: Point, dir: Point, length: number, width: number): Point[] {
  const n = { x: -dir.z, z: dir.x };
  return [
    { x: centre.x - dir.x * length / 2 - n.x * width / 2, z: centre.z - dir.z * length / 2 - n.z * width / 2 },
    { x: centre.x + dir.x * length / 2 - n.x * width / 2, z: centre.z + dir.z * length / 2 - n.z * width / 2 },
    { x: centre.x + dir.x * length / 2 + n.x * width / 2, z: centre.z + dir.z * length / 2 + n.z * width / 2 },
    { x: centre.x - dir.x * length / 2 + n.x * width / 2, z: centre.z - dir.z * length / 2 + n.z * width / 2 },
  ];
}

/* ── pedestrian graph ──────────────────────────────────────────────────────────── */

function addNode(id: string, point: Point, kind: PedNode['kind']): PedNode {
  let node = PED_NODES.get(id);
  if (!node) {
    node = { id, point, kind, links: [] };
    PED_NODES.set(id, node);
  }
  return node;
}
function linkNodes(a: string, b: string, kind: 'walk' | 'cross' | 'ramp', width: number): void {
  const from = PED_NODES.get(a), to = PED_NODES.get(b);
  if (!from || !to || from.id === to.id) return;
  if (from.links.some(l => l.to === b)) return;
  from.links.push({ to: b, kind, width });
  to.links.push({ to: a, kind, width });
}

/**
 * The footway network: a node at each corner of every junction, linked around the corner
 * and across each crossing, plus a node at every building entrance and transit stop.
 */
function buildPedestrians(): void {
  for (const junction of NETWORK.junctions) {
    const corners: string[] = [];
    junction.arms.forEach((arm, armIndex) => {
      const street = NETWORK.streetById.get(arm.streetId)!;
      const reach = boundaryOf(junction, armIndex) + 2.2;
      const normal = { x: -arm.dir.z, z: arm.dir.x };
      for (const side of [1, -1] as const) {
        const half = street.width / 2 + street.sidewalk * .5;
        const point = {
          x: junction.point.x + arm.dir.x * reach + normal.x * half * side,
          z: junction.point.z + arm.dir.z * reach + normal.z * half * side,
        };
        const id = `${junction.id}-c${armIndex}-${side > 0 ? 'r' : 'l'}`;
        addNode(id, point, 'corner');
        corners.push(id);
      }
    });
    for (let i = 0; i < corners.length; i++) {
      linkNodes(corners[i], corners[(i + 1) % corners.length], 'walk', 2.4);
    }
    for (const crossing of CROSSINGS.filter(c => c.junction === junction.id)) {
      const left = `${junction.id}-c${crossing.armIndex}-l`;
      const right = `${junction.id}-c${crossing.armIndex}-r`;
      linkNodes(left, right, 'cross', crossing.width);
    }
  }
  // Footways run continuously along both sides of every street, junction to junction,
  // with a node roughly every 45 m so doors and stops always have somewhere to attach.
  for (const edge of NETWORK.edges) {
    const a = NETWORK.junctionById.get(edge.from), b = NETWORK.junctionById.get(edge.to);
    if (!a || !b) continue;
    const street = NETWORK.streetById.get(edge.streetId)!;
    const armA = a.arms.findIndex(arm => arm.streetId === edge.streetId &&
      (arm.dir.x * (b.point.x - a.point.x) + arm.dir.z * (b.point.z - a.point.z)) > 0);
    const armB = b.arms.findIndex(arm => arm.streetId === edge.streetId &&
      (arm.dir.x * (a.point.x - b.point.x) + arm.dir.z * (a.point.z - b.point.z)) > 0);
    if (armA < 0 || armB < 0) continue;
    const startT = a.arms[armA].t, endT = b.arms[armB].t;
    if (Math.abs(endT - startT) < 20) {
      linkNodes(`${a.id}-c${armA}-l`, `${b.id}-c${armB}-r`, 'walk', 2.6);
      linkNodes(`${a.id}-c${armA}-r`, `${b.id}-c${armB}-l`, 'walk', 2.6);
      continue;
    }
    const half = street.width / 2 + street.sidewalk * .55;
    const steps = Math.max(1, Math.round(Math.abs(endT - startT) / 45));
    for (const side of [1, -1] as const) {
      let previous = `${a.id}-c${armA}-${side > 0 ? 'r' : 'l'}`;
      for (let i = 1; i < steps; i++) {
        const t = startT + (endT - startT) * (i / steps);
        const centre = streetAt(street, t);
        const ahead = streetAt(street, t + Math.sign(endT - startT) * 2);
        const dir = normalize({ x: ahead.x - centre.x, z: ahead.z - centre.z });
        const point = { x: centre.x + (-dir.z) * half * side, z: centre.z + dir.x * half * side };
        const id = `${edge.id}-w${i}-${side > 0 ? 'r' : 'l'}`;
        addNode(id, point, 'footway');
        linkNodes(previous, id, 'walk', 2.6);
        previous = id;
      }
      // Sides swap at the far junction because the arm normal points the other way.
      linkNodes(previous, `${b.id}-c${armB}-${side > 0 ? 'l' : 'r'}`, 'walk', 2.6);
    }
  }
  // Service alleys have a walkable spine of their own. Their ends ramp into the public
  // footway graph at the two streets they connect; alley-front doors can then reach the
  // rest of downtown without an implausible shortcut through a block.
  const alleyEnds: { id: string; point: Point }[] = [];
  for (const alley of PLAN.alleys) {
    const length = distance2d(alley.a, alley.b);
    const steps = Math.max(2, Math.ceil(length / 28));
    let previous = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point = { x: alley.a.x + (alley.b.x - alley.a.x) * t, z: alley.a.z + (alley.b.z - alley.a.z) * t };
      const id = `alley-${alley.id}-w${i}`;
      addNode(id, point, 'footway');
      if (previous) linkNodes(previous, id, 'walk', Math.min(alley.width, 3));
      previous = id;
      if (i === 0 || i === steps) alleyEnds.push({ id, point });
    }
  }
  for (const end of alleyEnds) linkToNearest(end.id, end.point, 54, true);

  // Building entrances join the nearest footway node.
  for (const building of CITY.buildings) {
    const id = `ent-${building.id}`;
    addNode(id, building.entrance.point, 'entrance');
    // Some doors front a deep forecourt or service court; one full urban block (72 m)
    // is the longest permitted access spur to a public walkable node.
    linkToNearest(id, building.entrance.point, 72);
  }
  for (const building of CITY.landmarks) {
    const id = `ent-${building.id}`;
    addNode(id, building.entrance.point, 'entrance');
    linkToNearest(id, building.entrance.point, 72);
  }
  for (const stop of BUS_STOPS) {
    const id = `stop-${stop.id}`;
    addNode(id, stop.point, 'stop');
    linkToNearest(id, stop.point, 30);
  }
}
function linkToNearest(id: string, point: Point, limit: number, excludeAlleys = false): void {
  let best: { id: string; distance: number } | null = null;
  for (const node of PED_NODES.values()) {
    if (node.id === id || node.kind === 'entrance' || node.kind === 'stop') continue;
    if (excludeAlleys && node.id.startsWith('alley-')) continue;
    const d = distance2d(node.point, point);
    if (d < limit && (!best || d < best.distance)) best = { id: node.id, distance: d };
  }
  if (best) linkNodes(id, best.id, 'walk', 2);
}

buildLanes();
buildLinks();
buildCrossings();
buildParking();
buildStops();
buildPedestrians();

/* ── queries used by rendering, audit and future AI ─────────────────────────────── */

export function nearestLane(x: number, z: number): { lane: Lane; distance: number; index: number } | null {
  let best: { lane: Lane; distance: number; index: number } | null = null;
  for (const lane of LANES) {
    for (let i = 0; i < lane.points.length; i++) {
      const p = lane.points[i];
      const d = Math.hypot(p.x - x, p.z - z);
      if (!best || d < best.distance) best = { lane, distance: d, index: i };
    }
  }
  return best;
}
export function laneLength(): number { return LANES.reduce((sum, l) => sum + l.length, 0); }
export function pedNodeCount(): number { return PED_NODES.size; }

/** Breadth-first traversal of the lane graph; the routing a traffic AI would refine. */
export function laneRoute(fromLaneId: string, toLaneId: string): string[] | null {
  if (fromLaneId === toLaneId) return [fromLaneId];
  const seen = new Set([fromLaneId]);
  const queue: { id: string; path: string[] }[] = [{ id: fromLaneId, path: [fromLaneId] }];
  while (queue.length) {
    const current = queue.shift()!;
    for (const link of LANE_LINKS) {
      if (link.fromLane !== current.id || seen.has(link.toLane)) continue;
      const path = [...current.path, link.toLane];
      if (link.toLane === toLaneId) return path;
      seen.add(link.toLane);
      queue.push({ id: link.toLane, path });
    }
  }
  return null;
}
export function pedRoute(fromId: string, toId: string): string[] | null {
  if (!PED_NODES.has(fromId) || !PED_NODES.has(toId)) return null;
  const seen = new Set([fromId]);
  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];
  while (queue.length) {
    const current = queue.shift()!;
    for (const link of PED_NODES.get(current.id)!.links) {
      if (seen.has(link.to)) continue;
      const path = [...current.path, link.to];
      if (link.to === toId) return path;
      seen.add(link.to);
      queue.push({ id: link.to, path });
    }
  }
  return null;
}

/** Parking supply: kerbside bays, surface courts, decks and the underground garages. */
export const PARKING_SUPPLY = (() => {
  const kerbside = PARKING_BAYS.length;
  const surface = PLAN.courtyards
    .filter(c => c.kind === 'parking')
    .reduce((sum, c) => sum + Math.floor(polygonArea(c.polygon) / 26), 0);
  const decks = CITY.buildings
    .filter(b => b.use === 'parking')
    .reduce((sum, b) => sum + Math.floor(polygonArea(b.footprint) / 26) * Math.max(1, b.levels - 1), 0);
  const underground = PLAN.siteAreas
    .filter(area => area.site.garage)
    .reduce((sum, area) => {
      const built = area.parts.filter(p => p.part.use === 'open');
      const space = built.reduce((s, p) => s + polygonArea(p.polygon), 0);
      return sum + Math.floor(space / 26) * (area.site.garage?.levels ?? 1);
    }, 0);
  return { kerbside, surface, decks, underground, total: kerbside + surface + decks + underground };
})();

export const GARAGE_SITES = PLAN.siteAreas.filter(area => area.site.garage).map(area => ({
  id: area.site.id,
  name: area.site.name,
  levels: area.site.garage!.levels,
  depth: area.site.garage!.depth,
  entries: area.site.garage!.entries,
  polygons: area.polygons,
  centre: polygonCentroid(area.polygons.flat()),
}));
