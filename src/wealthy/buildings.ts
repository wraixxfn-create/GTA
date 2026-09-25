/**
 * Buildings and grounds of Vantage Heights: the landmark properties, the houses on their
 * terraces, and the landscaping that is the real fabric of the district.
 *
 * Landmark estates are laid out from their authored part lists; every remaining plot takes
 * a building from its zone and vintage, with its footprint set back from the plot edge so
 * the garden survives. Each building carries the side its doors face, so porches, drives
 * and forecourts land on the street. Five buildings are interior-ready; the other two
 * hundred and more are closed doors — that is what a private hillside is.
 *
 * Ground is generated as deliberately as building: lawns, formal gardens, drives, orchards,
 * tennis courts and pools are polygons in their own right, and every walled plot gets its
 * wall with a gap where the gate is.
 */
import type { Point } from '../world/data';
import {
  add, distance2d, ensureCCW, extentAlong, insetConvex, leftNormal, longestEdge,
  normalize, pointToSegment, polygonArea, polygonBounds, polygonCentroid, rectAt,
  regularPolygon, scale, sub,
} from '../city/geometry2d';
import { pointInPolygon, terrainHeight } from '../world/geometry';
import {
  ESTATE_LIMITS, hash01, hillGround, makeRandom, padLevel, vintageAt, zoneAt,
  type Vintage,
} from './frame';
import {
  ESTATE_NAMES, GATE_NAMES, HOUSE_NAMES, HOTEL_NAMES, RESTAURANTS, SHOPS,
  facadeForVintage, LANDMARK_ESTATES, estatePolygon, partPolygon,
  type FacadeId, type LandmarkEstate, type EstatePart,
} from './identity';
import { ESTATE_GROUNDS, PLOTS, type Plot } from './sites';
import { W_NETWORK, nearestStreet } from './plan';

export type BuildingKind =
  | 'villa' | 'mansion' | 'wing' | 'apartments' | 'tower' | 'podium' | 'shop'
  | 'restaurant' | 'club' | 'clubhouse' | 'gate-lodge' | 'garage' | 'pool-house'
  | 'orangery' | 'pavilion' | 'mall' | 'spa' | 'stable';

export type RoofKind = 'flat' | 'hip' | 'gable' | 'parapet' | 'terrace' | 'glass' | 'lantern';

export type Door = { point: Point; dir: Point; width: number; kind: 'porch' | 'service' | 'gate' | 'shop' | 'lobby' };

export type Building = {
  id: string;
  name?: string;
  kind: BuildingKind;
  polygon: Point[];
  centre: Point;
  /** Terrace datum the building stands on. */
  base: number;
  height: number;
  storeys: number;
  facade: FacadeId;
  roof: RoofKind;
  vintage: Vintage;
  doors: Door[];
  sign?: { text: string; point: Point; dir: Point };
  interior?: string;
  plotId?: string;
  estateId?: string;
  tint: number;
  /** Upper floors overhanging the slope by this many metres. */
  cantilever?: number;
};

export type GardenKind =
  | 'lawn' | 'formal' | 'drive' | 'orchard' | 'kitchen' | 'tennis' | 'practice'
  | 'forecourt' | 'terrace' | 'plaza' | 'woodland';
export type Garden = { polygon: Point[]; kind: GardenKind; level: number; owner: string; tint: number };

export type WaterKind = 'pool' | 'infinity' | 'pond' | 'fountain';
export type Water = { polygon: Point[]; kind: WaterKind; level: number; owner: string };

export type WallKind = 'stone' | 'hedge' | 'railing' | 'fence';
export type WallRun = { points: Point[]; height: number; kind: WallKind; owner: string; gate?: Point };

export type GateStructure = {
  point: Point;
  dir: Point;
  width: number;
  kind: 'estate' | 'district' | 'house';
  name: string;
  level: number;
  lodge?: boolean;
};

/* ── accumulators ─────────────────────────────────────────────────────────────── */

