/**
 * Plots of Vantage Heights: the ground the district is divided into.
 *
 * A hillside estate is not a lattice of blocks, so the layout starts from a coarse survey
 * lattice, throws away everything a landmark property, a road corridor or the reservation
 * limit already owns, and splits what is left into plots sized by where they are: big
 * walled villa grounds on the ridge, smaller ones in the gated compounds, apartment and
 * shop sites on the downtown-facing terrace, and open garden or parkland ground where the
 * slope is too steep or the view too good to build on.
 *
 * Every plot records the terrace datum its buildings sit on and the fraction of it left as
 * garden — the district's rule is that no plot is ever more than half built over.
 */
import type { Point } from '../world/data';
import {
  clipLeft, clipRight, distance2d, leftNormal, normalize, pointToSegment,
  polygonArea, polygonBounds, polygonCentroid, sub,
} from '../city/geometry2d';
import { pointInPolygon, terrainHeight } from '../world/geometry';
import {
  ESTATE_LIMITS, W_GRID_BOUNDS, W_POLYGON, boundaryDistance, fromGrid, hash01, localRelief,
  padLevel, zoneAt, vintageAt, type EstateId, type Vintage,
} from './frame';
import { LANDMARK_ESTATES, estatePolygon } from './identity';
import { W_NETWORK, positionAt, type Street } from './plan';

export type PlotUse =
  | 'villa'        // a detached house on its own gated ground
  | 'mansion'      // a large house with wings, on the ridge
  | 'apartments'   // a luxury apartment block
  | 'shops'        // an exclusive shop or boutique
  | 'restaurant'   // an upscale restaurant
  | 'club'         // a private club or pavilion
  | 'gate-lodge'   // the lodge and gate that serve a compound
  | 'garden'       // landscaped ground: formal gardens, orchards, hedged walks
  | 'viewpoint'    // a scenic terrace with a balustrade, no building
  | 'parkland';    // open ground, trees, no access

export type Plot = {
  id: string;
  polygon: Point[];
  centre: Point;
  area: number;
  use: PlotUse;
  zone: EstateId;
  vintage: Vintage;
  /** Level datum of the terrace this plot is cut into. */
  level: number;
  /** Local relief across the plot, metres. */
  relief: number;
  /** Fraction of the plot left as garden rather than built over. */
  gardenFraction: number;
  /** The street this plot fronts, if any. */
  frontage?: { streetId: string; t: number; distance: number; point: Point };
  tint: number;
};

export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

/* ── estate grounds ───────────────────────────────────────────────────────────── */

export type EstateGround = {
  id: string;
  name: string;
  polygon: Point[];
  centre: Point;
  level: number;
  area: number;
  walled: boolean;
  kind: string;
};

export const ESTATE_GROUNDS: readonly EstateGround[] = LANDMARK_ESTATES.map(estate => {
  const polygon = estatePolygon(estate);
  return {
    id: estate.id, name: estate.name, polygon,
    centre: polygonCentroid(polygon), level: padLevel(polygon),
    area: polygonArea(polygon), walled: estate.walled, kind: estate.kind,
  };
});

function insideAnyEstate(q: Point, margin = 0): boolean {
  for (const ground of ESTATE_GROUNDS) {
    if (!pointInPolygon(q.x, q.z, ground.polygon)) continue;
    if (margin <= 0) return true;
    let nearest = Infinity;
    for (let i = 0; i < ground.polygon.length; i++) {
      nearest = Math.min(nearest, pointToSegment(q, ground.polygon[i], ground.polygon[(i + 1) % ground.polygon.length]).distance);
    }
    if (nearest < margin) return true;
  }
  return false;
}

/* ── street corridors ─────────────────────────────────────────────────────────── */

/**
 * Cut a convex plot back from every street that runs past it. Streets are curves, so each
 * nearby sample segment contributes a half-plane at its own offset: the result follows the
 * alignment instead of a bounding box.
 */
function clipFromStreets(polygon: Point[], reach: number): Point[] {
  let result = polygon;
  if (result.length < 3) return result;
  const bounds = polygonBounds(result);
  for (const street of W_NETWORK.streets) {
    if (street.kind === 'pedestrian') continue;
    const offset = reach + street.width / 2 + street.shoulder + street.median / 2;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      if (Math.max(a.x, b.x) < bounds.minX - offset - 4 || Math.min(a.x, b.x) > bounds.maxX + offset + 4 ||
        Math.max(a.z, b.z) < bounds.minZ - offset - 4 || Math.min(a.z, b.z) > bounds.maxZ + offset + 4) continue;
      const dir = normalize(sub(b, a));
      const n = leftNormal(dir);
      // Whichever side the plot's centroid is on, keep that side beyond the offset.
      const c = polygonCentroid(result);
      const side = (c.x - a.x) * n.x + (c.z - a.z) * n.z;
      if (side >= 0) {
        result = clipLeft(result, { x: a.x + n.x * offset, z: a.z + n.z * offset }, { x: b.x + n.x * offset, z: b.z + n.z * offset });
      } else {
        result = clipRight(result, { x: a.x - n.x * offset, z: a.z - n.z * offset }, { x: b.x - n.x * offset, z: b.z - n.z * offset });
      }
      if (result.length < 3) return [];
    }
  }
  return result;
}

