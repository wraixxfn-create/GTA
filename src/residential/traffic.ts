/**
 * Traffic preparation for the Residential Valley: lanes, junction movements, crossings,
 * kerbside parking, bus stops and the pedestrian graph — plus a light kinetic fleet of
 * ordinary cars and vans for the lived-in feel.
 *
 * Nothing here drives gameplay yet: vehicles shuttle their street and turn around at
 * the ends. The lane graph (streets → edges → junctions) is the spatial opportunity
 * future missions, pursuits and NPC activity can build on.
 */
import type { Point } from '../world/data';
import { RES_NETWORK, streetAt, derivativeAt, streetNormal, type Street, type Junction } from './plan';
import { PARKING_LOTS, type ParkingLot } from './sites';
import { makeRandom, resGround, hash01 } from './frame';
import { leftNormal, normalize, distance2d, lerp2 } from '../city/geometry2d';

export type Lane = {
  id: string;
  streetId: string;
  spanIndex: number;
  index: number;
  width: number;
  speed: number;
  points: { x: number; y: number; z: number }[];
};

export const LANES: Lane[] = (() => {
  const out: Lane[] = [];
  for (const street of RES_NETWORK.streets) {
    if (street.kind === 'pedestrian' || !street.lanes) continue;
    street.spans.forEach((span, spanIndex) => {
      for (let l = 0; l < street.lanes; l++) {
        const lateral = (l - (street.lanes - 1) / 2) * street.laneWidth;
        const points: { x: number; y: number; z: number }[] = [];
        for (let i = 0; i < street.samples.length; i++) {
          const s = street.samples[i];
          if (s.t < span.min - 1e-6 || s.t > span.max + 1e-6) continue;
          const next = street.samples[Math.min(i + 1, street.samples.length - 1)];
          const prev = street.samples[Math.max(i - 1, 0)];
          const dir = normalize({ x: next.x - prev.x, z: next.z - prev.z });
          const n = leftNormal(dir);
          points.push({ x: s.x + n.x * lateral, y: s.y + 0.11, z: s.z + n.z * lateral });
        }
        if (points.length >= 2) {
          out.push({
            id: `${street.id}-s${spanIndex}-l${l}`, streetId: street.id, spanIndex, index: l,
            width: street.laneWidth, speed: street.speed, points,
          });
        }
      }
    });
  }
  return out;
})();

/* ── crossings ────────────────────────────────────────────────────────────────── */

export type Crossing = {
  id: string;
  a: Point;
  b: Point;
  width: number;
  kind: 'zebra' | 'side-street';
  junction?: string;
  streetId: string;
};

/**
 * Pedestrian crossings. The valley's crossings sit at the busy junctions and outside
 * the schools and the park gates — the places people actually cross.
 */
