/**
 * The shared, non-streamed content of the region: sea, river, lake, surf, the coarse
 * all-region silhouette, sunlight and the dashed district boundary lines.
 *
 * These builders are pure Three.js — no DOM, no WebGL context — so the live viewer and
 * the headless scene audit (`npm run verify:scene`) construct exactly the same meshes
 * from exactly the same authored world data. Nothing here is hand-drawn.
 */
import * as THREE from 'three';
import { DISTRICTS, LAKE, WORLD, isBuiltDistrictId, type District, type RoadClass } from '../world/data';
import {
  COASTS, RIVER_CURVE, distance, lakeRadius, riverHalfWidth, riverLevel, terrainHeight,
} from '../world/geometry';
import { SAMPLED_ROADS, type RoadSample } from '../world/roads';

/** Overview ribbons are lighter than the asphalt the sectors draw, so they read from above. */
const REGION_ROAD_TINT: Record<RoadClass, readonly [number, number, number]> = {
  highway: [.96, .88, .66], arterial: [.93, .82, .58], secondary: [.90, .80, .58],
  local: [.85, .80, .68], rural: [.78, .70, .52],
};
const toLinear = (rgb: readonly [number, number, number]): readonly [number, number, number] => {
  const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};

/** Sky + fog colour shared by the viewer so a mode switch never changes the horizon. */
export const SKY_COLOR = 0xbcd6d3;
export const FOG_DENSITY = 0.000076;

export function createLights(): THREE.Object3D[] {
  const sky = new THREE.HemisphereLight(0xeaf5eb, 0x627c73, 1.28);
  const sunlight = new THREE.DirectionalLight(0xffebc9, 1.36);
  sunlight.position.set(-5300, 9200, -3900);
  sunlight.name = 'Sun';
  return [sky, sunlight];
}

export function makeWaterMesh(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(70000, 70000);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhongMaterial({
    color: 0x5c9ca7, emissive: 0x0d3039, emissiveIntensity: .12,
    specular: 0x7fbcc1, shininess: 62, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -.25; mesh.name = 'Open sea / tidal pools';
  return mesh;
}

export function makeRiver(): THREE.Mesh {
  const positions: number[] = [], indices: number[] = [];
  const length: number[] = [0];
  for (let i = 1; i < RIVER_CURVE.length; i++) length.push(length[i - 1] + distance(RIVER_CURVE[i - 1], RIVER_CURVE[i]));
  const total = length[length.length - 1];
  for (let i = 0; i < RIVER_CURVE.length; i++) {
    const p = RIVER_CURVE[i], prev = RIVER_CURVE[Math.max(0, i - 1)], next = RIVER_CURVE[Math.min(RIVER_CURVE.length - 1, i + 1)];
    const dx = next.x - prev.x, dz = next.z - prev.z, m = Math.hypot(dx, dz) || 1;
    const t = length[i] / total, w = riverHalfWidth(t), y = riverLevel(t) + .4;
    positions.push(p.x + dz / m * w, y, p.z - dx / m * w, p.x - dz / m * w, y, p.z + dx / m * w);
    if (i < RIVER_CURVE.length - 1) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: 0x6aabb1, specular: 0xa8d1ce, shininess: 68, side: THREE.DoubleSide }));
  mesh.name = 'Descending inland river'; return mesh;
}

export function makeLake(): THREE.Mesh {
  const positions: number[] = [LAKE.center.x, LAKE.level + .4, LAKE.center.z], indices: number[] = [];
  const count = 128;
  for (let i = 0; i <= count; i++) {
    const angle = i / count * 2 * Math.PI, r = lakeRadius(angle);
    positions.push(LAKE.center.x + Math.cos(angle) * LAKE.radiusX * r, LAKE.level + .4, LAKE.center.z + Math.sin(angle) * LAKE.radiusZ * r);
    if (i > 0) indices.push(0, i, i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: 0x72aaa3, specular: 0xd1dfc8, shininess: 82, side: THREE.DoubleSide }));
  mesh.name = 'Elevated inland lake'; return mesh;
}

