/**
 * Prop placement for the Residential Valley: where the street furniture, planting,
 * playground kit, parked cars and the small clutter of lived-in neighbourhoods stand.
 */
import { hash01, resGround, makeRandom } from './frame';
import { RES_NETWORK, streetAt, derivativeAt, streetNormal } from './plan';
import { RES_BUILDINGS } from './buildings';
import { GROUNDS, PARKING_LOTS, SITE_GROUNDS } from './sites';
import { PARKING_BAYS, BUS_STOPS } from './traffic';
import { LANDMARK_SITES } from './identity';
import type { PropKind } from './propmesh';
import { distance2d, leftNormal, normalize, polygonCentroid, sub, add, scale } from '../city/geometry2d';
import type { Point } from '../world/data';

export type Prop = {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  angle: number;
  scale: number;
  tint: number;
};

const props: Prop[] = [];

function place(kind: PropKind, x: number, z: number, angle: number, scale = 1, tint = 0.5, y?: number): void {
  props.push({ kind, x, y: y ?? resGround(x, z), z, angle, scale, tint });
}

/* ── street trees and furniture along the frontages ───────────────────────────── */

for (const street of RES_NETWORK.streets) {
  const span = street.spans[0];
  if (!span) continue;
  const step = street.kind === 'arterial' ? 18 : street.kind === 'terrace' ? 34 : 28;
  for (let t = span.min + 8; t < span.max - 8; t += step) {
    const s = streetAt(street, t);
    const dir = derivativeAt(street, t);
    const n = streetNormal(street, t);
    const angle = Math.atan2(-dir.z, dir.x);
    const jitter = hash01(Math.round(t), street.id.length, 5);
    for (const side of [1, -1] as const) {
      const lateral = (street.width / 2 + street.sidewalk * 0.75) * side;
      const px = s.x + n.x * lateral, pz = s.z + n.z * lateral;
      // Street trees: the valley's avenues and residential streets are lined.
      if (street.kind === 'arterial' || street.kind === 'collector' || (street.kind === 'local' && jitter < 0.35)) {
        if (jitter < 0.7) {
          place(jitter < 0.42 ? 'tree-round' : 'tree-conifer', px, pz, jitter * 3.1, 0.85 + jitter * 0.5, jitter, s.y);
        }
      }
      // Lamps on one side of the street at wider spacing.
      if (side === 1 && jitter > 0.25) {
        place('street-lamp', s.x + n.x * (street.width / 2 + street.sidewalk * 0.4) * side, pz, angle, 1, 0.5, s.y);
      }
      // Benches near the park paths and bus stops.
      if (street.kind === 'pedestrian' && jitter < 0.5) {
        place('bench', px, pz, angle, 1, 0.5, s.y);
      }
      if (jitter > 0.92) place('bin', px, pz, angle, 1, 0.5, s.y);
    }
  }
}

/* ── parked cars on the kerbs and in the lots ─────────────────────────────────── */

const CAR_KINDS: PropKind[] = ['car-hatchback', 'car-saloon', 'estate-car', 'van', 'pickup'];
for (const bay of PARKING_BAYS) {
  const angle = Math.atan2(-bay.dir.z, bay.dir.x);
  const roll = hash01(Math.round(bay.centre.x), Math.round(bay.centre.z), 17);
  if (roll < (bay.lot ? 0.62 : 0.55)) continue; // plenty of bays stand empty
  const kind = CAR_KINDS[Math.floor(roll * CAR_KINDS.length) % CAR_KINDS.length];
  place(kind, bay.centre.x, bay.centre.z, angle, 1, hash01(Math.round(bay.centre.x), 3, 19), resGround(bay.centre.x, bay.centre.z) + 0.02);
}
for (const lot of PARKING_LOTS) {
  const centre = polygonCentroid(lot.polygon);
  place('park-meter', centre.x, centre.z, 0, 1, 0.5);
  for (const corner of lot.polygon) {
    if (hash01(Math.round(corner.x), Math.round(corner.z), 23) < 0.5) place('tree-round', corner.x, corner.z, 0, 0.9, 0.4);
  }
}

/* ── grounds: playground kit, goals, hedges, washing lines ────────────────────── */

