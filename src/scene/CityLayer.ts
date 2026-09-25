/**
 * The downtown streaming layer.
 *
 * Chunks are 500 m tiles (or 1 km groups of four at distance), each built at one of four
 * levels of detail and rebuilt when the camera moves far enough to change its level. A
 * per-frame build budget keeps streaming off the critical path, and every chunk owns the
 * geometries it created so unloading is exact.
 */
import * as THREE from 'three';
import { CITY } from '../city/buildings';
import { CITY_POLYGON, cityGround } from '../city/frame';
import { LOD_RANGES, TILE_SIZE } from '../city/chunks';
import { cityMaterials, materialFor } from '../city/materials';
import {
  Buffer, buildingBuffers, massingBuffers, surfaceBuffers, type BuildingLod,
} from '../city/meshes';
import { NEAR_ONLY, propGeometry } from '../city/propmesh';
import { PROPS, propsInBounds, type PropKind } from '../city/props';
import { piecesForBounds } from '../city/surfaces';
import { BUILDING_INDEX } from '../city/tiles';
import { LANES, CROSSINGS, PARKING_BAYS, BUS_STOPS, PED_NODES } from '../city/traffic';
import { polygonBounds } from '../city/geometry2d';

export type ChunkStats = {
  chunks: number; detailed: number; triangles: number; drawCalls: number;
  buildMs: number; disposed: number;
};

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

type Chunk = {
  id: string;
  lod: BuildingLod;
  bounds: Bounds;
  group: THREE.Group;
  dispose(): void;
  triangles: number;
  calls: number;
};

/** 500 m tiles that hold any part of the district, plus one ring of context. */
const TILES: { key: string; ix: number; iz: number; centre: { x: number; z: number } }[] = (() => {
  const bounds = polygonBounds(CITY_POLYGON);
  const out: { key: string; ix: number; iz: number; centre: { x: number; z: number } }[] = [];
  const first = { ix: Math.floor((bounds.minX - TILE_SIZE) / TILE_SIZE), iz: Math.floor((bounds.minZ - TILE_SIZE) / TILE_SIZE) };
  const last = { ix: Math.floor((bounds.maxX + TILE_SIZE) / TILE_SIZE), iz: Math.floor((bounds.maxZ + TILE_SIZE) / TILE_SIZE) };
  for (let iz = first.iz; iz <= last.iz; iz++) {
    for (let ix = first.ix; ix <= last.ix; ix++) {
      out.push({
        key: `${ix}:${iz}`, ix, iz,
        centre: { x: (ix + .5) * TILE_SIZE, z: (iz + .5) * TILE_SIZE },
      });
    }
  }
  return out;
})();

function rectDistance(bounds: Bounds, x: number, z: number): number {
  return Math.hypot(
    Math.max(0, Math.abs(x - (bounds.minX + bounds.maxX) / 2) - (bounds.maxX - bounds.minX) / 2),
    Math.max(0, Math.abs(z - (bounds.minZ + bounds.maxZ) / 2) - (bounds.maxZ - bounds.minZ) / 2),
  );
}

export class CityLayer {
  readonly group = new THREE.Group();
  readonly navigation = new THREE.Group();
  stats: ChunkStats = { chunks: 0, detailed: 0, triangles: 0, drawCalls: 0, buildMs: 0, disposed: 0 };
  private readonly chunks = new Map<string, Chunk>();
  /** Tiles inside a district's bounding box that hold nothing. Without this memo the
   * three-builds-per-frame budget is spent forever re-testing the same empty tiles,
   * which stalls the whole district whenever the nearest tiles are empty. */
  private readonly empty = new Map<string, 0 | 1 | 2 | 3>();
  private readonly wanted = new Map<string, { id: string; lod: BuildingLod; bounds: Bounds; distance: number }>();
  private lastCheck = 0;
  private built = 0;
  private navigationVisible = false;
  private navigationBuilt = false;

