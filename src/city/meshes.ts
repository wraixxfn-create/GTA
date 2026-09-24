/**
 * Mesh construction: surface pieces, buildings and their street-level detail.
 *
 * The builders emit merged buffers grouped by material so a whole city block is a handful
 * of draw calls, and they emit only what a given level of detail can show. Faces that can
 * never be seen (a wall buried in the middle of a terrace, the inside of a roof) are not
 * generated at all — that is the cheapest occlusion there is.
 */
import * as THREE from 'three';
import { facadeStyle, type FacadeStyleId } from './identity';
import { cityTextures, facadeUVScale, signTileUV, SIGN_ATLAS } from './textures';
import { SURFACE_COLOR, type Piece, type SurfaceKind } from './surfaces';
import type { Building, Volume } from './buildings';
import { cityGround } from './frame';
import { distance2d, normalize, polygonArea, polygonCentroid, sub } from './geometry2d';

export type MaterialKey =
  | `facade:${FacadeStyleId}` | 'roof' | 'asphalt' | 'stone' | 'green' | 'paint'
  | 'signage' | 'glass' | 'metal' | 'trim' | 'wood' | 'concrete';

type Vec3 = { x: number; y: number; z: number };
const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Flat-shaded triangle soup with vertex colours; every group is one draw call. */
export class Buffer {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  get triangles(): number { return this.indices.length / 3; }
  get empty(): boolean { return this.indices.length === 0; }

