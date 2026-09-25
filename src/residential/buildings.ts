/**
 * Buildings of the Residential Valley: how a plot becomes a house, a terrace, a block of
 * flats or a parade of shops.
 *
 * Heights follow the use and the neighbourhood's era — two storeys for the semis, two to
 * three for the terraces, three to five for the flats, two over shops on Market Row.
 * Every volume carries its own cladding so the valley reads as four generations of
 * ordinary building rather than one texture repeated.
 */
import type { Point } from '../world/data';
import {
  FACADES, facadeForVintage, facade, partPolygon,
  type FacadeId, type LandmarkSite, type SitePart, LANDMARK_SITES,
} from './identity';
import { RES_LIMITS, hash01, makeRandom, resGround, localRelief, type HoodId, type Vintage } from './frame';
import { PLOTS, SITE_GROUNDS, type Plot, type PlotUse } from './sites';
import {
  distance2d, ensureCCW, insetConvex, normalize, polygonArea, polygonCentroid, sub,
  polygonBounds, type Bounds,
} from '../city/geometry2d';

export type RoofKind = 'gable' | 'hip' | 'flat' | 'parapet' | 'mansard' | 'mono';
export type BuildingKind =
  | 'house'        // detached or semi
  | 'townhouse'    // one unit of a terrace row
  | 'apartment'    // ordinary block of flats
  | 'mixed'        // shops below, flats above
  | 'shop'         // single shop
  | 'store'        // supermarket / filling-station shop
  | 'hall'         // community hall
  | 'school'       // school range
  | 'flat-block'   // the landmark postwar slabs
  | 'pavilion'     // park pavilion / kiosk
  | 'garage'       // tyre bay / bin store / shed
  | 'canopy';      // filling-station canopy

export type Door = { point: Point; dir: Point; width: number; kind: 'front' | 'shop' | 'communal' | 'service' };
export type ShopUnit = {
  /** Frontage run along the street wall. */
  a: Point; b: Point;
  sign: string;
  interior?: string;
  interiorReady?: boolean;
};

export type Building = {
  id: string;
  name?: string;
  kind: BuildingKind;
  use: PlotUse | 'landmark';
  hood: HoodId;
  vintage: Vintage;
  footprint: Point[];
  height: number;
  storeys: number;
  facade: FacadeId;
  roof: RoofKind;
  /** Ridge direction for pitched roofs (unit vector in plan). */
  ridge?: Point;
  door: Door;
  shopUnits: ShopUnit[];
  /** Balcony stacks for flats. */
  balconies: number;
  /** Chimneys for houses and terraces. */
  chimneys: number;
  /** Front porch for semis. */
  porch: boolean;
  /** Party walls shared with neighbours in a terrace row. */
  rowId?: string;
  rowSlot?: number;
  interior?: string;
  interiorReady?: boolean;
  landmark?: string;
  tint: number;
  year: number;
  ground: number;
  centre: Point;
  clutter: number;
};

/* ── ordinary buildings ───────────────────────────────────────────────────────── */

const HEIGHT_BY_USE: Record<PlotUse, [number, number]> = {
  house: [5.4, 7.2], townhouse: [6.4, 8.6], apartment: [9.5, 17.5],
  mixed: [8.5, 11], shop: [4.2, 6.2], yard: [3, 4.2],
};
const ROOF_BY_USE: Record<PlotUse, RoofKind[]> = {
  house: ['gable', 'hip', 'gable', 'mono'],
  townhouse: ['gable', 'gable', 'mansard'],
  apartment: ['flat', 'parapet', 'flat'],
  mixed: ['parapet', 'mansard', 'flat'],
  shop: ['parapet', 'flat', 'mansard'],
  yard: ['mono', 'flat'],
};
const STOREY_HEIGHT: Record<Vintage, number> = { victorian: 3.05, interwar: 2.9, postwar: 2.85, nineties: 2.75 };

const SHOPS_POOL_BY_HOOD: Record<string, string[]> = {
  millgate: ['Marlow & Sons', 'The Hardware Box', 'Ferndale Barbers', 'Paper Lane News', 'The Wool Room', 'Kavanagh Shoes'],
  default: ['Greenfield Flowers', 'Valley Pets', 'The Key Cutters', 'Toy Box'],
};

