/**
 * Industrial mesh construction: buildings, interiors, landmarks and fences as merged,
 * vertex-coloured buffers grouped by material — a tile of the flats is a handful of
 * draw calls, and interior-ready shells are the only buildings that grow detail.
 *
 * Corrugation and panel joints are painted into vertex colours in bays; glazing is a
 * separate group so it can catch a specular highlight. Faces that cannot be seen are
 * never emitted, except inside the six enterable buildings, where the walls are doubled
 * so the camera can stand in them.
 */
import * as THREE from 'three';
import type { Point } from '../world/data';
import { Buffer } from '../city/meshes';
import { distance2d, extentAlong, leftNormal, normalize, polygonCentroid, sub } from '../city/geometry2d';
import { indGround, makeRandom } from './frame';
import { cladding } from './identity';
import type { IndBuilding, Landmark, FenceRun } from './buildings';

export type IndMaterialKey = 'walls' | 'roof' | 'glass' | 'metal' | 'paint';
type Vec3 = { x: number; y: number; z: number };

export type IndBuildingBuffers = {
  groups: Map<IndMaterialKey, Buffer>;
};

const color = (rgb: readonly [number, number, number], shade = 1): THREE.Color => {
  const c = new THREE.Color();
  c.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
  return c;
};

const ROOF_COLOR: THREE.Color = color([0.34, 0.35, 0.36]);
const ROOF_DARK: THREE.Color = color([0.24, 0.25, 0.26]);
const CONCRETE: THREE.Color = color([0.58, 0.57, 0.54]);
const STEEL: THREE.Color = color([0.5, 0.51, 0.52]);
const DOOR_DARK: THREE.Color = color([0.16, 0.17, 0.18]);
const CRANE_YELLOW: THREE.Color = color([0.78, 0.62, 0.2]);
const RUST: THREE.Color = color([0.46, 0.32, 0.22]);

function ground(p: Point, lift = 0): number { return indGround(p.x, p.z) + lift; }

function boxOn(groups: Map<IndMaterialKey, Buffer>, key: IndMaterialKey,
  centre: Point, w: number, h: number, d: number, dir: Point, baseY: number, c: THREE.Color): void {
  let buffer = groups.get(key);
  if (!buffer) { buffer = new Buffer(); groups.set(key, buffer); }
  const n = leftNormal(dir);
  const hw = w / 2, hd = d / 2;
  const corner = (sw: number, sd: number): Point => ({
    x: centre.x + dir.x * sw + n.x * sd, z: centre.z + dir.z * sw + n.z * sd,
  });
  const a = corner(-hw, -hd), b = corner(hw, -hd), cc = corner(hw, hd), dd = corner(-hw, hd);
  const y0 = baseY, y1 = baseY + h;
  const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
  buffer.polygon([v(a, y1), v(b, y1), v(cc, y1), v(dd, y1)], c, undefined, true);
  buffer.quad(v(a, y0), v(b, y0), v(b, y1), v(a, y1), c);
  buffer.quad(v(b, y0), v(cc, y0), v(cc, y1), v(b, y1), c);
  buffer.quad(v(cc, y0), v(dd, y0), v(dd, y1), v(cc, y1), c);
  buffer.quad(v(dd, y0), v(a, y0), v(a, y1), v(dd, y1), c);
}

function cylinderAt(groups: Map<IndMaterialKey, Buffer>, key: IndMaterialKey,
  centre: Point, r0: number, r1: number, y0: number, h: number, segments: number, c: THREE.Color, cap = true): void {
  let buffer = groups.get(key);
  if (!buffer) { buffer = new Buffer(); groups.set(key, buffer); }
  const ring = (y: number, r: number): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: centre.x + Math.cos(a) * r, y, z: centre.z + Math.sin(a) * r });
    }
    return pts;
  };
  const bottom = ring(y0, r0), top = ring(y0 + h, r1);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    buffer.quad(bottom[i], bottom[j], top[j], top[i], c);
  }
  if (cap) buffer.polygon(top, color([c.r * 1.12, c.g * 1.12, c.b * 1.12]), undefined, true);
}

/* ── walls with bays, doors and glazing ──────────────────────────────────────── */

