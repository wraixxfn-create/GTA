/**
 * Vantage Heights mesh construction: buildings, interiors, walls and terraces as merged,
 * vertex-coloured buffers grouped by material — a tile of the hill is a handful of draw
 * calls.
 *
 * Facades are drawn per bay: stone and render get punched windows, curtain wall gets a
 * glazed panel grid that catches a specular highlight, and every style gets its own tint so
 * one material serves the whole district. Faces that cannot be seen are never emitted,
 * except inside the five enterable buildings, where the walls are doubled so the camera can
 * stand in them.
 *
 * Terraces are the district's structure: a level pad, a retaining wall on its downhill side
 * and steps where the ground falls away. Without them a hillside house would float.
 */
import * as THREE from 'three';
import type { Point } from '../world/data';
import { Buffer } from '../city/meshes';
import {
  distance2d, leftNormal, normalize, polygonArea, polygonBounds, polygonCentroid, sub,
} from '../city/geometry2d';
import { hillGround, makeRandom } from './frame';
import { facade, type FacadeId } from './identity';
import {
  terraceFill, W_WALLS, type Building, type WallRun,
} from './buildings';

export type MaterialKey = 'walls' | 'roof' | 'glass' | 'metal' | 'paint';
type Vec3 = { x: number; y: number; z: number };

const color = (rgb: readonly [number, number, number], shade = 1): THREE.Color => {
  const c = new THREE.Color();
  c.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
  return c;
};

const ROOF_TILE: THREE.Color = color([0.44, 0.32, 0.28]);
const ROOF_FLAT: THREE.Color = color([0.56, 0.55, 0.52]);
const ROOF_ZINC: THREE.Color = color([0.6, 0.62, 0.63]);
const STONE: THREE.Color = color([0.72, 0.69, 0.62]);
const DOOR: THREE.Color = color([0.24, 0.19, 0.15]);
const BALUSTRADE: THREE.Color = color([0.82, 0.8, 0.74]);
const HEDGE: THREE.Color = color([0.22, 0.36, 0.24]);
const FLOOR: THREE.Color = color([0.62, 0.57, 0.49]);
const WALL_IN: THREE.Color = color([0.83, 0.8, 0.73]);
const LIGHT: THREE.Color = color([0.98, 0.93, 0.76]);

const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
const ground = (p: Point, lift = 0): number => hillGround(p.x, p.z) + lift;

function group(groups: Map<MaterialKey, Buffer>, key: MaterialKey): Buffer {
  let buffer = groups.get(key);
  if (!buffer) { buffer = new Buffer(); groups.set(key, buffer); }
  return buffer;
}

function boxOn(groups: Map<MaterialKey, Buffer>, key: MaterialKey,
  centre: Point, w: number, h: number, d: number, dir: Point, baseY: number, c: THREE.Color): void {
  const buffer = group(groups, key);
  const n = leftNormal(dir);
  const hw = w / 2, hd = d / 2;
  const corner = (sw: number, sd: number): Point => ({
    x: centre.x + dir.x * sw + n.x * sd, z: centre.z + dir.z * sw + n.z * sd,
  });
  const a = corner(-hw, -hd), b = corner(hw, -hd), cc = corner(hw, hd), dd = corner(-hw, hd);
  const y0 = baseY, y1 = baseY + h;
  buffer.polygon([v(a, y1), v(b, y1), v(cc, y1), v(dd, y1)], c, undefined, true);
  buffer.quad(v(a, y0), v(b, y0), v(b, y1), v(a, y1), c);
  buffer.quad(v(b, y0), v(cc, y0), v(cc, y1), v(b, y1), c);
  buffer.quad(v(cc, y0), v(dd, y0), v(dd, y1), v(cc, y1), c);
  buffer.quad(v(dd, y0), v(a, y0), v(a, y1), v(dd, y1), c);
}

function cylinderAt(groups: Map<MaterialKey, Buffer>, key: MaterialKey,
  centre: Point, radius: number, y: number, height: number, sides: number, c: THREE.Color): void {
  const buffer = group(groups, key);
  const ring = (r: number, yy: number): Point[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r };
    }).map(p => p) as Point[];
  const bottom = ring(radius, y), top = ring(radius, y + height);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    buffer.quad(v(bottom[i], y), v(bottom[j], y), v(top[j], y + height), v(top[i], y + height), c);
  }
  buffer.polygon(top.map(p => v(p, y + height)), c, undefined, true);
}

