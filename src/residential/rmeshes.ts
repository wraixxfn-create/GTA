/**
 * Mesh construction for the Residential Valley's buildings: walls with window bands,
 * pitched and flat roofs, chimneys, porches, balconies and the painted shopfronts of
 * Market Row. Everything is emitted per level of detail — close up gets windows and
 * signage, the middle ring gets roofs and doors, distance gets the massing alone.
 */
import * as THREE from 'three';
import { Buffer } from '../city/meshes';
import { facade, type FacadeId } from './identity';
import type { Building, RoofKind } from './buildings';
import { distance2d, normalize, polygonArea, polygonCentroid, sub, add, scale, leftNormal } from '../city/geometry2d';

export type MaterialKey = 'walls' | 'roof' | 'glass' | 'metal' | 'paint' | 'signage';

type Vec3 = { x: number; y: number; z: number };
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function facadeColor(id: FacadeId, tint: number, out: THREE.Color): void {
  const f = facade(id);
  const shade = 0.9 + tint * 0.18;
  out.setRGB(f.tint[0] * shade, f.tint[1] * shade, f.tint[2] * shade, THREE.SRGBColorSpace);
}

const ROOF_COLOR: Record<RoofKind, [number, number, number]> = {
  gable: [.4, .3, .28], hip: [.42, .32, .28], flat: [.5, .5, .48],
  parapet: [.52, .5, .46], mansard: [.34, .3, .3], mono: [.45, .4, .36],
};

type Target = {
  groups: Map<MaterialKey, Buffer>;
  triangles: number;
};
function bufferOf(target: Target, key: MaterialKey): Buffer {
  let buffer = target.groups.get(key);
  if (!buffer) { buffer = new Buffer(); target.groups.set(key, buffer); }
  return buffer;
}
function account(target: Target, buffer: Buffer, before: number): void {
  target.triangles += buffer.triangles - before;
}

/** Prism walls for a convex footprint between base and top, with optional window bands. */
function walls(target: Target, footprint: readonly { x: number; z: number }[], base: number, top: number, building: Building, lod: 0 | 1 | 2 | 3): void {
  const wallsBuf = bufferOf(target, 'walls');
  const glassBuf = bufferOf(target, 'glass');
  const paintBuf = bufferOf(target, 'paint');
  const color = new THREE.Color();
  facadeColor(building.facade, building.tint, color);
  const windows = lod === 0 || lod === 1;
  const floors = Math.max(1, building.storeys);
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const length = distance2d(a, b);
    if (length < 0.4) continue;
    const before = wallsBuf.triangles;
    const dir = normalize(sub(b, a));
    const n = leftNormal(dir);
    // Outward normal: for CCW footprints the left normal points inward; flip it.
    const out = { x: -n.x, z: -n.z };
    void out;
    const outward = { x: n.x, z: n.z };
    wallsBuf.quad(
      v3(a.x, base, a.z), v3(b.x, base, b.z), v3(b.x, top, b.z), v3(a.x, top, a.z),
      color, [[0, 0], [length / 4, 0], [length / 4, (top - base) / 4], [0, (top - base) / 4]],
    );
    account(target, wallsBuf, before);
    if (!windows) continue;
    // Window bands: one row per floor, punched out as glass quads sitting on the wall.
    const floorH = (top - base) / floors;
    for (let f = 0; f < floors; f++) {
      const y0 = base + f * floorH + floorH * 0.28;
      const y1 = base + f * floorH + floorH * 0.72;
      const cols = Math.max(1, Math.floor(length / (building.kind === 'shop' || building.kind === 'mixed' ? 3.2 : 2.6)));
      for (let c = 0; c < cols; c++) {
        const isShopBand = f === 0 && building.shopUnits.length > 0;
        const t0 = (c + 0.18) / cols, t1 = (c + 0.82) / cols;
        const wa = { x: a.x + (b.x - a.x) * t0 + outward.x * 0.04, z: a.z + (b.z - a.z) * t0 + outward.z * 0.04 };
        const wb = { x: a.x + (b.x - a.x) * t1 + outward.x * 0.04, z: a.z + (b.z - a.z) * t1 + outward.z * 0.04 };
        const beforeG = glassBuf.triangles;
        if (isShopBand) {
          // Shopfront glazing below the fascia.
          glassBuf.quad(
            v3(wa.x, base + 0.2, wa.z), v3(wb.x, base + 0.2, wb.z),
            v3(wb.x, base + floorH * 0.7, wb.z), v3(wa.x, base + floorH * 0.7, wa.z),
            new THREE.Color(0.2, 0.26, 0.3),
          );
        } else {
          glassBuf.quad(
            v3(wa.x, y0, wa.z), v3(wb.x, y0, wb.z), v3(wb.x, y1, wb.z), v3(wa.x, y1, wa.z),
            new THREE.Color(0.16, 0.22, 0.26),
          );
        }
        account(target, glassBuf, beforeG);
      }
      // Floor band under each row of windows (the Victorian terrace's string course).
      if (building.vintage === 'victorian' && f > 0 && lod === 0) {
        const beforeP = paintBuf.triangles;
        const band = 0.14;
        paintBuf.quad(
          v3(a.x + outward.x * 0.05, base + f * floorH - band, a.z + outward.z * 0.05),
          v3(b.x + outward.x * 0.05, base + f * floorH - band, b.z + outward.z * 0.05),
          v3(b.x + outward.x * 0.05, base + f * floorH, b.z + outward.z * 0.05),
          v3(a.x + outward.x * 0.05, base + f * floorH, a.z + outward.z * 0.05),
          new THREE.Color(0.82, 0.78, 0.7),
        );
        account(target, paintBuf, beforeP);
      }
    }
  }
}

