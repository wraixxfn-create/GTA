import {
  DISTRICTS, LAKE, MAIN_LAND, RIVER, SOUND_ISLAND, WORLD,
  type Point,
} from './data';

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, n: number): number => {
  const t = clamp((n - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

export function pointInPolygon(x: number, z: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

/** Exact polygon/tile intersection for assigning future asset bundles to sectors. */
export function polygonIntersectsRect(polygon:readonly Point[],x:number,z:number,size:number):boolean {
  const x2=x+size,z2=z+size;
  if(polygon.some(p=>p.x>=x&&p.x<=x2&&p.z>=z&&p.z<=z2))return true;
  const corners=[{x,z},{x:x2,z},{x:x2,z:z2},{x,z:z2}];
  if(corners.some(p=>pointInPolygon(p.x,p.z,polygon)))return true;
  const crosses=(a:Point,b:Point,c:Point,d:Point)=>{
    if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||
       Math.max(a.z,b.z)<Math.min(c.z,d.z)||Math.max(c.z,d.z)<Math.min(a.z,b.z))return false;
    const turn=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
    const u=turn(a,b,c),v=turn(a,b,d),w=turn(c,d,a),y=turn(c,d,b);
    return u*v<=0&&w*y<=0;
  };
  for(let i=0;i<polygon.length;i++)for(let j=0;j<4;j++)
    if(crosses(polygon[i],polygon[(i+1)%polygon.length],corners[j],corners[(j+1)%4]))return true;
  return false;
}

function curvePoint(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2*b.x + (-a.x+c.x)*t + (2*a.x-5*b.x+4*c.x-d.x)*t2 + (-a.x+3*b.x-3*c.x+d.x)*t3),
    z: 0.5 * (2*b.z + (-a.z+c.z)*t + (2*a.z-5*b.z+4*c.z-d.z)*t2 + (-a.z+3*b.z-3*c.z+d.z)*t3),
  };
}

/** Endpoint-preserving interpolating curve; endpoints are never rounded off a road junction. */
export function sampleCurve(points: readonly Point[], spacing = 45, closed = false): Point[] {
  if (points.length < 2) return [...points];
  const result: Point[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const b = points[i], c = points[(i + 1) % points.length];
    const a = points[closed ? (i - 1 + points.length) % points.length : Math.max(0, i - 1)];
    const d = points[closed ? (i + 2) % points.length : Math.min(points.length - 1, i + 2)];
    const subdivisions = Math.max(1, Math.ceil(distance(b, c) / spacing));
    for (let j = 0; j < subdivisions; j++) result.push(curvePoint(a, b, c, d, j / subdivisions));
  }
  if (closed) result.push({ ...result[0] });
  else result.push({ ...points[points.length - 1] });
  return result;
}

// Smooth shoreline and meander at a resolution independent of the rendered terrain LOD.
export const COASTS = [sampleCurve(MAIN_LAND, 115, true), sampleCurve(SOUND_ISLAND, 90, true)] as const;
export const RIVER_CURVE = sampleCurve(RIVER, 55);
const coastSegments=COASTS.flatMap(coast=>coast.slice(0,-1).map((a,i)=>({a,b:coast[i+1]})));
const coastRowSize=700;
const coastRows=new Map<number,typeof coastSegments>();
for(const segment of coastSegments) {
  const lo=Math.floor(Math.min(segment.a.z,segment.b.z)/coastRowSize);
  const hi=Math.floor(Math.max(segment.a.z,segment.b.z)/coastRowSize);
  for(let row=lo;row<=hi;row++) {
    const list=coastRows.get(row)??[];list.push(segment);coastRows.set(row,list);
  }
}
const coastCandidates=new Map<string,typeof coastSegments>();
function candidateCoastSegments(x:number,z:number):typeof coastSegments {
  const ix=Math.floor(x/coastRowSize),iz=Math.floor(z/coastRowSize),key=`${ix},${iz}`;
  const cached=coastCandidates.get(key);
  if(cached)return cached;
  const cx=(ix+.5)*coastRowSize,cz=(iz+.5)*coastRowSize;
  let nearest=Infinity;
  const distances=coastSegments.map(({a,b})=>{
    const d=segmentDistance(cx,cz,a,b).distance;
    nearest=Math.min(nearest,d);return d;
  });
  // Triangle inequality: a segment farther than best + 2*cellRadius from
  // the cell centre cannot be nearest to any point in that cell.
  const threshold=nearest+coastRowSize*Math.SQRT2+1;
  const candidates=coastSegments.filter((_,i)=>distances[i]<=threshold);
  coastCandidates.set(key,candidates);
  return candidates;
}

function segmentDistance(x: number, z: number, a: Point, b: Point): { distance: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x-a.x)*dx + (z-a.z)*dz) / (dx*dx + dz*dz || 1), 0, 1);
  return { distance: Math.hypot(x - a.x - t*dx, z - a.z - t*dz), t };
}

