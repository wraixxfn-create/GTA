/**
 * Street furniture, planting, parked cars and the small structures of public space.
 *
 * Props are placed from the same street and parcel data as everything else — lamps and
 * trees follow the footway, shelters sit on transit stop pads, café tables come out of
 * shopfronts with a wide pavement — so they never float or intersect a building wall.
 * They are drawn as instanced meshes, one draw call per type per tile.
 */
import type { Point } from '../world/data';
import { NETWORK, streetAt, type Street } from './streets';
import { PLAN } from './blocks';
import { CITY } from './buildings';
import { BUS_STOPS, PARKING_BAYS, SIGNALS } from './traffic';
import { cityGround, hash01, makeRandom } from './frame';
import { distance2d, normalize, polygonArea, polygonBounds, polygonCentroid, sub } from './geometry2d';

export type PropKind =
  | 'lamp' | 'tree' | 'bench' | 'bin' | 'bollard' | 'planter' | 'shelter' | 'signal'
  | 'ped-signal' | 'car' | 'cafe' | 'rack' | 'fountain' | 'flag' | 'kiosk' | 'meter'
  | 'sculpture' | 'pavilion' | 'play' | 'hydrant' | 'totem' | 'bollard-row';

export type Prop = {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  angle: number;
  scale: number;
  tint: number;
};

export const PROPS: Prop[] = [];
const random = makeRandom(0x77a31);

function push(kind: PropKind, point: Point, angle: number, scale = 1, tint = random()): void {
  PROPS.push({ kind, x: point.x, z: point.z, y: cityGround(point.x, point.z), angle, scale, tint });
}

/** Intervals of a street that are not inside a junction table (mirrors the surfaces). */
function openIntervals(street: Street): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = [];
  for (const span of street.spans) out.push({ ...span });
  for (const junction of NETWORK.junctions) {
    if (!junction.streets.includes(street.id)) continue;
    junction.arms.filter(a => a.streetId === street.id).forEach(arm => {
      const reach = 14;
      for (let i = out.length - 1; i >= 0; i--) {
        const piece = out[i];
        if (arm.t + reach <= piece.min || arm.t - reach >= piece.max) continue;
        const pieces: { min: number; max: number }[] = [];
        if (arm.t - reach > piece.min) pieces.push({ min: piece.min, max: arm.t - reach });
        if (arm.t + reach < piece.max) pieces.push({ min: arm.t + reach, max: piece.max });
        out.splice(i, 1, ...pieces);
      }
    });
  }
  return out;
}

function streetFurniture(): void {
  for (const street of NETWORK.streets) {
    const minor = street.kind === 'alley' || street.kind === 'service';
    for (const interval of openIntervals(street)) {
      const length = interval.max - interval.min;
      if (length < 14) continue;
      const half = street.width / 2;
      const sw = Math.max(street.sidewalk, 0);
      const lampStep = street.kind === 'lane' ? 34 : 28;
      const treeStep = sw >= 4 ? 11.5 : sw >= 3 ? 15 : 0;
      const sides = street.kind === 'lane' || street.kind === 'street' ? [1, -1] : [1, -1];
      for (let t = interval.min + 6; t < interval.max - 6; t += lampStep) {
        const sample = streetAt(street, t);
        const ahead = streetAt(street, t + 2);
        const dir = normalize(sub(ahead, sample));
        const n = { x: -dir.z, z: dir.x };
        for (const side of sides) {
          if (minor) continue;
          push('lamp', {
            x: sample.x + n.x * (half + Math.min(1.5, sw * .35)) * side,
            z: sample.z + n.z * (half + Math.min(1.5, sw * .35)) * side,
          }, Math.atan2(n.x * side, n.z * side), 1);
        }
      }
      if (treeStep && !minor) {
        for (let t = interval.min + 4; t < interval.max - 4; t += treeStep) {
          if (hash01(Math.round(t), Math.round(street.offset ?? 0), 21) < .22) continue;
          const sample = streetAt(street, t);
          const ahead = streetAt(street, t + 2);
          const dir = normalize(sub(ahead, sample));
          const n = { x: -dir.z, z: dir.x };
          for (const side of [1, -1] as const) {
            if (sw < 3.2) continue;
            push('tree', {
              x: sample.x + n.x * (half + sw * .62) * side,
              z: sample.z + n.z * (half + sw * .62) * side,
            }, 0, .82 + random() * .5);
          }
        }
      }
      if (!minor && sw >= 4) {
        for (let t = interval.min + 20; t < interval.max - 20; t += street.kind === 'boulevard' ? 52 : 78) {
          const sample = streetAt(street, t);
          const ahead = streetAt(street, t + 2);
          const dir = normalize(sub(ahead, sample));
          const n = { x: -dir.z, z: dir.x };
          const side = hash01(Math.round(t), 3, 5) < .5 ? 1 : -1;
          push('bench', {
            x: sample.x + n.x * (half + sw * .55) * side,
            z: sample.z + n.z * (half + sw * .55) * side,
          }, Math.atan2(n.x * side, n.z * side) + Math.PI / 2, 1);
          if (random() < .55) {
            push('bin', {
              x: sample.x + n.x * (half + sw * .8) * side,
              z: sample.z + n.z * (half + sw * .8) * side,
            }, 0, 1);
          }
        }
      }
    }
    if (street.kind === 'pedestrian') {
      // Pedestrian streets are closed with bollards and planted.
      for (const span of street.spans) {
        for (let t = span.min + 3; t < span.max - 3; t += 9) {
          const sample = streetAt(street, t);
          const ahead = streetAt(street, t + 2);
          const dir = normalize(sub(ahead, sample));
          const n = { x: -dir.z, z: dir.x };
          for (const side of [1, -1] as const) {
            const offset = street.width / 2 - 1.2;
            push('planter', {
              x: sample.x + n.x * offset * side, z: sample.z + n.z * offset * side,
            }, Math.atan2(dir.x, dir.z), 1);
          }
        }
      }
    }
  }
}