function emitWall(groups: Map<IndMaterialKey, Buffer>, building: IndBuilding,
  a: Point, b: Point, lod: 0 | 1, interior: boolean): void {
  let walls = groups.get('walls');
  if (!walls) { walls = new Buffer(); groups.set('walls', walls); }
  const clad = cladding(building.cladding);
  const ya = ground(a), yb = ground(b);
  const topA = ya + building.height, topB = yb + building.height;
  const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
  const len = distance2d(a, b);
  const dir = normalize(sub(b, a));
  const base = color(clad.tint, 0.9 + building.tint * 0.16);
  const trim = color(clad.trim, 0.9 + building.tint * 0.16);
  const conditionShade = building.condition === 'abandoned' ? 0.72 : building.condition === 'renovated' ? 1.06 : 1;
  base.multiplyScalar(conditionShade); trim.multiplyScalar(conditionShade);

  // Doors on this edge (lod 0): openings in the wall, recesses behind them.
  const doors = lod === 0 ? building.doors.filter(d => {
    const hit = Math.abs((d.point.x - a.x) * dir.x + (d.point.z - a.z) * dir.z);
    const lateral = Math.abs((d.point.x - a.x) * -dir.z + (d.point.z - a.z) * dir.x);
    return lateral < 2.5 && hit >= 0 && hit <= len;
  }).map(d => ({ at: (d.point.x - a.x) * dir.x + (d.point.z - a.z) * dir.z, width: d.width + 0.7, kind: d.kind }))
    .sort((p, q) => p.at - q.at) : [];

  const outward = { x: dir.z, z: -dir.x }; // polygon is CCW: the right normal faces out
  const face = (from: number, to: number, c: THREE.Color, y0f: (t: number) => number, y1f: (t: number) => number, off = 0): void => {
    if (to - from < 0.05) return;
    const p0 = { x: a.x + dir.x * from + outward.x * off, z: a.z + dir.z * from + outward.z * off };
    const p1 = { x: a.x + dir.x * to + outward.x * off, z: a.z + dir.z * to + outward.z * off };
    walls!.quad(v(p1, y0f(to)), v(p0, y0f(from)), v(p0, y1f(from)), v(p1, y1f(to)), c);
    if (interior) {
      walls!.quad(v(p0, y0f(from)), v(p1, y0f(to)), v(p1, y1f(to)), v(p0, y1f(from)), color([c.r * 0.8, c.g * 0.8, c.b * 0.8]));
    }
  };
  const y0 = (t: number): number => ya + (yb - ya) * (t / (len || 1));
  const y1 = (t: number) => y0(t) + building.height;

  let cursor = 0;
  for (const door of doors) {
    const from = Math.max(0, door.at - door.width / 2), to = Math.min(len, door.at + door.width / 2);
    face(cursor, from, base, y0, y1);
    // Lintel above the opening, dark recess behind it.
    const doorHeight = door.kind === 'person' ? 2.3 : door.kind === 'dock' ? 3.4 : 4.4;
    face(from, to, base, (t) => y0(t) + doorHeight, y1);
    face(from, to, DOOR_DARK, y0, (t) => y0(t) + doorHeight, 0.07);
    if (door.kind === 'roller' || door.kind === 'dock') {
      // Horizontal slats read as a roller door at a glance.
      for (let s = 1; s <= 4; s++) {
        const hh = doorHeight * (s / 5);
        face(from, to, color([0.3, 0.31, 0.32]), (t) => y0(t) + hh, (t) => y0(t) + hh + 0.09, 0.1);
      }
    }
    cursor = to;
  }
  const stripe = lod === 0 && len > 8;
  if (stripe) {
    // Corrugation / panel joints in bays — every second bay, capped so long mill
    // walls stay cheap.
    const bays = Math.max(1, Math.min(36, Math.round((len - cursor) / (clad.bay * 2))));
    for (let i = 0; i < bays; i++) {
      const t0 = cursor + ((len - cursor) * i) / bays, t1 = cursor + ((len - cursor) * (i + 1)) / bays;
      face(t0, t1 - 0.06, i % 2 === 0 ? base : color([base.r * 0.93, base.g * 0.93, base.b * 0.93]), y0, y1);
    }
  } else {
    face(cursor, len, base, y0, y1);
  }
  // Plinth and eaves trim.
  face(0, len, color([0.3, 0.3, 0.3]), y0, (t) => y0(t) + 0.85);
  face(0, len, trim, (t) => y1(t) - 0.55, y1);

  // Glazing: strip windows on offices, high lights on halls.
  const isOffice = building.kind === 'office' || building.kind === 'canteen';
  if (isOffice || building.kind === 'hall' || clad.id === 'steel-glazed') {
    let glass = groups.get('glass');
    if (!glass) { glass = new Buffer(); groups.set('glass', glass); }
    const band = (h0: number, h1: number): void => {
      if (h1 <= h0) return;
      const p0 = { x: a.x + dir.x * 1.2, z: a.z + dir.z * 1.2 };
      const p1 = { x: a.x + dir.x * (len - 1.2), z: a.z + dir.z * (len - 1.2) };
      if (len < 5) return;
      const yA0 = ya + h0, yA1 = ya + h1, yB0 = yb + h0, yB1 = yb + h1;
      glass!.quad(v(p1, yB0), v(p0, yA0), v(p0, yA1), v(p1, yB1), color([0.2, 0.26, 0.3], 1));
      if (interior) glass!.quad(v(p0, yA0), v(p1, yB0), v(p1, yB1), v(p0, yA1), color([0.32, 0.36, 0.4]));
    };
    if (isOffice) {
      const floors = Math.max(1, Math.round(building.height / clad.floor));
      for (let f = 0; f < floors; f++) band(f * clad.floor + 1.1, f * clad.floor + 2.5);
    } else {
      band(building.height * 0.55, building.height * 0.78); // clerestory high lights
    }
  }
  void trim;
}