const buildings: Building[] = [];
const gardens: Garden[] = [];
const waters: Water[] = [];
const walls: WallRun[] = [];
const gates: GateStructure[] = [];
let buildingIndex = 0;

function addBuilding(partial: Omit<Building, 'id' | 'centre'> & { centre?: Point }): Building {
  const centre = partial.centre ?? polygonCentroid(partial.polygon);
  const building: Building = { ...partial, id: `wb-${buildingIndex++}`, centre } as Building;
  buildings.push(building);
  return building;
}
function addGarden(polygon: Point[], kind: GardenKind, level: number, owner: string, tint = 0.5): void {
  if (polygon.length < 3 || polygonArea(polygon) < 12) return;
  gardens.push({ polygon, kind, level, owner, tint });
}
function addWater(polygon: Point[], kind: WaterKind, level: number, owner: string): void {
  if (polygon.length < 3) return;
  waters.push({ polygon, kind, level, owner });
}
function addWall(points: Point[], kind: WallKind, height: number, owner: string, gate?: Point): void {
  if (points.length < 2) return;
  let length = 0;
  for (let i = 0; i + 1 < points.length; i++) length += distance2d(points[i], points[i + 1]);
  if (length < 3) return;
  walls.push({ points, height, kind, owner, gate });
}

/** Orientation of a footprint: the longest edge, and the outward normal facing the street. */
function faceOf(polygon: readonly Point[], toward?: Point): { along: Point; front: Point; centre: Point } {
  const centre = polygonCentroid(polygon);
  const edge = longestEdge(polygon);
  const along = normalize(sub(edge.b, edge.a));
  let front = leftNormal(along);
  if (toward && (toward.x - centre.x) * front.x + (toward.z - centre.z) * front.z < 0) {
    front = { x: -front.x, z: -front.z };
  }
  return { along, front, centre };
}

function doorOn(polygon: readonly Point[], toward: Point | undefined, width: number, kind: Door['kind'], offset = 0): Door {
  const { along, front, centre } = faceOf(polygon, toward);
  const point = { x: centre.x + front.x * 0.4 + along.x * offset, z: centre.z + front.z * 0.4 + along.z * offset };
  // Place the door on the footprint's front edge, not at its centroid.
  let best = point, bestDistance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const mid = { x: (a.x + b.x) / 2 + along.x * offset, z: (a.z + b.z) / 2 + along.z * offset };
    const n = normalize(leftNormal(sub(b, a)));
    const facing = n.x * front.x + n.z * front.z;
    if (facing < 0.6) continue;
    const d = distance2d(mid, point);
    if (d < bestDistance) { bestDistance = d; best = mid; }
  }
  return { point: best, dir: front, width, kind };
}

/* ── landmark estates ─────────────────────────────────────────────────────────── */

const PART_KIND: Record<EstatePart['kind'], BuildingKind | null> = {
  'house': 'mansion', 'wing': 'wing', 'lodge': 'gate-lodge', 'garage': 'garage',
  'pool-house': 'pool-house', 'orangery': 'orangery', 'pavilion': 'pavilion',
  'tower': 'tower', 'block': 'apartments', 'podium': 'podium', 'clubhouse': 'clubhouse',
  'shop-block': 'shop', 'mall': 'mall', 'gatehouse': 'gate-lodge', 'stable': 'stable',
  'spa': 'spa', 'none': null,
};
const PART_ROOF: Partial<Record<EstatePart['kind'], RoofKind>> = {
  'house': 'hip', 'wing': 'hip', 'lodge': 'hip', 'garage': 'flat', 'pool-house': 'flat',
  'orangery': 'glass', 'pavilion': 'hip', 'tower': 'parapet', 'block': 'parapet',
  'podium': 'terrace', 'clubhouse': 'hip', 'shop-block': 'parapet', 'mall': 'glass',
  'gatehouse': 'hip', 'stable': 'gable', 'spa': 'flat',
};

function featurePolygon(polygon: readonly Point[]): Point[] {
  return insetConvex([...polygon], 2);
}

