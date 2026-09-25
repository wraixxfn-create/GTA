/**
 * Plots and grounds of the Residential Valley.
 *
 * Ordinary plots are cut from street frontages: houses and semis get a garden and a
 * drive, terraces share party walls in long rows, apartments take deeper blocks, and the
 * mixed-use edge of Market Row gets shopfront plots. The landmark sites — Mill Green,
 * Market Row, Warfield Hall, Rosecourt, the two schools and the filling stations — are
 * authored in `identity.ts` and converted to grounds here.
 */
import type { Point } from '../world/data';
import { LANDMARK_SITES, partPolygon, sitePolygon, type LandmarkSite, type SiteFeature, type SitePart } from './identity';
import { RES_LIMITS, hash01, makeRandom, insideDistrict, resGround, type HoodId, type Vintage, hoodAt, vintageAt } from './frame';
import { RES_NETWORK, insideStreetCorridor, streetAt, derivativeAt, type Street, type StreetKind } from './plan';
import { distance2d, leftNormal, normalize, polygonArea, sub, add, scale, ensureCCW, polygonBounds, type Bounds } from '../city/geometry2d';

export type PlotUse =
  | 'house'        // detached or semi-detached with garden and drive
  | 'townhouse'    // narrow terraced house sharing party walls
  | 'apartment'    // block of flats with communal yard and parking
  | 'mixed'        // shops below, flats above (Market Row edge)
  | 'shop'         // single shop unit
  | 'yard';        // rear yard / garage court

export type Plot = {
  id: string;
  polygon: Point[];
  frontage: { a: Point; b: Point; length: number; dir: Point; normal: Point };
  use: PlotUse;
  hood: HoodId;
  vintage: Vintage;
  depth: number;
  area: number;
  streetId: string;
  /** Set-back from the frontage: terraces sit flush, houses pull back for a drive. */
  setback: number;
  /** Townhouse runs: consecutive plots with the same rowId share a terrace block. */
  rowId?: string;
  rowSlot?: number;
  rowLength?: number;
};

export type GroundKind = 'lawn' | 'garden' | 'park' | 'pond' | 'playground' | 'court' | 'parking' | 'plaza' | 'kickabout' | 'path' | 'allotments';
export type Ground = {
  polygon: Point[];
  kind: GroundKind;
  level: number;
  owner: string;
  tint: number;
  feature?: SiteFeature;
};

export type FenceKind = 'hedge' | 'chain' | 'timber' | 'iron' | 'wall';
export type FenceRun = { points: Point[]; height: number; kind: FenceKind; owner: string; gate?: Point };

export const SITE_GROUNDS: readonly { site: LandmarkSite; grounds: Ground[]; parts: { part: SitePart; polygon: Point[] }[] }[] =
  LANDMARK_SITES.map(site => {
    const grounds: Ground[] = [];
    const parts: { part: SitePart; polygon: Point[] }[] = [];
    for (const part of site.parts) {
      const polygon = partPolygon(site, part);
      if (part.kind === 'none') {
        const kind: GroundKind =
          part.feature === 'pond' ? 'pond'
            : part.feature === 'playground' ? 'playground'
              : part.feature === 'muga' ? 'court'
                : part.feature === 'ball-court' ? 'court'
                  : part.feature === 'parking' ? 'parking'
                    : part.feature === 'plaza' ? 'plaza'
                      : part.feature === 'market-square' ? 'plaza'
                        : part.feature === 'bowling-green' ? 'lawn'
                          : part.feature === 'kickabout' ? 'kickabout'
                            : part.feature === 'allotments' ? 'allotments'
                              : part.feature === 'park-path' ? 'path'
                                : 'lawn';
        grounds.push({ polygon, kind, level: resGround(polygon[0].x, polygon[0].z), owner: `${site.id}:${part.id}`, tint: hash01(part.id.length, site.id.length, 3), feature: part.feature });
        continue;
      }
      parts.push({ part, polygon });
    }
    return { site, grounds, parts };
  });