function shopSign(use: PlotUse, hood: HoodId, seed: number): string {
  const pool = SHOPS_POOL_BY_HOOD[hood] ?? SHOPS_POOL_BY_HOOD.default;
  const grocers = ['Valley Foods', 'Freshmart Express', 'Brook Lane Grocers', 'Sunrise Mini Market'];
  const food = ['The Copper Kettle', 'Saffron & Sage', 'Basil & Vine', 'The Valley Diner', 'Nonna Piero’s', 'Café Millgate'];
  const services = ['Marlow’s Pharmacy', 'Spin & Dry', 'Valley Chemist', 'The Valley Launderette', 'Valley Dental', 'The Print Shop'];
  const roll = hash01(seed, use.length, 31);
  const list = roll < 0.2 ? grocers : roll < 0.5 ? food : roll < 0.72 ? services : pool;
  return list[Math.floor(hash01(seed, 7, 17) * list.length) % list.length];
}

function footprintFor(plot: Plot): Point[] {
  // Terraces build to the line with no gap; houses and flats pull back for a drive.
  const inset = plot.use === 'townhouse' ? 0.5 : plot.use === 'shop' || plot.use === 'mixed' ? 1 : plot.use === 'yard' ? 1.2 : plot.setback * 0.55;
  const poly = insetConvex(plot.polygon, inset);
  return poly.length >= 3 ? poly : plot.polygon;
}

function doorFor(plot: Plot, footprint: readonly Point[]): Door {
  const { a, b, normal } = plot.frontage;
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  // Push the door onto the facade that faces the street.
  const centre = polygonCentroid(footprint as Point[]);
  const dir = normalize(sub(mid, centre));
  const edge = footprint.reduce((best, p) => (distance2d(p, mid) < distance2d(best, mid) ? p : best), footprint[0]);
  const kind: Door['kind'] =
    plot.use === 'shop' || plot.use === 'mixed' ? 'shop'
      : plot.use === 'apartment' ? 'communal'
        : plot.use === 'yard' ? 'service' : 'front';
  void normal; void b;
  return { point: { x: edge.x, z: edge.z }, dir, width: kind === 'shop' ? 2.4 : 1.1, kind };
}

function shopUnitsFor(plot: Plot, footprint: readonly Point[]): ShopUnit[] {
  if (plot.use !== 'shop' && plot.use !== 'mixed') return [];
  const { a, b } = plot.frontage;
  const units: ShopUnit[] = [];
  const width = distance2d(a, b);
  const count = Math.max(1, Math.round(width / (plot.use === 'shop' ? 9 : 7)));
  for (let i = 0; i < count; i++) {
    const t0 = i / count, t1 = (i + 1) / count;
    const ua = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
    const ub = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
    const seed = Math.round(ua.x * 3 + ua.z * 7 + i * 31);
    units.push({ a: ua, b: ub, sign: shopSign(plot.use, plot.hood, seed) });
  }
  return units;
}

function buildOrdinary(plot: Plot, random: () => number): Building {
  const footprint = ensureCCW(footprintFor(plot));
  const centre = polygonCentroid(footprint);
  const [lo, hi] = HEIGHT_BY_USE[plot.use];
  const roll = hash01(Math.round(centre.x), Math.round(centre.z), 5);
  let height = lo + (hi - lo) * roll;
  const storey = STOREY_HEIGHT[plot.vintage];
  // Postwar flats vary floor counts block by block; houses stick to two.
  if (plot.use === 'apartment') {
    const storeys = 3 + Math.floor(hash01(Math.round(centre.x), Math.round(centre.z), 9) * 3);
    height = storeys * storey + 1.2;
  } else if (plot.use === 'house' || plot.use === 'townhouse') {
    const storeys = plot.use === 'townhouse' ? (plot.vintage === 'victorian' ? 2 : 3) : (roll < 0.5 ? 2 : 1);
    height = storeys * storey + 1.1;
  }
  height = Math.max(3, Math.min(RES_LIMITS.maxOrdinaryHeight, height));
  const facadeId = facadeForVintage(plot.vintage, hash01(Math.round(centre.x), Math.round(centre.z), 23));
  const roofs = ROOF_BY_USE[plot.use];
  const roof = roofs[Math.floor(hash01(Math.round(centre.x), Math.round(centre.z), 29) * roofs.length) % roofs.length];
  const storeys = Math.max(1, Math.round((height - 1) / storey));
  return {
    id: `b-${plot.id}`,
    kind: plot.use === 'yard' ? 'garage' : plot.use === 'shop' ? 'shop' : plot.use === 'mixed' ? 'mixed'
      : plot.use === 'apartment' ? 'apartment' : plot.use === 'townhouse' ? 'townhouse' : 'house',
    use: plot.use,
    hood: plot.hood,
    vintage: plot.vintage,
    footprint,
    height,
    storeys,
    facade: facadeId,
    roof,
    ridge: normalize(sub(footprint[1] ?? footprint[0], footprint[0])),
    door: doorFor(plot, footprint),
    shopUnits: shopUnitsFor(plot, footprint),
    balconies: plot.use === 'apartment' ? storeys : 0,
    chimneys: plot.use === 'house' || plot.use === 'townhouse' ? (hash01(Math.round(centre.x), 3, 7) < 0.7 ? 1 : 2) : 0,
    porch: plot.use === 'house' && hash01(Math.round(centre.x), Math.round(centre.z), 41) < 0.65,
    rowId: plot.rowId,
    rowSlot: plot.rowSlot,
    tint: hash01(Math.round(centre.x), Math.round(centre.z), 43),
    year: plot.vintage === 'victorian' ? 1868 + Math.floor(hash01(Math.round(centre.x), 1, 47) * 48)
      : plot.vintage === 'interwar' ? 1926 + Math.floor(hash01(Math.round(centre.x), 2, 47) * 18)
        : plot.vintage === 'postwar' ? 1955 + Math.floor(hash01(Math.round(centre.x), 3, 47) * 28)
          : 1991 + Math.floor(hash01(Math.round(centre.x), 4, 47) * 14),
    ground: resGround(centre.x, centre.z),
    centre,
    clutter: plot.use === 'apartment' ? 0.8 : 0.35,
  };
}