function buildEstate(estate: LandmarkEstate): void {
  const ground = ESTATE_GROUNDS.find(g => g.id === estate.id)!;
  const level = ground.level;
  const random = makeRandom(Math.round(estate.rect.u0 * 3 + estate.rect.v0 * 7));
  const polygons = estatePolygon(estate);

  for (const part of estate.parts) {
    const polygon = ensureCCW(partPolygon(estate, part));
    if (polygon.length < 3) continue;
    /**
     * Each part of an estate is cut into its own terrace. One datum for a whole 400 m
     * property would bury the downhill ranges and leave the uphill ones floating, so the
     * level follows the part and the retaining walls do the rest — which is exactly how a
     * hillside estate is actually built.
     */
    const partLevel = padLevel(polygon);
    const kind = PART_KIND[part.kind];
    if (!kind) {
      // Ground features: gardens, pools, courts, forecourts and terraces.
      const feature = featurePolygon(polygon);
      const level = partLevel;
      switch (part.feature) {
        case 'pool':
          addWater(insetConvex(feature, Math.min(6, Math.sqrt(polygonArea(feature)) * 0.12)), 'pool', level, estate.id);
          addGarden(insetConvex(feature, 1.5), 'terrace', level, estate.id, 0.35);
          break;
        case 'infinity-pool':
          addWater(insetConvex(feature, Math.min(5, Math.sqrt(polygonArea(feature)) * 0.1)), 'infinity', level, estate.id);
          addGarden(insetConvex(feature, 1.2), 'terrace', level, estate.id, 0.3);
          break;
        case 'fountain':
          addWater(regularPolygon(polygonCentroid(feature), Math.min(9, Math.sqrt(polygonArea(feature)) * 0.16), 12), 'fountain', level, estate.id);
          addGarden(feature, 'plaza', level, estate.id, 0.5);
          break;
        case 'tennis':
          addGarden(feature, 'tennis', level, estate.id, 0.4);
          break;
        case 'practice-ground':
          addGarden(feature, 'practice', level, estate.id, 0.6);
          break;
        case 'formal-garden':
          addGarden(feature, 'formal', level, estate.id, 0.5);
          break;
        case 'kitchen-garden':
          addGarden(feature, 'kitchen', level, estate.id, 0.5);
          break;
        case 'orchard':
          addGarden(feature, 'orchard', level, estate.id, 0.5);
          break;
        case 'drive':
          addGarden(feature, 'drive', level, estate.id, 0.4);
          break;
        case 'forecourt':
          addGarden(feature, 'forecourt', level, estate.id, 0.4);
          break;
        case 'roof-terrace':
          addGarden(feature, 'terrace', level, estate.id, 0.4);
          break;
        default:
          addGarden(feature, 'lawn', level, estate.id, 0.5);
      }
      continue;
    }
    const facade = part.facade ?? facadeForVintage(estate.vintage, random());
    const height = part.height ?? 10;
    const storeys = Math.max(1, Math.round(height / 3.6));
    const frontage = nearestStreet(polygonCentroid(polygon).x, polygonCentroid(polygon).z);
    const building = addBuilding({
      name: part.name, kind, polygon,
      base: partLevel, height, storeys, facade,
      roof: PART_ROOF[part.kind] ?? 'flat',
      vintage: estate.vintage,
      doors: [doorOn(polygon, frontage?.point, kind === 'shop' ? 6 : 3.4,
        kind === 'shop' || kind === 'mall' ? 'shop' : kind === 'podium' ? 'lobby' : 'porch')],
      interior: part.interior, estateId: estate.id, tint: random(),
      cantilever: part.cantilever,
    });
    if (part.kind === 'shop-block' || part.kind === 'mall') {
      const name = SHOPS[Math.floor(random() * SHOPS.length)];
      building.sign = { text: name, point: building.doors[0].point, dir: building.doors[0].dir };
    }
    if (part.interior === 'the-orangery') {
      building.name = RESTAURANTS[0];
      building.sign = { text: RESTAURANTS[0], point: building.doors[0].point, dir: building.doors[0].dir };
    }
    if (estate.kind === 'hotel' && part.kind === 'podium') {
      building.name = HOTEL_NAMES[0];
      building.sign = { text: HOTEL_NAMES[0], point: building.doors[0].point, dir: building.doors[0].dir };
    }
  }

  // Under everything else the property is laid to lawn, so no ground is left raw.
  const inner = insetConvex(polygons, 8);
  if (inner.length >= 3) addGarden(inner, 'lawn', padLevel(inner), estate.id, 0.55);

  if (estate.walled) {
    const wall = insetConvex(polygons, 3);
    const entrance = estate.parts.find(p => p.kind === 'gatehouse');
    let gatePoint: Point | undefined;
    if (entrance) {
      gatePoint = polygonCentroid(partPolygon(estate, entrance));
    }
    addWall(wall, 'stone', 2.6, estate.id, gatePoint);
    if (gatePoint) {
      const frontage = nearestStreet(gatePoint.x, gatePoint.z);
      gates.push({
        point: gatePoint, dir: frontage ? normalize(sub(gatePoint, frontage.point)) : { x: 1, z: 0 },
        width: 9, kind: 'estate', name: GATE_NAMES[estate.zone] ?? 'Estate Gate', level, lodge: true,
      });
    }
  }
}

