/**
 * Environmental props: the dressing that makes the hill read as wealthy and watched.
 *
 * Street lighting follows the road hierarchy — standards on the boulevard and collector,
 * low bollards on the private drives — and the avenue trees follow the roads too. Gates get
 * piers, leaves, topiary and a sign; district and estate gates get a sentry box and a camera.
 * Pools get loungers, terraces get parasols, plazas get sculpture, and the forecourts hold a
 * scattered fleet of expensive cars as placeholders for future traffic.
 *
 * The cameras and sentry boxes are static geometry only. Nothing here sees, patrols or
 * reacts: NPC and security AI are deliberately not part of this district.
 */
import type { Point } from '../world/data';
import {
  distance2d, leftNormal, normalize, polygonArea, polygonBounds, polygonCentroid, sub,
} from '../city/geometry2d';
import { pointInPolygon } from '../world/geometry';
import { hash01, hillGround, makeRandom } from './frame';
import { LANDMARK_ESTATES, estatePolygon } from './identity';
import {
  W_BUILDINGS, W_GARDENS, W_GATES, W_WALLS, W_WATERS, type Building,
} from './buildings';
import { W_NETWORK, type Street } from './plan';
import type { PropKind } from './propmesh';

export type Prop = {
  kind: PropKind;
  x: number; z: number; y: number;
  angle: number;
  scale: number;
  tint: number;
};

const props: Prop[] = [];
function push(kind: PropKind, p: Point, angle = 0, scale = 1, tint = 0.5, lift = 0, y?: number): void {
  props.push({ kind, x: p.x, z: p.z, y: (y ?? hillGround(p.x, p.z)) + lift, angle, scale, tint });
}
const angleOf = (dir: Point): number => Math.atan2(-dir.z, dir.x);

/* ── street lighting and planting ─────────────────────────────────────────────── */

const LAMP_SPACING: Partial<Record<Street['kind'], number>> = {
  boulevard: 34, collector: 42, scenic: 56, ridge: 62, arterial: 48, secondary: 58,
  private: 74, lane: 92,
};

function streetFurniture(): void {
  for (const street of W_NETWORK.streets) {
    const spacing = LAMP_SPACING[street.kind];
    if (!spacing) continue;
    const avenue = street.kind === 'boulevard';
    let nextAt = 18;
    for (let i = 1; i < street.samples.length; i++) {
      const a = street.samples[i - 1], b = street.samples[i];
      if (a.span !== b.span) continue;
      if (b.t < nextAt) continue;
      nextAt = b.t + spacing;
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      const offset = street.width / 2 + street.shoulder * 0.6 + 1.2;
      for (const side of avenue ? [-1, 1] as const : [1] as const) {
        const p = { x: b.x + n.x * offset * side, z: b.z + n.z * offset * side };
        push(street.kind === 'private' || street.kind === 'lane' ? 'bollard-light' : 'lamp-standard',
          p, angleOf(dir) + Math.PI / 2, 1, hash01(i, street.samples.length, 3));
      }
      // The boulevard's double avenue: a tree either side, outboard of the lamps.
      if (avenue) {
        for (const side of [-1, 1] as const) {
          const p = { x: b.x + n.x * (offset + 4.6) * side, z: b.z + n.z * (offset + 4.6) * side };
          push('tree-cypress', p, hash01(i, 9, 1) * Math.PI, 0.9 + hash01(i, 5, 2) * 0.35, hash01(i, 11, 4));
        }
      }
      // Ornamental trees on the scenic and ridge roads, at intervals rather than in rows.
      if ((street.scenic || street.kind === 'ridge') && i % 4 === 0) {
        const side = hash01(i, 17, 6) > 0.5 ? 1 : -1;
        const p = { x: b.x + n.x * (offset + 6) * side, z: b.z + n.z * (offset + 6) * side };
        push(hash01(i, 23, 8) > 0.5 ? 'tree-round' : 'tree-cypress', p,
          hash01(i, 29, 9) * Math.PI, 0.8 + hash01(i, 31, 10) * 0.5, hash01(i, 37, 11));
      }
    }
  }
}

/* ── gates, cameras and guard stands ──────────────────────────────────────────── */