/* ── roofs ───────────────────────────────────────────────────────────────────── */

function emitRoof(groups: Map<IndMaterialKey, Buffer>, building: IndBuilding): void {
  const polygon = building.polygon;
  const centre = polygonCentroid(polygon);
  const yTop = ground(centre) + building.height;
  let roof = groups.get('roof');
  if (!roof) { roof = new Buffer(); groups.set('roof', roof); }
  const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });

  if (building.roof === 'flat' || building.kind === 'office' || building.kind === 'canteen') {
    roof.polygon(polygon.map(p => v(p, ground(p) + building.height + 0.18)), ROOF_COLOR, undefined, true);
    // Parapet.
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      roof.quad(v(b, ground(b) + building.height), v(a, ground(a) + building.height),
        v(a, ground(a) + building.height + 0.75), v(b, ground(b) + building.height + 0.75), color([0.42, 0.43, 0.44]));
    }
    return;
  }
  // Long axis of the plot.
  let best = { a: polygon[0], b: polygon[1] ?? polygon[0], length: -1 };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = distance2d(a, b);
    if (length > best.length) best = { a, b, length };
  }
  const along = normalize(sub(best.b, best.a));
  const across = leftNormal(along);
  const extA = extentAlong(polygon, centre, along);
  const extC = extentAlong(polygon, centre, across);
  const corner = (sa: number, sc: number): Point => ({
    x: centre.x + along.x * sa + across.x * sc, z: centre.z + along.z * sa + across.z * sc,
  });

  if (building.roof === 'sawtooth') {
    const rows = Math.max(2, Math.floor((extA.max - extA.min) / 9));
    let glass = groups.get('glass');
    if (!glass) { glass = new Buffer(); groups.set('glass', glass); }
    for (let r = 0; r < rows; r++) {
      const s0 = extA.min + ((extA.max - extA.min) * r) / rows;
      const s1 = extA.min + ((extA.max - extA.min) * (r + 1)) / rows;
      const rise = Math.min(2.6, (s1 - s0) * 0.3);
      // Sloped panel, then the vertical glazed face at the end of each tooth.
      roof.quad(v(corner(s0, extC.min), yTop), v(corner(s0, extC.max), yTop),
        v(corner(s1, extC.max), yTop + rise), v(corner(s1, extC.min), yTop + rise), color([0.4, 0.41, 0.42]));
      glass.quad(v(corner(s1, extC.max), yTop + rise), v(corner(s1, extC.min), yTop + rise),
        v(corner(s1, extC.min), yTop + rise * 0.15), v(corner(s1, extC.max), yTop + rise * 0.15), color([0.26, 0.32, 0.36]));
    }
    return;
  }
  if (building.roof === 'barrel') {
    const rise = Math.min(3.4, (extC.max - extC.min) * 0.14);
    const segments = 5;
    for (let s = 0; s < segments; s++) {
      const c0 = extC.min + ((extC.max - extC.min) * s) / segments;
      const c1 = extC.min + ((extC.max - extC.min) * (s + 1)) / segments;
      const h0 = Math.sqrt(Math.max(0, 1 - Math.pow((c0 / extC.max) * 0.92, 2))) * rise;
      const h1 = Math.sqrt(Math.max(0, 1 - Math.pow((c1 / extC.max) * 0.92, 2))) * rise;
      roof.quad(v(corner(extA.min, c0), yTop + h0), v(corner(extA.min, c1), yTop + h1),
        v(corner(extA.max, c1), yTop + h1), v(corner(extA.max, c0), yTop + h0), ROOF_COLOR);
    }
    return;
  }
  if (building.roof === 'gable') {
    const rise = Math.min(2.8, (extC.max - extC.min) * 0.16);
    roof.quad(v(corner(extA.min, extC.min), yTop), v(corner(extA.max, extC.min), yTop),
      v(corner(extA.max, 0), yTop + rise), v(corner(extA.min, 0), yTop + rise), ROOF_COLOR);
    roof.quad(v(corner(extA.max, extC.max), yTop), v(corner(extA.min, extC.max), yTop),
      v(corner(extA.min, 0), yTop + rise), v(corner(extA.max, 0), yTop + rise), ROOF_COLOR);
    return;
  }
  // 'open': ruins keep patches of roof; frames keep none.
  if (building.kind === 'ruin') {
    roof.quad(v(corner(extA.min, extC.min), yTop), v(corner(extA.min + (extA.max - extA.min) * 0.45, extC.min), yTop),
      v(corner(extA.min + (extA.max - extA.min) * 0.45, extC.max * 0.6), yTop), v(corner(extA.min, extC.max * 0.6), yTop), ROOF_DARK);
    roof.quad(v(corner(extA.max, extC.max), yTop - 0.4), v(corner(extA.max - (extA.max - extA.min) * 0.3, extC.max), yTop - 0.4),
      v(corner(extA.max - (extA.max - extA.min) * 0.3, extC.min * 0.4), yTop - 0.4), v(corner(extA.max, extC.min * 0.4), yTop - 0.4), ROOF_DARK);
  }
}