/* ── plot buildings ───────────────────────────────────────────────────────────── */

const SIGN_BY_KIND: Partial<Record<Plot['use'], readonly string[]>> = {
  'shops': SHOPS, 'restaurant': RESTAURANTS, 'club': ['The Vantage Club', 'Marchmont Racquet Club', 'Belvedere Swimming Club', 'The Lantern Room'],
};

function buildPlot(plot: Plot): void {
  if (plot.use === 'garden' || plot.use === 'parkland') {
    addGarden(insetConvex(plot.polygon, 4), plot.use === 'parkland' ? 'woodland' : 'lawn', plot.level, plot.id, plot.tint);
    if (plot.use === 'garden' && plot.tint > 0.72) {
      addGarden(insetConvex(plot.polygon, 14), 'formal', plot.level, plot.id, plot.tint);
    }
    return;
  }
  if (plot.use === 'viewpoint') {
    addGarden(insetConvex(plot.polygon, 6), 'terrace', plot.level, plot.id, plot.tint);
    return;
  }
  const random = makeRandom(Math.round(plot.centre.x * 3 + plot.centre.z * 5));
  const frontage = plot.frontage?.point ?? nearestStreet(plot.centre.x, plot.centre.z)?.point;
  const toward = frontage ?? { x: plot.centre.x + 1, z: plot.centre.z };
  const facade = facadeForVintage(plot.vintage, plot.tint);

  // The footprint is a rectangle set back inside the plot, facing its frontage.
  const { along, front } = faceOf(plot.polygon, toward);
  const extent = extentAlong(plot.polygon, plot.centre, along);
  const across = extentAlong(plot.polygon, plot.centre, front);
  const span = extent.max - extent.min, depth = across.max - across.min;

  type Spec = { w: number; d: number; h: number; kind: BuildingKind; roof: RoofKind; pool: number; garage: number; wall: WallKind };
  const spec: Spec = (() => {
    switch (plot.use) {
      case 'mansion':
        return { w: Math.min(38, span * 0.46), d: Math.min(26, depth * 0.44), h: 10 + plot.tint * 6, kind: 'mansion', roof: 'hip', pool: .7, garage: 1, wall: 'stone' };
      case 'villa':
        return { w: Math.min(23, span * 0.34), d: Math.min(17, depth * 0.32), h: 6.6 + plot.tint * 4.4, kind: 'villa', roof: plot.vintage === 'modern' ? 'flat' : 'hip', pool: .38, garage: .8, wall: plot.tint > .55 ? 'hedge' : 'stone' };
      case 'apartments':
        return { w: Math.min(34, span * 0.5), d: Math.min(22, depth * 0.44), h: 18 + plot.tint * 16, kind: 'apartments', roof: 'parapet', pool: .3, garage: .6, wall: 'railing' };
      case 'shops':
        return { w: Math.min(22, span * 0.42), d: Math.min(15, depth * 0.36), h: 8 + plot.tint * 5, kind: 'shop', roof: 'parapet', pool: 0, garage: 0, wall: 'railing' };
      case 'restaurant':
        return { w: Math.min(24, span * 0.42), d: Math.min(16, depth * 0.36), h: 7 + plot.tint * 5, kind: 'restaurant', roof: plot.tint > .5 ? 'glass' : 'hip', pool: 0, garage: 0, wall: 'hedge' };
      case 'club':
        return { w: Math.min(28, span * 0.44), d: Math.min(19, depth * 0.4), h: 9 + plot.tint * 5, kind: 'club', roof: 'hip', pool: .5, garage: 0, wall: 'stone' };
      case 'gate-lodge':
        return { w: Math.min(12, span * 0.28), d: Math.min(10, depth * 0.26), h: 5.6 + plot.tint * 2.4, kind: 'gate-lodge', roof: 'hip', pool: 0, garage: 0, wall: 'stone' };
      default:
        return { w: Math.min(18, span * 0.3), d: Math.min(14, depth * 0.3), h: 7, kind: 'villa', roof: 'hip', pool: .2, garage: .5, wall: 'hedge' };
    }
  })();
  if (spec.w < ESTATE_LIMITS.minBuildingWidth || spec.d < ESTATE_LIMITS.minBuildingDepth) {
    addGarden(insetConvex(plot.polygon, 4), 'lawn', plot.level, plot.id, plot.tint);
    return;
  }
  // Set the house back from the road and toward the good ground on its own plot.
  const setback = Math.min(depth * 0.22, 26);
  const centre = {
    x: plot.centre.x + front.x * (depth * 0.06) + along.x * (random() - 0.5) * Math.max(0, span - spec.w) * 0.3,
    z: plot.centre.z + front.z * (depth * 0.06) + along.z * (random() - 0.5) * Math.max(0, span - spec.w) * 0.3,
  };
  void setback;
  const polygon = rectAt(centre, along, spec.w, spec.d);
  const height = spec.h;
  const storeys = Math.max(1, Math.round(height / 3.4));
  const name = plot.use === 'mansion' || plot.use === 'villa'
    ? `${HOUSE_NAMES[Math.floor(plot.tint * HOUSE_NAMES.length) % HOUSE_NAMES.length]}${plot.use === 'mansion' ? ' House' : ''}`
    : undefined;
  const building = addBuilding({
    name, kind: spec.kind, polygon,
    base: plot.level, height, storeys, facade, roof: spec.roof, vintage: plot.vintage,
    doors: [
      doorOn(polygon, toward, spec.kind === 'shop' || spec.kind === 'restaurant' ? 5 : 2.6,
        spec.kind === 'shop' || spec.kind === 'restaurant' ? 'shop' : spec.kind === 'apartments' ? 'lobby' : 'porch'),
    ],
    plotId: plot.id, tint: plot.tint,
  });
  if (spec.kind === 'shop' || spec.kind === 'restaurant' || spec.kind === 'club') {
    const pool = SIGN_BY_KIND[plot.use] ?? SHOPS;
    const text = pool[Math.floor(plot.tint * pool.length) % pool.length];
    building.sign = { text, point: building.doors[0].point, dir: building.doors[0].dir };
  }

  // Ground: the garden is the remainder of the plot, and it is laid before the drive.
  const gardenPoly = insetConvex(plot.polygon, 3);
  if (gardenPoly.length >= 3) {
    addGarden(gardenPoly, plot.zone === 'crown' || plot.zone === 'larchmere' ? 'lawn' : 'lawn', plot.level, plot.id, plot.tint);
  }
  // A drive from the frontage to the front door.
  if (frontage) {
    const door = building.doors[0];
    const a = frontage, b = { x: door.point.x + door.dir.x * 5, z: door.point.z + door.dir.z * 5 };
    const dir = normalize(sub(b, a));
    const n = leftNormal(dir);
    const drive: Point[] = [
      { x: a.x - n.x * 2.6, z: a.z - n.z * 2.6 }, { x: b.x - n.x * 2.6, z: b.z - n.z * 2.6 },
      { x: b.x + n.x * 2.6, z: b.z + n.z * 2.6 }, { x: a.x + n.x * 2.6, z: a.z + n.z * 2.6 },
    ];
    addGarden(drive, 'drive', plot.level, plot.id, 0.4);
    // Forecourt in front of the door.
    addGarden(rectAt({ x: b.x + dir.x * 3, z: b.z + dir.z * 3 }, dir, 12, 7), 'forecourt', plot.level, plot.id, 0.4);
  }
  // A pool on the downhill side of the bigger houses.
  if (random() < spec.pool && spec.w > 15) {
    const back = { x: centre.x - front.x * (spec.d * 0.5 + 9), z: centre.z - front.z * (spec.d * 0.5 + 9) };
    if (pointInPolygon(back.x, back.z, plot.polygon)) {
      addWater(rectAt(back, along, Math.min(16, spec.w * 0.8), 6), plot.vintage === 'modern' ? 'infinity' : 'pool', plot.level, plot.id);
      addGarden(rectAt(back, along, Math.min(24, spec.w * 1.2), 14), 'terrace', plot.level, plot.id, 0.35);
    }
  }
  // Garage or coach house behind the frontage line.
  if (random() < spec.garage && span > 30) {
    const gCentre = { x: centre.x + along.x * (spec.w * 0.5 + 7), z: centre.z + along.z * (spec.w * 0.5 + 7) };
    if (pointInPolygon(gCentre.x, gCentre.z, plot.polygon)) {
      addBuilding({
        kind: 'garage', polygon: rectAt(gCentre, along, 7.5, 6),
        base: plot.level, height: 4.2, storeys: 1, facade, roof: 'flat', vintage: plot.vintage,
        doors: [doorOn(rectAt(gCentre, along, 7.5, 6), toward, 4, 'service')],
        plotId: plot.id, tint: plot.tint,
      });
    }
  }
  // Boundary wall or hedge along the frontage, with a gap for the gate.
  if (frontage && plot.frontage && spec.wall !== 'railing') {
    for (const line of wallLineAlongStreet(plot, 1.2)) {
      addWall(line, spec.wall, spec.wall === 'hedge' ? 1.7 : 2.1, plot.id, frontage);
    }
  }
  if (plot.use === 'mansion' && frontage) {
    gates.push({
      point: frontage, dir: normalize(sub(plot.centre, frontage)), width: 7,
      kind: 'house', name: name ? `${name} Gate` : 'House Gate', level: plot.level, lodge: false,
    });
  }
  if (plot.use === 'gate-lodge' && frontage) {
    gates.push({
      point: frontage, dir: normalize(sub(plot.centre, frontage)), width: 8,
      kind: 'estate', name: GATE_NAMES[plot.zone] ?? 'Estate Gate', level: plot.level, lodge: true,
    });
  }
}

