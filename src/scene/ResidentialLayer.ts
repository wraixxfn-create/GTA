/**
 * The Residential Valley streaming layer.
 *
 * Mirrors the other district chunkers: 500 m tiles at four levels of detail, distant
 * pairs merged into kilometre blocks, a per-frame build budget, exact disposal. The
 * kinetic fleet — ordinary hatchbacks, saloons, vans, pickups and estates on the through
 * routes — runs in instanced meshes updated every frame, and the navigation overlay
 * (lanes, crossings, parking, footways) sits behind the same toggle the other districts
 * use.
 */
import * as THREE from 'three';
import { LOD_RANGES, TILE_SIZE } from '../city/chunks';
import { cityMaterials, materialFor } from '../city/materials';
import { Buffer, surfaceBuffers } from '../city/meshes';
import { polygonBounds, distance2d } from '../city/geometry2d';
import { resGround, RES_POLYGON } from '../residential/frame';
import { RES_NETWORK, type Street } from '../residential/plan';
import { buildingsInBounds, type Building } from '../residential/buildings';
import { resBuildingBuffers, type MaterialKey } from '../residential/rmeshes';
import { piecesForBounds } from '../residential/surfaces';
import { propsInBounds, type Prop } from '../residential/props';
import { NEAR_ONLY, propGeometry, type PropKind } from '../residential/propmesh';
import {
  LANES, CROSSINGS, PARKING_BAYS, BUS_STOPS, PED_NODES,
  VEHICLES, advanceTraffic, vehiclePose, type VehicleKind,
} from '../residential/traffic';
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
  walls: 'trim', roof: 'roof', glass: 'glass', metal: 'metal', paint: 'paint', signage: 'signage',
};