const GROUND_OF_FEATURE: Record<SiteFeature, GroundKind> = {
  lawn: 'lawn', pond: 'pond', playground: 'playground', 'ball-court': 'court', muga: 'court',
  parking: 'parking', plaza: 'plaza', 'market-square': 'plaza', 'bowling-green': 'lawn',
  allotments: 'allotments', kickabout: 'kickabout', 'park-path': 'path',
};

/** Bounds every landmark site occupies, so ordinary plots stay off them. */
export const SITE_BOUNDS: readonly { id: string; bounds: Bounds }[] = LANDMARK_SITES.map(site => ({
  id: site.id,
  bounds: polygonBounds(sitePolygon(site)),
}));

function overlapsSite(polygon: readonly Point[]): boolean {
  const b = polygonBounds(polygon as Point[]);
  for (const site of SITE_BOUNDS) {
    const s = site.bounds;
    if (b.maxX < s.minX - 6 || b.minX > s.maxX + 6 || b.maxZ < s.minZ - 6 || b.minZ > s.maxZ + 6) continue;
    // Cheap centroid test against the site rectangle: plots are small and sites are rare.
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (cx >= s.minX - 6 && cx <= s.maxX + 6 && cz >= s.minZ - 6 && cz <= s.maxZ + 6) return true;
  }
  return false;
}

/* ── ordinary frontage plots ──────────────────────────────────────────────────── */

const LOT_WIDTH: Record<PlotUse, [number, number]> = {
  house: [14, 24], townhouse: [6.5, 9.5], apartment: [24, 44], mixed: [10, 18], shop: [8, 16], yard: [10, 20],
};
const LOT_DEPTH: Record<PlotUse, [number, number]> = {
  house: [22, 32], townhouse: [16, 24], apartment: [30, 46], mixed: [22, 32], shop: [20, 28], yard: [12, 18],
};
const SETBACK: Record<PlotUse, number> = {
  house: 5.5, townhouse: 0.6, apartment: 6, mixed: 1.2, shop: 1.2, yard: 2,
};

/** Which uses line which street kind — the frontage decides the building line. */
function useFor(street: Street, t: number): PlotUse {
  const isMarket = street.id === 'market-row' || (street.id === 'market-alley');
  if (isMarket) return 'mixed';
  switch (street.kind) {
    case 'arterial':
      // Grand Valley and Mill carry a few shops at the crossroads, flats above them.
      return hash01(Math.round(t), street.id.length, 7) < 0.24 ? 'mixed' : 'apartment';
    case 'collector':
      return hash01(Math.round(t), street.id.length, 11) < 0.5 ? 'apartment' : 'house';
    case 'terrace':
      return 'townhouse';
    case 'close':
      return 'house';
    case 'local':
      return street.hood === 'willowbank' || street.hood === 'larkspur' || street.hood === 'sunnybank' ? 'house'
        : street.hood === 'chapel-fields' ? 'townhouse'
          : hash01(Math.round(t), street.id.length, 13) < 0.4 ? 'apartment' : 'house';
    case 'alley':
      return 'yard';
    default:
      return 'house';
  }
}