/**
 * The wall a plot keeps along its frontage: every edge of the plot whose outward normal
 * faces the road it opens onto, inset a metre so the wall stands inside its own ground.
 * Building it from the plot's own edges means the wall always exists and always follows
 * the boundary the street corridor was clipped to.
 */
function wallLineAlongStreet(plot: Plot, inset: number): Point[][] {
  if (!plot.frontage) return [];
  const toward = plot.frontage.point;
  const centre = polygonCentroid(plot.polygon);
  const runs: Point[][] = [];
  let run: Point[] = [];
  let lastIndex = -2;
  for (let i = 0; i < plot.polygon.length; i++) {
    const a = plot.polygon[i], b = plot.polygon[(i + 1) % plot.polygon.length];
    const outward = normalize(leftNormal(sub(b, a)));
    // The polygon may wind either way; an edge is a frontage when its outward normal
    // points at the road and away from the plot centre.
    const toCentre = sub(centre, a);
    const facesOut = outward.x * toCentre.x + outward.z * toCentre.z < 0;
    const n = facesOut ? outward : { x: -outward.x, z: -outward.z };
    const toRoad = sub(toward, a);
    const qualifies = n.x * toRoad.x + n.z * toRoad.z >= 0 &&
      distance2d(a, toward) <= 260 && distance2d(b, toward) <= 260;
    if (!qualifies) continue;
    // Consecutive qualifying edges of the polygon are already contiguous.
    if (i !== lastIndex + 1 && run.length) { runs.push(run); run = []; }
    if (!run.length) run.push({ x: a.x - n.x * inset, z: a.z - n.z * inset });
    run.push({ x: b.x - n.x * inset, z: b.z - n.z * inset });
    lastIndex = i;
  }
  if (run.length) runs.push(run);
  // A wall that wrapped the first corner joins the run at the other end of the list.
  if (runs.length >= 2) {
    const first = runs[0], last = runs[runs.length - 1];
    if (distance2d(last[last.length - 1], first[0]) < 1.5) {
      runs[0] = [...last, ...first];
      runs.pop();
    }
  }
  return runs.filter(r => r.length >= 2);
}

