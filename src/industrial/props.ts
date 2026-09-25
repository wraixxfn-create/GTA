/**
 * Environmental props: the clutter that makes the flats read as a working district.
 *
 * Container rows follow their yard patches; trailer and truck courts park along the
 * painted stalls; the scrap yard gets bale stacks and wrecks; construction sites get
 * plant, barriers and pipe stacks. Streets carry poles, floodlights and dumpsters;
 * level crossings get crossbucks and barrier arms. Placement is deterministic — the
 * same seed always scatters the same yard.
 */
import type { Point } from '../world/data';
import { distance2d, leftNormal, normalize, pointInPolygon, polygonCentroid, sub } from '../city/geometry2d';
import { fromGrid, indGround, makeRandom, hash01 } from './frame';
import { ANCHORS } from './identity';
import { IND_BUILDINGS, IND_FENCES, IND_YARDS, type YardPatch } from './buildings';
import { IND_NETWORK, LEVEL_CROSSINGS, derivativeAt } from './plan';
import type { IndPropKind } from './propmesh';

export type IndProp = {
  kind: IndPropKind;
  x: number; z: number; y: number;
  angle: number;
  scale: number;
  tint: number;
};

const props: IndProp[] = [];
function push(kind: IndPropKind, p: Point, angle = 0, scale = 1, tint = 0.5, lift = 0): void {
  props.push({ kind, x: p.x, z: p.z, y: indGround(p.x, p.z) + lift, angle, scale, tint });
}

/* ── scatter helpers ─────────────────────────────────────────────────────────── */

function axesOf(polygon: readonly Point[]): { centre: Point; along: Point; across: Point; halfAlong: number; halfAcross: number } {
  const centre = polygonCentroid(polygon);
  let best = { a: polygon[0], b: polygon[1] ?? polygon[0], length: -1 };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = distance2d(a, b);
    if (length > best.length) best = { a, b, length };
  }
  const along = normalize(sub(best.b, best.a));
  const across = leftNormal(along);
  let halfAlong = 0, halfAcross = 0;
  for (const p of polygon) {
    const d = sub(p, centre);
    halfAlong = Math.max(halfAlong, Math.abs(d.x * along.x + d.z * along.z));
    halfAcross = Math.max(halfAcross, Math.abs(d.x * across.x + d.z * across.z));
  }
  return { centre, along, across, halfAlong, halfAcross };
}

function inside(polygon: readonly Point[], p: Point): boolean {
  return pointInPolygon(polygon, p);
}

const BUILDING_CENTRES = IND_BUILDINGS.map(b => ({ centre: b.centre, radius: Math.max(14, Math.sqrt(Math.abs(b.polygon.length ? polygonAreaOf(b.polygon) : 0)) / 2) }));
function polygonAreaOf(polygon: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}
function clearOfBuildings(p: Point, margin: number): boolean {
  for (const b of BUILDING_CENTRES) {
    if (Math.abs(b.centre.x - p.x) > b.radius + margin || Math.abs(b.centre.z - p.z) > b.radius + margin) continue;
    if (distance2d(b.centre, p) < b.radius + margin) return false;
  }
  return true;
}

/* ── yard contents ───────────────────────────────────────────────────────────── */

function containerRows(yard: YardPatch): void {
  const random = makeRandom(Math.round(yard.polygon[0].x * 3 + yard.polygon[0].z * 7));
  const { centre, along, across, halfAlong, halfAcross } = axesOf(yard.polygon);
  const rowGap = 15, slotGap = 13;
  const rows = Math.max(1, Math.floor((halfAcross * 2 - 8) / rowGap));
  for (let r = 0; r < rows; r++) {
    const lateral = -halfAcross + 5 + r * rowGap;
    if (Math.abs(lateral) > halfAcross - 4) continue;
    const length = Math.sqrt(Math.max(0, halfAlong * halfAlong - lateral * lateral * 0.25)) * 2 - 8;
    const slots = Math.floor(length / slotGap);
    let stackRun = 0;
    for (let s = 0; s < slots; s++) {
      if (random() < 0.14) { stackRun = 0; continue; } // a gap in the row
      const height = stackRun > 0 ? Math.min(3, stackRun) : random() < 0.5 ? 1 : random() < 0.72 ? 2 : 3;
      stackRun = height > 1 ? 1 : 0;
      const p = { x: centre.x + along.x * (-length / 2 + 6 + s * slotGap) + across.x * lateral,
        z: centre.z + along.z * (-length / 2 + 6 + s * slotGap) + across.z * lateral };
      if (!inside(yard.polygon, p)) continue;
      const angle = Math.atan2(-along.z, along.x) + (random() - 0.5) * 0.03;
      for (let level = 0; level < height; level++) {
        push(level === 2 ? 'container20' : random() < 0.62 ? 'container40' : 'container20',
          p, angle + (random() - 0.5) * 0.02, 1, random(), level * 2.62 + 0.2);
      }
    }
  }
}