/** Roof caps: pitched prisms for houses and terraces, flat slabs with parapets. */
function roof(target: Target, footprint: readonly { x: number; z: number }[], top: number, building: Building, lod: 0 | 1 | 2 | 3): void {
  const roofBuf = bufferOf(target, 'roof');
  const wallsBuf = bufferOf(target, 'walls');
  const color = new THREE.Color();
  const rgb = ROOF_COLOR[building.roof];
  color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const before = roofBuf.triangles;
  const centre = polygonCentroid(footprint as { x: number; z: number }[]);
  switch (building.roof) {
    case 'gable': case 'mono': case 'mansard': {
      // Ridge along the footprint's long axis.
      const ridge = building.ridge ?? normalize(sub(footprint[1] ?? footprint[0], footprint[0]));
      const n = leftNormal(ridge);
      const span = 2 + (building.roof === 'mansard' ? 1.4 : building.roof === 'mono' ? 0.8 : 2.2);
      const rise = building.roof === 'mono' ? 1.4 : 2.4;
      // Find the extremes along the ridge axis and the width axis.
      let rMin = Infinity, rMax = -Infinity, wMin = Infinity, wMax = -Infinity;
      for (const p of footprint) {
        const r = (p.x - centre.x) * ridge.x + (p.z - centre.z) * ridge.z;
        const w = (p.x - centre.x) * n.x + (p.z - centre.z) * n.z;
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
        wMin = Math.min(wMin, w); wMax = Math.max(wMax, w);
      }
      void span;
      const r0 = { x: centre.x + ridge.x * rMin, z: centre.z + ridge.z * rMin };
      const r1 = { x: centre.x + ridge.x * rMax, z: centre.z + ridge.z * rMax };
      const wL = Math.abs(wMin), wR = Math.abs(wMax);
      const eaveL = { x: centre.x + n.x * wMin, z: centre.z + n.z * wMin };
      const eaveR = { x: centre.x + n.x * wMax, z: centre.z + n.z * wMax };
      const ridgeY = top + rise;
      const eaveOver = 0.5;
      // Two pitched planes from eaves to ridge with a slight overhang.
      const l0 = { x: eaveL.x + ridge.x * (rMin - eaveOver) - n.x * 0, z: eaveL.z + ridge.z * (rMin - eaveOver) };
      const l1 = { x: eaveL.x + ridge.x * (rMax + eaveOver), z: eaveL.z + ridge.z * (rMax + eaveOver) };
      const rr0 = { x: r0.x - n.x * 0, z: r0.z };
      void rr0; void l0; void l1; void wL; void wR;
      const eL0 = v3(centre.x + n.x * (wMin - 0.3) + ridge.x * (rMin - eaveOver), top, centre.z + n.z * (wMin - 0.3) + ridge.z * (rMin - eaveOver));
      const eL1 = v3(centre.x + n.x * (wMin - 0.3) + ridge.x * (rMax + eaveOver), top, centre.z + n.z * (wMin - 0.3) + ridge.z * (rMax + eaveOver));
      const g0 = v3(centre.x + ridge.x * (rMin - eaveOver), ridgeY, centre.z + ridge.z * (rMin - eaveOver));
      const g1 = v3(centre.x + ridge.x * (rMax + eaveOver), ridgeY, centre.z + ridge.z * (rMax + eaveOver));
      const eR0 = v3(centre.x + n.x * (wMax + 0.3) + ridge.x * (rMin - eaveOver), top, centre.z + n.z * (wMax + 0.3) + ridge.z * (rMin - eaveOver));
      const eR1 = v3(centre.x + n.x * (wMax + 0.3) + ridge.x * (rMax + eaveOver), top, centre.z + n.z * (wMax + 0.3) + ridge.z * (rMax + eaveOver));
      roofBuf.quad(eL0, eL1, g1, g0, color);
      roofBuf.quad(eR1, eR0, g0, g1, color);
      // Gable ends close the prism.
      const beforeW = wallsBuf.triangles;
      wallsBuf.triangle(eL0, g0, eR0, color);
      wallsBuf.triangle(eR1, g1, eL1, color);
      account(target, wallsBuf, beforeW);
      break;
    }
    case 'flat': case 'parapet': default: {
      // Flat slab with a shallow parapet ring.
      const height = building.roof === 'parapet' ? 0.85 : 0.35;
      roofBuf.polygon(footprint.map(p => v3(p.x, top + 0.1, p.z)), color, undefined, true);
      const beforeW = wallsBuf.triangles;
      for (let i = 0; i < footprint.length; i++) {
        const a = footprint[i], b = footprint[(i + 1) % footprint.length];
        const innerA = { x: centre.x + (a.x - centre.x) * 0.94, z: centre.z + (a.z - centre.z) * 0.94 };
        const innerB = { x: centre.x + (b.x - centre.x) * 0.94, z: centre.z + (b.z - centre.z) * 0.94 };
        wallsBuf.quad(
          v3(a.x, top, a.z), v3(b.x, top, b.z),
          v3(b.x, top + height, b.z), v3(a.x, top + height, a.z), color,
        );
        void innerA; void innerB;
      }
      account(target, wallsBuf, beforeW);
      break;
    }
    case 'hip': {
      // Hip roof: planes from each eave edge to a short ridge or apex.
      const rise = 2.2;
      const apex = v3(centre.x, top + rise, centre.z);
      const beforeH = roofBuf.triangles;
      for (let i = 0; i < footprint.length; i++) {
        const a = footprint[i], b = footprint[(i + 1) % footprint.length];
        roofBuf.triangle(v3(a.x, top, a.z), v3(b.x, top, b.z), apex, color);
      }
      account(target, roofBuf, beforeH);
      break;
    }
  }
  void building;
}