function cutFrontagePlots(): { plots: Plot[]; fences: FenceRun[] } {
  const plots: Plot[] = [];
  const fences: FenceRun[] = [];
  const random = makeRandom(0x7a11e2);
  for (const street of RES_NETWORK.streets) {
    if (street.kind === 'pedestrian') continue;
    for (const side of [1, -1] as const) {
      // Park paths and alleys: one side only gets deep service yards.
      if (street.kind === 'alley' && side === -1) continue;
      const span = street.spans[0];
      if (!span) continue;
      const corridor = street.width / 2 + street.sidewalk + 1.4;
      let t = span.min + 6;
      let rowCounter = 0;
      while (t < span.max - 6) {
        const q = { x: 0, z: 0 };
        const s0 = streetAt(street, t);
        const dir = derivativeAt(street, t);
        const n = leftNormal(dir);
        const use = useFor(street, t);
        const [wMin, wMax] = LOT_WIDTH[use];
        const [dMin, dMax] = LOT_DEPTH[use];
        const width = wMin + hash01(Math.round(t), street.id.length, Math.round(street.length)) * (wMax - wMin);
        const depth = dMin + random() * (dMax - dMin);
        const setback = SETBACK[use];
        if (t + width > span.max - 4) break;
        const s1 = streetAt(street, t + width);
        const dir1 = derivativeAt(street, t + width);
        const n1 = leftNormal(dir1);
        // Corner lots shrink so two frontages never fight over the same pavement.
        const nearJunction = RES_NETWORK.junctions.some(j =>
          j.control !== 'turning-circle' && Math.hypot(j.point.x - s0.x, j.point.z - s0.z) < corridor + 14);
        if (nearJunction) { t += width; continue; }
        const a = { x: s0.x + n.x * side * corridor, z: s0.z + n.z * side * corridor };
        const b = { x: s1.x + n1.x * side * corridor, z: s1.z + n1.z * side * corridor };
        const back0 = { x: a.x + n.x * side * depth, z: a.z + n.z * side * depth };
        const back1 = { x: b.x + n1.x * side * depth, z: b.z + n1.z * side * depth };
        void q;
        const polygon = ensureCCW(side === 1 ? [a, b, back1, back0] : [b, a, back0, back1]);
        const centre = { x: (a.x + b.x + back0.x + back1.x) / 4, z: (a.z + b.z + back0.z + back1.z) / 4 };
        if (!insideDistrict(centre, 8)) { t += width; continue; }
        if (insideStreetCorridor(centre, 1) || overlapsSite(polygon)) { t += width; continue; }
        // Keep plots off other streets' corridors (alleys running behind the rows).
        const area = polygonArea(polygon);
        if (area < RES_LIMITS.minPlotArea * 0.55) { t += width; continue; }
        const frontDir = normalize(sub(b, a));
        const isRow = use === 'townhouse';
        // Consecutive units on the same frontage form one terrace row.
        const rowId = isRow ? `${street.id}:${side}` : undefined;
        plots.push({
          id: `pl-${street.id}-${side}-${Math.round(t)}`,
          polygon,
          frontage: { a, b, length: distance2d(a, b), dir: frontDir, normal: { x: -frontDir.z * -side, z: frontDir.x * -side } },
          use,
          hood: hoodAt(centre),
          vintage: vintageAt(centre),
          depth,
          area,
          streetId: street.id,
          setback,
          rowId,
          rowSlot: isRow ? Math.round(t) : undefined,
        });
        // Garden fence for houses: the boundary is part of the street scene.
        if (use === 'house' && street.kind !== 'alley') {
          const gate = add(a, scale(frontDir, width * 0.4));
          fences.push({
            points: [a, back0], height: 1.1, owner: `f-${street.id}-${Math.round(t)}`,
            kind: hash01(Math.round(t), 2, 5) < 0.55 ? 'hedge' : 'timber', gate,
          });
        }
        if (isRow) rowCounter++;
        t += width + (isRow ? 0 : 0.4 + random() * 1.6);
      }
    }
  }
  // Merge consecutive townhouse plots into shared rows for the mesh pass.
  return { plots, fences };
}

/** Strip garden/drive ground under the ordinary plots: houses have gardens, flats yards. */
function plotGrounds(plots: readonly Plot[]): Ground[] {
  const out: Ground[] = [];
  for (const plot of plots) {
    if (plot.use === 'yard' || plot.use === 'shop') continue;
    out.push({
      polygon: plot.polygon,
      kind: plot.use === 'apartment' ? 'lawn' : 'garden',
      level: resGround(plot.polygon[0].x, plot.polygon[0].z),
      owner: plot.id,
      tint: hash01(Math.round(plot.frontage.a.x), Math.round(plot.frontage.a.z), 9),
    });
  }
  return out;
}

/* ── kerbside and lot parking ─────────────────────────────────────────────────── */