/** Nearest frontage: which street this plot opens onto, and where. */
function frontageOf(centre: Point): Plot['frontage'] {
  let best: Plot['frontage'] | null = null;
  for (const street of W_NETWORK.streets) {
    if (street.kind === 'pedestrian') continue;
    for (let i = 0; i + 1 < street.samples.length; i++) {
      const a = street.samples[i], b = street.samples[i + 1];
      if (a.span !== b.span) continue;
      const hit = pointToSegment(centre, a, b);
      if (hit.distance > 190) continue;
      if (best && best.distance <= hit.distance) continue;
      best = {
        streetId: street.id, t: a.t + (b.t - a.t) * hit.t, distance: hit.distance,
        point: { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t },
      };
    }
  }
  return best ?? undefined;
}

/* ── use by position ──────────────────────────────────────────────────────────── */

function useFor(zone: EstateId, relief: number, seed: number, nearScenic: boolean): PlotUse {
  // Steep ground and viewpoints stay open; that is what makes the hill read as a hill.
  if (relief > 4.6 && seed > .42) return seed > .8 ? 'viewpoint' : 'garden';
  switch (zone) {
    case 'crown':
      return seed > .74 ? 'mansion' : seed > .16 ? 'villa' : 'garden';
    case 'wych-elm': case 'ashcombe': case 'larchmere':
      return seed > .84 ? 'gate-lodge' : seed > .12 ? 'villa' : 'garden';
    case 'marchmont':
      if (seed > .88) return 'restaurant';
      if (seed > .62) return 'apartments';
      if (seed > .34) return 'shops';
      return seed > .12 ? 'villa' : 'garden';
    case 'village':
      if (seed > .82) return 'restaurant';
      if (seed > .42) return 'shops';
      if (seed > .28) return 'club';
      return seed > .1 ? 'villa' : 'garden';
    case 'clublands':
      return seed > .78 ? 'club' : seed > .5 ? 'garden' : 'villa';
    default:
      return nearScenic && seed > .7 ? 'viewpoint' : seed > .3 ? 'garden' : 'parkland';
  }
}

/* ── the layout ───────────────────────────────────────────────────────────────── */

const CELL_U = 172;
const CELL_V = 152;

function cellPolygon(u0: number, v0: number): Point[] {
  return [fromGrid(u0, v0), fromGrid(u0 + CELL_U, v0), fromGrid(u0 + CELL_U, v0 + CELL_V), fromGrid(u0, v0 + CELL_V)];
}

/** Split a plot along its longer axis, in the survey frame. */
function splitCell(u0: number, v0: number, alongU: boolean): [Point[], Point[]] {
  const mid = alongU ? CELL_U / 2 : CELL_V / 2;
  const a = alongU
    ? [fromGrid(u0, v0), fromGrid(u0 + mid, v0), fromGrid(u0 + mid, v0 + CELL_V), fromGrid(u0, v0 + CELL_V)]
    : [fromGrid(u0, v0), fromGrid(u0 + CELL_U, v0), fromGrid(u0 + CELL_U, v0 + mid), fromGrid(u0, v0 + mid)];
  const b = alongU
    ? [fromGrid(u0 + mid, v0), fromGrid(u0 + CELL_U, v0), fromGrid(u0 + CELL_U, v0 + CELL_V), fromGrid(u0 + mid, v0 + CELL_V)]
    : [fromGrid(u0, v0 + mid), fromGrid(u0 + CELL_U, v0 + mid), fromGrid(u0 + CELL_U, v0 + CELL_V), fromGrid(u0, v0 + CELL_V)];
  return [a, b];
}

const SCENIC_STREETS = W_NETWORK.streets.filter(s => s.scenic);
function nearScenicRoute(q: Point): boolean {
  for (const street of SCENIC_STREETS) {
    for (let i = 0; i + 1 < street.samples.length; i += 2) {
      const a = street.samples[i], b = street.samples[i + 1] ?? street.samples[i];
      if (pointToSegment(q, a, b).distance < 120) return true;
    }
  }
  return false;
}