for (const ground of GROUNDS) {
  const centre = polygonCentroid(ground.polygon);
  switch (ground.kind) {
    case 'playground': {
      place('swing-frame', centre.x - 4, centre.z, 0, 1, 0.5);
      place('slide', centre.x + 4, centre.z + 2, 0.6, 1, 0.5);
      place('climbing-frame', centre.x + 1, centre.z - 4, 0.3, 1, 0.5);
      place('bench', centre.x, centre.z + 8, Math.PI, 1, 0.5);
      place('bin', centre.x + 7, centre.z + 7, 0, 1, 0.5);
      break;
    }
    case 'court':
      place('goal-post', centre.x, centre.z - 8, 0, 1, 0.5);
      place('goal-post', centre.x, centre.z + 8, Math.PI, 1, 0.5);
      break;
    case 'kickabout':
      place('goal-post', centre.x, centre.z - 12, 0, 1, 0.5);
      place('goal-post', centre.x, centre.z + 12, Math.PI, 1, 0.5);
      break;
    case 'garden': {
      const roll = hash01(Math.round(centre.x), Math.round(centre.z), 29);
      if (roll < 0.14) place('shed', centre.x, centre.z, roll * 3, 1, 0.5);
      if (roll > 0.86) place('washing-line', centre.x, centre.z, roll * 3, 1, 0.5);
      if (roll > 0.4 && roll < 0.5) place('flower-bed', centre.x, centre.z, roll * 3, 1, 0.5);
      if (roll > 0.55 && roll < 0.6) place('tree-conifer', centre.x, centre.z, 0, 1, 0.45);
      break;
    }
    case 'lawn':
      if (hash01(Math.round(centre.x), 7, 31) < 0.3) place('tree-round', centre.x, centre.z, 0, 1.1, 0.4);
      break;
    case 'park':
      break;
    case 'plaza':
      place('planter', centre.x - 5, centre.z, 0, 1, 0.5);
      place('planter', centre.x + 5, centre.z, 0, 1, 0.5);
      place('bench', centre.x, centre.z + 4, Math.PI / 2, 1, 0.5);
      break;
    case 'pond': {
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        place('bench', centre.x + Math.cos(angle) * 12, centre.z + Math.sin(angle) * 12, angle + Math.PI, 1, 0.5);
      }
      place('tree-round', centre.x + 10, centre.z - 10, 0, 1.1, 0.35);
      break;
    }
    default:
      break;
  }
}

/* ── perimeters: hedges and fences along plot fronts ──────────────────────────── */

for (const building of RES_BUILDINGS) {
  if (building.kind !== 'house') continue;
  const roll = hash01(Math.round(building.centre.x), Math.round(building.centre.z), 37);
  const dir = building.door.dir;
  if (roll < 0.4) {
    const n = leftNormal(dir);
    for (const side of [-1, 1] as const) {
      place('hedge',
        building.door.point.x + n.x * side * 3.2 - dir.x * 3,
        building.door.point.z + n.z * side * 3.2 - dir.z * 3,
        Math.atan2(-dir.z, dir.x), 1, 0.5);
    }
  }
  if (roll > 0.9) place('postbox', building.door.point.x - dir.x * 4.5, building.door.point.z - dir.z * 4.5, 0, 1, 0.5);
}

/* ── landmark dressing ────────────────────────────────────────────────────────── */

for (const site of LANDMARK_SITES) {
  const x0 = site.rect.x0, x1 = site.rect.x1, z0 = site.rect.z0, z1 = site.rect.z1;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  switch (site.id) {
    case 'mill-green':
      for (let i = 0; i < 14; i++) {
        const t = i / 14;
        place(i % 3 === 0 ? 'tree-conifer' : 'tree-round',
          x0 + (x1 - x0) * ((i * 0.173) % 1), z0 + (z1 - z0) * ((i * 0.311) % 1),
          t * 3, 1.1 + (i % 4) * 0.12, 0.3 + (i % 5) * 0.08);
      }
      place('bin', cx - 20, cz, 0, 1, 0.5);
      place('bin', cx + 20, cz + 30, 0, 1, 0.5);
      break;
    case 'market-row':
      for (let i = 0; i < 8; i++) {
        place('bin', x0 + (x1 - x0) * (i / 8), z0 - 4, 0, 1, 0.5);
        if (i % 2 === 0) place('planter', x0 + (x1 - x0) * (i / 8) + 8, z1 + 4, 0, 1, 0.5);
      }
      break;
    case 'warfield-hall':
      place('sign-post', cx - 25, z1 - 10, 0, 1, 0.5);
      place('bench', cx, z1 - 5, Math.PI, 1, 0.5);
      place('bench', cx - 10, z1 - 5, Math.PI, 1, 0.5);
      place('bin', cx + 15, z1 - 8, 0, 1, 0.5);
      break;
    case 'rosecourt':
      for (let i = 0; i < 6; i++) {
        place('washing-line', x0 + 40 + i * 25, z1 - 40, 0, 1, 0.5);
      }
      place('bin', cx, z0 + 20, 0, 1.1, 0.5);
      place('bin', cx + 30, z1 - 20, 0, 1.1, 0.5);
      break;
    case 'valley-garage': case 'orchard-fuel':
      place('fuel-pump', cx - 8, cz, 0, 1, 0.5);
      place('fuel-pump', cx + 2, cz, 0, 1, 0.5);
      place('fuel-pump', cx + 12, cz, 0, 1, 0.5);
      break;
    case 'millgate-primary': case 'brook-lane-academy':
      place('bin', x0 + 15, z1 - 15, 0, 1, 0.5);
      place('sign-post', (x0 + x1) / 2, z1 + 3, 0, 1, 0.5);
      break;
  }
  void cx; void cz;
}

/* ── bus shelters at the stops ────────────────────────────────────────────────── */

for (const stop of BUS_STOPS) {
  place('bus-shelter', stop.point.x, stop.point.z, hash01(Math.round(stop.point.x), 1, 41) * 3.1, 1, 0.5);
}

export const RES_PROPS: readonly Prop[] = props;

export function propsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Prop[] {
  return props.filter(p =>
    p.x >= bounds.minX - 10 && p.x <= bounds.maxX + 10 && p.z >= bounds.minZ - 10 && p.z <= bounds.maxZ + 10);
}

export const propSummary = (() => {
  const byKind: Record<string, number> = {};
  for (const p of props) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  return { count: props.length, byKind, kinds: Object.keys(byKind).length };
})();