/* ── landmark buildings ───────────────────────────────────────────────────────── */

function landmarkBuilding(site: LandmarkSite, part: SitePart, polygon: Point[], random: () => number): Building | null {
  const poly = ensureCCW(polygon);
  if (poly.length < 3 || polygonArea(poly) < 40) return null;
  const centre = polygonCentroid(poly);
  const kind: BuildingKind =
    part.kind === 'flat-block' ? 'flat-block'
      : part.kind === 'hall' ? 'hall'
        : part.kind === 'school' ? 'school'
          : part.kind === 'shop-row' ? 'mixed'
            : part.kind === 'store' ? 'store'
              : part.kind === 'pavilion' || part.kind === 'kiosk' ? 'pavilion'
                : part.kind === 'canopy' ? 'canopy'
                  : part.kind === 'garage' ? 'garage'
                    : part.kind === 'terrace-row' ? 'townhouse' : 'apartment';
  const height = part.height ?? (kind === 'flat-block' ? 15 : 7);
  const facadeId = part.facade ?? facadeForVintage(site.vintage, hash01(part.id.length, site.id.length, 3));
  const roof: RoofKind =
    kind === 'flat-block' ? 'flat'
      : kind === 'hall' ? 'gable'
        : kind === 'school' ? 'mono'
          : kind === 'canopy' ? 'flat'
            : kind === 'pavilion' ? 'hip' : 'parapet';
  const frontageEdge = poly.reduce((best, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return distance2d(p, q) > distance2d(best.a, best.b) ? { a: p, b: q } : best;
  }, { a: poly[0], b: poly[1] ?? poly[0] });
  const doorDir = normalize(sub(polygonCentroid(poly), { x: (frontageEdge.a.x + frontageEdge.b.x) / 2, z: (frontageEdge.a.z + frontageEdge.b.z) / 2 }));
  const shopUnits: ShopUnit[] = kind === 'mixed' || kind === 'store'
    ? shopfrontUnits(frontageEdge.a, frontageEdge.b, site, part)
    : [];
  return {
    id: `lm-${site.id}-${part.id}`,
    name: part.name,
    kind,
    use: 'landmark',
    hood: site.zone,
    vintage: site.vintage,
    footprint: poly,
    height,
    storeys: Math.max(1, Math.round(height / 3)),
    facade: facadeId,
    roof,
    ridge: normalize(sub(frontageEdge.b, frontageEdge.a)),
    door: {
      point: { x: (frontageEdge.a.x + frontageEdge.b.x) / 2, z: (frontageEdge.a.z + frontageEdge.b.z) / 2 },
      dir: doorDir,
      width: kind === 'hall' || kind === 'school' || kind === 'store' ? 3 : 1.8,
      kind: kind === 'mixed' || kind === 'store' ? 'shop' : kind === 'flat-block' ? 'communal' : 'front',
    },
    shopUnits,
    balconies: kind === 'flat-block' ? Math.round(height / 3) : 0,
    chimneys: kind === 'hall' ? 2 : 0,
    porch: false,
    interior: part.interior,
    interiorReady: part.interiorReady,
    landmark: site.id,
    tint: 0.5,
    year: site.vintage === 'victorian' ? 1875 : site.vintage === 'interwar' ? 1934 : site.vintage === 'postwar' ? 1966 : 1996,
    ground: resGround(centre.x, centre.z),
    centre,
    clutter: 0.6,
  };
}