  constructor() {
    this.group.name = 'Lowmere Downtown';
    this.group.add(this.navigation);
    this.navigation.visible = false;
  }

  setNavigation(visible: boolean): void {
    this.navigationVisible = visible;
    this.navigation.visible = visible;
    if (visible && !this.navigationBuilt) this.buildNavigation();
  }
  getNavigation(): boolean { return this.navigationVisible; }

  /** Streaming pass: unload whatever left a ring, then build the nearest missing chunks. */
  update(target: THREE.Vector3, now: number, budgetMs = 9): void {
    if (now - this.lastCheck < 140) return;
    this.lastCheck = now;
    this.wanted.clear();

    // 1. choose a level of detail for every tile, merging the distant 2×2 groups.
    const lodOfTile = new Map<string, BuildingLod>();
    for (const tile of TILES) {
      const bounds: Bounds = {
        minX: tile.ix * TILE_SIZE, minZ: tile.iz * TILE_SIZE,
        maxX: (tile.ix + 1) * TILE_SIZE, maxZ: (tile.iz + 1) * TILE_SIZE,
      };
      const distance = rectDistance(bounds, target.x, target.z);
      if (distance > LOD_RANGES.silhouette) continue;
      const lod: BuildingLod = distance <= LOD_RANGES.detailed ? 0
        : distance <= LOD_RANGES.middle ? 1 : distance <= 3600 ? 2 : 3;
      lodOfTile.set(tile.key, lod);
    }
    const merged = new Set<string>();
    for (const tile of TILES) {
      const lod = lodOfTile.get(tile.key);
      if (lod === undefined || lod < 2 || merged.has(tile.key)) continue;
      const baseX = Math.floor(tile.ix / 2) * 2, baseZ = Math.floor(tile.iz / 2) * 2;
      const group: string[] = [];
      let uniform = true;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        const key = `${baseX + dx}:${baseZ + dz}`;
        if (lodOfTile.get(key) !== lod) { uniform = false; }
        group.push(key);
      }
      if (uniform) {
        for (const key of group) merged.add(key);
        this.wanted.set(`4:${baseX}:${baseZ}`, {
          id: `4:${baseX}:${baseZ}`, lod,
          bounds: {
            minX: baseX * TILE_SIZE, minZ: baseZ * TILE_SIZE,
            maxX: (baseX + 2) * TILE_SIZE, maxZ: (baseZ + 2) * TILE_SIZE,
          },
          distance: rectDistance({
            minX: baseX * TILE_SIZE, minZ: baseZ * TILE_SIZE,
            maxX: (baseX + 2) * TILE_SIZE, maxZ: (baseZ + 2) * TILE_SIZE,
          }, target.x, target.z),
        });
      } else {
        const bounds: Bounds = {
          minX: tile.ix * TILE_SIZE, minZ: tile.iz * TILE_SIZE,
          maxX: (tile.ix + 1) * TILE_SIZE, maxZ: (tile.iz + 1) * TILE_SIZE,
        };
        this.wanted.set(tile.key, { id: tile.key, lod, bounds, distance: rectDistance(bounds, target.x, target.z) });
      }
    }
    for (const [key, lod] of lodOfTile) {
      if (lod === undefined || merged.has(key) || this.wanted.has(key)) continue;
      const [ix, iz] = key.split(':').map(Number);
      const bounds: Bounds = {
        minX: ix * TILE_SIZE, minZ: iz * TILE_SIZE,
        maxX: (ix + 1) * TILE_SIZE, maxZ: (iz + 1) * TILE_SIZE,
      };
      this.wanted.set(key, { id: key, lod, bounds, distance: rectDistance(bounds, target.x, target.z) });
    }