/* ── walls ────────────────────────────────────────────────────────────────────── */

function emitWall(groups: Map<MaterialKey, Buffer>, building: Building,
  a: Point, b: Point, lod: 0 | 1, interior: boolean): void {
  const style = facade(building.facade);
  const tint = color(style.tint, 0.94 + building.tint * 0.12);
  const walls = group(groups, 'walls');
  const glass = group(groups, 'glass');
  const dir = normalize(sub(b, a));
  const length = distance2d(a, b);
  const n = leftNormal(dir);
  const outward = { x: -n.x, z: -n.z };
  /** Offset a plan point outward off the facade, for reveals, bands and balcony decks. */
  const o = (p: Point, s: number): Point => ({ x: p.x + outward.x * s, z: p.z + outward.z * s });
  const y0 = building.base;
  const y1 = building.base + building.height;
  const storey = style.storey;
  const floors = Math.max(1, building.storeys);
  const floorHeight = building.height / floors;

  // Solid wall, drawn from the outside; interiors double it so the camera can stand in.
  walls.quad(v(b, y0), v(a, y0), v(a, y1), v(b, y1), tint);
  if (interior) walls.quad(v(a, y0), v(b, y0), v(b, y1), v(a, y1), WALL_IN);

  // Openings per floor: a curtain wall glazes almost the whole bay, masonry punches windows.
  const bayCount = Math.max(1, Math.round(length / (style.glazing > 0.6 ? 3.1 : 4.2)));
  const bayWidth = length / bayCount;
  const windowWidth = bayWidth * (style.glazing > 0.6 ? 0.86 : 0.46);
  const windowHeight = floorHeight * (style.glazing > 0.6 ? 0.82 : 0.5);
  if (lod === 1 && style.glazing <= 0.6) return;
  for (let floor = 0; floor < floors; floor++) {
    const sill = y0 + floor * floorHeight + (floorHeight - windowHeight) * 0.42;
    for (let bay = 0; bay < bayCount; bay++) {
      const centreT = (bay + 0.5) * bayWidth;
      const c0 = centreT - windowWidth / 2, c1 = centreT + windowWidth / 2;
      const p0 = { x: a.x + dir.x * c0, z: a.z + dir.z * c0 };
      const p1 = { x: a.x + dir.x * c1, z: a.z + dir.z * c1 };
      const lift = 0.09;
      glass.quad(
        v(o(p1, lift), sill), v(o(p0, lift), sill),
        v(o(p0, lift), sill + windowHeight), v(o(p1, lift), sill + windowHeight),
        color([0.42, 0.48, 0.52], 0.7 + ((bay + floor) % 3) * 0.12),
      );
      // A balcony rail on the upper floors of the modern generation.
      if (lod === 0 && style.glazing > 0.6 && floor > 0 && bay % 2 === 0) {
        const rail = group(groups, 'metal');
        const railHeight = 1.05;
        rail.quad(
          v(o(p0, 1.5), sill - 0.1), v(o(p1, 1.5), sill - 0.1),
          v(o(p1, 1.5), sill - 0.1 + railHeight), v(o(p0, 1.5), sill - 0.1 + railHeight),
          BALUSTRADE,
        );
        const deck = group(groups, 'walls');
        deck.polygon([
          v(o(p0, 0.2), sill - 0.16), v(o(p1, 0.2), sill - 0.16),
          v(o(p1, 1.6), sill - 0.16), v(o(p0, 1.6), sill - 0.16),
        ], STONE, undefined, true);
      }
    }
    // A floor band breaks up the taller facades.
    if (lod === 0 && floors > 2 && floor > 0) {
      const band = group(groups, 'walls');
      band.quad(
        v(o(b, 0.22), y0 + floor * floorHeight - 0.14), v(o(a, 0.22), y0 + floor * floorHeight - 0.14),
        v(o(a, 0.22), y0 + floor * floorHeight + 0.14), v(o(b, 0.22), y0 + floor * floorHeight + 0.14),
        color(style.tint, 0.82),
      );
    }
  }
  // Corner quoins on the stone generation.
  if (lod === 0 && style.family === 'stone' && length > 9) {
    for (const end of [a, b]) {
      boxOn(groups, 'walls', { x: end.x + outward.x * 0.12, z: end.z + outward.z * 0.12 },
        0.5, building.height, 0.5, dir, y0, color(style.tint, 1.02));
    }
  }
}

