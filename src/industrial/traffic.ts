/**
 * Traffic of the flats: lane geometry for future vehicle AI, and a light kinetic
 * fleet — trucks on the haulways, vans on the works roads, cars around the offices —
 * that shuttles the signed routes so the district is never a still life.
 *
 * Nothing here is a gameplay system: vehicles follow their street spans and turn
 * around at the ends. The lane graph (streets → edges → junctions) is the spatial
 * opportunity future missions, deliveries and chases can build on.
 */
import { leftNormal, normalize } from '../city/geometry2d';
import { IND_NETWORK, streetAt, derivativeAt, type IndStreet } from './plan';
import { makeRandom } from './frame';

export type IndLane = {
  id: string;
  streetId: string;
  spanIndex: number;
  index: number;
  width: number;
  speed: number;
  points: { x: number; y: number; z: number }[];
};

export const LANES: IndLane[] = (() => {
  const out: IndLane[] = [];
  for (const street of IND_NETWORK.streets) {
    if (street.kind === 'yard') continue;
    street.spans.forEach((span, spanIndex) => {
      for (let l = 0; l < street.lanes; l++) {
        const lateral = (l - (street.lanes - 1) / 2) * street.laneWidth;
        const points: { x: number; y: number; z: number }[] = [];
        for (let i = 0; i < street.samples.length; i++) {
          const s = street.samples[i];
          if (s.span !== spanIndex || s.t > span.max + 1e-6) continue;
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

/* ── the kinetic fleet ───────────────────────────────────────────────────────── */

export type VehicleKind = 'lorry' | 'truck' | 'van' | 'car';
export type IndVehicle = {
  id: string;
  kind: VehicleKind;
  streetId: string;
  spanIndex: number;
  /** Distance along the span, metres. */
  s: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  tint: number;
};

const FLEET_MIX: Record<string, { kind: VehicleKind; weight: number }[]> = {
  haulway: [{ kind: 'lorry', weight: .5 }, { kind: 'truck', weight: .35 }, { kind: 'van', weight: .15 }],
  boulevard: [{ kind: 'truck', weight: .4 }, { kind: 'car', weight: .35 }, { kind: 'van', weight: .25 }],
  arterial: [{ kind: 'truck', weight: .4 }, { kind: 'car', weight: .4 }, { kind: 'van', weight: .2 }],
  collector: [{ kind: 'van', weight: .45 }, { kind: 'truck', weight: .25 }, { kind: 'car', weight: .3 }],
  secondary: [{ kind: 'truck', weight: .3 }, { kind: 'car', weight: .4 }, { kind: 'van', weight: .3 }],
  service: [{ kind: 'van', weight: .7 }, { kind: 'car', weight: .3 }],
};
const VEHICLE_SPEED: Record<VehicleKind, number> = { lorry: .78, truck: .85, van: .95, car: 1.05 };

export const VEHICLES: IndVehicle[] = (() => {
  const out: IndVehicle[] = [];
  let id = 0;
  for (const street of IND_NETWORK.streets) {
    if (street.kind === 'yard') continue;
    const mix = FLEET_MIX[street.kind] ?? FLEET_MIX.collector;
    street.spans.forEach((span, spanIndex) => {
      const length = span.max - span.min;
      // Roughly one vehicle per 550 m of signed route, at least one on any span
      // longer than 300 m, so no working street looks dead.
      const count = length > 300 ? Math.max(1, Math.round(length / 550)) : 0;
      const random = makeRandom(Math.round(street.samples[0].x + street.samples[0].z * 3 + spanIndex * 17));
      for (let i = 0; i < count; i++) {
        const roll = random();
        let acc = 0, kind: VehicleKind = 'van';
        for (const option of mix) { acc += option.weight; if (roll < acc) { kind = option.kind; break; } }
        const lanes = street.lanes;
        out.push({
          id: `veh${id++}`, kind, streetId: street.id, spanIndex,
          s: random() * length, dir: random() < 0.5 ? 1 : -1,
          lane: Math.floor(random() * lanes),
          speed: street.speed * 0.3 * VEHICLE_SPEED[kind] * (0.85 + random() * 0.3),
          tint: random(),
        });
      }
    });
  }
  return out;
})();

export type VehiclePose = { x: number; z: number; y: number; angle: number };

/** Move the fleet; vehicles shuttle their span and turn around at the ends. */
export function advanceTraffic(dt: number): void {
  const clamped = Math.min(dt, 0.1);
  for (const v of VEHICLES) {
    const street = IND_NETWORK.streetById.get(v.streetId);
    if (!street) continue;
    const span = street.spans[v.spanIndex];
    if (!span) continue;
    const length = span.max - span.min;
    v.s += v.speed * clamped * v.dir;
    if (v.s < 6) { v.s = 12 - v.s; v.dir = 1; }
    if (v.s > length - 6) { v.s = 2 * (length - 6) - v.s; v.dir = -1; }
    v.s = Math.max(0, Math.min(length, v.s));
  }
}

export function vehiclePose(v: IndVehicle): VehiclePose | null {
  const street: IndStreet | undefined = IND_NETWORK.streetById.get(v.streetId);
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
  return { lanes: LANES.length, vehicles: VEHICLES.length, byKind, laneKm: Math.round(laneKm / 100) / 10 };
})();