export const CROSSINGS: Crossing[] = (() => {
  const out: Crossing[] = [];
  let id = 0;
  const schoolGates: Point[] = [
    { x: -2050, z: -2330 }, { x: 200, z: -740 }, // academy + primary
    { x: -1350, z: -1655 }, // Mill Green west gate
    { x: -1350, z: -2045 }, // Mill Green south gate
    { x: -900, z: -755 },  // Market Row west
  ];
  for (const junction of RES_NETWORK.junctions) {
    if (junction.control === 'terminal' || junction.control === 'turning-circle') continue;
    for (const arm of junction.arms) {
      const street = RES_NETWORK.streetById.get(arm.streetId);
      if (!street || street.kind === 'alley' || street.kind === 'pedestrian') continue;
      if (street.kind === 'local' && junction.arms.length < 3) continue;
      const t = arm.t + arm.side * (street.width / 2 + street.sidewalk + 2.5);
      const s = streetAt(street, t);
      const n = streetNormal(street, t);
      const half = street.width / 2 + 1;
      out.push({
        id: `cr-${id++}`,
        a: { x: s.x + n.x * half, z: s.z + n.z * half },
        b: { x: s.x - n.x * half, z: s.z - n.z * half },
        width: 3.4,
        kind: junction.control === 'signal' ? 'zebra' : 'side-street',
        junction: junction.id,
        streetId: street.id,
      });
    }
  }
  // Mid-block crossings by the school gates and park gates.
  for (const gate of schoolGates) {
    let best: { street: Street; t: number; distance: number } | null = null;
    for (const street of RES_NETWORK.streets) {
      if (street.kind === 'alley' || street.kind === 'pedestrian') continue;
      for (let i = 0; i < street.samples.length - 1; i++) {
        const a = street.samples[i], b = street.samples[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len2 = dx * dx + dz * dz || 1;
        const k = Math.max(0, Math.min(1, ((gate.x - a.x) * dx + (gate.z - a.z) * dz) / len2));
        const px = a.x + dx * k, pz = a.z + dz * k;
        const d = Math.hypot(gate.x - px, gate.z - pz);
        if (!best || d < best.distance) best = { street, t: a.t + (b.t - a.t) * k, distance: d };
      }
    }
    if (!best || best.distance > 45) continue;
    const n = streetNormal(best.street, best.t);
    const half = best.street.width / 2 + 1;
    const s = streetAt(best.street, best.t);
    out.push({
      id: `cr-${id++}`,
      a: { x: s.x + n.x * half, z: s.z + n.z * half },
      b: { x: s.x - n.x * half, z: s.z - n.z * half },
      width: 3.6,
      kind: 'zebra',
      streetId: best.street.id,
    });
  }
  return out;
})();

/* ── kerbside parking ─────────────────────────────────────────────────────────── */

export type ParkingBay = {
  id: string;
  centre: Point;
  dir: Point;
  length: number;
  width: number;
  lot?: string;
};

export const PARKING_BAYS: ParkingBay[] = (() => {
  const out: ParkingBay[] = [];
  let id = 0;
  // Kerbside: the valley parks on its streets. Sample both sides of terraces and locals.
  for (const street of RES_NETWORK.streets) {
    if (!street.parking || street.kind === 'alley' || street.kind === 'pedestrian') continue;
    const span = street.spans[0];
    if (!span) continue;
    const step = 9;
    for (let t = span.min + 10; t < span.max - 10; t += step) {
      for (const side of [1, -1] as const) {
        if (hash01(Math.round(t), street.id.length, side) < 0.45) continue;
        const s = streetAt(street, t);
        const dir = derivativeAt(street, t);
        const n = streetNormal(street, t);
        const lateral = (street.width / 2 - 1.3) * side;
        out.push({
          id: `pb-${id++}`,
          centre: { x: s.x + n.x * lateral, z: s.z + n.z * lateral },
          dir, length: 5, width: 2.2,
        });
      }
    }
  }
  // Off-street lots from the landmark sites.
  for (const lot of PARKING_LOTS) {
    for (const bay of lot.bays) {
      out.push({ id: `pb-${id++}`, centre: bay.centre, dir: bay.dir, length: bay.length, width: bay.width, lot: lot.id });
    }
  }
  return out;
})();

/* ── transit ──────────────────────────────────────────────────────────────────── */

export type BusStop = {
  id: string;
  name: string;
  point: Point;
  pad: { polygon: Point[] };
  streetId: string;
};

/** Bus stops along the two arterials — the valley's only transit. */
export const BUS_STOPS: BusStop[] = (() => {
  const out: BusStop[] = [];
  const names = ['Mill Crossroads', 'Market Row', 'Chapel Lane', 'Brook Lane', 'Willow Crescent', 'Maple Way', 'Rosecourt', 'Larkspur'];
  const streets = RES_NETWORK.streets.filter(s => s.kind === 'arterial' || s.kind === 'collector');
  let nameIndex = 0;
  for (const street of streets) {
    const span = street.spans[0];
    if (!span || span.max - span.min < 320) continue;
    const count = Math.max(1, Math.floor((span.max - span.min) / 420));
    for (let i = 0; i < count; i++) {
      const t = span.min + (span.max - span.min) * ((i + 0.5) / count);
      const s = streetAt(street, t);
      const dir = derivativeAt(street, t);
      const n = streetNormal(street, t);
      const side = i % 2 === 0 ? 1 : -1;
      const lateral = (street.width / 2 + 1.4) * side;
      const centre = { x: s.x + n.x * lateral, z: s.z + n.z * lateral };
      const half = { x: dir.x * 2.4, z: dir.z * 2.4 };
      const across = { x: n.x * side * 1.3, z: n.z * side * 1.3 };
      out.push({
        id: `bs-${out.length}`,
        name: names[nameIndex++ % names.length],
        point: centre,
        streetId: street.id,
        pad: {
          polygon: [
            { x: centre.x - half.x - across.x, z: centre.z - half.z - across.z },
            { x: centre.x + half.x - across.x, z: centre.z + half.z - across.z },
            { x: centre.x + half.x + across.x, z: centre.z + half.z + across.z },
            { x: centre.x - half.x + across.x, z: centre.z - half.z + across.z },
          ],
        },
      });
    }
  }
  return out;
})();

/* ── pedestrian graph ─────────────────────────────────────────────────────────── */

export type PedNode = {
  id: string;
  point: Point;
  y: number;
  links: { to: string; kind: 'footway' | 'cross' | 'desire'; width: number }[];
};

export const PED_NODES: Map<string, PedNode> = (() => {
  const nodes = new Map<string, PedNode>();
  const edge = (from: string, to: string, kind: PedNode['links'][number]['kind'], width: number): void => {
    const a = nodes.get(from), b = nodes.get(to);
    if (!a || !b) return;
    if (!a.links.some(l => l.to === to)) a.links.push({ to, kind, width });
    if (!b.links.some(l => l.to === from)) b.links.push({ to: from, kind, width });
  };
  // Sidewalk chains along every walkable street, nodes at ~25 m intervals.
  for (const street of RES_NETWORK.streets) {
    const walkable = street.kind !== 'alley' || street.sidewalk > 0;
    if (!walkable && street.kind !== 'alley') continue;
    for (const side of street.sidewalk > 0 ? [1, -1] as const : [1] as const) {
      let previous: string | null = null;
      const span = street.spans[0];
      if (!span) continue;
      const step = 25;
      for (let t = span.min; t <= span.max + 1e-3; t += step) {
        const s = streetAt(street, Math.min(t, span.max));
        const n = streetNormal(street, Math.min(t, span.max));
        const lateral = (street.width / 2 + street.sidewalk * 0.5) * side;
        const point = { x: s.x + n.x * lateral, z: s.z + n.z * lateral };
        const id = `pn-${street.id}-${side}-${Math.round(t)}`;
        if (!nodes.has(id)) nodes.set(id, { id, point, y: resGround(point.x, point.z), links: [] });
        if (previous) edge(previous, id, 'footway', street.sidewalk || 1.2);
        previous = id;
      }
    }
  }
  // Junction stitching: the pavement runs round the corner, so every chain that
  // reaches a junction links to every other chain there.
  for (const junction of RES_NETWORK.junctions) {
    if (junction.shape === 'terminal') continue;
    const reach = 20;
    const near: string[] = [];
    for (const node of nodes.values()) {
      if (node.id.startsWith('px-')) continue;
      if (distance2d(node.point, junction.point) < reach) near.push(node.id);
    }
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        edge(near[i], near[j], 'footway', 1.8);
      }
    }
  }
  // Crossings tie the two sides of a street together where people cross.
  for (const crossing of CROSSINGS) {
    const idA = `px-${crossing.id}-a`, idB = `px-${crossing.id}-b`;
    nodes.set(idA, { id: idA, point: crossing.a, y: resGround(crossing.a.x, crossing.a.z), links: [] });
    nodes.set(idB, { id: idB, point: crossing.b, y: resGround(crossing.b.x, crossing.b.z), links: [] });
    edge(idA, idB, 'cross', crossing.width);
  }
  // Desire lines: crossing nodes reach the nearest sidewalk nodes.
  for (const crossing of CROSSINGS) {
    for (const end of [`px-${crossing.id}-a`, `px-${crossing.id}-b`] as const) {
      const node = nodes.get(end)!;
      let best: { id: string; distance: number } | null = null;
      for (const other of nodes.values()) {
        if (other.id.startsWith('px-')) continue;
        const d = distance2d(node.point, other.point);
        if (d < 14 && (!best || d < best.distance)) best = { id: other.id, distance: d };
      }
      if (best) edge(end, best.id, 'desire', 1.6);
    }
  }
  return nodes;
})();