/** Positive on either island, negative in the sea; absolute value is metres to the shore. */
export function signedCoastDistance(x: number, z: number): number {
  let nearest=Infinity,inside=false;
  for(const {a,b} of candidateCoastSegments(x,z)) {
    const d=segmentDistance(x,z,a,b).distance;
    if(d<nearest)nearest=d;
  }
  // Only shoreline edges that cross this horizontal row can change parity.
  for(const {a,b} of coastRows.get(Math.floor(z/coastRowSize))??[]) {
    if((a.z>z)!==(b.z>z) && x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside?nearest:-nearest;
}

const riverLength: number[] = [0];
for (let i=1; i<RIVER_CURVE.length; i++) riverLength.push(riverLength[i-1] + distance(RIVER_CURVE[i-1], RIVER_CURVE[i]));
const totalRiverLength = riverLength[riverLength.length-1];

// The river index keeps distant terrain tiles from scanning every water segment.
const riverBuckets = new Map<string, number[]>();
const bucketSize = 1000;
for (let i=0; i<RIVER_CURVE.length-1; i++) {
  const a=RIVER_CURVE[i], b=RIVER_CURVE[i+1];
  const minX=Math.floor((Math.min(a.x,b.x)-850)/bucketSize), maxX=Math.floor((Math.max(a.x,b.x)+850)/bucketSize);
  const minZ=Math.floor((Math.min(a.z,b.z)-850)/bucketSize), maxZ=Math.floor((Math.max(a.z,b.z)+850)/bucketSize);
  for (let ix=minX; ix<=maxX; ix++) for (let iz=minZ; iz<=maxZ; iz++) {
    const key=`${ix},${iz}`;
    const bucket=riverBuckets.get(key) ?? [];
    bucket.push(i);
    riverBuckets.set(key,bucket);
  }
}

export function riverLevel(t: number): number { return 70 * Math.pow(1-clamp(t,0,1), 1.65); }
export function riverHalfWidth(t: number): number { return 36 + 121 * Math.pow(clamp(t,0,1), 1.45); }
export type RiverProximity = { distance: number; t: number; level: number; width: number };
export function nearestRiver(x: number, z: number): RiverProximity {
  const bucket=riverBuckets.get(`${Math.floor(x/bucketSize)},${Math.floor(z/bucketSize)}`);
  if (!bucket) return { distance: Infinity, t: 0, level: 0, width: 0 };
  let nearest=Infinity;
  const hits: {distance:number;t:number}[]=[];
  for (const i of bucket) {
    const hit=segmentDistance(x,z,RIVER_CURVE[i],RIVER_CURVE[i+1]);
    const t=(riverLength[i] + hit.t*(riverLength[i+1]-riverLength[i]))/totalRiverLength;
    hits.push({distance:hit.distance,t});
    if (hit.distance < nearest) nearest=hit.distance;
  }
  // A meander can bring two reaches equally close to one hillside. Blend their
  // floodplain levels there; switching abruptly to a different reach creates cliffs.
  let weight=0, weightedT=0;
  for (const hit of hits) {
    const delta=hit.distance-nearest;
    if (delta>280) continue;
    const w=Math.exp(-.5*(delta/110)**2);
    weight+=w; weightedT+=hit.t*w;
  }
  const t=weightedT/weight;
  return { distance: nearest, t, level: riverLevel(t), width: riverHalfWidth(t) };
}

export function lakeRadius(angle: number): number {
  return 1 + .058*Math.sin(3*angle+.8) + .035*Math.sin(7*angle-1.1) + .018*Math.cos(11*angle+.4);
}
export function lakeDistance(x: number, z: number): number {
  const dx=(x-LAKE.center.x)/LAKE.radiusX, dz=(z-LAKE.center.z)/LAKE.radiusZ;
  return Math.hypot(dx,dz)/lakeRadius(Math.atan2(dz,dx));
}

function hash2(ix: number, iz: number): number {
  let n=(Math.imul(ix,374761393)+Math.imul(iz,668265263))|0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967295;
}
export function noise(x: number, z: number): number {
  const ix=Math.floor(x), iz=Math.floor(z), fx=x-ix, fz=z-iz;
  const u=fx*fx*(3-2*fx), v=fz*fz*(3-2*fz);
  return lerp(lerp(hash2(ix,iz),hash2(ix+1,iz),u),lerp(hash2(ix,iz+1),hash2(ix+1,iz+1),u),v);
}
function gaussian(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const dx=(x-cx)/rx, dz=(z-cz)/rz;
  if (Math.abs(dx)>3.7 || Math.abs(dz)>3.7) return 0;
  return Math.exp(-.5*(dx*dx+dz*dz));
}

export function forestDensity(x: number, z: number): number {
  const groves =
    .76*gaussian(x,z,1460,-4350,1880,1600) +
    .73*gaussian(x,z,-7250,-4430,1450,1350) +
    .43*gaussian(x,z,-1090,-3990,1700,1350) +
    .44*gaussian(x,z,-3250,650,1450,1000) +
    .38*gaussian(x,z,6590,4260,1060,680);
  return clamp((groves-.13) * (.65+.62*noise(x/480,z/480)),0,.88);
}

export function isReservedBuiltArea(x: number, z: number): boolean {
  return DISTRICTS.some(d => d.kind !== 'landscape' && pointInPolygon(x,z,d.polygon));
}

/**
 * The districts that are actually built. Regional routes are drawn by the streaming
 * sectors everywhere else; inside a constructed district the district owns its own
 * streets (the same alignments, carried through as legacy streets), so the foundation
 * ribbons stop at the district limit instead of running under the graded pad.
 */
const CONSTRUCTED_POLYGON = DISTRICTS.find(d => d.id === 'downtown')!.polygon;
const CONSTRUCTED_INDUSTRIAL_POLYGON = DISTRICTS.find(d => d.id === 'industrial')!.polygon;
const CONSTRUCTED_WEALTHY_POLYGON = DISTRICTS.find(d => d.id === 'wealthy')!.polygon;
const CONSTRUCTED_RESIDENTIAL_POLYGON = DISTRICTS.find(d => d.id === 'residential')!.polygon;
export function isConstructedDowntown(x: number, z: number): boolean {
  return pointInPolygon(x, z, CONSTRUCTED_POLYGON);
}
export function isConstructedIndustrial(x: number, z: number): boolean {
  return pointInPolygon(x, z, CONSTRUCTED_INDUSTRIAL_POLYGON);
}
/**
 * The hillside district owns its own roads too, but unlike the other two it is *not* graded:
 * its datum is the natural terrain (see `src/wealthy/frame.ts`), so the carried-through
 * regional alignments meet their continuations outside the limit without a step.
 */
export function isConstructedWealthy(x: number, z: number): boolean {
  return pointInPolygon(x, z, CONSTRUCTED_WEALTHY_POLYGON);
}
/**
 * The residential valley is graded like downtown (see `residentialFloorWeight`) and owns
 * its own streets — the same regional alignments, carried through as legacy streets — so
 * the foundation ribbons stop at the district limit instead of running under the pad.
 */
export function isConstructedResidential(x: number, z: number): boolean {
  return pointInPolygon(x, z, CONSTRUCTED_RESIDENTIAL_POLYGON);
}
export function isConstructedDistrict(x: number, z: number): boolean {
  return isConstructedDowntown(x, z) || isConstructedIndustrial(x, z) || isConstructedWealthy(x, z) || isConstructedResidential(x, z);
}

export function marshInfluence(x: number, z: number): number {
  return gaussian(x,z,6090,640,1450,1040);
}

/**
 * Grading weight of the constructed downtown (0 → untouched terrain, 1 → fully graded
 * city floor). The built district needs a continuous pad for streets, sidewalks and
 * building platforms, so high-frequency relief is *removed* inside its footprint and
 * blended out over 420 m at the edge. Long-wavelength relief is kept, which is why the
 * floor still tilts gently towards the bay instead of becoming a flat plate.
 */
export function cityFloorWeight(x: number, z: number): number {
  const d = CITY_FLOOR_DISTANCE(x, z);
  return smoothstep(-140, 280, d);
}
const DOWNTOWN_POLYGON = DISTRICTS.find(d => d.id === 'downtown')!.polygon;
function CITY_FLOOR_DISTANCE(x: number, z: number): number {
  let nearest = Infinity;
  for (let i = 0; i < DOWNTOWN_POLYGON.length; i++) {
    const a = DOWNTOWN_POLYGON[i], b = DOWNTOWN_POLYGON[(i + 1) % DOWNTOWN_POLYGON.length];
    nearest = Math.min(nearest, segmentDistance(x, z, a, b).distance);
  }
  return pointInPolygon(x, z, DOWNTOWN_POLYGON) ? nearest : -nearest;
}

/**
 * Grading weight of the constructed industrial district. The riverward flats are a
 * working pad: every noise octave of relief is graded away inside the footprint and
 * blended back over 420 m at the limit, leaving the long-wavelength regional tilt
 * (the plain falls from ~41 m in the north to the port plateau in the south, and the
 * river valley terrace keeps its own level on the east flank). Regional roads that
 * cross the district re-sample this surface, so gateways meet their continuations
 * without a step and never exceed the road grade audit.
 */
export function industrialFloorWeight(x: number, z: number): number {
  const d = INDUSTRIAL_FLOOR_DISTANCE(x, z);
  return smoothstep(-140, 280, d);
}
const INDUSTRIAL_POLYGON = DISTRICTS.find(d => d.id === 'industrial')!.polygon;
function INDUSTRIAL_FLOOR_DISTANCE(x: number, z: number): number {
  let nearest = Infinity;
  for (let i = 0; i < INDUSTRIAL_POLYGON.length; i++) {
    const a = INDUSTRIAL_POLYGON[i], b = INDUSTRIAL_POLYGON[(i + 1) % INDUSTRIAL_POLYGON.length];
    nearest = Math.min(nearest, segmentDistance(x, z, a, b).distance);
  }
  return pointInPolygon(x, z, INDUSTRIAL_POLYGON) ? nearest : -nearest;
}

/**
 * Grading weight of the constructed residential district. The valley floor is graded
 * gently for its street grid — high-frequency relief is removed inside the footprint and
 * blended back over 260 m at the limit, keeping the long-wavelength tilt of the valley
 * (it falls from the mountain shoulder towards the city floor). Regional routes that
 * cross the district re-sample this surface, so gates meet their continuations without a
 * step and never exceed the road grade audit.
 */
export function residentialFloorWeight(x: number, z: number): number {
  const d = RESIDENTIAL_FLOOR_DISTANCE(x, z);
  return smoothstep(-120, 240, d);
}
const RESIDENTIAL_POLYGON = DISTRICTS.find(d => d.id === 'residential')!.polygon;
function RESIDENTIAL_FLOOR_DISTANCE(x: number, z: number): number {
  let nearest = Infinity;
  for (let i = 0; i < RESIDENTIAL_POLYGON.length; i++) {
    const a = RESIDENTIAL_POLYGON[i], b = RESIDENTIAL_POLYGON[(i + 1) % RESIDENTIAL_POLYGON.length];
    nearest = Math.min(nearest, segmentDistance(x, z, a, b).distance);
  }
  return pointInPolygon(x, z, RESIDENTIAL_POLYGON) ? nearest : -nearest;
}

export type TerrainSample = { height: number; coast: number; river: RiverProximity; lake: number; marsh: number };
/** Stable world-space height function shared by every sector, waterbody, road and atlas. */
export function terrainSample(x: number, z: number): TerrainSample {
  const coast=signedCoastDistance(x,z);
  const river=nearestRiver(x,z);
  const lake=lakeDistance(x,z);
  const marsh=marshInfluence(x,z);
  if (coast <= 0) return {height:Math.max(-85,coast*.087),coast,river,lake,marsh};

  const inland=smoothstep(0,130,coast);
  let h=(6 + 35*(1-Math.exp(-coast/670)))*inland;
  // Inside the built downtown the fine relief is graded away (see cityFloorWeight);
  // inside the built industrial district every noise octave is graded away, leaving
  // only the regional tilt and the river terrace (see industrialFloorWeight).
  const cityFloor=cityFloorWeight(x,z), fineRelief=1-.94*cityFloor;
  const indFloor=industrialFloorWeight(x,z), gradedRelief=1-.96*indFloor;
  const resFloor=residentialFloorWeight(x,z), valleyRelief=1-.85*resFloor;
  h+=inland*(gradedRelief*valleyRelief*12*(noise(x/1330,z/1330)-.5)+fineRelief*gradedRelief*valleyRelief*(6*(noise(x/370,z/370)-.5)+1.8*(noise(x/105,z/105)-.5)));
  h+=.85*cityFloor+.7*indFloor+.6*resFloor;
  h+=inland*(
    565*gaussian(x,z,-2960,-5230,1180,950) +
    625*gaussian(x,z,-1260,-5750,990,760) +
    282*gaussian(x,z,-4780,-5290,1210,850) +
    388*gaussian(x,z,710,-5480,1070,850) +
    150*gaussian(x,z,2050,-4360,1160,1280) +
    92*gaussian(x,z,-3640,1610,1250,1070) +
    58*gaussian(x,z,-7000,-1100,950,1180) +
    63*gaussian(x,z,6650,4350,960,730)
  );

  // Coherent lowlands are left level enough for future construction and long road links.
  const airportR=Math.hypot((x-6510)/1560,(z+2820)/1410);
  h=lerp(h,39 + 1.3*(noise(x/510,z/510)-.5),1-smoothstep(.74,1.19,airportR));
  const urbanR=Math.hypot((x+70)/2400,(z-860)/2700);
  h=lerp(h,34+3*(noise(x/730,z/730)-.5),.68*(1-smoothstep(.64,1.2,urbanR)));
  const portR=Math.hypot((x-3560)/1420,(z-3080)/1340);
  h=lerp(h,23+2*(noise(x/620,z/620)-.5),.78*(1-smoothstep(.68,1.18,portR)));
  h=lerp(h,5+3*(noise(x/450,z/450)-.5),.88*(1-smoothstep(.52,1.18,Math.hypot((x-6090)/1620,(z-620)/1120))));

  // An elevated freshwater basin with a shallow perimeter, not a sea-level hole.
  if (lake < 1) h=16 + 9*smoothstep(.72,1,lake);
  else if (lake < 1.3) h=lerp(25,Math.max(30,h),smoothstep(1,1.3,lake));

  // A wide floodplain grades down to a narrow, descending channel.
  if (river.distance < river.width+1500) {
    const bank=river.level + Math.max(0,river.distance-river.width)*.075;
    // Fade the valley cut into the hills. A hard edge here would create a
    // discontinuous cliff (and an impossible grade on its approach roads).
    const valleyWeight=1-smoothstep(river.width+450,river.width+1500,river.distance);
    h=lerp(h,Math.min(h,bank),valleyWeight);
    if (river.distance < river.width) h=Math.min(h,river.level-3.8+3.8*Math.pow(river.distance/river.width,2));
  }

  // Small tidal pools in the delta remain clear of its reserved road alignments.
  if (marsh > .28) {
    const pools: readonly [number,number,number,number][] = [
      [5480,260,170,120],[6650,1050,185,105],[6860,380,145,100],[5270,780,100,145],
    ];
    for (const [cx,cz,rx,rz] of pools) {
      const r=Math.hypot((x-cx)/rx,(z-cz)/rz);
      if (r<1.18) h=lerp(-1.9,Math.max(2,h),smoothstep(.7,1.18,r));
    }
  }
  return {height:h,coast,river,lake,marsh};
}
export function terrainHeight(x: number, z: number): number { return terrainSample(x,z).height; }

export type RGB = readonly [number,number,number];
function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
}
/** Shared land palette for the 3D surface and the two-dimensional atlas. */
export function terrainColor(x: number, z: number, sample: TerrainSample): RGB {
  if (sample.coast<0) return [0.27,0.51,0.52];
  const sand:RGB=[.79,.73,.55], meadow:RGB=[.48,.60,.47];
  let color:RGB=mixColor(sand,meadow,smoothstep(40,270,sample.coast));
  const field=noise(x/780,z/780);
  color=mixColor(color,[.56,.62,.43],.16*field);
  const woodland=forestDensity(x,z);
  color=mixColor(color,[.28,.45,.38],woodland*.87);
  color=mixColor(color,[.48,.56,.42],sample.marsh*.58);
  color=mixColor(color,[.53,.54,.49],smoothstep(195,515,sample.height)*.9);
  color=mixColor(color,[.68,.66,.58],smoothstep(490,760,sample.height)*.74);
  // Dry protected plateaus have readable open ground; no district detail is painted in.
  const airportR=Math.hypot((x-6510)/1540,(z+2820)/1320);
  color=mixColor(color,[.57,.63,.51],.32*(1-smoothstep(.8,1.22,airportR)));
  const texture=(noise(x/160,z/160)-.5)*.075;
  return [clamp(color[0]+texture,0,1),clamp(color[1]+texture,0,1),clamp(color[2]+texture,0,1)];
}

export function sectorAt(x: number, z: number): { x: number; z: number } | null {
  if (x<WORLD.minX || x>=WORLD.maxX || z<WORLD.minZ || z>=WORLD.maxZ) return null;
  return {x:Math.floor((x-WORLD.minX)/WORLD.sectorSize),z:Math.floor((z-WORLD.minZ)/WORLD.sectorSize)};
}
export function sectorKey(x: number, z: number): string { return `${x}:${z}`; }
export const SECTOR_COLUMNS=(WORLD.maxX-WORLD.minX)/WORLD.sectorSize;
export const SECTOR_ROWS=(WORLD.maxZ-WORLD.minZ)/WORLD.sectorSize;

/** Only sectors intersecting the current exploration radius should have detailed assets. */
export function sectorsNear(x: number, z: number, radius: number): {x:number;z:number;distance:number}[] {
  const tiles: {x:number;z:number;distance:number}[]=[];
  for (let iz=0; iz<SECTOR_ROWS; iz++) for (let ix=0; ix<SECTOR_COLUMNS; ix++) {
    const cx=WORLD.minX+(ix+.5)*WORLD.sectorSize, cz=WORLD.minZ+(iz+.5)*WORLD.sectorSize;
    const d=Math.hypot(Math.max(0,Math.abs(cx-x)-WORLD.sectorSize/2),Math.max(0,Math.abs(cz-z)-WORLD.sectorSize/2));
    if (d<=radius) tiles.push({x:ix,z:iz,distance:d});
  }
  return tiles.sort((a,b)=>a.distance-b.distance);
}

export function districtAt(x: number, z: number) {
  return DISTRICTS.find(d => pointInPolygon(x,z,d.polygon));
}