function stallRows(yard: YardPatch, kind: IndPropKind, stallGap: number, fill: number): void {
  const random = makeRandom(Math.round(yard.polygon[0].x * 5 + yard.polygon[0].z * 11));
  for (let i = 0; i < yard.polygon.length; i++) {
    const a = yard.polygon[i], b = yard.polygon[(i + 1) % yard.polygon.length];
    const len = distance2d(a, b);
    if (len < stallGap * 3) continue;
    const along = normalize(sub(b, a));
    let across = leftNormal(along);
    if ((polygonCentroid(yard.polygon).x - a.x) * across.x + (polygonCentroid(yard.polygon).z - a.z) * across.z < 0) across = { x: -across.x, z: -across.z };
    const count = Math.min(kind === 'trailer' ? 14 : 18, Math.floor(len / stallGap));
    const angle = Math.atan2(-across.z, across.x);
    for (let k = 0; k < count; k++) {
      if (random() > fill) continue;
      const p = { x: a.x + along.x * (k + 0.5) * stallGap + across.x * 7, z: a.z + along.z * (k + 0.5) * stallGap + across.z * 7 };
      if (!inside(yard.polygon, p) || !clearOfBuildings(p, 3)) continue;
      push(kind, p, angle + (random() - 0.5) * 0.08, 1, random());
    }
  }
}

function scatter(yard: YardPatch, count: number, kinds: IndPropKind[], spacing: number, scaleRange: [number, number], lift = 0): void {
  const random = makeRandom(Math.round(yard.polygon[0].x + yard.polygon[0].z * 13 + count));
  const bounds = {
    minX: Math.min(...yard.polygon.map(p => p.x)), maxX: Math.max(...yard.polygon.map(p => p.x)),
    minZ: Math.min(...yard.polygon.map(p => p.z)), maxZ: Math.max(...yard.polygon.map(p => p.z)),
  };
  const placed: Point[] = [];
  let attempts = 0;
  while (placed.length < count && attempts < count * 12) {
    attempts++;
    const p = { x: bounds.minX + random() * (bounds.maxX - bounds.minX), z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ) };
    if (!inside(yard.polygon, p) || !clearOfBuildings(p, 4)) continue;
    if (placed.some(q => distance2d(q, p) < spacing)) continue;
    placed.push(p);
    const kind = kinds[Math.floor(random() * kinds.length)];
    push(kind, p, random() * Math.PI * 2, scaleRange[0] + random() * (scaleRange[1] - scaleRange[0]), random(), lift);
  }
}

function cluster(yard: YardPatch, clusters: number, perCluster: number, kinds: IndPropKind[], spacing: number): void {
  const random = makeRandom(Math.round(yard.polygon[1].x * 7 + yard.polygon[0].z + clusters));
  const bounds = {
    minX: Math.min(...yard.polygon.map(p => p.x)), maxX: Math.max(...yard.polygon.map(p => p.x)),
    minZ: Math.min(...yard.polygon.map(p => p.z)), maxZ: Math.max(...yard.polygon.map(p => p.z)),
  };
  for (let c = 0; c < clusters; c++) {
    let centre: Point | null = null;
    for (let tries = 0; tries < 20 && !centre; tries++) {
      const p = { x: bounds.minX + random() * (bounds.maxX - bounds.minX), z: bounds.minZ + random() * (bounds.maxZ - bounds.minZ) };
      if (inside(yard.polygon, p) && clearOfBuildings(p, 6)) centre = p;
    }
    if (!centre) continue;
    for (let i = 0; i < perCluster; i++) {
      const p = { x: centre.x + (random() - 0.5) * spacing * 2.4, z: centre.z + (random() - 0.5) * spacing * 2.4 };
      if (!inside(yard.polygon, p)) continue;
      push(kinds[Math.floor(random() * kinds.length)], p, random() * Math.PI * 2, 0.8 + random() * 0.5, random());
    }
  }
}