function chimneys(target: Target, building: Building, lod: 0 | 1): void {
  if (!building.chimneys || lod > 1) return;
  const buf = bufferOf(target, 'walls');
  const color = new THREE.Color(0.5, 0.38, 0.32);
  const centre = building.centre;
  const ridge = building.ridge ?? { x: 1, z: 0 };
  for (let i = 0; i < building.chimneys; i++) {
    const along = (i - (building.chimneys - 1) / 2) * 3.2;
    const cx = centre.x + ridge.x * along;
    const cz = centre.z + ridge.z * along;
    const w = 0.55, h = 1.6;
    const y = building.ground + building.height;
    const before = buf.triangles;
    buf.quad(v3(cx - w, y, cz - w), v3(cx + w, y, cz - w), v3(cx + w, y + h, cz - w), v3(cx - w, y + h, cz - w), color);
    buf.quad(v3(cx + w, y, cz + w), v3(cx - w, y, cz + w), v3(cx - w, y + h, cz + w), v3(cx + w, y + h, cz + w), color);
    buf.quad(v3(cx + w, y, cz - w), v3(cx + w, y, cz + w), v3(cx + w, y + h, cz + w), v3(cx + w, y + h, cz - w), color);
    buf.quad(v3(cx - w, y, cz + w), v3(cx - w, y, cz - w), v3(cx - w, y + h, cz - w), v3(cx - w, y + h, cz + w), color);
    buf.quad(v3(cx - w, y + h, cz - w), v3(cx + w, y + h, cz - w), v3(cx + w, y + h, cz + w), v3(cx - w, y + h, cz + w), color);
    account(target, buf, before);
  }
}