/** Market Row's shop rows divide into units along the frontage. */
function shopfrontUnits(a: Point, b: Point, site: LandmarkSite, part: SitePart): ShopUnit[] {
  const width = distance2d(a, b);
  const count = Math.max(2, Math.round(width / 8));
  const units: ShopUnit[] = [];
  const pool = ['Marlow & Sons', 'The Hardware Box', 'Ferndale Barbers', 'Paper Lane News', 'The Wool Room',
    'Kavanagh Shoes', 'Rowe & Daughter Books', 'The Music Chest', 'Valley Pets', 'Greenfield Flowers',
    'Marlow’s Pharmacy', 'Spin & Dry', 'The Copper Kettle', 'Saffron & Sage', 'Café Millgate', 'Valley Launderette'];
  for (let i = 0; i < count; i++) {
    const t0 = i / count, t1 = (i + 1) / count;
    const ua = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
    const ub = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
    const seed = Math.round(ua.x + ua.z * 5 + i * 97 + part.id.length);
    const interiorReady = site.id === 'market-row' && hash01(seed, 3, 13) < 0.2;
    units.push({
      a: ua, b: ub,
      sign: pool[Math.floor(hash01(seed, 5, 7) * pool.length) % pool.length],
      interiorReady,
    });
  }
  return units;
}

/* ── assembly ─────────────────────────────────────────────────────────────────── */

export const RES_BUILDINGS: readonly Building[] = (() => {
  const random = makeRandom(0x33b0a);
  const buildings: Building[] = [];
  for (const plot of PLOTS) {
    if (plot.use === 'yard' && hash01(Math.round(plot.frontage.a.x), Math.round(plot.frontage.a.z), 53) > 0.4) continue;
    buildings.push(buildOrdinary(plot, random));
  }
  for (const { site, parts } of SITE_GROUNDS) {
    for (const { part, polygon } of parts) {
      const built = landmarkBuilding(site, part, polygon, random);
      if (built) buildings.push(built);
    }
  }
  // Landmark yard pieces (fountain surrounds etc.) that carried no polygon earlier.
  for (const site of LANDMARK_SITES) {
    for (const part of site.parts) {
      if (part.kind === 'none') continue;
      if (buildings.some(b => b.id === `lm-${site.id}-${part.id}`)) continue;
      const polygon = partPolygon(site, part);
      const built = landmarkBuilding(site, part, polygon, random);
      if (built) buildings.push(built);
    }
  }
  return buildings;
})();

export const RES_INTERIOR_BUILDINGS: readonly Building[] = RES_BUILDINGS.filter(b => b.interior);
export const RES_INTERIOR_READY: readonly Building[] = RES_BUILDINGS.filter(b => b.interiorReady && !b.interior);

export function buildingsInBounds(bounds: Bounds): Building[] {
  return RES_BUILDINGS.filter(b => {
    const pb = polygonBounds(b.footprint);
    return pb.maxX >= bounds.minX - 20 && pb.minX <= bounds.maxX + 20 && pb.maxZ >= bounds.minZ - 20 && pb.minZ <= bounds.maxZ + 20;
  });
}

export const wSummary = (() => {
  const byKind: Record<string, number> = {};
  const byRoof: Record<string, number> = {};
  const byFacade: Record<string, number> = {};
  const rows = new Map<string, Building[]>();
  let minH = Infinity, maxH = 0;
  for (const b of RES_BUILDINGS) {
    byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
    byRoof[b.roof] = (byRoof[b.roof] ?? 0) + 1;
    byFacade[b.facade] = (byFacade[b.facade] ?? 0) + 1;
    minH = Math.min(minH, b.height); maxH = Math.max(maxH, b.height);
    if (b.rowId) {
      const list = rows.get(b.rowId) ?? [];
      list.push(b);
      rows.set(b.rowId, list);
    }
  }
  const shopUnits = RES_BUILDINGS.reduce((s, b) => s + b.shopUnits.length, 0);
  return {
    buildings: RES_BUILDINGS.length,
    byKind, byRoof, byFacade,
    kinds: Object.keys(byKind).length,
    facades: Object.keys(byFacade).length,
    roofs: Object.keys(byRoof).length,
    terraceRows: rows.size,
    terraceUnits: [...rows.values()].reduce((s, r) => s + r.length, 0),
    shopUnits,
    interiors: RES_INTERIOR_BUILDINGS.length,
    interiorReady: RES_INTERIOR_READY.length,
    minHeight: Math.round(minH * 10) / 10,
    maxHeight: Math.round(maxH * 10) / 10,
  };
})();

export { FACADES, facade };
export type { FacadeId, HoodId, Vintage };
export { localRelief, insetConvex };