function gates(): void {
  for (const gate of W_GATES) {
    const n = leftNormal(gate.dir);
    const half = gate.width / 2;
    const angle = angleOf(gate.dir);
    for (const side of [-1, 1] as const) {
      const p = { x: gate.point.x + n.x * (half + 1.1) * side, z: gate.point.z + n.z * (half + 1.1) * side };
      push('gate-pier', p, angle, gate.kind === 'house' ? 0.82 : 1, 0.5, 0, gate.level);
    }
    for (const side of [-1, 1] as const) {
      const p = { x: gate.point.x + n.x * (half * 0.5) * side, z: gate.point.z + n.z * (half * 0.5) * side };
      push('gate-leaf', p, angle, gate.width / 8, 0.5, 0, gate.level);
    }
    // A private house gate gets its piers and nothing else: no sentry, no sign.
    if (gate.kind === 'house') continue;
    // Topiary either side of the entrance, and a name board on the approach.
    for (const side of [-1, 1] as const) {
      const p = {
        x: gate.point.x + gate.dir.x * 3.4 + n.x * (half + 2.6) * side,
        z: gate.point.z + gate.dir.z * 3.4 + n.z * (half + 2.6) * side,
      };
      push('topiary', p, 0, 1, 0.5, 0, gate.level);
    }
    push('sign-board', { x: gate.point.x - gate.dir.x * 5 + n.x * (half + 2.2), z: gate.point.z - gate.dir.z * 5 + n.z * (half + 2.2) },
      angle, 1, 0.5, 0, gate.level);
    // A sentry box and a camera on the gate line: static dressing, no occupant.
    push('guard-stand', { x: gate.point.x + gate.dir.x * 2.5 + n.x * (half + 3.6), z: gate.point.z + gate.dir.z * 2.5 + n.z * (half + 3.6) },
      angle + Math.PI, 1, 0.5, 0, gate.level);
    push('camera', { x: gate.point.x - gate.dir.x * 1.5 - n.x * (half + 1.4), z: gate.point.z - gate.dir.z * 1.5 - n.z * (half + 1.4) },
      angle + Math.PI, 1, 0.5, 0, gate.level);
  }
}

function security(): void {
  // Cameras watch the landmark approaches and the perimeter walls, not the houses.
  for (const wall of W_WALLS) {
    if (wall.kind === 'hedge') continue;
    const step = 90;
    let travelled = 0;
    for (let i = 0; i + 1 < wall.points.length; i++) {
      const a = wall.points[i], b = wall.points[i + 1];
      const length = distance2d(a, b);
      if (travelled + length < step) { travelled += length; continue; }
      travelled = 0;
      const dir = normalize(sub(b, a));
      push('camera', b, angleOf(dir), 1, 0.5);
    }
  }
  for (const estate of LANDMARK_ESTATES) {
    const polygon = estatePolygon(estate);
    const centre = polygonCentroid(polygon);
    const corners = polygon;
    for (let i = 0; i < corners.length; i += 2) {
      const p = corners[i];
      push('camera', p, angleOf(normalize(sub(p, centre))), 1, 0.5);
    }
    if (estate.kind === 'hotel' || estate.kind === 'club' || estate.kind === 'country-club') {
      push('flagpole', { x: centre.x + 14, z: centre.z + 10 }, 0, 1, 0.5);
    }
  }
}

/* ── grounds, water and terraces ──────────────────────────────────────────────── */