/* ── steel frames under construction ─────────────────────────────────────────── */

function emitFrame(groups: Map<IndMaterialKey, Buffer>, polygon: readonly Point[], height: number, baseLift = 0): void {
  let metal = groups.get('metal');
  if (!metal) { metal = new Buffer(); groups.set('metal', metal); }
  const centre = polygonCentroid(polygon);
  const column = (p: Point): void => {
    boxOn(groups, 'metal', p, 0.5, height, 0.5, normalize(sub(p, centre)), ground(p) + baseLift, STEEL);
    void metal;
  };
  for (const p of polygon) column(p);
  // Edge columns every 7 m, beams at every level.
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const len = distance2d(a, b);
    const dir = normalize(sub(b, a));
    const steps = Math.max(0, Math.floor(len / 7) - 1);
    for (let s = 1; s <= steps; s++) {
      const p = { x: a.x + dir.x * (len * s) / (steps + 1), z: a.z + dir.z * (len * s) / (steps + 1) };
      boxOn(groups, 'metal', p, 0.42, height, 0.42, dir, ground(p) + baseLift, STEEL);
    }
    const levels = Math.max(1, Math.round(height / 5));
    for (let l = 1; l <= levels; l++) {
      const y = ground(a) + baseLift + (height * l) / levels;
      boxOn(groups, 'metal', { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, len, 0.4, 0.35, dir, y - 0.2, STEEL);
    }
  }
}

/* ── interiors: the six enterable buildings ──────────────────────────────────── */