const TILES: { key: string; ix: number; iz: number }[] = (() => {
  const bounds = polygonBounds(RES_POLYGON);
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

/** Ordinary-car liveries: the valley's cars are silver, white, blue and red. */
const LIVERY: Record<VehicleKind, [number, number, number][]> = {
  hatchback: [[.72, .72, .72], [.2, .3, .5], [.6, .15, .15], [.85, .85, .82]],
  saloon: [[.15, .15, .17], [.55, .55, .58], [.3, .38, .5], [.2, .35, .3]],
  van: [[.88, .88, .86], [.7, .7, .68], [.2, .3, .5]],
  pickup: [[.4, .42, .44], [.55, .3, .2], [.25, .3, .25]],
  estate: [[.6, .6, .62], [.3, .3, .33], [.5, .45, .38], [.75, .75, .72]],
};

function propColor(kind: PropKind, tint: number, out: THREE.Color): void {
  switch (kind) {
    case 'car-hatchback': case 'car-saloon': case 'van': case 'pickup': case 'estate-car': {
      const map: Record<string, [number, number, number][]> = {
        'car-hatchback': LIVERY.hatchback, 'car-saloon': LIVERY.saloon, 'van': LIVERY.van,
        'pickup': LIVERY.pickup, 'estate-car': LIVERY.estate,
      };
      const pool = map[kind];
      const rgb = pool[Math.floor(tint * pool.length) % pool.length];
      out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      break;
    }
    case 'tree-round': case 'tree-conifer': case 'hedge':
      out.setRGB(.8 + tint * .3, .88 + tint * .22, .76 + tint * .28, THREE.SRGBColorSpace); break;
    case 'flower-bed':
      out.setRGB(.9 + tint * .2, .7 + tint * .35, .72 + tint * .3, THREE.SRGBColorSpace); break;
    default:
      out.setRGB(.94 + tint * .12, .94 + tint * .12, .92 + tint * .14, THREE.SRGBColorSpace);
  }
}

export class ResidentialLayer {
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
    this.group.name = 'Residential Valley';
    this.group.add(this.navigation);
    this.navigation.visible = false;
    const counts: Record<VehicleKind, number> = { hatchback: 0, saloon: 0, van: 0, pickup: 0, estate: 0 };
    for (const v of VEHICLES) counts[v.kind]++;
    const geometryOf: Record<VehicleKind, PropKind> = {
      hatchback: 'car-hatchback', saloon: 'car-saloon', van: 'van', pickup: 'pickup', estate: 'estate-car',
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
      rotation.makeRotationY(pose.angle);
      scl.makeScale(1, 1, 1);
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
    group.name = `Residential ${id} · LOD${lod}`;
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

    // Ground: carriageways, pavements, crossings, gardens, drives and the park.
    if (lod <= 2) {
      const pieces = piecesForBounds(bounds, { markings: lod === 0, detail: lod === 0 });
      for (const [key, buffer] of surfaceBuffers(pieces)) add(buffer.geometry(), key);
    }

    // Buildings with their roofs, chimneys, balconies and shopfronts.
    const buildings = buildingsInBounds(bounds);
    const built = resBuildingBuffers(buildings, lod);
    for (const [key, buffer] of built.groups) add(buffer.geometry(), MATERIAL_OF[key]);

    if (lod <= 1) this.addProps(group, bounds, lod as 0 | 1, (t, c) => { triangles += t; calls += c; });

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
      account((index ? index.count / 3 : 24) * list.length, 1);
    }
  }

  /**
   * Navigation overlay: the surfaces a future traffic and pedestrian AI would read —
   * drivable lanes, footway links, crossings, parking supply and transit stops.
   */
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
          { x: b.x - nx, y: b.y + 0.12, z: b.z - nz }, { x: a.x - nx, y: a.y + 0.12, z: a.z - nz }, colour,
        );
      }
    }
    const laneGeometry = lanes.geometry();
    if (laneGeometry) {
      const mesh = new THREE.Mesh(laneGeometry, materials.debug.road);
      mesh.name = 'Drivable lanes';
      this.navigation.add(mesh);
    }
    // Sidewalk and alley links make the pedestrian layer visible alongside drive lanes.
    const footways = new Buffer();
    const walked = new Set<string>();
    for (const node of PED_NODES.values()) {
      for (const link of node.links) {
        if (link.kind === 'cross') continue;
        const key = node.id < link.to ? `${node.id}|${link.to}` : `${link.to}|${node.id}`;
        if (walked.has(key)) continue;
        walked.add(key);
        const other = PED_NODES.get(link.to);
        if (!other) continue;
        const dx = other.point.x - node.point.x, dz = other.point.z - node.point.z;
        const length = Math.hypot(dx, dz) || 1;
        const half = Math.max(.5, Math.min(2, link.width * .42));
        const nx = -dz / length * half, nz = dx / length * half;
        const y0 = resGround(node.point.x, node.point.z) + .24;
        const y1 = resGround(other.point.x, other.point.z) + .24;
        footways.quad(
          { x: node.point.x + nx, y: y0, z: node.point.z + nz },
          { x: other.point.x + nx, y: y1, z: other.point.z + nz },
          { x: other.point.x - nx, y: y1, z: other.point.z - nz },
          { x: node.point.x - nx, y: y0, z: node.point.z - nz }, colour,
        );
      }
    }
    const footwayGeometry = footways.geometry();
    if (footwayGeometry) {
      const mesh = new THREE.Mesh(footwayGeometry, materials.debug.footway);
      mesh.name = 'Sidewalks and alley walks';
      this.navigation.add(mesh);
    }
    // Crossings, parking supply and transit pads share the overlay.
    const crossings = new Buffer();
    for (const crossing of CROSSINGS) {
      const dir = { x: crossing.b.x - crossing.a.x, z: crossing.b.z - crossing.a.z };
      const length = Math.hypot(dir.x, dir.z) || 1;
      const nx = -dir.z / length * crossing.width / 2, nz = dir.x / length * crossing.width / 2;
      const y = resGround(crossing.a.x, crossing.a.z) + .14;
      crossings.quad(
        { x: crossing.a.x + nx, y, z: crossing.a.z + nz }, { x: crossing.b.x + nx, y, z: crossing.b.z + nz },
        { x: crossing.b.x - nx, y, z: crossing.b.z - nz }, { x: crossing.a.x - nx, y, z: crossing.a.z - nz }, colour,
      );
    }
    const crossingGeometry = crossings.geometry();
    if (crossingGeometry) {
      const mesh = new THREE.Mesh(crossingGeometry, materials.debug.crossing);
      mesh.name = 'Pedestrian crossings';
      this.navigation.add(mesh);
    }
    const parking = new Buffer();
    for (const bay of PARKING_BAYS) {
      const n = { x: -bay.dir.z, z: bay.dir.x };
      const y = resGround(bay.centre.x, bay.centre.z) + .13;
      const half = bay.length / 2;
      parking.quad(
        { x: bay.centre.x - bay.dir.x * half + n.x * bay.width / 2, y, z: bay.centre.z - bay.dir.z * half + n.z * bay.width / 2 },
        { x: bay.centre.x + bay.dir.x * half + n.x * bay.width / 2, y, z: bay.centre.z + bay.dir.z * half + n.z * bay.width / 2 },
        { x: bay.centre.x + bay.dir.x * half - n.x * bay.width / 2, y, z: bay.centre.z + bay.dir.z * half - n.z * bay.width / 2 },
        { x: bay.centre.x - bay.dir.x * half - n.x * bay.width / 2, y, z: bay.centre.z - bay.dir.z * half - n.z * bay.width / 2 },
        colour,
      );
    }
    const parkingGeometry = parking.geometry();
    if (parkingGeometry) {
      const mesh = new THREE.Mesh(parkingGeometry, materials.debug.parking);
      mesh.name = 'Parking supply';
      this.navigation.add(mesh);
    }
    const transit = new Buffer();
    for (const stop of BUS_STOPS) {
      transit.polygon(stop.pad.polygon.map(p => ({ x: p.x, y: resGround(p.x, p.z) + .15, z: p.z })), colour, undefined, true);
    }
    const transitGeometry = transit.geometry();
    if (transitGeometry) {
      const mesh = new THREE.Mesh(transitGeometry, materials.debug.transit);
      mesh.name = 'Bus stops';
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

export { distance2d };