for (const yard of IND_YARDS) {
  const area = Math.abs(polygonAreaOf(yard.polygon));
  switch (yard.content) {
    case 'containers': containerRows(yard); break;
    case 'trailers': stallRows(yard, 'trailer', 6, yard.condition === 'abandoned' ? 0.12 : 0.34); break;
    case 'trucks': stallRows(yard, 'truck', 4.8, 0.5); break;
    case 'vans': stallRows(yard, 'van', 3.4, 0.55); break;
    case 'parking':
      stallRows(yard, 'car', 3, 0.5);
      stallRows(yard, 'van', 3.6, 0.2);
      break;
    case 'scrap':
      scatter(yard, Math.min(40, Math.floor(area / 450)), ['bale'], 5, [1, 1.9]);
      scatter(yard, Math.min(14, Math.floor(area / 1600)), ['wreck', 'bale'], 7, [0.9, 1.3]);
      cluster(yard, 3, 6, ['barrel', 'dumpster'], 4);
      break;
    case 'wrecks':
      scatter(yard, Math.min(22, Math.floor(area / 700)), ['wreck', 'container20', 'barrel'], 6, [0.8, 1.2]);
      break;
    case 'aggregate':
      scatter(yard, Math.min(6, Math.floor(area / 2600)), ['aggregate'], 14, [1, 2.2]);
      scatter(yard, Math.min(10, Math.floor(area / 1400)), ['logs', 'pipe'], 8, [0.9, 1.4]);
      break;
    case 'plant':
      scatter(yard, Math.min(8, Math.floor(area / 1200)), ['excavator', 'barrier', 'pipe'], 9, [0.9, 1.2]);
      cluster(yard, 2, 5, ['barrier', 'pipe'], 5);
      break;
    case 'pipe':
      scatter(yard, Math.min(14, Math.floor(area / 700)), ['pipe'], 6, [0.9, 1.5]);
      break;
    case 'logs':
      scatter(yard, Math.min(12, Math.floor(area / 800)), ['logs'], 6, [0.9, 1.4]);
      break;
    case 'barrels':
      cluster(yard, Math.min(8, Math.floor(area / 900)), 6, ['barrel', 'dumpster'], 3.4);
      break;
    case 'pallets':
      cluster(yard, Math.min(7, Math.floor(area / 1100)), 4, ['pallet', 'crate'], 3.6);
      break;
    case 'machinery':
      scatter(yard, Math.min(7, Math.floor(area / 1300)), ['generator', 'transformer', 'hopper'], 9, [0.9, 1.3]);
      break;
    case 'frames':
      scatter(yard, Math.min(8, Math.floor(area / 1300)), ['frame-bundle', 'pipe'], 7, [0.9, 1.3]);
      break;
  }
}

/* ── street and site furniture ───────────────────────────────────────────────── */

// Dumpster and pallet courts beside the working doors.
for (const building of IND_BUILDINGS) {
  if (building.condition === 'abandoned') continue;
  const random = makeRandom(Math.round(building.centre.x * 3 + building.centre.z));
  for (const door of building.doors) {
    if (door.kind === 'person' || door.kind === 'dock') continue; // docks get their trailer courts
    const side = leftNormal(door.dir);
    const p = { x: door.point.x + door.dir.x * 4 + side.x * (door.width / 2 + 2.6), z: door.point.z + door.dir.z * 4 + side.z * (door.width / 2 + 2.6) };
    if (random() < 0.5) push('dumpster', p, Math.atan2(-door.dir.z, door.dir.x), 1, random());
    else if (random() < 0.5) push('pallet', p, 0, 1, random());
  }
}