/* ── the kinetic fleet ────────────────────────────────────────────────────────── */

export type VehicleKind = 'hatchback' | 'saloon' | 'van' | 'pickup' | 'estate';
export type Vehicle = {
  id: string;
  kind: VehicleKind;
  streetId: string;
  spanIndex: number;
  s: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  tint: number;
};

const FLEET_MIX: Record<string, { kind: VehicleKind; weight: number }[]> = {
  arterial: [
    { kind: 'hatchback', weight: .3 }, { kind: 'saloon', weight: .22 },
    { kind: 'van', weight: .18 }, { kind: 'estate', weight: .18 }, { kind: 'pickup', weight: .12 },
  ],
  collector: [
    { kind: 'hatchback', weight: .34 }, { kind: 'estate', weight: .24 },
    { kind: 'van', weight: .16 }, { kind: 'saloon', weight: .16 }, { kind: 'pickup', weight: .1 },
  ],
  local: [{ kind: 'hatchback', weight: .4 }, { kind: 'saloon', weight: .3 }, { kind: 'estate', weight: .3 }],
  legacy: [
    { kind: 'hatchback', weight: .3 }, { kind: 'saloon', weight: .24 },
    { kind: 'van', weight: .2 }, { kind: 'estate', weight: .16 }, { kind: 'pickup', weight: .1 },
  ],
};
const VEHICLE_SPEED: Record<VehicleKind, number> = { hatchback: 1, saloon: 1.02, van: .9, pickup: .94, estate: .98 };