function emitRoof(groups: Map<MaterialKey, Buffer>, building: Building, lod: 0 | 1): void {
  const polygon = building.polygon;
  const y = building.base + building.height;
  const roofBuffer = group(groups, 'roof');
  const style = facade(building.facade);
  switch (building.roof) {
    case 'hip': {
      const box = polygonBounds(polygon);
      const centre = polygonCentroid(polygon);
      const rise = Math.min(3.6, Math.min(box.maxX - box.minX, box.maxZ - box.minZ) * 0.22);
      const apex = v(centre, y + rise);
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        roofBuffer.triangle(v(b, y), v(a, y), apex, ROOF_TILE);
      }
      if (lod === 0) {
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          roofBuffer.quad(v(b, y - 0.1), v(a, y - 0.1), v(a, y + 0.34), v(b, y + 0.34), color(style.tint, 1.0));
        }
      }
      break;
    }
    case 'gable': {
      const box = polygonBounds(polygon);
      const rise = Math.min(2.6, (box.maxZ - box.minZ) * 0.2);
      const ridgeZ = (box.minZ + box.maxZ) / 2;
      const left = polygon.filter(p => p.z <= ridgeZ);
      const right = polygon.filter(p => p.z > ridgeZ);
      void left; void right;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        roofBuffer.quad(
          v(a, y), v(b, y),
          { x: b.x, y: y + rise, z: ridgeZ }, { x: a.x, y: y + rise, z: ridgeZ },
          ROOF_TILE,
        );
      }
      break;
    }
    case 'glass': {
      const glass = group(groups, 'glass');
      glass.polygon(polygon.map(p => v(p, y + 0.35)), color([0.4, 0.47, 0.5], 0.9), undefined, true);
      roofBuffer.polygon(polygon.map(p => v(p, y + 0.06)), ROOF_FLAT, undefined, true);
      if (lod === 0) {
        const box = polygonBounds(polygon);
        const centre = polygonCentroid(polygon);
        for (let i = 0; i < 5; i++) {
          const t = (i + 0.5) / 5;
          const p = { x: box.minX + (box.maxX - box.minX) * t, z: centre.z };
          boxOn(groups, 'metal', p, 0.22, 0.5, box.maxZ - box.minZ, { x: 0, z: 1 }, y + 0.1, color([0.5, 0.51, 0.52]));
        }
      }
      break;
    }
    case 'lantern': {
      roofBuffer.polygon(polygon.map(p => v(p, y + 0.08)), ROOF_ZINC, undefined, true);
      const centre = polygonCentroid(polygon);
      boxOn(groups, 'glass', centre, 5, 2.2, 5, { x: 1, z: 0 }, y + 0.1, color([0.45, 0.5, 0.53], 0.9));
      break;
    }
    case 'terrace': {
      roofBuffer.polygon(polygon.map(p => v(p, y + 0.1)), ROOF_FLAT, undefined, true);
      if (lod === 0) {
        const metal = group(groups, 'metal');
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          metal.quad(v(b, y + 0.1), v(a, y + 0.1), v(a, y + 1.1), v(b, y + 1.1), BALUSTRADE);
        }
      }
      break;
    }
    default: {
      // Flat with a parapet.
      roofBuffer.polygon(polygon.map(p => v(p, y + 0.08)),
        building.facade.startsWith('glass') ? ROOF_ZINC : ROOF_FLAT, undefined, true);
      if (lod === 0) {
        const walls = group(groups, 'walls');
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          walls.quad(v(b, y - 0.1), v(a, y - 0.1), v(a, y + 0.7), v(b, y + 0.7), color(style.tint, 0.98));
        }
        // Rooftop plant on the taller blocks.
        if (building.height > 16) {
          const random = makeRandom(Math.round(building.centre.x + building.centre.z * 7));
          const centre = polygonCentroid(polygon);
          const count = 1 + Math.floor(random() * 3);
          for (let i = 0; i < count; i++) {
            const p = { x: centre.x + (random() - 0.5) * 12, z: centre.z + (random() - 0.5) * 9 };
            boxOn(groups, 'metal', p, 2 + random() * 3, 1 + random() * 1.4, 1.8 + random() * 2,
              normalize(sub(p, centre)), y + 0.1, color([0.5, 0.51, 0.52], 0.9 + random() * 0.2));
          }
        }
      }
    }
  }
}