// Poles along the signed routes; floodlights around the fenced works.
for (const street of IND_NETWORK.streets) {
  if (street.kind === 'service' || street.kind === 'yard' || street.legacy) continue;
  for (let i = 3; i < street.samples.length; i += 3) {
    const s = street.samples[i];
    const d = derivativeAt(street, s.t);
    const n = leftNormal(d);
    const side = (i / 3) % 2 === 0 ? 1 : -1;
    const off = street.width / 2 + street.shoulder + 1.6;
    const p = { x: s.x + n.x * off * side, z: s.z + n.z * off * side };
    push('pole', p, 0, 1, hash01(i, street.samples.length, 21));
  }
}
for (const fence of IND_FENCES) {
  if (fence.points.length < 2) continue;
  const random = makeRandom(Math.round(fence.points[0].x + fence.points[0].z * 5));
  for (let i = 0; i < fence.points.length; i += 13) {
    if (random() < 0.5) continue;
    push('floodlight', fence.points[i], random() * Math.PI * 2, 0.9 + random() * 0.3, random());
  }
}

// Level crossings: crossbucks always, barrier arms where the line declares them.
for (const crossing of LEVEL_CROSSINGS) {
  const railN = leftNormal(crossing.railDir);
  for (const side of [-1, 1] as const) {
    const p = { x: crossing.point.x + railN.x * 5.4 * side, z: crossing.point.z + railN.z * 5.4 * side };
    push('crossbuck', p, Math.atan2(-crossing.roadDir.z, crossing.roadDir.x), 1, 0.5);
    if (crossing.barriers) push('barrier-arm', p, Math.atan2(-crossing.roadDir.z, crossing.roadDir.x), side > 0 ? 1 : -1, 0.5);
  }
}

// Anchor gates get a barrier arm and a hazard board; fenced corners get a sign board.
for (const anchor of ANCHORS) {
  for (const part of anchor.parts) {
    if (part.kind !== 'gatehouse') continue;
    const u0 = anchor.rect.u0 + (anchor.rect.u1 - anchor.rect.u0) * part.rect.u0;
    const u1 = anchor.rect.u0 + (anchor.rect.u1 - anchor.rect.u0) * part.rect.u1;
    const v0 = anchor.rect.v0 + (anchor.rect.v1 - anchor.rect.v0) * part.rect.v0;
    const v1 = anchor.rect.v0 + (anchor.rect.v1 - anchor.rect.v0) * part.rect.v1;
    const centre = polygonCentroid([gridPoint(u0, v0), gridPoint(u1, v0), gridPoint(u1, v1), gridPoint(u0, v1)]);
    push('sign-board', centre, hash01(u0, v0, 4) * Math.PI * 2, 1, hash01(u1, v1, 8));
  }
}
function gridPoint(u: number, v: number): Point { return fromGrid(u, v); }

/* ── exports ─────────────────────────────────────────────────────────────────── */

export const IND_PROPS: readonly IndProp[] = props;

const TILE = 500;
const PROPS_BY_TILE = new Map<string, number[]>();
for (const [index, prop] of props.entries()) {
  const key = `${Math.floor(prop.x / TILE)}:${Math.floor(prop.z / TILE)}`;
  const list = PROPS_BY_TILE.get(key) ?? [];
  list.push(index);
  PROPS_BY_TILE.set(key, list);
}

export function propsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): IndProp[] {
  const out: IndProp[] = [];
  const seen = new Set<number>();
  for (let iz = Math.floor(bounds.minZ / TILE); iz <= Math.floor(bounds.maxZ / TILE); iz++) {
    for (let ix = Math.floor(bounds.minX / TILE); ix <= Math.floor(bounds.maxX / TILE); ix++) {
      for (const index of PROPS_BY_TILE.get(`${ix}:${iz}`) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const prop = props[index];
        if (prop.x >= bounds.minX - 30 && prop.x <= bounds.maxX + 30 &&
          prop.z >= bounds.minZ - 30 && prop.z <= bounds.maxZ + 30) out.push(prop);
      }
    }
  }
  return out;
}

export const propSummary = (() => {
  const byKind: Record<string, number> = {};
  for (const prop of props) byKind[prop.kind] = (byKind[prop.kind] ?? 0) + 1;
  return { count: props.length, byKind };
})();