function signalsAndStops(): void {
  for (const signal of SIGNALS) {
    if (signal.kind === 'vehicle') {
      push('signal', signal.point, Math.atan2(signal.dir.x, signal.dir.z), 1);
    } else {
      push('ped-signal', signal.point, Math.atan2(signal.dir.x, signal.dir.z), 1);
    }
  }
  for (const stop of BUS_STOPS) {
    if (stop.shelter) push('shelter', stop.point, Math.atan2(stop.dir.x, stop.dir.z), 1);
    push('totem', {
      x: stop.point.x + stop.dir.x * 6.5, z: stop.point.z + stop.dir.z * 6.5,
    }, Math.atan2(-stop.dir.x, -stop.dir.z), 1);
    push('bench', {
      x: stop.point.x + stop.dir.x * 2, z: stop.point.z + stop.dir.z * 2,
    }, Math.atan2(stop.dir.x, stop.dir.z), 1);
  }
  // Parking meters beside the first bay of each run.
  let last = -1;
  for (const bay of PARKING_BAYS) {
    const key = Math.round(bay.centre.x / 30);
    if (key === last) continue;
    last = key;
    push('meter', { x: bay.centre.x + bay.dir.x * 3.2, z: bay.centre.z + bay.dir.z * 3.2 },
      Math.atan2(bay.dir.x, bay.dir.z), 1);
  }
}

/** Cars parked on the kerb and in the surface courts behind the street wall. */
function parkedCars(): void {
  let count = 0;
  for (const bay of PARKING_BAYS) {
    if (hash01(Math.round(bay.centre.x), Math.round(bay.centre.z), 31) > .72) continue;
    const n = { x: -bay.dir.z, z: bay.dir.x };
    push('car', {
      x: bay.centre.x + n.x * 0.2 * (bay.side > 0 ? 1 : -1),
      z: bay.centre.z + n.z * 0.2 * (bay.side > 0 ? 1 : -1),
    }, Math.atan2(bay.dir.x, bay.dir.z), 1, hash01(Math.round(bay.centre.x), 41, 3));
    count++;
  }
  for (const courtyard of PLAN.courtyards) {
    if (courtyard.kind !== 'parking') continue;
    const bounds = polygonBounds(courtyard.polygon);
    const centre = polygonCentroid(courtyard.polygon);
    const area = polygonArea(courtyard.polygon);
    const rows = Math.max(1, Math.floor(Math.sqrt(area) / 9));
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < rows; column++) {
        const x = bounds.minX + (column + .5) * (bounds.maxX - bounds.minX) / rows;
        const z = bounds.minZ + (row + .5) * (bounds.maxZ - bounds.minZ) / rows;
        if (hash01(Math.round(x), Math.round(z), 51) > .58) continue;
        // Rows face alternate ways, the way a court is actually striped.
        push('car', { x, z }, row % 2 ? Math.PI / 2 : -Math.PI / 2, 1, hash01(Math.round(x), 61, 3));
        count++;
      }
    }
    void centre;
  }
  void count;
}

/** Café tables outside shopfronts with room on the pavement. */
function cafeTerraces(): void {
  for (const building of CITY.buildings) {
    if (!building.shopfront || building.tenants.length === 0) continue;
    if (hash01(Math.round(building.centre.x), Math.round(building.centre.z), 71) > .22) continue;
    const entrance = building.entrance;
    const dir = normalize(entrance.dir);
    const n = { x: -dir.z, z: dir.x };
    const sets = 1 + Math.floor((building.frontageLength ?? 0) / 14);
    for (let i = 0; i < Math.min(2, sets); i++) {
      const along = (i - 1) * 2.6;
      push('cafe', {
        x: entrance.point.x + dir.x * 1.1 + n.x * along,
        z: entrance.point.z + dir.z * 1.1 + n.z * along,
      }, Math.atan2(dir.x, dir.z), 1);
    }
  }
}