/* ── district gates ───────────────────────────────────────────────────────────── */

function buildDistrictGates(): void {
  for (const junction of W_NETWORK.gateways) {
    const street = W_NETWORK.streetById.get(junction.streets[0]);
    const dir = junction.arms[0] ? junction.arms[0].dir : { x: 1, z: 0 };
    gates.push({
      point: junction.point, dir: { x: -dir.x, z: -dir.z },
      width: street ? street.width : 12,
      kind: 'district', name: junction.label ?? 'District Gate',
      level: junction.y, lodge: false,
    });
  }
  // Estate gates where a compound lane meets a through road.
  for (const junction of W_NETWORK.estateGates) {
    const lane = junction.streets.map(id => W_NETWORK.streetById.get(id)!).find(s => s && s.kind === 'lane');
    const estate = lane?.estate;
    gates.push({
      point: junction.point,
      dir: junction.arms[0] ? junction.arms[0].dir : { x: 1, z: 0 },
      width: lane ? lane.width + 2 : 10,
      kind: 'estate',
      name: estate ? (GATE_NAMES[estate as keyof typeof GATE_NAMES] ?? 'Estate Gate') : 'Estate Gate',
      level: junction.y, lodge: true,
    });
  }
}

/* ── scenic viewpoints ────────────────────────────────────────────────────────── */