function details(target: Target, building: Building, lod: 0 | 1): void {
  const paintBuf = bufferOf(target, 'paint');
  const signBuf = bufferOf(target, 'signage');
  const metalBuf = bufferOf(target, 'metal');
  const wallBuf = bufferOf(target, 'walls');
  const white = new THREE.Color(0.9, 0.88, 0.82);
  const doorColor = new THREE.Color(0.3, 0.24, 0.2);
  // Door.
  const d = building.door;
  const n = leftNormal(d.dir);
  const hw = d.width / 2;
  const beforeD = paintBuf.triangles;
  paintBuf.quad(
    v3(d.point.x + n.x * hw, building.ground, d.point.z + n.z * hw),
    v3(d.point.x - n.x * hw, building.ground, d.point.z - n.z * hw),
    v3(d.point.x - n.x * hw, building.ground + d.width * 1.7, d.point.z - n.z * hw),
    v3(d.point.x + n.x * hw, building.ground + d.width * 1.7, d.point.z + n.z * hw),
    doorColor,
  );
  account(target, paintBuf, beforeD);
  // Porch canopy over the front door of a semi.
  if (building.porch && lod === 0) {
    const beforeW = wallBuf.triangles;
    const reach = 1.4;
    wallBuf.quad(
      v3(d.point.x + n.x * (hw + 0.2), building.ground + 2.3, d.point.z + n.z * (hw + 0.2)),
      v3(d.point.x - n.x * (hw + 0.2), building.ground + 2.3, d.point.z - n.z * (hw + 0.2)),
      v3(d.point.x - d.dir.x * reach - n.x * (hw + 0.2), building.ground + 2.3, d.point.z - d.dir.z * reach - n.z * (hw + 0.2)),
      v3(d.point.x - d.dir.x * reach + n.x * (hw + 0.2), building.ground + 2.3, d.point.z - d.dir.z * reach + n.z * (hw + 0.2)),
      white,
    );
    account(target, wallBuf, beforeW);
  }
  // Balconies for the flats: one slab per floor on the front.
  if (building.balconies && lod === 0) {
    const beforeM = metalBuf.triangles;
    const floorH = (building.height - 1) / Math.max(1, building.storeys);
    for (let f = 1; f < building.balconies; f++) {
      const y = building.ground + f * floorH;
      const reach = 1.3;
      const bw = 2.2;
      const bx = d.point.x - d.dir.x * reach * 0.5, bz = d.point.z - d.dir.z * reach * 0.5;
      metalBuf.quad(
        v3(bx + n.x * bw, y, bz + n.z * bw),
        v3(bx - n.x * bw, y, bz - n.z * bw),
        v3(bx - n.x * bw - d.dir.x * reach, y, bz - n.z * bw - d.dir.z * reach),
        v3(bx + n.x * bw - d.dir.x * reach, y, bz + n.z * bw - d.dir.z * reach),
        new THREE.Color(0.6, 0.6, 0.58),
      );
      // Rail.
      metalBuf.quad(
        v3(bx + n.x * bw, y + 0.05, bz + n.z * bw),
        v3(bx - n.x * bw, y + 0.05, bz - n.z * bw),
        v3(bx - n.x * bw, y + 1.0, bz - n.z * bw),
        v3(bx + n.x * bw, y + 1.0, bz + n.z * bw),
        new THREE.Color(0.55, 0.55, 0.53),
      );
    }
    account(target, metalBuf, beforeM);
  }
  // Shopfronts: fascia signs over the ground-floor glazing.
  if (lod === 0 || lod === 1) {
    for (const unit of building.shopUnits) {
      const mid = { x: (unit.a.x + unit.b.x) / 2, z: (unit.a.z + unit.b.z) / 2 };
      const dir = normalize(sub(unit.b, unit.a));
      const nn = leftNormal(dir);
      const outward = polygonCentroid(building.footprint);
      const facing = normalize(sub(mid, outward));
      const off = { x: facing.x * 0.08, z: facing.z * 0.08 };
      void nn;
      const beforeS = signBuf.triangles;
      const signY = building.ground + (building.kind === 'mixed' || building.kind === 'store' ? 3.2 : 2.8);
      signBuf.quad(
        v3(unit.a.x + off.x, signY, unit.a.z + off.z),
        v3(unit.b.x + off.x, signY, unit.b.z + off.z),
        v3(unit.b.x + off.x, signY + 0.75, unit.b.z + off.z),
        v3(unit.a.x + off.x, signY + 0.75, unit.a.z + off.z),
        new THREE.Color().setHSL((unit.sign.length * 0.13) % 1, 0.35, 0.5),
      );
      account(target, signBuf, beforeS);
    }
  }
}

export type BuildingBuffers = { groups: Map<MaterialKey, Buffer>; triangles: number };

export function resBuildingBuffers(buildings: readonly Building[], lod: 0 | 1 | 2 | 3): BuildingBuffers {
  const target: Target = { groups: new Map(), triangles: 0 };
  for (const building of buildings) {
    const base = building.ground;
    const top = building.ground + building.height;
    walls(target, building.footprint, base, top, building, lod);
    roof(target, building.footprint, top, building, lod);
    if (lod <= 1) {
      chimneys(target, building, lod as 0 | 1);
      details(target, building, lod as 0 | 1);
    }
  }
  return target;
}

export function countTriangles(groups: Map<MaterialKey, Buffer>): number {
  let n = 0;
  for (const buffer of groups.values()) n += buffer.triangles;
  return n;
}