export const VEHICLES: Vehicle[] = (() => {
  const out: Vehicle[] = [];
  let id = 0;
  for (const street of RES_NETWORK.streets) {
    const mix = FLEET_MIX[street.kind];
    if (!mix || !street.spans.length) continue;
    const span = street.spans[0];
    const length = span.max - span.min;
    // A steady ordinary flow: the valley has cars but no prestige traffic.
    const count = length > 240 ? Math.max(1, Math.round(length / 320)) : 0;
    const random = makeRandom(Math.round(street.samples[0].x + street.samples[0].z * 3));
    for (let i = 0; i < count; i++) {
      const roll = random();
      let acc = 0, kind: VehicleKind = 'hatchback';
      for (const option of mix) { acc += option.weight; if (roll < acc) { kind = option.kind; break; } }
      out.push({
        id: `rv${id++}`, kind, streetId: street.id, spanIndex: 0,
        s: random() * length, dir: random() < 0.5 ? 1 : -1,
        lane: Math.floor(random() * street.lanes),
        speed: street.speed * 0.3 * VEHICLE_SPEED[kind] * (0.88 + random() * 0.24),
        tint: random(),
      });
    }
  }
  return out;
})();

export type VehiclePose = { x: number; z: number; y: number; angle: number };

/** Move the fleet; vehicles shuttle their span and turn around at the ends. */
export function advanceTraffic(dt: number): void {
  const clamped = Math.min(dt, 0.1);
  for (const v of VEHICLES) {
    const street = RES_NETWORK.streetById.get(v.streetId);
    if (!street) continue;
    const span = street.spans[v.spanIndex];
    if (!span) continue;
    const length = span.max - span.min;
    v.s += v.speed * clamped * v.dir;
    if (v.s < 8) { v.s = 16 - v.s; v.dir = 1; }
    if (v.s > length - 8) { v.s = 2 * (length - 8) - v.s; v.dir = -1; }
    v.s = Math.max(0, Math.min(length, v.s));
  }
}

export function vehiclePose(v: Vehicle): VehiclePose | null {
  const street = RES_NETWORK.streetById.get(v.streetId);
  if (!street) return null;
  const span = street.spans[v.spanIndex];
  if (!span) return null;
  const t = span.min + v.s;
  const sample = streetAt(street, t);
  const d = derivativeAt(street, t);
  const n = leftNormal(d);
  const right = v.dir === 1 ? { x: -n.x, z: -n.z } : { x: n.x, z: n.z };
  const lateral = ((street.lanes - 1) / 2 - v.lane) * street.laneWidth;
  const heading = v.dir === 1 ? d : { x: -d.x, z: -d.z };
  return {
    x: sample.x + right.x * lateral,
    z: sample.z + right.z * lateral,
    y: sample.y + 0.1,
    angle: Math.atan2(-heading.z, heading.x),
  };
}

export const trafficSummary = (() => {
  const byKind: Record<string, number> = {};
  for (const v of VEHICLES) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  let laneKm = 0;
  for (const lane of LANES) {
    for (let i = 0; i + 1 < lane.points.length; i++) {
      laneKm += Math.hypot(lane.points[i + 1].x - lane.points[i].x, lane.points[i + 1].z - lane.points[i].z);
    }
  }
  let footKm = 0;
  for (const node of PED_NODES.values()) {
    for (const link of node.links) {
      if (link.kind !== 'footway') continue;
      const other = PED_NODES.get(link.to);
      if (other) footKm += distance2d(node.point, other.point) * 0.5;
    }
  }
  return {
    lanes: LANES.length, laneKm: Math.round(laneKm / 100) / 10,
    vehicles: VEHICLES.length, byKind,
    crossings: CROSSINGS.length,
    parkingBays: PARKING_BAYS.length,
    busStops: BUS_STOPS.length,
    pedNodes: PED_NODES.size,
    footwayKm: Math.round(footKm / 100) / 10,
  };
})();

export { lerp2 };
export type { Junction, ParkingLot };