  /** Winding follows the right-hand rule; the caller supplies outward-facing order. */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: THREE.Color, uvs?: [number, number][], flatNormal?: Vec3): void {
    const base = this.positions.length / 3;
    const normal = flatNormal ?? faceNormal(a, b, c);
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(color.r, color.g, color.b);
    }
    const uv = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [u, v] of uv) this.uvs.push(u, v);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  triangle(a: Vec3, b: Vec3, c: Vec3, color: THREE.Color, uvs?: [number, number][]): void {
    const base = this.positions.length / 3;
    const normal = faceNormal(a, b, c);
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(color.r, color.g, color.b);
    }
    const uv = uvs ?? [[0, 0], [1, 0], [1, 1]];
    for (const [u, v] of uv) this.uvs.push(u, v);
    this.indices.push(base, base + 1, base + 2);
  }

  /** Convex polygon emitted as a fan; `up` reverses the ring for upward-facing caps. */
  polygon(points: readonly Vec3[], color: THREE.Color, uvs?: [number, number][], up = true): void {
    if (points.length < 3) return;
    const order = up ? [...points].reverse() : points;
    for (let i = 1; i + 1 < order.length; i++) {
      this.triangle(order[0], order[i], order[i + 1], color,
        uvs ? [uvs[0], uvs[i], uvs[i + 1]] : undefined);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = v3(b.x - a.x, b.y - a.y, b.z - a.z);
  const w = v3(c.x - a.x, c.y - a.y, c.z - a.z);
  const nx = u.y * w.z - u.z * w.y;
  const ny = u.z * w.x - u.x * w.z;
  const nz = u.x * w.y - u.y * w.x;
  const length = Math.hypot(nx, ny, nz) || 1;
  return v3(nx / length, ny / length, nz / length);
}

/**
 * Every hard surface shares one material and one texture — its colour is per vertex — so
 * a block's paving, asphalt and concrete arrive as a single draw call.
 */
const GROUP_BY_SURFACE: Record<SurfaceKind, MaterialKey> = {
  asphalt: 'asphalt', 'asphalt-worn': 'asphalt', concrete: 'asphalt', paving: 'asphalt',
  'paving-warm': 'asphalt', cobbles: 'asphalt', gravel: 'asphalt',
  'paint-white': 'paint', 'paint-yellow': 'paint', 'paint-red': 'paint', 'paint-green': 'paint',
  grass: 'green', water: 'green', void: 'asphalt', deck: 'asphalt',
};

export function surfaceBuffers(pieces: readonly Piece[]): Map<MaterialKey, Buffer> {
  const groups = new Map<MaterialKey, Buffer>();
  const color = new THREE.Color();
  for (const piece of pieces) {
    const key = GROUP_BY_SURFACE[piece.kind];
    let buffer = groups.get(key);
    if (!buffer) { buffer = new Buffer(); groups.set(key, buffer); }
    const rgb = SURFACE_COLOR[piece.kind];
    const shade = 0.9 + piece.tint * 0.2;
    color.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
    const points = piece.points.map(p => v3(p.x, p.y, p.z));
    if (points.length === 4) {
      const [a, b, c, d] = points;
      // Surface pieces are authored counter-clockwise in plan, which faces down in a
      // right-handed scene, so emit them reversed to face the sky.
      buffer.quad(d, c, b, a, color, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    } else {
      buffer.polygon(points, color, points.map(() => [0, 0] as [number, number]), true);
    }
  }
  return groups;
}

/* ── buildings ─────────────────────────────────────────────────────────────────── */

export type BuildingLod = 0 | 1 | 2 | 3;

export type BuildingBuffers = {
  groups: Map<MaterialKey, Buffer>;
  /** Rooftop clutter and masts: instanced per tile, only at the closest LOD. */
  clutter: { position: Vec3; scale: Vec3; kind: 'mech' | 'mast' | 'tank' | 'green' }[];
  /** Sign boards drawn with the signage atlas. */
  signs: { position: Vec3; dir: Vec3; width: number; height: number; tile: number; elevated: boolean }[];
  awnings: { position: Vec3; dir: Vec3; width: number; depth: number; tint: number }[];
  canopies: { position: Vec3; dir: Vec3; width: number; depth: number }[];
};

function tintOf(building: Building): number {
  return 0.9 + building.tint * 0.2;
}

/** Walls shared with the neighbouring building are never built: classic occlusion. */
function sharedEdges(buildings: readonly Building[]): Set<string> {
  const seen = new Map<string, { building: number; index: number }>();
  const shared = new Set<string>();
  const key = (p: { x: number; z: number }) => `${Math.round(p.x / 1.5)}:${Math.round(p.z / 1.5)}`;
  buildings.forEach((building, buildingIndex) => {
    const polygon = building.footprint;
    polygon.forEach((a, index) => {
      const b = polygon[(index + 1) % polygon.length];
      const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const id = key(midpoint);
      const previous = seen.get(id);
      if (previous && previous.building !== buildingIndex) {
        shared.add(`${buildingIndex}:${index}`);
        shared.add(`${previous.building}:${previous.index}`);
      } else if (!previous) {
        seen.set(id, { building: buildingIndex, index });
      }
    });
  });
  return shared;
}

export function buildingBuffers(
  buildings: readonly Building[], lod: BuildingLod, shared?: Set<string>,
): BuildingBuffers {
  const groups = new Map<MaterialKey, Buffer>();
  const clutter: BuildingBuffers['clutter'] = [];
  const signs: BuildingBuffers['signs'] = [];
  const awnings: BuildingBuffers['awnings'] = [];
  const canopies: BuildingBuffers['canopies'] = [];
  const textures = cityTextures();
  const colour = new THREE.Color();
  const sharedEdgesSet = shared ?? sharedEdges(buildings);

  buildings.forEach((building, buildingIndex) => {
    const ground = cityGround(building.centre.x, building.centre.z);
    const tint = tintOf(building);
    building.volumes.forEach((volume, volumeIndex) => {
      const style = facadeStyle(volume.style);
      // Buffers are grouped by family, so one material is also one draw call.
      const key: MaterialKey = `facade:${style.family}` as MaterialKey;
      let buffer = groups.get(key);
      if (!buffer) { buffer = new Buffer(); groups.set(key, buffer); }
      const polygon = volume.polygon;
      const [, repeatV] = facadeUVScale(style, 1, volume.top - volume.base);
      const height = Math.max(0.4, volume.top - volume.base);
      const isTop = volumeIndex === building.volumes.length - 1;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        if (volumeIndex === 0 && sharedEdgesSet.has(`${buildingIndex}:${i}`)) continue;
        const width = distance2d(a, b);
        if (width < 0.4) continue;
        const [repeatU] = facadeUVScale(style, width, 1);
        const base = ground + volume.base, top = ground + volume.top;
        // The family texture is neutral, so the vertex colour carries this building's
        // material colour and its small variation from its neighbours.
        colour.setRGB(style.tint[0] * tint * 1.15, style.tint[1] * tint * 1.15, style.tint[2] * tint * 1.15, THREE.SRGBColorSpace);
        // Side wall: outward facing, UVs repeat the facade module both ways.
        buffer.quad(
          v3(a.x, base, a.z), v3(a.x, top, a.z), v3(b.x, top, b.z), v3(b.x, base, b.z),
          colour, [[0, 0], [0, repeatV], [repeatU, repeatV], [repeatU, 0]],
        );
        if (lod === 0 && height > 11 && (volume.roof === 'parapet' || volume.roof === 'mechanical' || volume.roof === 'mast')) {
          // Parapet: a low wall that gives the roofline a visible edge.
          let roofBuffer = groups.get('trim');
          if (!roofBuffer) { roofBuffer = new Buffer(); groups.set('trim', roofBuffer); }
          const parapet = Math.min(1.4, Math.max(0.7, height * 0.02));
          const inset = insetEdge(a, b, 0.35);
          colour.setRGB(style.trim[0] * tint, style.trim[1] * tint, style.trim[2] * tint, THREE.SRGBColorSpace);
          roofBuffer.quad(
            v3(a.x, top, a.z), v3(a.x, top + parapet, a.z), v3(b.x, top + parapet, b.z), v3(b.x, top, b.z),
            colour,
          );
          // Only the street-facing parapets get a coping stone; the rest is unseen.
          if (inset && width > 6 && building.height > 26) {
            roofBuffer.quad(
              v3(inset.a.x, top + parapet, inset.a.z), v3(a.x, top + parapet, a.z),
              v3(b.x, top + parapet, b.z), v3(inset.b.x, top + parapet, inset.b.z),
              colour, undefined, v3(0, 1, 0),
            );
          }
        }
        if (lod === 0 && building.shopfront && volume.base < 0.5) {
          // Only the street frontage is fitted out as shops: the sides and back are the
          // blind walls you actually get behind a terrace.
          const outward = { x: (b.z - a.z), z: -(b.x - a.x) };
          const facing = outward.x * building.entrance.dir.x + outward.z * building.entrance.dir.z;
          const length = Math.hypot(outward.x, outward.z) || 1;
          if (facing / length > 0.55) addShopfront(building, groups, a, b, ground, tint);
        }
      }
      // Roof cap.
      const roofKey: MaterialKey = volume.roof === 'garden' || volume.roof === 'plant' ? 'green' : 'roof';
      let roofBuffer = groups.get(roofKey);
      if (!roofBuffer) { roofBuffer = new Buffer(); groups.set(roofKey, roofBuffer); }
      const top = ground + volume.top;
      const roofColour = volume.roof === 'garden' || volume.roof === 'plant'
        ? colour.setRGB(0.33, 0.45, 0.30, THREE.SRGBColorSpace)
        : colour.setRGB(0.30 + building.tint * 0.08, 0.31 + building.tint * 0.06, 0.30, THREE.SRGBColorSpace);
      const cap = polygon.map(p => v3(p.x, top + (volume.roof === 'vault' ? 0 : 0), p.z));
      const scale = Math.max(1, Math.sqrt(polygonArea(polygon)) / 4);
      roofBuffer.polygon(cap, roofColour.clone(),
        cap.map(p => [(p.x) / scale / 4, (p.z) / scale / 4] as [number, number]), true);
      if (lod === 0 && isTop) {
        if (volume.roof === 'mechanical' || volume.roof === 'plant') {
          const centre = polygonCentroid(polygon);
          const count = Math.min(4, Math.max(1, Math.round(polygonArea(polygon) / 420)));
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + building.tint * 6;
            const radius = Math.sqrt(polygonArea(polygon)) * 0.18;
            clutter.push({
              position: v3(centre.x + Math.cos(angle) * radius, top + 1.1, centre.z + Math.sin(angle) * radius),
              scale: v3(3.4 + (i % 2) * 2.2, 2.4, 2.4 + (i % 3)), kind: 'mech',
            });
          }
        }
        if (volume.roof === 'mast' || volume.roof === 'spire') {
          const centre = polygonCentroid(polygon);
          clutter.push({
            position: v3(centre.x, top + 12, centre.z),
            scale: v3(1.1, 24, 1.1), kind: 'mast',
          });
        }
      }
      if (lod === 0 && building.signs.length && isTop) {
        // A fascia sign above the shopfront, and a roof sign on the taller buildings.
        const front = building.entrance;
        const y = ground + Math.min(5.6, height * 0.32);
        const width = Math.min(14, Math.max(4, building.entrance ? 8 : 6));
        const index = Math.floor(building.tint * (textures.signNames.length || 1));
        signs.push({
          position: v3(front.point.x + front.dir.x * -0.5, y, front.point.z + front.dir.z * -0.5),
          dir: v3(front.dir.x, 0, front.dir.z), width, height: 1.5, tile: index, elevated: false,
        });
      }
      void height;
    });
  });

  return { groups, clutter, signs, awnings, canopies };
}