function buildViewpoints(): void {
  for (const junction of W_NETWORK.viewpoints) {
    const street = W_NETWORK.streetById.get(junction.streets[0]);
    const dir = junction.arms[0]?.dir ?? { x: 1, z: 0 };
    const n = leftNormal(dir);
    const centre = { x: junction.point.x - dir.x * 16, z: junction.point.z - dir.z * 16 };
    const level = hillGround(centre.x, centre.z);
    addGarden(rectAt(centre, n, 26, 18), 'terrace', level, 'viewpoint', 0.4);
    // The balustrade runs along the outward edge, facing the view.
    const outward = { x: -n.x, z: -n.z };
    const edge = { x: centre.x + outward.x * 9, z: centre.z + outward.z * 9 };
    addWall([
      { x: edge.x - n.x * 13, z: edge.z - n.z * 13 },
      { x: edge.x + n.x * 13, z: edge.z + n.z * 13 },
    ], 'railing', 1.15, 'viewpoint');
    void street;
  }
}

/* ── run ──────────────────────────────────────────────────────────────────────── */

for (const estate of LANDMARK_ESTATES) buildEstate(estate);
for (const plot of PLOTS) buildPlot(plot);
buildDistrictGates();
buildViewpoints();

export const W_BUILDINGS: readonly Building[] = buildings;
export const W_GARDENS: readonly Garden[] = gardens;
export const W_WATERS: readonly Water[] = waters;
export const W_WALLS: readonly WallRun[] = walls;
export const W_GATES: readonly GateStructure[] = gates;
export const W_INTERIOR_BUILDINGS: readonly Building[] = buildings.filter(b => b.interior);

