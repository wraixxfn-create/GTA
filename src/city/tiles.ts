/**
 * Building-to-tile index. A building is *drawn* by the tile that holds its centroid but is
 * a *candidate* for every tile it touches, so a tower straddling a boundary is never drawn
 * twice and never disappears when only the neighbouring tile is resident.
 */
import { CITY, type Building } from './buildings';
import { TILE_SIZE } from './chunks';
import { polygonBounds, polygonCentroid } from './geometry2d';

const ALL: readonly Building[] = [...CITY.buildings, ...CITY.landmarks];
const CENTROIDS = ALL.map(b => polygonCentroid(b.footprint));
const BOUNDS = ALL.map(b => polygonBounds(b.footprint));

type Entry = { building: Building; centroid: { x: number; z: number }; bounds: ReturnType<typeof polygonBounds> };
const ENTRIES: Entry[] = ALL.map((building, index) => ({
  building, centroid: CENTROIDS[index], bounds: BOUNDS[index],
}));

const CELL = TILE_SIZE;
const GRID = new Map<string, number[]>();
ENTRIES.forEach((entry, index) => {
  const first = { x: Math.floor(entry.bounds.minX / CELL), z: Math.floor(entry.bounds.minZ / CELL) };
  const last = { x: Math.floor(entry.bounds.maxX / CELL), z: Math.floor(entry.bounds.maxZ / CELL) };
  for (let z = first.z; z <= last.z; z++) {
    for (let x = first.x; x <= last.x; x++) {
      const key = `${x}:${z}`;
      const list = GRID.get(key) ?? [];
      list.push(index);
      GRID.set(key, list);
    }
  }
});

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

export const BUILDING_INDEX = {
  /** Buildings whose centroid lies inside the rectangle: exactly one chunk draws them. */
  in(bounds: Bounds, lod = 0): Building[] {
    const out: Building[] = [];
    const seen = new Set<number>();
    const first = { x: Math.floor(bounds.minX / CELL), z: Math.floor(bounds.minZ / CELL) };
    const last = { x: Math.floor(bounds.maxX / CELL), z: Math.floor(bounds.maxZ / CELL) };
    for (let z = first.z; z <= last.z; z++) {
      for (let x = first.x; x <= last.x; x++) {
        for (const index of GRID.get(`${x}:${z}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const entry = ENTRIES[index];
          if (entry.centroid.x < bounds.minX || entry.centroid.x >= bounds.maxX) continue;
          if (entry.centroid.z < bounds.minZ || entry.centroid.z >= bounds.maxZ) continue;
          // The distant rings drop the small stuff: it is invisible at that range and
          // it keeps the silhouette readable.
          if (lod >= 3 && entry.building.height < 16) continue;
          if (lod >= 2 && entry.building.height < 9) continue;
          out.push(entry.building);
        }
      }
    }
    return out;
  },
  all: ALL,
  count: ALL.length,
};