function emitInterior(groups: Map<IndMaterialKey, Buffer>, building: IndBuilding): void {
  const polygon = building.polygon;
  const centre = polygonCentroid(polygon);
  const yFloor = ground(centre) + 0.12;
  let walls = groups.get('walls');
  if (!walls) { walls = new Buffer(); groups.set('walls', walls); }
  const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
  // Floor slab and ceiling underside.
  walls.polygon(polygon.map(p => v(p, ground(p) + 0.12)), CONCRETE, undefined, true);
  walls.polygon(polygon.map(p => v(p, ground(p) + building.height - 0.3)), ROOF_DARK, undefined, false);
  const kind = building.interior;
  let best = { a: polygon[0], b: polygon[1] ?? polygon[0], length: -1 };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (distance2d(a, b) > best.length) best = { a, b, length: distance2d(a, b) };
  }
  const along = normalize(sub(best.b, best.a));
  const across = leftNormal(along);
  const extA = extentAlong(polygon, centre, along);
  const extC = extentAlong(polygon, centre, across);
  const at = (sa: number, sc: number): Point => ({ x: centre.x + along.x * sa + across.x * sc, z: centre.z + along.z * sa + across.z * sc });
  const random = makeRandom(Math.round(centre.x * 3 + centre.z));

  // Structural columns on a 9 m grid.
  for (let sa = extA.min + 6; sa < extA.max - 3; sa += 9) {
    for (let sc = extC.min + 5; sc < extC.max - 3; sc += 9) {
      boxOn(groups, 'metal', at(sa, sc), 0.45, building.height - 0.6, 0.45, along, yFloor, STEEL);
    }
  }
  if (kind === 'freight-warehouse' || kind === 'depot-warehouse') {
    // Pallet racks down the hall, a clear aisle in the middle.
    for (let sc = extC.min + 4; sc < extC.max - 4; sc += 5.5) {
      if (Math.abs(sc) < 4) continue;
      for (let sa = extA.min + 4; sa < extA.max - 6; sa += 14) {
        const shade = 0.8 + random() * 0.4;
        boxOn(groups, 'walls', at(sa + 5, sc), 10, 3.6, 1.2, along, yFloor, color([0.55 * shade, 0.42 * shade, 0.26 * shade]));
        if (random() < 0.6) boxOn(groups, 'walls', at(sa + 5, sc), 9, 1.1, 1.3, along, yFloor + 3.6, color([0.4, 0.4, 0.42], shade));
      }
    }
  } else if (kind === 'kilnside-floor') {
    // Mill floor: machine blocks, roll tables and an overhead crane on rails.
    for (let sa = extA.min + 8; sa < extA.max - 10; sa += 18) {
      boxOn(groups, 'metal', at(sa, extC.min + 6), 7, 3.2, 4.5, along, yFloor, color([0.42, 0.44, 0.45]));
      boxOn(groups, 'metal', at(sa + 3, extC.min + 6), 2.2, 1.4, 2.2, along, yFloor + 3.2, CRANE_YELLOW);
      if (random() < 0.6) boxOn(groups, 'metal', at(sa + 9, extC.max - 7), 8, 2.4, 3.6, along, yFloor, color([0.36, 0.37, 0.38]));
    }
    boxOn(groups, 'metal', at(0, extC.min + 2.5), extA.max - extA.min - 4, 0.5, 0.5, along, yFloor + building.height - 3.2, CRANE_YELLOW);
    boxOn(groups, 'metal', at(0, extC.max - 2.5), extA.max - extA.min - 4, 0.5, 0.5, along, yFloor + building.height - 3.2, CRANE_YELLOW);
    boxOn(groups, 'metal', at((random() - 0.5) * 20, 0), 4.5, 1.6, (extC.max - extC.min) - 5, along, yFloor + building.height - 4.6, CRANE_YELLOW);
  } else if (kind === 'tidehall-workshop') {
    // Repair bays: inspection pits, benches, a tyre cage.
    for (let sc = extC.min + 5; sc < extC.max - 5; sc += 8) {
      boxOn(groups, 'walls', at(0, sc), extA.max - extA.min - 12, 0.1, 4.5, along, yFloor, color([0.14, 0.14, 0.15])); // pit
      boxOn(groups, 'walls', at(extA.min + 8, sc + 3.4), 4, 0.9, 0.8, along, yFloor, color([0.5, 0.36, 0.24]));      // bench
    }
    boxOn(groups, 'metal', at(extA.max - 6, extC.max - 5), 5, 2.6, 5, along, yFloor, color([0.3, 0.31, 0.32]));
  } else if (kind === 'works-office') {
    // Ground floor: counter, desk rows, a meeting room box.
    boxOn(groups, 'walls', at(extA.min + 5, 0), 4.5, 1.1, 1.2, along, yFloor, color([0.52, 0.4, 0.3]));
    for (let sa = extA.min + 12; sa < extA.max - 6; sa += 6) {
      for (let sc = extC.min + 4; sc < extC.max - 4; sc += 5) {
        boxOn(groups, 'walls', at(sa, sc), 2.4, 0.74, 1.4, along, yFloor, color([0.62, 0.58, 0.5], 0.85 + random() * 0.3));
      }
    }
    boxOn(groups, 'glass', at(extA.max - 7, extC.min + 4), 6, 2.8, 5, along, yFloor, color([0.3, 0.36, 0.4], 0.7));
  } else if (kind === 'marrow-canteen') {
    // Serving counter and long tables.
    boxOn(groups, 'walls', at(extA.min + 4, 0), 2.2, 1.2, extC.max - extC.min - 6, along, yFloor, color([0.6, 0.6, 0.62]));
    for (let sa = extA.min + 10; sa < extA.max - 5; sa += 7) {
      boxOn(groups, 'walls', at(sa, 0), 4.6, 0.75, 1.1, along, yFloor, color([0.55, 0.42, 0.3], 0.9 + random() * 0.2));
    }
  }
}

/* ── signs ───────────────────────────────────────────────────────────────────── */

