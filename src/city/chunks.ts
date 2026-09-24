/**
 * Downtown streaming: a spatial index of everything that has to be drawn, and the LOD
 * rings that decide how much of it is built.
 *
 * The district is generated once (streets, parcels, buildings, props) and only the meshes
 * stream. Content is indexed twice: into 500 m tiles for the detailed ring and into the
 * world's 1 km sectors for the middle ring, so a chunk request never scans the district.
 */
import type { Point } from '../world/data';
import { WORLD } from '../world/data';
import { CITY } from './buildings';
import { PLAN } from './blocks';
import { NETWORK } from './streets';
import { CROSSINGS, PARKING_BAYS, BUS_STOPS, SIGNALS } from './traffic';
import { CITY_POLYGON } from './frame';
import { polygonBounds, polygonCentroid } from './geometry2d';

export const TILE_SIZE = 500;
export type TileKey = { ix: number; iz: number };
export type LodLevel = 0 | 1 | 2;

export const LOD_RANGES = { detailed: 720, middle: 1300, silhouette: 7000 } as const;

export function tileKey(x: number, z: number): TileKey {
  return { ix: Math.floor(x / TILE_SIZE), iz: Math.floor(z / TILE_SIZE) };
}
export function tileId(key: TileKey): string { return `${key.ix}:${key.iz}`; }
export function tileCentre(key: TileKey): Point {
  return { x: (key.ix + .5) * TILE_SIZE, z: (key.iz + .5) * TILE_SIZE };
}
export function tileBounds(key: TileKey) {
  return {
    minX: key.ix * TILE_SIZE, minZ: key.iz * TILE_SIZE,
    maxX: (key.ix + 1) * TILE_SIZE, maxZ: (key.iz + 1) * TILE_SIZE,
  };
}

export type TileContent = {
  id: string;
  key: TileKey;
  buildings: number[];
  streets: string[];
  crossings: number[];
  bays: number[];
  stops: number[];
  signals: number[];
  openSpace: number[];
  courtyards: number[];
  alleys: number[];
};

const TILES = new Map<string, TileContent>();

function tile(indexKey: string, key: TileKey): TileContent {
  let content = TILES.get(indexKey);
  if (!content) {
    content = {
      id: indexKey, key, buildings: [], streets: [], crossings: [], bays: [], stops: [],
      signals: [], openSpace: [], courtyards: [], alleys: [],
    };
    TILES.set(indexKey, content);
  }
  return content;
}

function eachTileOf(minX: number, minZ: number, maxX: number, maxZ: number, visit: (content: TileContent) => void): void {
  const first = tileKey(minX, minZ), last = tileKey(maxX, maxZ);
  for (let iz = first.iz; iz <= last.iz; iz++) {
    for (let ix = first.ix; ix <= last.ix; ix++) {
      visit(tile(`${ix}:${iz}`, { ix, iz }));
    }
  }
}