function emitDoors(groups: Map<MaterialKey, Buffer>, building: Building): void {
  for (const door of building.doors) {
    const height = door.kind === 'lobby' || door.kind === 'shop' ? 3.2 : 2.7;
    boxOn(groups, 'walls', door.point, door.width + 1.1, height + 0.5, 0.5, door.dir, building.base, STONE);
    boxOn(groups, 'glass', { x: door.point.x + door.dir.x * 0.28, z: door.point.z + door.dir.z * 0.28 },
      door.width, height, 0.16, door.dir, building.base + 0.1, DOOR);
    // A porch canopy over the front door of a house.
    if (door.kind === 'porch' && building.kind !== 'apartments') {
      boxOn(groups, 'walls', { x: door.point.x + door.dir.x * 1.5, z: door.point.z + door.dir.z * 1.5 },
        door.width + 2.2, 0.28, 3, door.dir, building.base + height + 0.3, STONE);
      for (const side of [-1, 1] as const) {
        const n = leftNormal(door.dir);
        boxOn(groups, 'walls', {
          x: door.point.x + door.dir.x * 2.6 + n.x * (door.width / 2 + 0.6) * side,
          z: door.point.z + door.dir.z * 2.6 + n.z * (door.width / 2 + 0.6) * side,
        }, 0.34, height + 0.3, 0.34, door.dir, building.base, STONE);
      }
    }
    // Steps where the terrace stands above the approach.
    const fill = building.base - ground(door.point);
    if (fill > 0.5) {
      const steps = Math.min(5, Math.ceil(fill / 0.34));
      for (let i = 0; i < steps; i++) {
        boxOn(groups, 'walls', {
          x: door.point.x + door.dir.x * (0.7 + i * 0.42), z: door.point.z + door.dir.z * (0.7 + i * 0.42),
        }, door.width + 1.4, 0.34, 0.46, door.dir, building.base - (i + 1) * 0.34, STONE);
      }
    }
  }
}

function emitSign(groups: Map<MaterialKey, Buffer>, building: Building): void {
  if (!building.sign) return;
  const { text, point, dir } = building.sign;
  const width = Math.min(9, 1.4 + text.length * 0.34);
  boxOn(groups, 'paint', { x: point.x + dir.x * 0.4, z: point.z + dir.z * 0.4 },
    width, 0.85, 0.14, dir, building.base + 3.6, color([0.9, 0.87, 0.78]));
}

/* ── interiors ────────────────────────────────────────────────────────────────── */

/**
 * The five enterable buildings get floors, an inner wall skin, a stair core and lights, so
 * a camera can stand inside them. Everything else is a sealed shell.
 */