export function makeCoastFoam(): THREE.Mesh {
  const pos: number[] = [], ids: number[] = [];
  for (const coast of COASTS) for (let i = 0; i < coast.length - 1; i++) {
    const a = coast[i], b = coast[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = dz / len * 11, nz = -dx / len * 11, j = pos.length / 3;
    pos.push(a.x - nx, 1.1, a.z - nz, a.x + nx, 1.1, a.z + nz,
      b.x - nx, 1.1, b.z - nz, b.x + nx, 1.1, b.z + nz);
    ids.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geometry.setIndex(ids);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xd9e6d7, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }));
  mesh.name = 'Shoreline surf'; return mesh;
}

/** One dashed outline per authored footprint — built districts and reservations alike. */
export function makeBoundary(district: District): THREE.Line {
  const vertices: number[] = [];
  for (let i = 0; i < district.polygon.length; i++) {
    const a = district.polygon[i], b = district.polygon[(i + 1) % district.polygon.length];
    const n = Math.ceil(distance(a, b) / 75);
    for (let j = 0; j < n; j++) {
      const t = j / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      vertices.push(x, Math.max(0, terrainHeight(x, z)) + 12, z);
    }
  }
  const first = district.polygon[0]; vertices.push(first.x, Math.max(0, terrainHeight(first.x, first.z)) + 12, first.z);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineDashedMaterial({ color: district.color, transparent: true, opacity: .62, dashSize: 72, gapSize: 56, depthTest: false });
  const line = new THREE.Line(geometry, material); line.computeLineDistances();
  line.renderOrder = 8; line.name = `${isBuiltDistrictId(district.id) ? 'Built' : 'Reserved'}: ${district.name}`; return line;
}

/**
 * The whole authored road graph in one merged mesh.
 *
 * Sector streaming only builds road ribbons near the camera, so a map-height view would
 * otherwise show a region with no roads in it. This overlay is generated from the very
 * same `SAMPLED_ROADS` alignments the sectors use — it is switched in only when the
 * camera is far enough that the streamed ribbons have stopped being built.
 */
export function makeRegionRoads(): THREE.Mesh {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const push = (a: RoadSample, b: RoadSample, width: number, tint: readonly [number, number, number]) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = dz / len * width / 2, nz = -dx / len * width / 2;
    const offset = positions.length / 3;
    positions.push(
      a.x - nx, a.y, a.z - nz, a.x + nx, a.y, a.z + nz,
      b.x + nx, b.y, b.z + nz, b.x - nx, b.y, b.z - nz,
    );
    for (let i = 0; i < 4; i++) colors.push(tint[0], tint[1], tint[2]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  for (const road of SAMPLED_ROADS) {
    const tint = toLinear(REGION_ROAD_TINT[road.road.type]);
    // Regional routes read as ribbons from map height; rural tracks stay thin.
    const width = road.road.type === 'highway' ? road.width * 2.1
      : road.road.type === 'arterial' ? road.width * 1.8
        : road.road.type === 'rural' ? road.width * 1.1 : road.width * 1.5;
    for (let i = 0; i < road.samples.length - 1; i++) push(road.samples[i], road.samples[i + 1], width, tint);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  mesh.name = 'Regional road network (overview)';
  mesh.visible = false;
  return mesh;
}

/** The world envelope, so the map view can frame the whole generated region at once. */
export const WORLD_EXTENT = {
  width: WORLD.maxX - WORLD.minX,
  depth: WORLD.maxZ - WORLD.minZ,
  centre: { x: (WORLD.minX + WORLD.maxX) / 2, z: (WORLD.minZ + WORLD.maxZ) / 2 },
} as const;

/** Every authored footprint, in the order the survey index lists them. */
export const REGION_DISTRICTS: readonly District[] = DISTRICTS;