function insetEdge(a: { x: number; z: number }, b: { x: number; z: number }, distance: number) {
  const length = distance2d(a, b);
  if (length < distance * 2.4) return null;
  const t = distance / length;
  return {
    a: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t },
    b: { x: b.x - (b.x - a.x) * t, z: b.z - (b.z - a.z) * t },
  };
}

/**
 * Ground floor: plinth, shop windows split into bays, a fascia with the tenant's name,
 * a recessed doorway and, for most shops, a projecting awning over the footway.
 */
function addShopfront(
  building: Building, groups: Map<MaterialKey, Buffer>,
  a: { x: number; z: number }, b: { x: number; z: number }, ground: number, tint: number,
): void {
  const length = distance2d(a, b);
  if (length < 2.4) return;
  let glassBuffer = groups.get('glass');
  if (!glassBuffer) { glassBuffer = new Buffer(); groups.set('glass', glassBuffer); }
  let trimBuffer = groups.get('trim');
  if (!trimBuffer) { trimBuffer = new Buffer(); groups.set('trim', trimBuffer); }
  let signBuffer = groups.get('signage');
  if (!signBuffer) { signBuffer = new Buffer(); groups.set('signage', signBuffer); }

  const dir = normalize(sub(b, a));
  const normal = { x: -dir.z, z: dir.x };
  const bays = Math.max(1, Math.round(length / 5.5));
  const glass = new THREE.Color().setRGB(0.13, 0.16, 0.18, THREE.SRGBColorSpace);
  const plinth = new THREE.Color().setRGB(0.30 * tint, 0.29 * tint, 0.28 * tint, THREE.SRGBColorSpace);
  const mullion = new THREE.Color().setRGB(0.22, 0.22, 0.21, THREE.SRGBColorSpace);
  const inset = 0.32;

  for (let i = 0; i < bays; i++) {
    const t0 = i / bays, t1 = (i + 1) / bays;
    const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
    const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
    const x0 = p0.x - normal.x * inset, z0 = p0.z - normal.z * inset;
    const x1 = p1.x - normal.x * inset, z1 = p1.z - normal.z * inset;
    // Plinth, then glazing, recessed behind the wall line.
    trimBuffer.quad(
      v3(x0, ground, z0), v3(x0, ground + 0.7, z0), v3(x1, ground + 0.7, z1), v3(x1, ground, z1), plinth,
    );
    glassBuffer.quad(
      v3(x0, ground + 0.7, z0), v3(x0, ground + 4.1, z0), v3(x1, ground + 4.1, z1), v3(x1, ground + 0.7, z1), glass,
    );
    // Mullion between bays.
    const mx = 0.12;
    trimBuffer.quad(
      v3(x0 - dir.x * mx, ground + 0.7, z0 - dir.z * mx), v3(x0 - dir.x * mx, ground + 5.4, z0 - dir.z * mx),
      v3(x0 + dir.x * mx, ground + 5.4, z0 + dir.z * mx), v3(x0 + dir.x * mx, ground + 0.7, z0 + dir.z * mx), mullion,
    );
  }
  // Fascia band with the tenant name from the signage atlas.
  const textures = cityTextures();
  const names = textures.signNames;
  if (names.length) {
    const tile = Math.floor(Math.abs(building.centre.x * 7 + building.centre.z * 13)) % names.length;
    const uv = signTileUV(tile, SIGN_ATLAS);
    const height = 1.3;
    const white = new THREE.Color().setRGB(1, 1, 1, THREE.SRGBColorSpace);
    signBuffer.quad(
      v3(a.x - normal.x * inset, ground + 4.1, a.z - normal.z * inset),
      v3(a.x - normal.x * inset, ground + 4.1 + height, a.z - normal.z * inset),
      v3(b.x - normal.x * inset, ground + 4.1 + height, b.z - normal.z * inset),
      v3(b.x - normal.x * inset, ground + 4.1, b.z - normal.z * inset),
      white, [[uv.u0, uv.v0], [uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0]],
    );
  }
  // Doorway: the middle bay recessed and glazed darker.
  const middle = Math.floor(bays / 2);
  const t0 = middle / bays, t1 = (middle + 0.6) / bays;
  const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
  const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
  const door = new THREE.Color().setRGB(0.10, 0.12, 0.14, THREE.SRGBColorSpace);
  const deep = 0.75;
  glassBuffer.quad(
    v3(p0.x - normal.x * deep, ground, p0.z - normal.z * deep),
    v3(p0.x - normal.x * deep, ground + 3.1, p0.z - normal.z * deep),
    v3(p1.x - normal.x * deep, ground + 3.1, p1.z - normal.z * deep),
    v3(p1.x - normal.x * deep, ground, p1.z - normal.z * deep), door,
  );
}