function emitSign(groups: Map<IndMaterialKey, Buffer>, building: IndBuilding): void {
  if (!building.sign) return;
  const { point, dir, text } = building.sign;
  const width = Math.min(11, 2.2 + text.length * 0.42);
  const y = ground(point) + Math.min(building.height - 1.6, 5.2);
  const n = leftNormal(dir);
  const c = color([0.72, 0.7, 0.64]);
  let paint = groups.get('paint');
  if (!paint) { paint = new Buffer(); groups.set('paint', paint); }
  const corner = (sw: number, sh: number): Vec3 => ({
    x: point.x + dir.x * 0.42 + n.x * sw, y: y + sh, z: point.z + dir.z * 0.42 + n.z * sw,
  });
  paint.quad(corner(width / 2, 0), corner(-width / 2, 0), corner(-width / 2, 1.3), corner(width / 2, 1.3), c);
  // Abstract lettering: light bars inside the board.
  const bars = Math.min(5, Math.max(2, Math.floor(text.length / 4)));
  for (let i = 0; i < bars; i++) {
    const w0 = -width / 2 + 0.7 + (i * (width - 1.4)) / bars;
    paint.quad(corner(w0, 0.42), corner(w0 + (width - 1.4) / bars - 0.35, 0.42),
      corner(w0 + (width - 1.4) / bars - 0.35, 0.88), corner(w0, 0.88), color([0.16, 0.18, 0.2]));
  }
}

/* ── the building pass ───────────────────────────────────────────────────────── */

export function indBuildingBuffers(buildings: readonly IndBuilding[], lod: 0 | 1 | 2 | 3): IndBuildingBuffers {
  const groups = new Map<IndMaterialKey, Buffer>();
  if (lod >= 2) {
    // Massing: one box per building, roof-tinted cap.
    for (const building of buildings) {
      const centre = polygonCentroid(building.polygon);
      const c = color(cladding(building.cladding).tint, building.condition === 'abandoned' ? 0.72 : 0.95);
      let walls = groups.get('walls');
      if (!walls) { walls = new Buffer(); groups.set('walls', walls); }
      const polygon = building.polygon;
      const y0 = ground(centre), y1 = y0 + building.height;
      const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        walls.quad(v(b, y0), v(a, y0), v(a, y1), v(b, y1), c);
      }
      let roof = groups.get('roof');
      if (!roof) { roof = new Buffer(); groups.set('roof', roof); }
      roof.polygon(polygon.map(p => v(p, y1 + 0.2)), ROOF_COLOR, undefined, true);
    }
    return { groups };
  }
  for (const building of buildings) {
    const interior = lod === 0 && building.interior !== undefined;
    if (building.kind === 'frame') {
      emitFrame(groups, building.polygon, building.height);
      if (building.condition === 'construction' && building.height > 6) {
        // The first lift of decking goes on with the frame.
        let roof = groups.get('roof');
        if (!roof) { roof = new Buffer(); groups.set('roof', roof); }
        const centre = polygonCentroid(building.polygon);
        roof.polygon(building.polygon.map(p => ({ x: p.x, y: ground(p) + building.height * 0.55, z: p.z })), ROOF_DARK, undefined, true);
        void centre;
      }
      continue;
    }
    const polygon = building.polygon;
    for (let i = 0; i < polygon.length; i++) {
      emitWall(groups, building, polygon[i], polygon[(i + 1) % polygon.length], lod as 0 | 1, interior);
    }
    if (building.kind === 'ruin' && building.condition === 'abandoned') {
      // Ruins: broken wall tops — drop a random edge's height for a collapsed look.
      // (Handled by the roof pass emitting patches; walls stay full for simplicity.)
    }
    emitRoof(groups, building);
    if (lod === 0) {
      emitSign(groups, building);
      // Dock platforms: a concrete lip in front of every dock door.
      for (const door of building.doors) {
        if (door.kind !== 'dock') continue;
        const p = { x: door.point.x + door.dir.x * 1.4, z: door.point.z + door.dir.z * 1.4 };
        boxOn(groups, 'walls', p, 2.6, 1.05, door.width + 0.6, door.dir, ground(door.point) - 0.05, CONCRETE);
        boxOn(groups, 'metal', { x: door.point.x + door.dir.x * 2.9, z: door.point.z + door.dir.z * 2.9 },
          0.5, 0.5, door.width, door.dir, ground(door.point) + 1.0, color([0.28, 0.29, 0.3]));
      }
      // Rooftop plant on the flat roofs of the working generation.
      if (building.roof === 'flat' && building.condition !== 'abandoned' && building.height > 9) {
        const random = makeRandom(Math.round(building.centre.x + building.centre.z * 7));
        const centre = polygonCentroid(polygon);
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i++) {
          const p = { x: centre.x + (random() - 0.5) * 14, z: centre.z + (random() - 0.5) * 10 };
          boxOn(groups, 'metal', p, 2.4 + random() * 3, 1.2 + random() * 1.4, 2 + random() * 2,
            normalize(sub(p, centre)), ground(centre) + building.height + 0.2, color([0.46, 0.47, 0.48], 0.9 + random() * 0.2));
        }
      }
    }
    if (interior) emitInterior(groups, building);
  }
  return { groups };
}