export type ParkingLot = {
  id: string;
  polygon: Point[];
  bays: { centre: Point; dir: Point; length: number; width: number }[];
  owner: string;
};

function parkingLots(): ParkingLot[] {
  const lots: ParkingLot[] = [];
  // Named lot ground comes from the landmark sites; ordinary blocks get small courts.
  for (const { site, grounds } of SITE_GROUNDS) {
    for (const ground of grounds) {
      if (ground.kind !== 'parking') continue;
      lots.push({ id: `pk-${ground.owner}`, polygon: ground.polygon, bays: baysForPolygon(ground.polygon), owner: site.id });
    }
  }
  return lots;
}

export function baysForPolygon(polygon: readonly Point[]): { centre: Point; dir: Point; length: number; width: number }[] {
  const b = polygonBounds(polygon as Point[]);
  const bays: { centre: Point; dir: Point; length: number; width: number }[] = [];
  const rows = Math.max(1, Math.floor((b.maxZ - b.minZ) / 14));
  const cols = Math.max(1, Math.floor((b.maxX - b.minX) / 2.8));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centre = {
        x: b.minX + (c + 0.5) * ((b.maxX - b.minX) / cols),
        z: b.minZ + (r + 0.5) * ((b.maxZ - b.minZ) / rows),
      };
      bays.push({ centre, dir: { x: 1, z: 0 }, length: 5, width: 2.4 });
    }
  }
  return bays;
}

/* ── assembly ─────────────────────────────────────────────────────────────────── */

const cut = cutFrontagePlots();

export const PLOTS: readonly Plot[] = cut.plots;
export const FENCES: readonly FenceRun[] = cut.fences;
export const GROUNDS: readonly Ground[] = [
  ...SITE_GROUNDS.flatMap(s => s.grounds),
  ...plotGrounds(PLOTS),
];
export const PARKING_LOTS: readonly ParkingLot[] = parkingLots();

export function plotsInBounds(bounds: Bounds): Plot[] {
  return PLOTS.filter(p => {
    const b = polygonBounds(p.polygon);
    return b.maxX >= bounds.minX - 20 && b.minX <= bounds.maxX + 20 && b.maxZ >= bounds.minZ - 20 && b.minZ <= bounds.maxZ + 20;
  });
}
export function groundsInBounds(bounds: Bounds): Ground[] {
  return GROUNDS.filter(g => {
    const b = polygonBounds(g.polygon);
    return b.maxX >= bounds.minX - 20 && b.minX <= bounds.maxX + 20 && b.maxZ >= bounds.minZ - 20 && b.minZ <= bounds.maxZ + 20;
  });
}
export function fencesInBounds(bounds: Bounds): FenceRun[] {
  return FENCES.filter(f => f.points.some(p =>
    p.x >= bounds.minX - 20 && p.x <= bounds.maxX + 20 && p.z >= bounds.minZ - 20 && p.z <= bounds.maxZ + 20));
}

export const siteSummary = (() => {
  const byUse: Record<string, number> = {};
  const byHood: Record<string, number> = {};
  const byVintage: Record<string, number> = {};
  for (const plot of PLOTS) {
    byUse[plot.use] = (byUse[plot.use] ?? 0) + 1;
    byHood[plot.hood] = (byHood[plot.hood] ?? 0) + 1;
    byVintage[plot.vintage] = (byVintage[plot.vintage] ?? 0) + 1;
  }
  return {
    plots: PLOTS.length,
    byUse, byHood, byVintage,
    plotAreaHa: Math.round(PLOTS.reduce((s, p) => s + p.area, 0) / 100) / 100,
    grounds: GROUNDS.length,
    groundAreaHa: Math.round(GROUNDS.reduce((s, g) => s + polygonArea(g.polygon), 0) / 100) / 100,
    parkingLots: PARKING_LOTS.length,
    parkingBays: PARKING_LOTS.reduce((s, l) => s + l.bays.length, 0),
  };
})();

export { GROUND_OF_FEATURE };
export type { StreetKind };
