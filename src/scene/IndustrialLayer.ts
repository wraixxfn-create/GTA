/**
 * The industrial streaming layer.
 *
 * Mirrors the downtown chunker: 500 m tiles at four levels of detail, distant pairs
 * merged into kilometre blocks, a per-frame build budget, exact disposal. On top of the
 * static world it keeps the kinetic fleet — lorries, vans and cars shuttling the signed
 * routes — in three instanced meshes updated every frame, and the navigation overlay
 * (lanes, yards, level crossings, gates) behind the same toggle downtown uses.
 */
import * as THREE from 'three';
import { LOD_RANGES, TILE_SIZE } from '../city/chunks';
import { cityMaterials, materialFor } from '../city/materials';
import { Buffer, surfaceBuffers } from '../city/meshes';
import { polygonBounds } from '../city/geometry2d';
import { IND_POLYGON, indGround } from '../industrial/frame';
import { IND_NETWORK, LEVEL_CROSSINGS } from '../industrial/plan';
import { buildingsInBounds, landmarksInBounds, IND_FENCES, IND_YARDS } from '../industrial/buildings';
import { indBuildingBuffers, indFenceBuffers, indLandmarkBuffers, type IndMaterialKey } from '../industrial/indmeshes';
import { piecesForBounds } from '../industrial/surfaces';
import { propsInBounds, type IndProp } from '../industrial/props';
import { IND_NEAR_ONLY, propGeometry, type IndPropKind } from '../industrial/propmesh';
import { LANES, VEHICLES, advanceTraffic, vehiclePose, type VehicleKind } from '../industrial/traffic';
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

const MATERIAL_OF: Record<IndMaterialKey, string> = {
  walls: 'trim', roof: 'roof', glass: 'glass', metal: 'metal', paint: 'paint',
};

