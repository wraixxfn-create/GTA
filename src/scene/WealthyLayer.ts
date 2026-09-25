/**
 * The Vantage Heights streaming layer.
 *
 * Mirrors the other two district chunkers: 500 m tiles at four levels of detail, distant
 * pairs merged into kilometre blocks, a per-frame build budget, exact disposal. On top of
 * the static world it keeps the kinetic fleet — a light traffic of saloons, coupés, SUVs and
 * a limousine on the through routes — in four instanced meshes updated every frame, and the
 * navigation overlay (lanes, gates, viewpoints) behind the same toggle the other districts
 * use.
 */
import * as THREE from 'three';
import { LOD_RANGES, TILE_SIZE } from '../city/chunks';
import { cityMaterials, materialFor } from '../city/materials';
import { Buffer, surfaceBuffers } from '../city/meshes';
import { polygonBounds } from '../city/geometry2d';
import { hillGround, W_POLYGON } from '../wealthy/frame';
import { W_NETWORK } from '../wealthy/plan';
import {
  W_BUILDINGS, W_GATES, W_WALLS, W_GARDENS, buildingsInBounds, gardensInBounds,
} from '../wealthy/buildings';
import {
  terraceBuffers, wBuildingBuffers, wallBuffers, type MaterialKey,
} from '../wealthy/wmeshes';
import { piecesForBounds } from '../wealthy/surfaces';
import { propsInBounds, type Prop } from '../wealthy/props';
import { NEAR_ONLY, propGeometry, type PropKind } from '../wealthy/propmesh';
import { LANES, VEHICLES, advanceTraffic, vehiclePose, type VehicleKind } from '../wealthy/traffic';
import type { ChunkStats } from './CityLayer';

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

type Chunk = {
  id: string;
  lod: 0 | 1 | 2 | 3;
  bounds: Bounds;
  group: THREE.Group;
  dispose(): void;
  triangles: number;
  calls: number;
};

const MATERIAL_OF: Record<MaterialKey, string> = {
  walls: 'trim', roof: 'roof', glass: 'glass', metal: 'metal', paint: 'paint',
};

const TILES: { key: string; ix: number; iz: number }[] = (() => {
  const bounds = polygonBounds(W_POLYGON);
  const out: { key: string; ix: number; iz: number }[] = [];
  const first = { ix: Math.floor((bounds.minX - TILE_SIZE) / TILE_SIZE), iz: Math.floor((bounds.minZ - TILE_SIZE) / TILE_SIZE) };
  const last = { ix: Math.floor((bounds.maxX + TILE_SIZE) / TILE_SIZE), iz: Math.floor((bounds.maxZ + TILE_SIZE) / TILE_SIZE) };
  for (let iz = first.iz; iz <= last.iz; iz++) {
    for (let ix = first.ix; ix <= last.ix; ix++) out.push({ key: `${ix}:${iz}`, ix, iz });
  }
  return out;
})();

function rectDistance(bounds: Bounds, x: number, z: number): number {
  return Math.hypot(
    Math.max(0, Math.abs(x - (bounds.minX + bounds.maxX) / 2) - (bounds.maxX - bounds.minX) / 2),
    Math.max(0, Math.abs(z - (bounds.minZ + bounds.maxZ) / 2) - (bounds.maxZ - bounds.minZ) / 2),
  );
}

/** Fleet liveries: dark saloons, pale coupés, stone SUVs, one black limousine. */
const LIVERY: Record<VehicleKind, [number, number, number][]> = {
  saloon: [[.1, .1, .11], [.16, .17, .2], [.5, .5, .52], [.06, .1, .14]],
  coupe: [[.85, .84, .8], [.62, .18, .16], [.2, .26, .34], [.78, .72, .58]],
  suv: [[.28, .27, .26], [.5, .49, .46], [.13, .16, .18], [.68, .66, .6]],
  limousine: [[.07, .07, .08]],
};

function propColor(kind: PropKind, tint: number, out: THREE.Color): void {
  switch (kind) {
    case 'car-luxury': case 'car-sport': case 'suv-luxury': case 'limousine': {
      const map: Record<string, [number, number, number][]> = {
        'car-luxury': LIVERY.saloon, 'car-sport': LIVERY.coupe,
        'suv-luxury': LIVERY.suv, 'limousine': LIVERY.limousine,
      };
      const pool = map[kind];
      const rgb = pool[Math.floor(tint * pool.length) % pool.length];
      out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      break;
    }
    case 'tree-round': case 'tree-cypress': case 'topiary':
      out.setRGB(.82 + tint * .3, .86 + tint * .26, .78 + tint * .3, THREE.SRGBColorSpace); break;
    case 'tree-palm':
      out.setRGB(.86 + tint * .24, .9 + tint * .2, .8 + tint * .26, THREE.SRGBColorSpace); break;
    case 'flower-bed':
      out.setRGB(.9 + tint * .2, .74 + tint * .34, .78 + tint * .3, THREE.SRGBColorSpace); break;
    default:
      out.setRGB(.94 + tint * .12, .94 + tint * .12, .92 + tint * .14, THREE.SRGBColorSpace);
  }
}