export const PLOTS: readonly Plot[] = (() => {
  const plots: Plot[] = [];
  const gb = W_GRID_BOUNDS;

  let index = 0;
  const addPlot = (polygon: Point[]): void => {
    if (polygon.length < 3) return;
    const area = polygonArea(polygon);
    if (area < ESTATE_LIMITS.minPlotArea) return;
    const centre = polygonCentroid(polygon);
    if (!pointInPolygon(centre.x, centre.z, W_POLYGON)) return;
    if (boundaryDistance(centre) < 26) return;
    const zone = zoneAt(centre);
    const relief = localRelief(centre.x, centre.z, 24);
    const seed = hash01(Math.round(centre.x / 7), Math.round(centre.z / 11), 5);
    const vintage = vintageAt(centre);
    const use = useFor(zone, relief, seed, nearScenicRoute(centre));
    const garden = use === 'garden' || use === 'parkland' || use === 'viewpoint' ? 1
      : Math.max(ESTATE_LIMITS.minGardenFraction, 0.5 + seed * 0.34);
    plots.push({
      id: `plot-${index++}`, polygon, centre, area, use, zone, vintage,
      level: padLevel(polygon), relief, gardenFraction: garden,
      frontage: use === 'parkland' ? undefined : frontageOf(centre),
      tint: seed,
    });
  };

  for (let v = Math.floor(gb.minV / CELL_V) * CELL_V; v < gb.maxV; v += CELL_V) {
    for (let u = Math.floor(gb.minU / CELL_U) * CELL_U; u < gb.maxU; u += CELL_U) {
      const cell = cellPolygon(u, v);
      const centre = polygonCentroid(cell);
      if (!pointInPolygon(centre.x, centre.z, W_POLYGON)) continue;
      // A landmark property owns its whole rectangle; nothing else is laid inside it.
      if (insideAnyEstate(centre)) continue;
      // The reservation polygon is convex, so clipping the cell against its edges is exact.
      let fenced = cell;
      for (let i = 0; i < W_POLYGON.length && fenced.length >= 3; i++) {
        fenced = clipLeft(fenced, W_POLYGON[i], W_POLYGON[(i + 1) % W_POLYGON.length]);
      }
      if (fenced.length < 3) continue;
      const trimmed = clipFromStreets(fenced, 6);
      if (trimmed.length < 3 || polygonArea(trimmed) < ESTATE_LIMITS.minPlotArea * 1.4) continue;
      const bounds = polygonBounds(trimmed);
      const wide = bounds.maxX - bounds.minX, deep = bounds.maxZ - bounds.minZ;
      const area = polygonArea(trimmed);
      // Big ground on the ridge and in the compounds is divided once more, so no single
      // plot swallows a whole hillside.
      if (area > 21000 && (wide > 150 || deep > 150)) {
        const [a, b] = splitCell(u, v, wide >= deep);
        for (const piece of [a, b]) {
          let inside = piece;
          for (let i = 0; i < W_POLYGON.length && inside.length >= 3; i++) {
            inside = clipLeft(inside, W_POLYGON[i], W_POLYGON[(i + 1) % W_POLYGON.length]);
          }
          const cut = clipFromStreets(inside, 6);
          if (cut.length < 3) continue;
          addPlot(cut);
        }
        continue;
      }
      addPlot(trimmed);
    }
  }
  return plots;
})();

export function plotsInBounds(bounds: Bounds): Plot[] {
  return PLOTS.filter(plot => {
    const b = polygonBounds(plot.polygon);
    return b.maxX >= bounds.minX && b.minX <= bounds.maxX && b.maxZ >= bounds.minZ && b.minZ <= bounds.maxZ;
  });
}
export function estatesInBounds(bounds: Bounds): EstateGround[] {
  return ESTATE_GROUNDS.filter(ground => {
    const b = polygonBounds(ground.polygon);
    return b.maxX >= bounds.minX && b.minX <= bounds.maxX && b.maxZ >= bounds.minZ && b.minZ <= bounds.maxZ;
  });
}

export const siteSummary = (() => {
  const byUse: Record<string, number> = {};
  const byZone: Record<string, number> = {};
  const byVintage: Record<string, number> = {};
  let area = 0, garden = 0, fronted = 0;
  for (const plot of PLOTS) {
    byUse[plot.use] = (byUse[plot.use] ?? 0) + 1;
    byZone[plot.zone] = (byZone[plot.zone] ?? 0) + 1;
    byVintage[plot.vintage] = (byVintage[plot.vintage] ?? 0) + 1;
    area += plot.area;
    garden += plot.area * plot.gardenFraction;
    if (plot.frontage) fronted++;
  }
  const estateArea = ESTATE_GROUNDS.reduce((sum, g) => sum + g.area, 0);
  return {
    count: PLOTS.length,
    areaHa: Math.round(area / 10000 * 10) / 10,
    estateCount: ESTATE_GROUNDS.length,
    estateAreaHa: Math.round(estateArea / 10000 * 10) / 10,
    byUse, byZone, byVintage,
    fronted,
    gardenFraction: area ? garden / area : 0,
    medianArea: (() => {
      const sorted = PLOTS.map(p => p.area).sort((a, b) => a - b);
      return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : 0;
    })(),
  };
})();

/** Terrain height under a plot corner, for retaining walls and terracing. */
export function groundUnder(q: Point): number { return terrainHeight(q.x, q.z); }
export function plotFrontagePoint(plot: Plot): Point | null {
  return plot.frontage ? positionAt(W_NETWORK.streetById.get(plot.frontage.streetId)!, plot.frontage.t) : null;
}
export { distance2d };
export type { Street };