function emitInterior(groups: Map<MaterialKey, Buffer>, building: Building): void {
  const polygon = building.polygon;
  const floors = Math.max(1, Math.min(building.storeys, 4));
  const floorHeight = building.height / Math.max(1, building.storeys);
  const centre = polygonCentroid(polygon);
  for (let f = 0; f < floors; f++) {
    const y = building.base + f * floorHeight;
    const slab = group(groups, 'walls');
    slab.polygon(polygon.map(p => v(p, y + 0.06)), FLOOR, undefined, true);
    if (f > 0) {
      const underside = group(groups, 'walls');
      underside.polygon(polygon.map(p => v(p, y - 0.06)), WALL_IN, undefined, false);
    }
    // Lights: a warm panel per floor, one draw call for all of them.
    const lights = group(groups, 'paint');
    const count = Math.max(2, Math.min(6, Math.round(polygonArea(polygon) / 90)));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = Math.sqrt(polygonArea(polygon)) * 0.28;
      const p = { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r };
      boxOn(groups, 'paint', p, 1.5, 0.1, 0.5, { x: 1, z: 0 }, y + floorHeight - 0.32, LIGHT);
      void lights;
    }
  }
  // The stair core.
  boxOn(groups, 'walls', { x: centre.x + 3.4, z: centre.z }, 4.2, building.height * 0.94, 3.4,
    { x: 1, z: 0 }, building.base, WALL_IN);
  for (let f = 0; f < floors; f++) {
    const y = building.base + f * floorHeight;
    for (let s = 0; s < 6; s++) {
      boxOn(groups, 'walls', { x: centre.x + 3.4 - 1.6 + s * 0.55, z: centre.z + 1.2 },
        0.55, 0.16, 1.6, { x: 1, z: 0 }, y + s * (floorHeight / 6), STONE);
    }
  }
  // Interior partitions, so a room reads as rooms.
  const walls = group(groups, 'walls');
  for (let i = 0; i < polygon.length; i += 2) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const inward = normalize(sub(centre, mid));
    const p0 = { x: mid.x + inward.x * 2.5, z: mid.z + inward.z * 2.5 };
    const along = leftNormal(inward);
    const p1 = { x: p0.x + along.x * 4, z: p0.z + along.z * 4 };
    walls.quad(v(p0, building.base), v(p1, building.base),
      v(p1, building.base + floorHeight * 0.92), v(p0, building.base + floorHeight * 0.92), WALL_IN);
    walls.quad(v(p1, building.base), v(p0, building.base),
      v(p0, building.base + floorHeight * 0.92), v(p1, building.base + floorHeight * 0.92), WALL_IN);
  }
}

/* ── terraces ─────────────────────────────────────────────────────────────────── */

/**
 * Retaining walls: wherever a terrace datum stands above the natural ground, a wall holds
 * the fill. Steep ground is stepped rather than given one impossible wall.
 */
export function terraceBuffers(buildings: readonly Building[], lod: 0 | 1 | 2 | 3): Map<MaterialKey, Buffer> {
  const groups = new Map<MaterialKey, Buffer>();
  if (lod >= 2) return groups;
  const walls = group(groups, 'walls');
  const done = new Set<string>();
  for (const building of buildings) {
    const key = building.plotId ?? building.estateId ?? building.id;
    if (done.has(key)) continue;
    done.add(key);
    for (const { point, depth } of terraceFill(building.polygon, building.base)) {
      if (depth < 0.45) continue;
      const centre = building.centre;
      const outward = normalize(sub(point, centre));
      const n = leftNormal(outward);
      const stepped = Math.min(3, Math.max(1, Math.ceil(depth / 2.1)));
      for (let s = 0; s < stepped; s++) {
        const y0 = building.base - ((s + 1) * depth) / stepped;
        const y1 = building.base - (s * depth) / stepped;
        const off = 0.6 + s * 0.5;
        const p = { x: point.x + outward.x * off, z: point.z + outward.z * off };
        walls.quad(
          v({ x: p.x - n.x * 4.5, z: p.z - n.z * 4.5 }, y0),
          v({ x: p.x + n.x * 4.5, z: p.z + n.z * 4.5 }, y0),
          v({ x: p.x + n.x * 4.5, z: p.z + n.z * 4.5 }, y1),
          v({ x: p.x - n.x * 4.5, z: p.z - n.z * 4.5 }, y1),
          STONE,
        );
      }
    }
  }
  return groups;
}

/* ── boundary walls, hedges and railings ──────────────────────────────────────── */