const TILES: { key: string; ix: number; iz: number }[] = (() => {
  const bounds = polygonBounds(IND_POLYGON);
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

const CONTAINER_PALETTE: [number, number, number][] = [
  [.62, .25, .2], [.24, .34, .52], [.3, .44, .3], [.72, .58, .3], [.5, .51, .53], [.66, .38, .2], [.78, .76, .72],
];

function propColor(kind: IndPropKind, tint: number, out: THREE.Color): void {
  switch (kind) {
    case 'container20': case 'container40': {
      const rgb = CONTAINER_PALETTE[Math.floor(tint * CONTAINER_PALETTE.length) % CONTAINER_PALETTE.length];
      out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      break;
    }
    case 'trailer': out.setRGB(.85 - tint * .1, .84 - tint * .1, .82 - tint * .08, THREE.SRGBColorSpace); break;
    case 'truck': out.setRGB(.3 + tint * .45, .32 + tint * .3, .38 + tint * .2, THREE.SRGBColorSpace); break;
    case 'van': out.setRGB(.72 + tint * .2, .7 + tint * .2, .66 + tint * .2, THREE.SRGBColorSpace); break;
    case 'car': out.setRGB(.28 + tint * .5, .3 + tint * .42, .34 + tint * .38, THREE.SRGBColorSpace); break;
    case 'bale': out.setRGB(.44 + tint * .18, .31 + tint * .12, .2 + tint * .1, THREE.SRGBColorSpace); break;
    case 'wreck': out.setRGB(.4 + tint * .25, .3 + tint * .18, .24 + tint * .14, THREE.SRGBColorSpace); break;
    case 'aggregate': out.setRGB(.62 + tint * .12, .56 + tint * .1, .44 + tint * .1, THREE.SRGBColorSpace); break;
    case 'barrel': out.setRGB(.4 + tint * .3, .28 + tint * .2, .2 + tint * .14, THREE.SRGBColorSpace); break;
    default: out.setRGB(.82 + tint * .3, .82 + tint * .3, .8 + tint * .3, THREE.SRGBColorSpace);
  }
}

export class IndustrialLayer {
  readonly group = new THREE.Group();
  readonly navigation = new THREE.Group();
  stats: ChunkStats = { chunks: 0, detailed: 0, triangles: 0, drawCalls: 0, buildMs: 0, disposed: 0 };
  private readonly chunks = new Map<string, Chunk>();
  /** Tiles inside a district's bounding box that hold nothing. Without this memo the
   * three-builds-per-frame budget is spent forever re-testing the same empty tiles,
   * which stalls the whole district whenever the nearest tiles are empty. */
  private readonly empty = new Map<string, 0 | 1 | 2 | 3>();
  private readonly wanted = new Map<string, { id: string; lod: 0 | 1 | 2 | 3; bounds: Bounds; distance: number }>();
  private readonly fleet = new Map<VehicleKind, THREE.InstancedMesh>();
  private lastCheck = 0;
  private navigationVisible = false;
  private navigationBuilt = false;

  constructor() {
    this.group.name = 'Lowmore Industrial Flats';
    this.group.add(this.navigation);
    this.navigation.visible = false;
    // The kinetic fleet lives outside the chunk system: three instanced meshes,
    // matrices rewritten each frame from the traffic simulation.
    const counts: Record<VehicleKind, number> = { lorry: 0, truck: 0, van: 0, car: 0 };
    for (const v of VEHICLES) counts[v.kind]++;
    const geometryOf: Record<VehicleKind, IndPropKind> = { lorry: 'truck', truck: 'truck', van: 'van', car: 'car' };
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

  /** Advance the fleet and rewrite instance matrices. */
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
      const scale = v.kind === 'lorry' ? 1.18 : 1;
      rotation.makeRotationY(pose.angle);
      scl.makeScale(scale, scale, scale);
      position.makeTranslation(pose.x, pose.y, pose.z);
      matrix.copy(position).multiply(rotation).multiply(scl);
      mesh.setMatrixAt(i, matrix);
    }
    for (const mesh of this.fleet.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Streaming pass: unload whatever left a ring, then build the nearest missing chunks. */
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
        this.empty.delete(id);
        disposed++;
      }
    }
    this.stats.disposed = disposed;

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

    let triangles = 0, calls = 0, detailed = 0;
    for (const chunk of this.chunks.values()) {
      triangles += chunk.triangles;
      calls += chunk.calls;
      if (chunk.lod === 0) detailed++;
    }
    for (const mesh of this.fleet.values()) {
      triangles += mesh.count * 24;
      calls++;
    }
    this.stats.chunks = this.chunks.size;
    this.stats.detailed = detailed;
    this.stats.triangles = triangles;
    this.stats.drawCalls = calls;
  }

  private build(id: string, lod: 0 | 1 | 2 | 3, bounds: Bounds): Chunk | null {
    const group = new THREE.Group();
    group.name = `Industrial ${id} · LOD${lod}`;
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

    // Ground: carriageways, yards, rail and the district skirt.
    if (lod <= 2) {
      const pieces = piecesForBounds(bounds, { markings: lod === 0, detail: lod === 0 });
      for (const [key, buffer] of surfaceBuffers(pieces)) add(buffer.geometry(), key);
    }

    // Buildings and landmarks.
    const buildings = buildingsInBounds(bounds);
    const built = indBuildingBuffers(buildings, lod);
    for (const [key, buffer] of built.groups) add(buffer.geometry(), MATERIAL_OF[key]);
    const landmarks = landmarksInBounds(bounds);
    if (landmarks.length) {
      const lm = indLandmarkBuffers(landmarks, lod);
      for (const [key, buffer] of lm) add(buffer.geometry(), MATERIAL_OF[key]);
    }
    // Fences: full ribbon near, posts and returns only in the detailed ring.
    if (lod <= 1) {
      const near = IND_FENCES.filter(f => f.points.some(p =>
        p.x >= bounds.minX - 40 && p.x <= bounds.maxX + 40 && p.z >= bounds.minZ - 40 && p.z <= bounds.maxZ + 40));
      if (near.length) {
        const fenceBuffers = indFenceBuffers(near, lod as 0 | 1);
        for (const [key, buffer] of fenceBuffers) add(buffer.geometry(), MATERIAL_OF[key]);
      }
    }
    // Props as instances, one mesh per kind.
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
    const byKind = new Map<IndPropKind, IndProp[]>();
    for (const prop of props) {
      if (lod > 0 && IND_NEAR_ONLY.has(prop.kind)) continue;
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

  /** Navigation overlay: lanes, yard pads, level crossings and the district gates. */
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
    // Yards: the manoeuvring ground future deliveries and chases would use.
    const yardBuffer = new Buffer();
    for (const yard of IND_YARDS) {
      yardBuffer.polygon(
        yard.polygon.map(p => ({ x: p.x, y: indGround(p.x, p.z) + 0.2, z: p.z })), colour, undefined, true,
      );
    }
    const yardGeometry = yardBuffer.geometry();
    if (yardGeometry) {
      const mesh = new THREE.Mesh(yardGeometry, materials.debug.parking);
      mesh.name = 'Industrial yards';
      this.navigation.add(mesh);
    }
    // Level crossings and gates.
    const marks = new Buffer();
    for (const crossing of LEVEL_CROSSINGS) {
      const n = { x: -crossing.roadDir.z, z: crossing.roadDir.x };
      const street = IND_NETWORK.streetById.get(crossing.streetId);
      const half = street ? street.width / 2 : 6;
      const y = indGround(crossing.point.x, crossing.point.z) + 0.26;
      for (const side of [-1, 1] as const) {
        const c = { x: crossing.point.x + crossing.roadDir.x * side * (half + 3), z: crossing.point.z + crossing.roadDir.z * side * (half + 3) };
        marks.quad(
          { x: c.x - n.x * half, y, z: c.z - n.z * half }, { x: c.x + n.x * half, y, z: c.z + n.z * half },
          { x: c.x + n.x * half + crossing.roadDir.x * 1.6, y, z: c.z + n.z * half + crossing.roadDir.z * 1.6 },
          { x: c.x - n.x * half + crossing.roadDir.x * 1.6, y, z: c.z - n.z * half + crossing.roadDir.z * 1.6 }, colour,
        );
      }
    }
    const markGeometry = marks.geometry();
    if (markGeometry) {
      const mesh = new THREE.Mesh(markGeometry, materials.debug.crossing);
      mesh.name = 'Level crossings';
      this.navigation.add(mesh);
    }
    const gates = new Buffer();
    for (const gate of IND_NETWORK.gateways) {
      gates.polygon(
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return { x: gate.point.x + Math.cos(a) * 14, y: gate.y + 0.3, z: gate.point.z + Math.sin(a) * 14 };
        }), colour, undefined, true,
      );
    }
    const gateGeometry = gates.geometry();
    if (gateGeometry) {
      const mesh = new THREE.Mesh(gateGeometry, materials.debug.transit);
      mesh.name = 'District gates';
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