/* ── landmarks ───────────────────────────────────────────────────────────────── */

export function indLandmarkBuffers(landmarks: readonly Landmark[], lod: 0 | 1 | 2 | 3): Map<IndMaterialKey, Buffer> {
  const groups = new Map<IndMaterialKey, Buffer>();
  for (const lm of landmarks) {
    const y = ground(lm.centre);
    const detail = lod <= 1;
    switch (lm.kind) {
      case 'stack': {
        cylinderAt(groups, 'walls', lm.centre, lm.radius, lm.radius * 0.62, y, lm.height, detail ? 12 : 7, CONCRETE);
        if (detail) {
          for (const [h0, hh] of [[lm.height * 0.72, 3.4], [lm.height * 0.86, 3.4]] as const) {
            cylinderAt(groups, 'paint', lm.centre, lm.radius * 0.79 + 0.06, lm.radius * 0.74 + 0.06, y + h0, hh, 12, color([0.66, 0.28, 0.22]), false);
          }
        }
        break;
      }
      case 'tank': {
        cylinderAt(groups, 'walls', lm.centre, lm.radius, lm.radius, y + 0.4, lm.height - 1.6, detail ? 12 : 7, color([0.66, 0.67, 0.66]));
        cylinderAt(groups, 'roof', lm.centre, lm.radius + 0.2, lm.radius * 0.2, y + lm.height - 1.2, 1.6, detail ? 12 : 7, color([0.45, 0.46, 0.47]));
        if (detail) cylinderAt(groups, 'metal', lm.centre, lm.radius + 0.5, lm.radius + 0.5, y, 0.4, 12, CONCRETE);
        break;
      }
      case 'water-tower':
      case 'silo': {
        const legH = lm.kind === 'water-tower' ? lm.height * 0.55 : 0;
        if (legH > 0 && detail) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            const p = { x: lm.centre.x + Math.cos(a) * lm.radius * 0.8, z: lm.centre.z + Math.sin(a) * lm.radius * 0.8 };
            boxOn(groups, 'metal', p, 0.5, legH, 0.5, normalize(sub(p, lm.centre)), y, STEEL);
          }
        }
        cylinderAt(groups, 'walls', lm.centre, lm.radius, lm.radius * 0.94, y + legH, lm.height - legH - 1.8, detail ? 12 : 7, color([0.6, 0.61, 0.6]));
        cylinderAt(groups, 'roof', lm.centre, lm.radius + 0.3, 0.3, y + lm.height - 1.8, 1.9, detail ? 12 : 7, color([0.42, 0.43, 0.44]));
        break;
      }
      case 'gantry-crane':
      case 'magnet-crane': {
        const dir = lm.dir ?? { x: 1, z: 0 };
        const n = leftNormal(dir);
        const halfSpan = (lm.span ?? 40) / 2;
        const legY = lm.height * 0.72;
        for (const side of [-1, 1] as const) {
          const footL = { x: lm.centre.x + n.x * side * halfSpan * 0.9, z: lm.centre.z + n.z * side * halfSpan * 0.9 };
          for (const along of [-halfSpan + 3, halfSpan - 3] as const) {
            const p = { x: footL.x + dir.x * along, z: footL.z + dir.z * along };
            boxOn(groups, 'metal', p, 1.1, legY, 1.1, dir, y, CRANE_YELLOW);
          }
          // Portal beam along the rail direction.
          boxOn(groups, 'metal', footL, 1.4, 1.6, (halfSpan - 3) * 2, dir, y + legY, CRANE_YELLOW);
        }
        // Gantry girder across, trolley and hoist.
        boxOn(groups, 'metal', lm.centre, (lm.span ?? 40) * 0.55, 1.5, 1.5, dir, y + legY + 1.6, CRANE_YELLOW);
        const trolley = { x: lm.centre.x + dir.x * 4, z: lm.centre.z + dir.z * 4 };
        boxOn(groups, 'metal', trolley, 3.4, 1.4, 2.6, dir, y + legY + 0.2, color([0.55, 0.45, 0.2]));
        if (detail) {
          const drop = lm.kind === 'magnet-crane' ? lm.height * 0.5 : 6;
          boxOn(groups, 'metal', trolley, 0.14, drop, 0.14, dir, y + legY - drop + 0.2, color([0.2, 0.2, 0.21]));
          if (lm.kind === 'magnet-crane') {
            cylinderAt(groups, 'metal', { x: trolley.x, z: trolley.z }, 2.4, 2.4, y + legY - drop - 1.2, 1.3, 10, color([0.3, 0.31, 0.33]));
          } else {
            boxOn(groups, 'metal', { x: trolley.x, z: trolley.z }, 6.4, 0.7, 2.6, dir, y + legY - drop - 0.8, CRANE_YELLOW); // spreader
          }
        }
        break;
      }
      case 'tower-crane': {
        const dir = lm.dir ?? { x: 1, z: 0 };
        boxOn(groups, 'metal', lm.centre, 1.7, lm.height, 1.7, dir, y, CRANE_YELLOW);
        const jibY = y + lm.height - 1.4;
        boxOn(groups, 'metal', { x: lm.centre.x + dir.x * 16, z: lm.centre.z + dir.z * 16 }, 34, 1.1, 1.1, dir, jibY, CRANE_YELLOW);
        boxOn(groups, 'metal', { x: lm.centre.x - dir.x * 8, z: lm.centre.z - dir.z * 8 }, 12, 1.1, 1.1, dir, jibY, CRANE_YELLOW);
        boxOn(groups, 'metal', { x: lm.centre.x - dir.x * 13, z: lm.centre.z - dir.z * 13 }, 3.4, 2.6, 2.4, dir, jibY - 1.2, color([0.35, 0.36, 0.37]));
        boxOn(groups, 'metal', { x: lm.centre.x - dir.x * 1.6, z: lm.centre.z - dir.z * 1.6 }, 2.6, 2.4, 2.2, dir, jibY - 2.4, color([0.5, 0.4, 0.2]));
        if (detail) {
          const hook = { x: lm.centre.x + dir.x * 24, z: lm.centre.z + dir.z * 24 };
          boxOn(groups, 'metal', hook, 0.1, lm.height * 0.45, 0.1, dir, jibY - lm.height * 0.45, color([0.2, 0.2, 0.21]));
          boxOn(groups, 'metal', hook, 1.6, 1, 1.2, dir, jibY - lm.height * 0.45 - 1, CRANE_YELLOW);
        }
        break;
      }
      case 'frame': {
        emitFrame(groups, [
          { x: lm.centre.x - (lm.dir?.x ?? 1) * (lm.span ?? 30) / 2, z: lm.centre.z - (lm.dir?.z ?? 0) * (lm.span ?? 30) / 2 },
          { x: lm.centre.x + (lm.dir?.x ?? 1) * (lm.span ?? 30) / 2, z: lm.centre.z + (lm.dir?.z ?? 0) * (lm.span ?? 30) / 2 },
        ], lm.height);
        break;
      }
    }
  }
  return groups;
}