function grounds(): void {
  for (const water of W_WATERS) {
    const centre = polygonCentroid(water.polygon);
    if (water.kind === 'fountain') {
      push('fountain-jet', centre, 0, 1.3, 0.5, 0, water.level);
      // A plaza fountain gets a ring of benches and planters around it.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = Math.max(11, Math.sqrt(polygonArea(water.polygon)) * 0.6);
        push(i % 2 ? 'planter' : 'bench', { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r },
          -a, 1, 0.5, 0, water.level);
      }
      continue;
    }
    // Poolside: loungers along one edge, parasols between them.
    const box = polygonBounds(water.polygon);
    const along = box.maxX - box.minX >= box.maxZ - box.minZ;
    const count = Math.max(2, Math.min(7, Math.round((along ? box.maxX - box.minX : box.maxZ - box.minZ) / 3.2)));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const p = along
        ? { x: box.minX + (box.maxX - box.minX) * t, z: box.maxZ + 2.4 }
        : { x: box.maxX + 2.4, z: box.minZ + (box.maxZ - box.minZ) * t };
      push('lounger', p, along ? Math.PI / 2 : 0, 1, hash01(i, 3, 1), 0, water.level);
      if (i % 2 === 0) push('parasol', { x: p.x + (along ? 0 : 3), z: p.z + (along ? 3 : 0) }, 0, 1, 0.5, 0, water.level);
    }
  }
  for (const garden of W_GARDENS) {
    const area = polygonArea(garden.polygon);
    const centre = polygonCentroid(garden.polygon);
    const random = makeRandom(Math.round(centre.x * 5 + centre.z * 3));
    const kind = garden.kind;
    if (kind === 'formal') {
      // Clipped topiary on a grid, and a flower bed along the long edge.
      const box = polygonBounds(garden.polygon);
      const cols = Math.max(2, Math.min(6, Math.round((box.maxX - box.minX) / 13)));
      const rows = Math.max(2, Math.min(5, Math.round((box.maxZ - box.minZ) / 13)));
      for (let cx = 0; cx < cols; cx++) for (let cz = 0; cz < rows; cz++) {
        const p = {
          x: box.minX + (box.maxX - box.minX) * ((cx + 0.5) / cols),
          z: box.minZ + (box.maxZ - box.minZ) * ((cz + 0.5) / rows),
        };
        if (!pointInPolygon(p.x, p.z, garden.polygon)) continue;
        push('topiary', p, 0, 0.9 + random() * 0.3, random(), 0, garden.level);
      }
      push('flower-bed', centre, random() * Math.PI, 1, random(), 0, garden.level);
    } else if (kind === 'orchard' || kind === 'woodland') {
      const count = Math.max(3, Math.min(22, Math.round(area / 900)));
      for (let i = 0; i < count; i++) {
        const p = {
          x: centre.x + (random() - 0.5) * Math.sqrt(area) * 0.9,
          z: centre.z + (random() - 0.5) * Math.sqrt(area) * 0.9,
        };
        if (!pointInPolygon(p.x, p.z, garden.polygon)) continue;
        push(kind === 'orchard' ? 'tree-round' : random() > 0.4 ? 'tree-round' : 'tree-cypress',
          p, random() * Math.PI, 0.75 + random() * 0.6, random(), 0, garden.level);
      }
    } else if (kind === 'lawn' && area > 2200) {
      // A few specimen trees and an uplighter or two on the bigger lawns.
      const count = Math.max(1, Math.min(6, Math.round(area / 4200)));
      for (let i = 0; i < count; i++) {
        const p = {
          x: centre.x + (random() - 0.5) * Math.sqrt(area) * 0.7,
          z: centre.z + (random() - 0.5) * Math.sqrt(area) * 0.7,
        };
        if (!pointInPolygon(p.x, p.z, garden.polygon)) continue;
        push(random() > 0.72 ? 'tree-palm' : 'tree-round', p, random() * Math.PI, 0.8 + random() * 0.5, random(), 0, garden.level);
      }
    } else if (kind === 'terrace' && area > 160) {
      const count = Math.max(1, Math.min(5, Math.round(area / 420)));
      for (let i = 0; i < count; i++) {
        const p = {
          x: centre.x + (random() - 0.5) * Math.sqrt(area) * 0.6,
          z: centre.z + (random() - 0.5) * Math.sqrt(area) * 0.6,
        };
        if (!pointInPolygon(p.x, p.z, garden.polygon)) continue;
        push(random() > 0.5 ? 'parasol' : 'planter', p, random() * Math.PI, 1, random(), 0, garden.level);
      }
    } else if (kind === 'tennis') {
      push('planter', { x: centre.x - 6, z: centre.z }, 0, 1, 0.5, 0, garden.level);
      push('planter', { x: centre.x + 6, z: centre.z }, 0, 1, 0.5, 0, garden.level);
    } else if (kind === 'plaza' || kind === 'forecourt') {
      if (area > 220) push('sculpture', centre, random() * Math.PI, 1, 0.5, 0, garden.level);
      const count = Math.max(1, Math.min(4, Math.round(area / 600)));
      for (let i = 0; i < count; i++) {
        const p = {
          x: centre.x + (random() - 0.5) * Math.sqrt(area) * 0.6,
          z: centre.z + (random() - 0.5) * Math.sqrt(area) * 0.6,
        };
        if (!pointInPolygon(p.x, p.z, garden.polygon)) continue;
        push(random() > 0.5 ? 'planter' : 'bench', p, random() * Math.PI, 1, random(), 0, garden.level);
      }
    }
  }
}

/* ── buildings: uplighters, planters, signage and the parked fleet ────────────── */

const PARKED: PropKind[] = ['car-luxury', 'car-sport', 'suv-luxury', 'limousine'];