for (const [index, building] of [...CITY.buildings, ...CITY.landmarks].entries()) {
  const b = polygonBounds(building.footprint);
  eachTileOf(b.minX - 2, b.minZ - 2, b.maxX + 2, b.maxZ + 2, content => content.buildings.push(index));
}
for (const street of NETWORK.streets) {
  const points = street.samples;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = street.width / 2 + street.sidewalk + 2;
  eachTileOf(minX - pad, minZ - pad, maxX + pad, maxZ + pad, content => content.streets.push(street.id));
}
for (const [index, crossing] of CROSSINGS.entries()) {
  const b = boundsOf([crossing.a, crossing.b]);
  eachTileOf(b.minX - 4, b.minZ - 4, b.maxX + 4, b.maxZ + 4, content => content.crossings.push(index));
}
for (const [index, bay] of PARKING_BAYS.entries()) {
  eachTileOf(bay.centre.x - 4, bay.centre.z - 4, bay.centre.x + 4, bay.centre.z + 4, content => content.bays.push(index));
}
for (const [index, stop] of BUS_STOPS.entries()) {
  const b = polygonBounds(stop.pad.polygon);
  eachTileOf(b.minX - 6, b.minZ - 6, b.maxX + 6, b.maxZ + 6, content => content.stops.push(index));
}
for (const [index, signal] of SIGNALS.entries()) {
  eachTileOf(signal.point.x - 3, signal.point.z - 3, signal.point.x + 3, signal.point.z + 3, content => content.signals.push(index));
}
const OPEN_SPACE = [
  ...CITY.openSpace.map(o => o.polygon),
];
for (const [index, polygon] of OPEN_SPACE.entries()) {
  const b = polygonBounds(polygon);
  eachTileOf(b.minX - 2, b.minZ - 2, b.maxX + 2, b.maxZ + 2, content => content.openSpace.push(index));
}
for (const [index, courtyard] of PLAN.courtyards.entries()) {
  const b = polygonBounds(courtyard.polygon);
  eachTileOf(b.minX - 2, b.minZ - 2, b.maxX + 2, b.maxZ + 2, content => content.courtyards.push(index));
}
for (const [index, alley] of PLAN.alleys.entries()) {
  const b = boundsOf([alley.a, alley.b]);
  eachTileOf(b.minX - 8, b.minZ - 8, b.maxX + 8, b.maxZ + 8, content => content.alleys.push(index));
}

function boundsOf(points: readonly Point[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, minZ, maxX, maxZ };
}

export function tileContent(key: TileKey): TileContent | undefined { return TILES.get(tileId(key)); }
export const TILE_IDS: readonly string[] = [...TILES.keys()];
export function tileCount(): number { return TILES.size; }

/** 1 km sector tiles for the middle ring: they line up with the world's terrain sectors. */
export type SectorKey = { ix: number; iz: number };
export const SECTOR_SIZE = WORLD.sectorSize;
export function sectorKeyOf(x: number, z: number): SectorKey {
  return {
    ix: Math.floor((x - WORLD.minX) / SECTOR_SIZE),
    iz: Math.floor((z - WORLD.minZ) / SECTOR_SIZE),
  };
}
export function sectorId(key: SectorKey): string { return `${key.ix}:${key.iz}`; }
export function sectorCentre(key: SectorKey): Point {
  return {
    x: WORLD.minX + (key.ix + .5) * SECTOR_SIZE,
    z: WORLD.minZ + (key.iz + .5) * SECTOR_SIZE,
  };
}
/** Sectors that hold any part of downtown. */
export const CITY_SECTORS: readonly SectorKey[] = (() => {
  const bounds = polygonBounds(CITY_POLYGON);
  const keys: SectorKey[] = [];
  const first = sectorKeyOf(bounds.minX, bounds.minZ), last = sectorKeyOf(bounds.maxX, bounds.maxZ);
  for (let iz = first.iz; iz <= last.iz; iz++) for (let ix = first.ix; ix <= last.ix; ix++) {
    const centre = sectorCentre({ ix, iz });
    // Only sectors whose centre is inside the footprint, plus their neighbours: the
    // footprint boundary is diagonal to the sector grid.
    if (CITY_POLYGON.some(p => Math.abs(p.x - centre.x) < SECTOR_SIZE && Math.abs(p.z - centre.z) < SECTOR_SIZE)) {
      keys.push({ ix, iz });
    }
  }
  return keys;
})();

/** Choose the level of detail for a tile at a given distance from the camera target. */
export function lodFor(distance: number): LodLevel {
  if (distance <= LOD_RANGES.detailed) return 0;
  if (distance <= LOD_RANGES.middle) return 1;
  return 2;
}

export const CONTENT_BOUNDS = (() => {
  const all = [...CITY.buildings, ...CITY.landmarks].map(b => polygonCentroid(b.footprint));
  return boundsOf(all);
})();
export const OPEN_SPACE_POLYGONS = OPEN_SPACE;