export const wSummary = (() => {
  const byKind: Record<string, number> = {};
  const byFacade: Record<string, number> = {};
  const byVintage: Record<string, number> = {};
  let tallest = 0, sumHeight = 0;
  for (const b of buildings) {
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
    byFacade[b.facade] = (byFacade[b.facade] ?? 0) + 1;
    byVintage[b.vintage] = (byVintage[b.vintage] ?? 0) + 1;
    tallest = Math.max(tallest, b.height);
    sumHeight += b.height;
  }
  const waterByKind: Record<string, number> = {};
  let poolArea = 0;
  for (const w of waters) {
    waterByKind[w.kind] = (waterByKind[w.kind] ?? 0) + 1;
    poolArea += polygonArea(w.polygon);
  }
  const gardenByKind: Record<string, number> = {};
  let gardenArea = 0;
  for (const g of gardens) {
    gardenByKind[g.kind] = (gardenByKind[g.kind] ?? 0) + 1;
    gardenArea += polygonArea(g.polygon);
  }
  const wallByKind: Record<string, number> = {};
  let wallKm = 0;
  for (const w of walls) {
    wallByKind[w.kind] = (wallByKind[w.kind] ?? 0) + 1;
    for (let i = 0; i + 1 < w.points.length; i++) wallKm += distance2d(w.points[i], w.points[i + 1]);
  }
  const footprint = buildings.reduce((sum, b) => sum + polygonArea(b.polygon), 0);
  return {
    buildings: buildings.length,
    interiors: buildings.filter(b => b.interior).length,
    byKind, byFacade, byVintage,
    tallest: Math.round(tallest),
    meanHeight: buildings.length ? Math.round(sumHeight / buildings.length * 10) / 10 : 0,
    waters: waters.length, waterByKind, poolHa: Math.round(poolArea / 10000 * 100) / 100,
    gardens: gardens.length, gardenByKind, gardenHa: Math.round(gardenArea / 10000 * 10) / 10,
    walls: walls.length, wallByKind, wallKm: Math.round(wallKm / 100) / 10,
    gates: gates.length,
    gatesByKind: gates.reduce<Record<string, number>>((acc, g) => { acc[g.kind] = (acc[g.kind] ?? 0) + 1; return acc; }, {}),
    footprintHa: Math.round(footprint / 10000 * 10) / 10,
    landmarks: LANDMARK_ESTATES.length,
  };
})();

export function buildingsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Building[] {
  return buildings.filter(b => {
    const box = polygonBounds(b.polygon);
    return box.maxX >= bounds.minX && box.minX <= bounds.maxX && box.maxZ >= bounds.minZ && box.minZ <= bounds.maxZ;
  });
}
export function gardensInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Garden[] {
  return gardens.filter(g => {
    const box = polygonBounds(g.polygon);
    return box.maxX >= bounds.minX && box.minX <= bounds.maxX && box.maxZ >= bounds.minZ && box.minZ <= bounds.maxZ;
  });
}
export function watersInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Water[] {
  return waters.filter(w => {
    const box = polygonBounds(w.polygon);
    return box.maxX >= bounds.minX && box.minX <= bounds.maxX && box.maxZ >= bounds.minZ && box.minZ <= bounds.maxZ;
  });
}

/** Retaining-wall height around a terrace: how far the natural ground falls below it. */
export function terraceFill(polygon: readonly Point[], level: number): { point: Point; depth: number }[] {
  const out: { point: Point; depth: number }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(length / 9));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      out.push({ point: q, depth: level - terrainHeight(q.x, q.z) });
    }
  }
  return out;
}
export { add, scale };
export { zoneAt, vintageAt, pointToSegment };