/** Public space: fountains, pavilions, planting, play, market stalls and sculpture. */
function publicSpace(): void {
  for (const space of CITY.openSpace) {
    const centre = polygonCentroid(space.polygon);
    const bounds = polygonBounds(space.polygon);
    const spread = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    switch (space.feature) {
      case 'fountain': {
        push('fountain', centre, 0, Math.min(2.4, spread / 22));
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const radius = spread * .28;
          push('bench', { x: centre.x + Math.cos(angle) * radius, z: centre.z + Math.sin(angle) * radius }, angle + Math.PI / 2, 1);
        }
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + .4;
          const radius = spread * .42;
          push('tree', { x: centre.x + Math.cos(angle) * radius, z: centre.z + Math.sin(angle) * radius }, 0, 1.15);
        }
        break;
      }
      case 'pavilion':
        push('pavilion', centre, hash01(Math.round(centre.x), 1, 1) * Math.PI, Math.min(1.6, spread / 20));
        break;
      case 'sculpture':
        push('sculpture', centre, hash01(Math.round(centre.x), 2, 2) * Math.PI, Math.min(1.8, spread / 16));
        break;
      case 'bosque':
      case 'trees': {
        const step = 9.5;
        for (let z = bounds.minZ + 4; z < bounds.maxZ; z += step) {
          for (let x = bounds.minX + 4; x < bounds.maxX; x += step) {
            const jitter = hash01(Math.round(x), Math.round(z), 81);
            if (jitter > .62) continue;
            push('tree', { x: x + (jitter - .3) * 3, z: z + (jitter - .5) * 3 }, 0, .95 + jitter * .6);
          }
        }
        break;
      }
      case 'playground':
        push('play', centre, 0, Math.min(1.5, spread / 18));
        break;
      case 'market': {
        const step = 7;
        for (let z = bounds.minZ + 4; z < bounds.maxZ - 3; z += step) {
          for (let x = bounds.minX + 4; x < bounds.maxX - 3; x += step) {
            push('kiosk', { x, z }, hash01(Math.round(x), Math.round(z), 91) * .6 - .3, .8 + hash01(Math.round(x), 3, 3) * .4);
          }
        }
        break;
      }
      case 'portecochere':
        for (let i = 0; i < 4; i++) {
          push('flag', { x: bounds.minX + 6 + i * (bounds.maxX - bounds.minX - 12) / 3, z: bounds.minZ + 5 }, 0, 1);
        }
        break;
      case 'amphitheatre':
        break;
      default: {
        if (space.kind === 'lawn') {
          const step = 14;
          for (let z = bounds.minZ + 5; z < bounds.maxZ; z += step) {
            for (let x = bounds.minX + 5; x < bounds.maxX; x += step) {
              if (hash01(Math.round(x), Math.round(z), 101) > .35) continue;
              push('tree', { x, z }, 0, 1 + hash01(Math.round(x), 5, 5) * .5);
            }
          }
        } else {
          const step = 12;
          for (let z = bounds.minZ + 5; z < bounds.maxZ; z += step) {
            for (let x = bounds.minX + 5; x < bounds.maxX; x += step) {
              if (hash01(Math.round(x), Math.round(z), 111) > .5) continue;
              push('bin', { x, z }, 0, 1);
            }
          }
        }
      }
    }
  }
  // Verge planting along the city edge.
  for (const courtyard of PLAN.courtyards) {
    if (courtyard.kind === 'parking') continue;
    if (polygonArea(courtyard.polygon) < 500) continue;
    const centre = polygonCentroid(courtyard.polygon);
    push('tree', centre, 0, 1.2);
  }
}

streetFurniture();
signalsAndStops();
parkedCars();
cafeTerraces();
publicSpace();

/* ── spatial index ─────────────────────────────────────────────────────────────── */

const CELL = 120;
const GRID = new Map<string, number[]>();
PROPS.forEach((prop, index) => {
  const key = `${Math.floor(prop.x / CELL)}:${Math.floor(prop.z / CELL)}`;
  const list = GRID.get(key) ?? [];
  list.push(index);
  GRID.set(key, list);
});

export function propsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Prop[] {
  const out: Prop[] = [];
  const seen = new Set<number>();
  const first = { x: Math.floor(bounds.minX / CELL), z: Math.floor(bounds.minZ / CELL) };
  const last = { x: Math.floor(bounds.maxX / CELL), z: Math.floor(bounds.maxZ / CELL) };
  for (let z = first.z; z <= last.z; z++) {
    for (let x = first.x; x <= last.x; x++) {
      for (const index of GRID.get(`${x}:${z}`) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const prop = PROPS[index];
        if (prop.x < bounds.minX || prop.x > bounds.maxX || prop.z < bounds.minZ || prop.z > bounds.maxZ) continue;
        out.push(prop);
      }
    }
  }
  return out;
}

export const PROP_COUNT: Record<string, number> = PROPS.reduce<Record<string, number>>((counts, prop) => {
  counts[prop.kind] = (counts[prop.kind] ?? 0) + 1;
  return counts;
}, {});
export function propDistance(a: Prop, x: number, z: number): number {
  return distance2d({ x: a.x, z: a.z }, { x, z });
}