export class WealthyLayer {
  readonly group = new THREE.Group();
  readonly navigation = new THREE.Group();
  stats: ChunkStats = { chunks: 0, detailed: 0, triangles: 0, drawCalls: 0, buildMs: 0, disposed: 0 };
  private readonly chunks = new Map<string, Chunk>();
  private readonly wanted = new Map<string, { id: string; lod: 0 | 1 | 2 | 3; bounds: Bounds; distance: number }>();
  private readonly fleet = new Map<VehicleKind, THREE.InstancedMesh>();
  private lastCheck = 0;
  private navigationVisible = false;
  private navigationBuilt = false;

  constructor() {
    this.group.name = 'Vantage Heights';
    this.group.add(this.navigation);
    this.navigation.visible = false;
    const counts: Record<VehicleKind, number> = { saloon: 0, coupe: 0, suv: 0, limousine: 0 };
    for (const v of VEHICLES) counts[v.kind]++;
    const geometryOf: Record<VehicleKind, PropKind> = {
      saloon: 'car-luxury', coupe: 'car-sport', suv: 'suv-luxury', limousine: 'limousine',
    };
    for (const kind of Object.keys(counts) as VehicleKind[]) {
      if (!counts[kind]) continue;
      const mesh = new THREE.InstancedMesh(propGeometry(geometryOf[kind]), materialFor('prop')!, counts[kind]);
      mesh.name = `Traffic · ${kind}`;
      mesh.frustumCulled = false;
      const colour = new THREE.Color();
      let i = 0;
      for (const v of VEHICLES) {
        if (v.kind !== kind) continue;
        propColor(geometryOf[kind], v.tint, colour);
        mesh.setColorAt(i++, colour);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.fleet.set(kind, mesh);
      this.group.add(mesh);
    }
  }

  setNavigation(visible: boolean): void {
    this.navigationVisible = visible;
    this.navigation.visible = visible;
    if (visible && !this.navigationBuilt) this.buildNavigation();
  }
  getNavigation(): boolean { return this.navigationVisible; }

  updateTraffic(dt: number): void {
    if (!this.fleet.size) return;
    advanceTraffic(dt);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const scl = new THREE.Matrix4();
    const position = new THREE.Matrix4();
    const cursor = new Map<VehicleKind, number>();
    for (const v of VEHICLES) {
      const mesh = this.fleet.get(v.kind);
      if (!mesh) continue;
      const pose = vehiclePose(v);
      const i = cursor.get(v.kind) ?? 0;
      cursor.set(v.kind, i + 1);
      if (!pose) continue;
      const scale = v.kind === 'limousine' ? 1.1 : 1;
      rotation.makeRotationY(pose.angle);
      scl.makeScale(scale, scale, scale);
      position.makeTranslation(pose.x, pose.y, pose.z);
      matrix.copy(position).multiply(rotation).multiply(scl);
      mesh.setMatrixAt(i, matrix);
    }
    for (const mesh of this.fleet.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  update(target: THREE.Vector3, now: number, budgetMs = 9): void {
    if (now - this.lastCheck < 140) return;
    this.lastCheck = now;
    this.wanted.clear();

    const lodOfTile = new Map<string, 0 | 1 | 2 | 3>();
    for (const tile of TILES) {
      const bounds: Bounds = {
        minX: tile.ix * TILE_SIZE, minZ: tile.iz * TILE_SIZE,
        maxX: (tile.ix + 1) * TILE_SIZE, maxZ: (tile.iz + 1) * TILE_SIZE,
      };
      const distance = rectDistance(bounds, target.x, target.z);
      if (distance > LOD_RANGES.silhouette) continue;
      const lod: 0 | 1 | 2 | 3 = distance <= LOD_RANGES.detailed ? 0
        : distance <= LOD_RANGES.middle ? 1 : distance <= 3600 ? 2 : 3;
      lodOfTile.set(tile.key, lod);
    }
    const merged = new Set<string>();
    for (const tile of TILES) {
      const lod = lodOfTile.get(tile.key);
      if (lod === undefined || lod < 2 || merged.has(tile.key)) continue;
      const baseX = Math.floor(tile.ix / 2) * 2, baseZ = Math.floor(tile.iz / 2) * 2;
      let uniform = true;
      const groupKeys: string[] = [];
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        const key = `${baseX + dx}:${baseZ + dz}`;
        if (lodOfTile.get(key) !== lod) uniform = false;
        groupKeys.push(key);
      }
      if (uniform) {
        for (const key of groupKeys) merged.add(key);
        const bounds: Bounds = {
          minX: baseX * TILE_SIZE, minZ: baseZ * TILE_SIZE,
          maxX: (baseX + 2) * TILE_SIZE, maxZ: (baseZ + 2) * TILE_SIZE,
        };
        this.wanted.set(`4:${baseX}:${baseZ}`, { id: `4:${baseX}:${baseZ}`, lod, bounds, distance: rectDistance(bounds, target.x, target.z) });
      }
    }
    for (const tile of TILES) {
      const lod = lodOfTile.get(tile.key);
      if (lod === undefined || merged.has(tile.key) || this.wanted.has(tile.key)) continue;
      const bounds: Bounds = {
        minX: tile.ix * TILE_SIZE, minZ: tile.iz * TILE_SIZE,
        maxX: (tile.ix + 1) * TILE_SIZE, maxZ: (tile.iz + 1) * TILE_SIZE,
      };
      this.wanted.set(tile.key, { id: tile.key, lod, bounds, distance: rectDistance(bounds, target.x, target.z) });
    }

    let disposed = 0;
    for (const [id, chunk] of this.chunks) {
      const want = this.wanted.get(id);
      if (!want || want.lod !== chunk.lod) {
        this.group.remove(chunk.group);
        chunk.dispose();
        this.chunks.delete(id);
        disposed++;
      }
    }
    this.stats.disposed = disposed;

    const queue = [...this.wanted.values()]
      .filter(w => !this.chunks.has(w.id))
      .sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    let created = 0;
    for (const want of queue) {
      const chunk = this.build(want.id, want.lod, want.bounds);
      if (chunk) {
        this.chunks.set(want.id, chunk);
        this.group.add(chunk.group);
      }
      created++;
      if (performance.now() - start > budgetMs || created >= 3) break;
    }
    this.stats.buildMs = performance.now() - start;

    let triangles = 0, calls = 0, detailed = 0;
    for (const chunk of this.chunks.values()) {
      triangles += chunk.triangles;
      calls += chunk.calls;
      if (chunk.lod === 0) detailed++;
    }
    for (const mesh of this.fleet.values()) {
      triangles += mesh.count * 30;
      calls++;
    }
    this.stats.chunks = this.chunks.size;
    this.stats.detailed = detailed;
    this.stats.triangles = triangles;
    this.stats.drawCalls = calls;
  }

  private build(id: string, lod: 0 | 1 | 2 | 3, bounds: Bounds): Chunk | null {
    const group = new THREE.Group();
    group.name = `Vantage ${id} · LOD${lod}`;
    const geometries: THREE.BufferGeometry[] = [];
    let triangles = 0, calls = 0;
    const add = (geometry: THREE.BufferGeometry | null, key: string): void => {
      if (!geometry) return;
      const material = materialFor(key);
      if (!material) return;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = key;
      group.add(mesh);
      geometries.push(geometry);
      const index = geometry.getIndex();
      triangles += index ? index.count / 3 : geometry.getAttribute('position').count / 3;
      calls++;
    };

    // Ground: carriageways, verges, lawns, drives, terraces and the pools.
    if (lod <= 2) {
      const pieces = piecesForBounds(bounds, { markings: lod === 0, detail: lod === 0 });
      for (const [key, buffer] of surfaceBuffers(pieces)) add(buffer.geometry(), key);
    }

    const buildings = buildingsInBounds(bounds);
    const built = wBuildingBuffers(buildings, lod);
    for (const [key, buffer] of built.groups) add(buffer.geometry(), MATERIAL_OF[key]);
    // Terraces: the retaining walls that hold each pad on the slope.
    if (lod <= 1) {
      for (const [key, buffer] of terraceBuffers(buildings, lod)) add(buffer.geometry(), MATERIAL_OF[key]);
    }
    if (lod <= 1) {
      const near = W_WALLS.filter(w => w.points.some(p =>
        p.x >= bounds.minX - 40 && p.x <= bounds.maxX + 40 && p.z >= bounds.minZ - 40 && p.z <= bounds.maxZ + 40));
      if (near.length) {
        for (const [key, buffer] of wallBuffers(near, lod as 0 | 1)) add(buffer.geometry(), MATERIAL_OF[key]);
      }
    }
    if (lod <= 1) this.addProps(group, bounds, lod as 0 | 1, (t, c) => { triangles += t; calls += c; });
    void gardensInBounds; void W_GARDENS;

    if (!group.children.length) return null;
    return {
      id, lod, bounds, group, triangles, calls,
      dispose: () => {
        for (const child of group.children) {
          if (child instanceof THREE.InstancedMesh) child.dispose();
        }
        for (const geometry of geometries) geometry.dispose();
      },
    };
  }

  private addProps(group: THREE.Group, bounds: Bounds, lod: 0 | 1, account: (triangles: number, calls: number) => void): void {
    const props = propsInBounds(bounds);
    if (!props.length) return;
    const byKind = new Map<PropKind, Prop[]>();
    for (const prop of props) {
      if (lod > 0 && NEAR_ONLY.has(prop.kind)) continue;
      const list = byKind.get(prop.kind) ?? [];
      list.push(prop);
      byKind.set(prop.kind, list);
    }
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const scl = new THREE.Matrix4();
    const position = new THREE.Matrix4();
    const colour = new THREE.Color();
    for (const [kind, list] of byKind) {
      const geometry = propGeometry(kind);
      const material = materialFor('prop')!;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((prop, i) => {
        rotation.makeRotationY(prop.angle);
        scl.makeScale(prop.scale, prop.scale, prop.scale);
        position.makeTranslation(prop.x, prop.y, prop.z);
        matrix.copy(position).multiply(rotation).multiply(scl);
        mesh.setMatrixAt(i, matrix);
        propColor(kind, prop.tint, colour);
        mesh.setColorAt(i, colour);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      const index = geometry.getIndex();
      account((index ? index.count / 3 : 12) * list.length, 1);
    }
  }

  /** Navigation overlay: lanes, gate plazas and the viewpoints. */
  private buildNavigation(): void {
    this.navigationBuilt = true;
    const materials = cityMaterials();
    const colour = new THREE.Color(1, 1, 1);
    const lanes = new Buffer();
    for (const lane of LANES) {
      const half = Math.max(0.5, lane.width * 0.5);
      for (let i = 0; i + 1 < lane.points.length; i++) {
        const a = lane.points[i], b = lane.points[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = -dz / length * half, nz = dx / length * half;
        lanes.quad(
          { x: a.x + nx, y: a.y + 0.12, z: a.z + nz }, { x: b.x + nx, y: b.y + 0.12, z: b.z + nz },
          { x: b.x - nx, y: b.y + 0.12, z: b.z - nz }, { x: a.x - nx, y: b.y + 0.12 - (b.y - a.y), z: a.z - nz }, colour,
        );
      }
    }
    const laneGeometry = lanes.geometry();
    if (laneGeometry) {
      const mesh = new THREE.Mesh(laneGeometry, materials.debug.road);
      mesh.name = 'Drivable lanes';
      this.navigation.add(mesh);
    }
    // Gates: the controlled entrances of a gated hillside.
    const gates = new Buffer();
    for (const gate of W_GATES) {
      gates.polygon(
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          const r = gate.kind === 'district' ? 16 : 12;
          return { x: gate.point.x + Math.cos(a) * r, y: gate.level + 0.3, z: gate.point.z + Math.sin(a) * r };
        }), colour, undefined, true,
      );
    }
    const gateGeometry = gates.geometry();
    if (gateGeometry) {
      const mesh = new THREE.Mesh(gateGeometry, materials.debug.transit);
      mesh.name = 'Gates';
      this.navigation.add(mesh);
    }
    // Viewpoints: where the scenic route stops to look at the bay.
    const views = new Buffer();
    for (const junction of W_NETWORK.viewpoints) {
      views.polygon(
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return {
            x: junction.point.x + Math.cos(a) * 18,
            y: hillGround(junction.point.x, junction.point.z) + 0.3,
            z: junction.point.z + Math.sin(a) * 18,
          };
        }), colour, undefined, true,
      );
    }
    const viewGeometry = views.geometry();
    if (viewGeometry) {
      const mesh = new THREE.Mesh(viewGeometry, materials.debug.footway);
      mesh.name = 'Viewpoints';
      this.navigation.add(mesh);
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.group);
      chunk.dispose();
    }
    this.chunks.clear();
    for (const mesh of this.fleet.values()) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.fleet.clear();
    for (const child of this.navigation.children) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.navigation.clear();
  }
}