export function wallBuffers(walls: readonly WallRun[], lod: 0 | 1): Map<MaterialKey, Buffer> {
  const groups = new Map<MaterialKey, Buffer>();
  for (const wall of walls) {
    const material = wall.kind === 'railing' ? 'metal' : wall.kind === 'fence' ? 'metal' : 'walls';
    const buffer = group(groups, material);
    const tint = wall.kind === 'hedge' ? HEDGE
      : wall.kind === 'railing' ? BALUSTRADE
        : wall.kind === 'fence' ? color([0.3, 0.28, 0.26]) : STONE;
    const height = wall.height;
    for (let i = 0; i + 1 < wall.points.length; i++) {
      const a = wall.points[i], b = wall.points[i + 1];
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      const thickness = wall.kind === 'hedge' ? 0.7 : wall.kind === 'railing' ? 0.12 : 0.42;
      const ya = wall.kind === 'railing' ? hillGround(a.x, a.z) + 0.35 : hillGround(a.x, a.z);
      const yb = wall.kind === 'railing' ? hillGround(b.x, b.z) + 0.35 : hillGround(b.x, b.z);
      for (const side of [-1, 1] as const) {
        const o = (p: Point): Point => ({ x: p.x + n.x * thickness * side, z: p.z + n.z * thickness * side });
        buffer.quad(
          v(o(b), yb), v(o(a), ya),
          v(o(a), ya + height), v(o(b), yb + height),
          tint,
        );
      }
      buffer.polygon([
        v({ x: a.x + n.x * thickness, z: a.z + n.z * thickness }, ya + height),
        v({ x: b.x + n.x * thickness, z: b.z + n.z * thickness }, yb + height),
        v({ x: b.x - n.x * thickness, z: b.z - n.z * thickness }, yb + height),
        v({ x: a.x - n.x * thickness, z: a.z - n.z * thickness }, ya + height),
      ], tint, undefined, true);
      // Piers along a stone wall, and posts along a railing.
      if (lod === 0) {
        const length = distance2d(a, b);
        const spacing = wall.kind === 'railing' ? 3.2 : 14;
        const count = Math.max(0, Math.floor(length / spacing));
        for (let s = 1; s <= count; s++) {
          const t = s / (count + 1);
          const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          boxOn(groups, material, p,
            wall.kind === 'railing' ? 0.18 : 0.72,
            wall.kind === 'railing' ? height + 0.5 : height + 0.34,
            wall.kind === 'railing' ? 0.18 : 0.72,
            dir, hillGround(p.x, p.z), tint);
        }
      }
    }
  }
  return groups;
}

/* ── the building pass ────────────────────────────────────────────────────────── */

export type BuildingBuffers = { groups: Map<MaterialKey, Buffer>; triangles: number };

export function wBuildingBuffers(buildings: readonly Building[], lod: 0 | 1 | 2 | 3): BuildingBuffers {
  const groups = new Map<MaterialKey, Buffer>();
  if (lod >= 2) {
    // Massing: one box per building, roof-tinted cap. Distant enough that the hill reads
    // as villas in trees rather than as detail.
    for (const building of buildings) {
      const c = color(facade(building.facade).tint, 0.96);
      const walls = group(groups, 'walls');
      const y0 = building.base, y1 = building.base + building.height;
      const polygon = building.polygon;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        walls.quad(v(b, y0), v(a, y0), v(a, y1), v(b, y1), c);
      }
      group(groups, 'roof').polygon(polygon.map(p => v(p, y1 + 0.2)),
        building.roof === 'hip' || building.roof === 'gable' ? ROOF_TILE : ROOF_FLAT, undefined, true);
    }
  } else {
    for (const building of buildings) {
      const interior = lod === 0 && building.interior !== undefined;
      const polygon = building.polygon;
      for (let i = 0; i < polygon.length; i++) {
        emitWall(groups, building, polygon[i], polygon[(i + 1) % polygon.length], lod as 0 | 1, interior);
      }
      emitRoof(groups, building, lod as 0 | 1);
      if (lod === 0) {
        emitDoors(groups, building);
        emitSign(groups, building);
        // A cantilevered upper floor needs its soffit drawn.
        if (building.cantilever) {
          const centre = polygonCentroid(polygon);
          const dir = normalize(sub(centre, building.centre));
          void dir;
          const box = polygonBounds(polygon);
          const soffit = group(groups, 'walls');
          const mid = building.base + building.height * 0.52;
          soffit.polygon(polygon.map(p => v({
            x: p.x + (p.x - centre.x) * 0.16, z: p.z + (p.z - centre.z) * 0.16,
          }, mid)), color([0.7, 0.68, 0.64]), undefined, false);
          void box;
        }
      }
      if (interior) emitInterior(groups, building);
    }
  }
  let triangles = 0;
  for (const buffer of groups.values()) triangles += buffer.triangles;
  return { groups, triangles };
}

export function countTriangles(groups: Map<MaterialKey, Buffer>): number {
  let total = 0;
  for (const buffer of groups.values()) total += buffer.triangles;
  return total;
}

export { facade, type FacadeId };