    // 2. drop chunks that are no longer wanted at the level they were built for
    let disposed = 0;
    for (const [id, chunk] of this.chunks) {
      const want = this.wanted.get(id);
      if (!want || want.lod !== chunk.lod) {
        this.group.remove(chunk.group);
        chunk.dispose();
        this.chunks.delete(id);
        this.empty.delete(id);
        disposed++;
      }
    }
    this.stats.disposed = disposed;

    // 3. build the nearest missing chunks inside the frame budget
    const queue = [...this.wanted.values()]
      .filter(w => !this.chunks.has(w.id) && this.empty.get(w.id) !== w.lod)
      .sort((a, b) => a.distance - b.distance);
    const start = performance.now();
    let created = 0;
    for (const want of queue) {
      const chunk = this.build(want.id, want.lod, want.bounds);
      if (chunk) {
        this.chunks.set(want.id, chunk);
        this.group.add(chunk.group);
      } else {
        this.empty.set(want.id, want.lod);
      }
      created++;
      if (performance.now() - start > budgetMs || created >= 3) break;
    }
    this.stats.buildMs = performance.now() - start;
    this.built += created;

    let triangles = 0, calls = 0, detailed = 0;
    for (const chunk of this.chunks.values()) {
      triangles += chunk.triangles;
      calls += chunk.calls;
      if (chunk.lod === 0) detailed++;
    }
    this.stats.chunks = this.chunks.size;
    this.stats.detailed = detailed;
    this.stats.triangles = triangles;
    this.stats.drawCalls = calls;
  }

  private build(id: string, lod: BuildingLod, bounds: Bounds): Chunk | null {
    const group = new THREE.Group();
    group.name = `Downtown ${id} · LOD${lod}`;
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

    // Ground: streets, footways, junction tables, courtyards, plazas and the verge.
    if (lod <= 2) {
      const pieces = piecesForBounds(bounds, { markings: lod === 0, detail: lod === 0 });
      for (const [key, buffer] of surfaceBuffers(pieces)) add(buffer.geometry(), key);
    }

    // Buildings.
    const buildings = BUILDING_INDEX.in(bounds, lod);
    if (lod <= 1) {
      const built = buildingBuffers(buildings, lod);
      for (const [key, buffer] of built.groups) add(buffer.geometry(), key);
      if (lod === 0) {
        // Rooftop plant and masts, one instanced draw call each.
        for (const kind of ['mech', 'mast'] as const) {
          const items = built.clutter.filter(c => c.kind === kind);
          if (!items.length) continue;
          const material = materialFor(kind === 'mech' ? 'trim' : 'metal')!;
          const mesh = new THREE.InstancedMesh(propGeometry(kind === 'mech' ? 'bin' : 'bollard'), material, items.length);
          const matrix = new THREE.Matrix4();
          const colour = new THREE.Color();
          items.forEach((item, i) => {
            matrix.makeScale(item.scale.x, item.scale.y, item.scale.z);
            matrix.setPosition(item.position.x, item.position.y, item.position.z);
            mesh.setMatrixAt(i, matrix);
            colour.setRGB(.58, .58, .56);
            mesh.setColorAt(i, colour);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
          group.add(mesh);
          calls++;
          triangles += items.length * 24;
        }
      }
      this.addProps(group, bounds, lod, geometries, (t, c) => { triangles += t; calls += c; });
    } else {
      for (const [key, buffer] of massingBuffers(buildings, lod)) add(buffer.geometry(), key);
    }

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

  /** Street furniture as instanced meshes, one per type, filtered by distance. */
  private addProps(group: THREE.Group, bounds: Bounds, lod: BuildingLod,
    geometries: THREE.BufferGeometry[], account: (triangles: number, calls: number) => void): void {
    const props = propsInBounds(bounds);
    if (!props.length) return;
    const byKind = new Map<PropKind, typeof props>();
    for (const prop of props) {
      // The middle ring keeps planting (which reads as mass) and drops the small
      // furniture that would only be a few pixels across.
      if (lod > 0 && (NEAR_ONLY.has(prop.kind) || prop.kind !== 'tree')) continue;
      const list = byKind.get(prop.kind) ?? [];
      list.push(prop);
      byKind.set(prop.kind, list);
    }
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const position = new THREE.Matrix4();
    const colour = new THREE.Color();
    for (const [kind, list] of byKind) {
      const geometry = propGeometry(kind);
      const material = materialFor('prop')!;
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((prop, i) => {
        rotation.makeRotationY(prop.angle);
        scale.makeScale(prop.scale, prop.scale, prop.scale);
        position.makeTranslation(prop.x, prop.y, prop.z);
        matrix.copy(position).multiply(rotation).multiply(scale);
        mesh.setMatrixAt(i, matrix);
        if (kind === 'tree') {
          const shade = .82 + prop.tint * .36;
          colour.setRGB(.20 * shade, .38 * shade, .26 * shade, THREE.SRGBColorSpace);
          mesh.setColorAt(i, colour);
        } else if (kind === 'car') {
          const hue = prop.tint;
          colour.setRGB(.30 + hue * .5, .32 + hue * .45, .36 + hue * .4, THREE.SRGBColorSpace);
          mesh.setColorAt(i, colour);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      const index = geometry.getIndex();
      account((index ? index.count / 3 : 12) * list.length, 1);
    }
  }

  /**
   * Navigation overlay: the surfaces a future traffic and pedestrian AI would read —
   * drivable lanes, footway links, crossings, parking supply and transit stops.
   */
  private buildNavigation(): void {
    this.navigationBuilt = true;
    const materials = cityMaterials();
    const lanes = new Buffer();
    const colour = new THREE.Color(1, 1, 1);
    for (const lane of LANES) {
      const width = Math.max(0.5, lane.width * .5);
      for (let i = 0; i + 1 < lane.points.length; i++) {
        const a = lane.points[i], b = lane.points[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = -dz / length * width, nz = dx / length * width;
        lanes.quad(
          { x: a.x + nx, y: a.y + .12, z: a.z + nz }, { x: b.x + nx, y: b.y + .12, z: b.z + nz },
          { x: b.x - nx, y: b.y + .12, z: b.z - nz }, { x: a.x - nx, y: a.y + .12, z: a.z - nz }, colour,
        );
      }
    }
    const geometry = lanes.geometry();
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, materials.debug.road);
      mesh.name = 'Drivable lanes';
      this.navigation.add(mesh);
    }
    // Sidewalk and alley links make the pedestrian layer visible alongside drive lanes.
    // Each undirected graph edge is emitted once; zebra crossings keep their own color.
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
        const half = Math.max(.7, Math.min(2.2, link.width * .42));
        const nx = -dz / length * half, nz = dx / length * half;
        const y0 = cityGround(node.point.x, node.point.z) + .24;
        const y1 = cityGround(other.point.x, other.point.z) + .24;
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
      const y = cityGround(crossing.a.x, crossing.a.z) + .14;
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
      const y = cityGround(bay.centre.x, bay.centre.z) + .13;
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
      mesh.name = 'Kerbside parking';
      this.navigation.add(mesh);
    }
    // Transit pads and stop markers.
    const transit = new Buffer();
    for (const stop of BUS_STOPS) {
      const polygon = stop.pad.polygon;
      transit.polygon(polygon.map(p => ({ x: p.x, y: cityGround(p.x, p.z) + .15, z: p.z })), colour, undefined, true);
    }
    const transitGeometry = transit.geometry();
    if (transitGeometry) {
      const mesh = new THREE.Mesh(transitGeometry, materials.debug.transit);
      mesh.name = 'Transit stops';
      this.navigation.add(mesh);
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.group);
      chunk.dispose();
    }
    this.chunks.clear();
    for (const child of this.navigation.children) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.navigation.clear();
  }
}

export const CITY_BUILDINGS = CITY;
export const PROP_TOTAL = PROPS.length;
