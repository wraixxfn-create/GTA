/**
 * Traffic of Vantage Heights: lane geometry for future vehicle AI, and a very light
 * kinetic fleet of expensive cars shuttling the through routes.
 *
 * The district is deliberately quiet. Downtown moves a dense mixed fleet; the works move
 * fifty lorries, trucks and vans. Here twenty-six saloons, coupés, SUVs and one limousine
 * cover the boulevard, the collector, the scenic roads and the six regional routes carried
 * through the district — and the private drives and estate lanes get nothing at all, because
 * a gated lane is not a through road.
 *
 * Nothing here is a gameplay system: vehicles follow their street span and turn around at
 * the ends. The lane graph (streets → edges → junctions) is the spatial opportunity future
 * missions, pursuits and arrivals can build on.
 */
import { leftNormal, normalize } from '../city/geometry2d';
import { W_NETWORK, streetAt, derivativeAt, type Street } from './plan';
import { makeRandom } from './frame';

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
  for (const street of W_NETWORK.streets) {
    if (street.kind === 'pedestrian' || !street.lanes) continue;
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
          // Two carriageways either side of the median: shift each side outward.
          const median = street.median / 2 + 0.6;
          const offset = lateral + (lateral >= 0 ? median : -median);
          points.push({ x: s.x + n.x * offset, y: s.y + 0.11, z: s.z + n.z * offset });
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

export type VehicleKind = 'saloon' | 'coupe' | 'suv' | 'limousine';
export type Vehicle = {
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

/** Which streets carry traffic at all. Private drives and estate lanes carry none. */
const FLEET_MIX: Record<string, { kind: VehicleKind; weight: number }[]> = {
  boulevard: [{ kind: 'saloon', weight: .34 }, { kind: 'coupe', weight: .26 }, { kind: 'suv', weight: .3 }, { kind: 'limousine', weight: .1 }],
  collector: [{ kind: 'saloon', weight: .4 }, { kind: 'suv', weight: .38 }, { kind: 'coupe', weight: .22 }],
  scenic: [{ kind: 'coupe', weight: .45 }, { kind: 'saloon', weight: .35 }, { kind: 'suv', weight: .2 }],
  ridge: [{ kind: 'coupe', weight: .4 }, { kind: 'saloon', weight: .4 }, { kind: 'suv', weight: .2 }],
  arterial: [{ kind: 'saloon', weight: .42 }, { kind: 'suv', weight: .34 }, { kind: 'coupe', weight: .16 }, { kind: 'limousine', weight: .08 }],
  secondary: [{ kind: 'saloon', weight: .4 }, { kind: 'suv', weight: .36 }, { kind: 'coupe', weight: .24 }],
};
const VEHICLE_SPEED: Record<VehicleKind, number> = { saloon: 1, coupe: 1.08, suv: .96, limousine: .9 };

/**
 * The boulevard carries chauffeur traffic by right, not by luck of the draw: with only a
 * couple of dozen vehicles in the whole district a 10% weight can roll empty. Its first
 * car is therefore always a limousine.
 */
const GUARANTEED_FIRST: Record<string, VehicleKind> = { boulevard: 'limousine' };

export const VEHICLES: Vehicle[] = (() => {
  const out: Vehicle[] = [];
  let id = 0;
  for (const street of W_NETWORK.streets) {
    const mix = FLEET_MIX[street.kind];
    if (!mix) continue;
    street.spans.forEach((span, spanIndex) => {
      const length = span.max - span.min;
      // Roughly one car per 800 m of through route — a fraction of the works' fifty
      // lorries and vans, and lighter again than downtown's flow.
      const count = length > 480 ? Math.max(1, Math.round(length / 800)) : 0;
      const random = makeRandom(Math.round(street.samples[0].x + street.samples[0].z * 3 + spanIndex * 17));
      for (let i = 0; i < count; i++) {
        const roll = random();
        let acc = 0, kind: VehicleKind = 'saloon';
        for (const option of mix) { acc += option.weight; if (roll < acc) { kind = option.kind; break; } }
        if (i === 0 && GUARANTEED_FIRST[street.kind]) kind = GUARANTEED_FIRST[street.kind];
        out.push({
          id: `wv${id++}`, kind, streetId: street.id, spanIndex,
          s: random() * length, dir: random() < 0.5 ? 1 : -1,
          lane: Math.floor(random() * street.lanes),
          speed: street.speed * 0.28 * VEHICLE_SPEED[kind] * (0.88 + random() * 0.24),
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
    const street = W_NETWORK.streetById.get(v.streetId);
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
  const street: Street | undefined = W_NETWORK.streetById.get(v.streetId);
  if (!street) return null;
  const span = street.spans[v.spanIndex];
  if (!span) return null;
  const t = span.min + v.s;
  const sample = streetAt(street, t);
  const d = derivativeAt(street, t);
  const n = leftNormal(d);
  const right = v.dir === 1 ? { x: -n.x, z: -n.z } : { x: n.x, z: n.z };
  const lateral = ((street.lanes - 1) / 2 - v.lane) * street.laneWidth + (street.median / 2 + 0.6);
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
  const servedStreets = new Set(VEHICLES.map(v => v.streetId));
  return {
    lanes: LANES.length, vehicles: VEHICLES.length, byKind,
    laneKm: Math.round(laneKm / 100) / 10,
    servedStreets: servedStreets.size,
    quietStreets: W_NETWORK.streets.filter(s => !servedStreets.has(s.id)).length,
  };
})();