/* ── fences ──────────────────────────────────────────────────────────────────── */

export function indFenceBuffers(fences: readonly FenceRun[], lod: 0 | 1): Map<IndMaterialKey, Buffer> {
  const groups = new Map<IndMaterialKey, Buffer>();
  let metal = groups.get('metal');
  if (!metal) { metal = new Buffer(); groups.set('metal', metal); }
  for (const fence of fences) {
    const c = fence.condition === 'abandoned'
      ? color([0.45, 0.33, 0.24], 0.85 + (fence.points.length % 3) * 0.05)
      : fence.kind === 'barbed' ? color([0.4, 0.41, 0.42]) : color([0.52, 0.53, 0.54]);
    const h = fence.height;
    for (let i = 0; i + 1 < fence.points.length; i++) {
      const a = fence.points[i], b = fence.points[i + 1];
      const ya = ground(a), yb = ground(b);
      const dir = normalize(sub(b, a));
      const v = (p: Point, y: number): Vec3 => ({ x: p.x, y, z: p.z });
      // A single ribbon: mesh panels read as mass at this scale.
      metal.quad(v(b, yb), v(a, ya), v(a, ya + h), v(b, yb + h), c);
      if (lod === 0) {
        metal.quad(v(a, ya), v(b, yb), v(b, yb + h), v(a, ya + h), color([c.r * 0.86, c.g * 0.86, c.b * 0.86]));
        if (i % 3 === 0) boxOn(groups, 'metal', a, 0.12, h + 0.25, 0.12, dir, ya, color([0.44, 0.45, 0.46]));
        if (fence.kind === 'barbed') {
          metal.quad(v(b, yb + h), v(a, ya + h), v(a, ya + h + 0.35), v(b, yb + h + 0.35), color([0.35, 0.3, 0.25]));
        }
      }
    }
  }
  return groups;
}
