/**
 * A single inventory of what the world generators have actually produced.
 *
 * Every number here is read out of the same authored/generated modules the renderer
 * streams, so the on-screen readout, the atlas and the checkpoint report cannot drift
 * from the scene. Nothing is counted twice: a "building" is one authored volume.
 */
import { BUILT_DISTRICT_IDS, DISTRICTS, ROADS } from './data';
import { SAMPLED_ROADS } from './roads';
import { ALL_BUILDINGS, CITY } from '../city/buildings';
import { NETWORK } from '../city/streets';
import { IND_BUILDINGS, IND_LANDMARKS } from '../industrial/buildings';
import { IND_NETWORK } from '../industrial/plan';
import { W_BUILDINGS } from '../wealthy/buildings';
import { W_NETWORK } from '../wealthy/plan';
import { RES_BUILDINGS } from '../residential/buildings';
import { RES_NETWORK } from '../residential/plan';

export type DistrictInventory = Readonly<{
  id: string;
  name: string;
  built: boolean;
  buildings: number;
  landmarks: number;
  streets: number;
  streetKm: number;
}>;

type StreetLike = { length: number };
const kilometres = (streets: readonly StreetLike[]): number =>
  Math.round(streets.reduce((total, street) => total + street.length, 0) / 100) / 10;

const TABLE: Record<string, Omit<DistrictInventory, 'id' | 'name' | 'built'>> = {
  downtown: {
    buildings: ALL_BUILDINGS.length,
    landmarks: CITY.landmarks.length,
    streets: NETWORK.streets.length,
    streetKm: kilometres(NETWORK.streets),
  },
  industrial: {
    buildings: IND_BUILDINGS.length,
    landmarks: IND_LANDMARKS.length,
    streets: IND_NETWORK.streets.length,
    streetKm: kilometres(IND_NETWORK.streets),
  },
  wealthy: {
    buildings: W_BUILDINGS.length,
    landmarks: 0,
    streets: W_NETWORK.streets.length,
    streetKm: kilometres(W_NETWORK.streets),
  },
  residential: {
    buildings: RES_BUILDINGS.length,
    landmarks: 0,
    streets: RES_NETWORK.streets.length,
    streetKm: kilometres(RES_NETWORK.streets),
  },
};

export const DISTRICT_INVENTORY: readonly DistrictInventory[] = DISTRICTS.map(district => ({
  id: district.id,
  name: district.name,
  built: BUILT_DISTRICT_IDS.includes(district.id),
  ...(TABLE[district.id] ?? { buildings: 0, landmarks: 0, streets: 0, streetKm: 0 }),
}));

export const builtDistricts = (): readonly DistrictInventory[] => DISTRICT_INVENTORY.filter(d => d.built);

export const WORLD_INVENTORY = (() => {
  const built = DISTRICT_INVENTORY.filter(district => district.built);
  const sum = (pick: (district: DistrictInventory) => number): number =>
    built.reduce((total, district) => total + pick(district), 0);
  const regionalKm = Math.round(SAMPLED_ROADS.reduce((total, road) => total + road.length, 0) / 100) / 10;
  const districtKm = Math.round(sum(district => district.streetKm) * 10) / 10;
  return {
    districts: DISTRICTS.length,
    builtDistricts: built.length,
    reservedDistricts: DISTRICTS.length - built.length,
    buildings: sum(district => district.buildings),
    landmarks: sum(district => district.landmarks),
    districtStreets: sum(district => district.streets),
    districtStreetKm: districtKm,
    regionalRoads: ROADS.length,
    regionalRoadKm: regionalKm,
    bridges: ROADS.filter(road => road.bridge).length,
    totalRoads: ROADS.length + sum(district => district.streets),
    totalRoadKm: Math.round((regionalKm + districtKm) * 10) / 10,
  };
})();