/** Simple box massing for the middle and distant rings: one colour per facade family. */
export function massingBuffers(buildings: readonly Building[], lod: BuildingLod): Map<MaterialKey, Buffer> {
  const groups = new Map<MaterialKey, Buffer>();
  const colour = new THREE.Color();
  let target = groups.get('stone');
  if (!target) { target = new Buffer(); groups.set('stone', target); }
  for (const building of buildings) {
    const ground = cityGround(building.centre.x, building.centre.z);
    const style = facadeStyle(building.style);
    const tint = tintOf(building);
    colour.setRGB(style.tint[0] * tint, style.tint[1] * tint, style.tint[2] * tint, THREE.SRGBColorSpace);
    // Only the tallest volume is worth drawing far away; podiums vanish into the block.
    const volume = building.volumes[building.volumes.length - 1];
    const polygon = lod >= 3 ? building.footprint : volume.polygon;
    const top = ground + (lod >= 3 ? building.height : volume.top);
    const base = ground + (lod >= 3 ? 0 : volume.base);
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      target.quad(v3(a.x, base, a.z), v3(a.x, top, a.z), v3(b.x, top, b.z), v3(b.x, base, b.z), colour);
    }
    target.polygon(polygon.map(p => v3(p.x, top, p.z)), colour.clone(), undefined, true);
  }
  return groups;
}

export type BuiltGeometry = { key: MaterialKey; geometry: THREE.BufferGeometry }[];
export function toGeometry(groups: Map<MaterialKey, Buffer>): BuiltGeometry {
  const out: BuiltGeometry = [];
  for (const [key, buffer] of groups) {
    const geometry = buffer.geometry();
    if (geometry) out.push({ key, geometry });
  }
  return out;
}