function buildingProps(): void {
  for (const building of W_BUILDINGS) {
    const random = makeRandom(Math.round(building.centre.x * 7 + building.centre.z * 11));
    const box = polygonBounds(building.polygon);
    const door = building.doors[0];
    const facadeAngle = door ? angleOf(door.dir) : 0;
    // Uplighters along the facade of anything worth lighting.
    if (building.height > 8 || building.kind === 'mansion' || building.kind === 'clubhouse' ||
      building.kind === 'shop' || building.kind === 'restaurant' || building.kind === 'podium' ||
      building.kind === 'tower') {
      const count = Math.max(2, Math.min(6, Math.round((box.maxX - box.minX) / 8)));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const p = door
          ? { x: door.point.x + leftNormal(door.dir).x * ((t - 0.5) * (box.maxX - box.minX) * 0.9), z: door.point.z + leftNormal(door.dir).z * ((t - 0.5) * (box.maxX - box.minX) * 0.9) }
          : building.centre;
        push('uplighter', p, facadeAngle, 1, random(), 0, building.base);
      }
      if (building.height > 8) push('wall-lamp', door?.point ?? building.centre, facadeAngle, 1, 0.5, 2.6, building.base);
    }
    // Planters and a bench outside shops and restaurants.
    if (building.kind === 'shop' || building.kind === 'restaurant' || building.kind === 'mall') {
      for (const side of [-1, 1] as const) {
        const n = door ? leftNormal(door.dir) : { x: 1, z: 0 };
        const p = {
          x: (door?.point.x ?? building.centre.x) + n.x * side * 3.6 + (door?.dir.x ?? 0) * 2.4,
          z: (door?.point.z ?? building.centre.z) + n.z * side * 3.6 + (door?.dir.z ?? 0) * 2.4,
        };
        push('planter', p, facadeAngle, 1, random(), 0, building.base);
      }
      if (building.kind === 'restaurant') {
        for (let i = 0; i < 3; i++) {
          const n = door ? leftNormal(door.dir) : { x: 1, z: 0 };
          const p = {
            x: (door?.point.x ?? building.centre.x) + (door?.dir.x ?? 0) * (5 + i * 2.2) + n.x * ((i % 2) * 3 - 1.5),
            z: (door?.point.z ?? building.centre.z) + (door?.dir.z ?? 0) * (5 + i * 2.2) + n.z * ((i % 2) * 3 - 1.5),
          };
          push('parasol', p, random() * Math.PI, 1, random(), 0, building.base);
        }
      }
    }
    // The parked fleet: forecourts, drives and the hotel's porte-cochère.
    const isHotel = building.estateId === 'meridian-hotel';
    const fleet = isHotel ? 7 : building.kind === 'mansion' ? 3 : building.kind === 'apartments' || building.kind === 'podium' ? 4
      : building.kind === 'shop' || building.kind === 'restaurant' || building.kind === 'club' ? 3
        : building.kind === 'villa' ? 2 : building.kind === 'gate-lodge' ? 1 : 0;
    for (let i = 0; i < fleet; i++) {
      const kind = PARKED[Math.floor(random() * PARKED.length)];
      const n = door ? leftNormal(door.dir) : { x: 1, z: 0 };
      const spread = (random() - 0.5) * Math.min(20, (box.maxX - box.minX) + 8);
      const p = {
        x: (door?.point.x ?? building.centre.x) + (door?.dir.x ?? 0) * (6.5 + random() * 7) + n.x * spread,
        z: (door?.point.z ?? building.centre.z) + (door?.dir.z ?? 0) * (6.5 + random() * 7) + n.z * spread,
      };
      push(kind, p, facadeAngle + (random() - 0.5) * 0.5, 1, random(), 0, building.base);
    }
  }
}

/* ── run ──────────────────────────────────────────────────────────────────────── */

streetFurniture();
gates();
security();
grounds();
buildingProps();

export const W_PROPS: readonly Prop[] = props;

export function propsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Prop[] {
  return props.filter(p =>
    p.x >= bounds.minX - 20 && p.x <= bounds.maxX + 20 &&
    p.z >= bounds.minZ - 20 && p.z <= bounds.maxZ + 20);
}

export const propSummary = (() => {
  const byKind: Record<string, number> = {};
  for (const p of props) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const vehicles = (byKind['car-luxury'] ?? 0) + (byKind['car-sport'] ?? 0) + (byKind['suv-luxury'] ?? 0) + (byKind['limousine'] ?? 0);
  return {
    count: props.length,
    byKind,
    kinds: Object.keys(byKind).length,
    lighting: (byKind['lamp-standard'] ?? 0) + (byKind['bollard-light'] ?? 0) + (byKind['uplighter'] ?? 0) + (byKind['wall-lamp'] ?? 0),
    planting: (byKind['tree-round'] ?? 0) + (byKind['tree-cypress'] ?? 0) + (byKind['tree-palm'] ?? 0) + (byKind['topiary'] ?? 0) + (byKind['planter'] ?? 0) + (byKind['flower-bed'] ?? 0),
    security: (byKind['camera'] ?? 0) + (byKind['guard-stand'] ?? 0),
    parkedVehicles: vehicles,
  };
})();
