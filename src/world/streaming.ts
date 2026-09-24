import { DISTRICTS, WORLD, type District } from './data';
import { polygonIntersectsRect, sectorAt, sectorKey } from './geometry';

/** 1 km tile index shared by terrain/roads today and future per-district assets. */
export const SECTOR_LAYOUT = {
  columns:(WORLD.maxX-WORLD.minX)/WORLD.sectorSize,
  rows:(WORLD.maxZ-WORLD.minZ)/WORLD.sectorSize,
  total:(WORLD.maxX-WORLD.minX)*(WORLD.maxZ-WORLD.minZ)/(WORLD.sectorSize**2),
  districtIds(ix:number,iz:number):string[] {
    const x=WORLD.minX+ix*WORLD.sectorSize,z=WORLD.minZ+iz*WORLD.sectorSize;
    // Boundary tiles may belong to more than one future bundle. A later asset
    // loader still clips placements to the actual polygon, not the whole tile.
    return DISTRICTS.filter(d=>polygonIntersectsRect(d.polygon,x,z,WORLD.sectorSize)).map(d=>d.id);
  },
  tilesFor(district:District):string[] {
    const tiles:string[]=[];
    for(let iz=0;iz<this.rows;iz++)for(let ix=0;ix<this.columns;ix++)
      if(this.districtIds(ix,iz).includes(district.id))tiles.push(sectorKey(ix,iz));
    return tiles;
  },
  at:sectorAt,
} as const;
