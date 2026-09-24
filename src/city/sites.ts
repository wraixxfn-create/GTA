/**
 * Landmark sites: the reserved cells where the district stops being generated and starts
 * being authored. Each site interrupts the grid, then lays out its own parts — towers,
 * forecourts, plazas, parks, garages — inside the block it took.
 */
import type { FacadeStyleId } from './identity';

export type BuildingShape =
  | 'box' | 'taper' | 'octagon' | 'stepped' | 'lshape' | 'barrel'
  | 'cantilever' | 'curved' | 'colonnade' | 'podium-tower';

export type OpenSurface = 'plaza' | 'lawn' | 'apron' | 'terrace' | 'cobbles' | 'water';
export type OpenFeature =
  | 'fountain' | 'pavilion' | 'amphitheatre' | 'bosque' | 'playground'
  | 'market' | 'sculpture' | 'portecochere' | 'terrace' | 'none';

export type SitePart = {
  id: string;
  use: 'open' | 'built';
  /** Normalised rectangle inside the site's buildable area. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  // open parts
  surface?: OpenSurface;
  feature?: OpenFeature;
  // built parts
  shape?: BuildingShape;
  base?: number;
  height?: number;
  levels?: number;
  style?: FacadeStyleId;
  name?: string;
  interior?: string;
  roof?: 'flat' | 'parapet' | 'vault' | 'garden' | 'mechanical' | 'mast' | 'sawtooth';
};

export type GarageSpec = {
  levels: number;
  /** Depth of each level below the street, metres. */
  depth: number;
  /** Ramp entries, positioned along a site edge. */
  entries: { side: 'u0' | 'u1' | 'v0' | 'v1'; at: number; width: number }[];
};

export type Site = {
  id: string;
  name: string;
  kind: 'landmark' | 'civic' | 'plaza' | 'park' | 'garage' | 'station' | 'market' | 'museum' | 'hotel' | 'tower';
  /** Inclusive cell range: the site takes whole blocks plus the streets between them. */
  i0: number; i1: number; j0: number; j1: number;
  parts: readonly SitePart[];
  garage?: GarageSpec;
};

/**
 * Placement: the core is the Meridian × Lantern crossing. The tall towers sit north and
 * east of it on the financial side, the civic block faces the plaza on its west, the
 * station takes the transit avenue, and the historic market sits on the south-west edge
 * where the older masonry survives.
 */
export const SITES: readonly Site[] = [
  {
    id: 'civic', name: 'Meridian Plaza', kind: 'civic', i0: 6, i1: 7, j0: 6, j1: 6,
    parts: [
      { id: 'plaza', use: 'open', rect: { u0: 0, u1: .52, v0: 0, v1: 1 }, surface: 'plaza', feature: 'fountain' },
      { id: 'apron', use: 'open', rect: { u0: .52, u1: .60, v0: 0, v1: 1 }, surface: 'plaza', feature: 'none' },
      { id: 'hall', use: 'built', rect: { u0: .62, u1: 1, v0: .06, v1: .94 }, shape: 'colonnade', height: 54, style: 'civic-stone', name: 'Lowmere Civic Hall', interior: 'civic-hall', roof: 'mast' },
    ],
  },
  {
    id: 'station', name: 'Meridian Interchange', kind: 'station', i0: 6, i1: 7, j0: 5, j1: 5,
    parts: [
      { id: 'hall', use: 'built', rect: { u0: .04, u1: .74, v0: .08, v1: .58 }, shape: 'barrel', height: 27, style: 'glass-silver', name: 'Meridian Interchange', interior: 'interchange', roof: 'vault' },
      { id: 'apron', use: 'open', rect: { u0: .04, u1: .74, v0: .58, v1: 1 }, surface: 'apron', feature: 'none' },
      { id: 'square', use: 'open', rect: { u0: .78, u1: 1, v0: .04, v1: .96 }, surface: 'plaza', feature: 'pavilion' },
    ],
  },
  {
    id: 'kestrel', name: 'Kestrel Tower', kind: 'tower', i0: 9, i1: 10, j0: 4, j1: 4,
    parts: [
      { id: 'tower', use: 'built', rect: { u0: .08, u1: .44, v0: .10, v1: .76 }, shape: 'taper', height: 292, style: 'glass-blue', name: 'Kestrel Tower', interior: 'kestrel-lobby', roof: 'mast' },
      { id: 'plaza', use: 'open', rect: { u0: .48, u1: 1, v0: .02, v1: .96 }, surface: 'plaza', feature: 'fountain' },
      { id: 'annex', use: 'built', rect: { u0: .08, u1: .44, v0: .80, v1: .98 }, shape: 'box', height: 52, style: 'office-ribbon', name: 'Kestrel Annex', roof: 'parapet' },
    ],
  },
  {
    id: 'reachmark', name: 'Reachmark Financial Center', kind: 'tower', i0: 10, i1: 10, j0: 6, j1: 6,
    parts: [
      { id: 'tower', use: 'built', rect: { u0: .08, u1: .58, v0: .08, v1: .70 }, shape: 'stepped', height: 214, style: 'glass-green', name: 'Reachmark Financial Center', interior: 'reachmark-hall', roof: 'mechanical' },
      { id: 'colonnade', use: 'open', rect: { u0: .62, u1: 1, v0: .04, v1: .96 }, surface: 'plaza', feature: 'pavilion' },
      { id: 'wing', use: 'built', rect: { u0: .08, u1: .58, v0: .74, v1: .98 }, shape: 'box', height: 26, style: 'glass-green', name: 'Reachmark Trading Floor', roof: 'garden' },
    ],
  },
  {
    id: 'trust', name: 'Lowmere Trust Building', kind: 'landmark', i0: 11, i1: 11, j0: 5, j1: 5,
    parts: [
      { id: 'tower', use: 'built', rect: { u0: .06, u1: .92, v0: .08, v1: .60 }, shape: 'box', height: 71, style: 'historic-renovated', name: 'Lowmere Trust Building', roof: 'parapet' },
      { id: 'atrium', use: 'built', rect: { u0: .30, u1: .92, v0: .60, v1: .96 }, shape: 'box', height: 17, style: 'glass-silver', name: 'Trust Banking Hall', roof: 'flat' },
      { id: 'court', use: 'open', rect: { u0: .06, u1: .28, v0: .60, v1: .96 }, surface: 'plaza', feature: 'none' },
    ],
  },
  {
    id: 'hotel', name: 'Halcyon Grand Hotel', kind: 'hotel', i0: 5, i1: 5, j0: 8, j1: 9,
    parts: [
      { id: 'podium', use: 'built', rect: { u0: .04, u1: .94, v0: .04, v1: .70 }, shape: 'box', height: 22, style: 'luxury-stone', name: 'Halcyon Grand Hotel', roof: 'garden' },
      { id: 'tower', use: 'built', rect: { u0: .12, u1: .52, v0: .10, v1: .58 }, shape: 'box', base: 22, height: 130, style: 'hotel', name: 'Halcyon Grand Hotel', interior: 'halcyon-lobby', roof: 'mechanical' },
      { id: 'motorcourt', use: 'open', rect: { u0: .56, u1: 1, v0: .04, v1: .52 }, surface: 'apron', feature: 'portecochere' },
      { id: 'garden', use: 'open', rect: { u0: .12, u1: .94, v0: .74, v1: .98 }, surface: 'lawn', feature: 'terrace' },
    ],
  },
  {
    id: 'museum', name: 'The Verge', kind: 'museum', i0: 3, i1: 3, j0: 10, j1: 10,
    parts: [
      { id: 'gallery', use: 'built', rect: { u0: .06, u1: .66, v0: .10, v1: .74 }, shape: 'cantilever', height: 33, style: 'museum-stone', name: 'The Verge', interior: 'verge-gallery', roof: 'sawtooth' },
      { id: 'court', use: 'open', rect: { u0: .70, u1: 1, v0: .04, v1: .80 }, surface: 'plaza', feature: 'sculpture' },
      { id: 'green', use: 'open', rect: { u0: .06, u1: 1, v0: .82, v1: .98 }, surface: 'lawn', feature: 'bosque' },
    ],
  },
  {
    id: 'market', name: 'Copperfield Market Hall', kind: 'market', i0: 3, i1: 3, j0: 11, j1: 11,
    parts: [
      { id: 'hall', use: 'built', rect: { u0: .08, u1: .68, v0: .10, v1: .88 }, shape: 'barrel', height: 21, style: 'historic-renovated', name: 'Copperfield Market Hall', roof: 'vault' },
      { id: 'square', use: 'open', rect: { u0: .72, u1: 1, v0: .04, v1: .96 }, surface: 'cobbles', feature: 'market' },
    ],
  },
  {
    id: 'anvil', name: 'The Anvil', kind: 'landmark', i0: 2, i1: 2, j0: 11, j1: 11,
    parts: [
      { id: 'block', use: 'built', rect: { u0: .06, u1: .88, v0: .10, v1: .90 }, shape: 'box', height: 38, style: 'historic-terracotta', name: 'The Anvil', roof: 'parapet' },
      { id: 'yard', use: 'open', rect: { u0: .90, u1: 1, v0: .04, v1: .96 }, surface: 'cobbles', feature: 'none' },
    ],
  },
  {
    id: 'solstice', name: 'Solstice Residences', kind: 'tower', i0: 12, i1: 12, j0: 10, j1: 10,
    parts: [
      { id: 'tower', use: 'built', rect: { u0: .10, u1: .58, v0: .08, v1: .74 }, shape: 'curved', height: 186, style: 'residential-balcony', name: 'Solstice Residences', roof: 'garden' },
      { id: 'court', use: 'open', rect: { u0: .62, u1: 1, v0: .04, v1: .96 }, surface: 'lawn', feature: 'bosque' },
      { id: 'wing', use: 'built', rect: { u0: .10, u1: .58, v0: .78, v1: .98 }, shape: 'box', height: 16, style: 'luxury-stone', name: 'Solstice Court', roof: 'flat' },
    ],
  },
  {
    id: 'northgate-deck', name: 'Northgate Deck', kind: 'garage', i0: 8, i1: 8, j0: 2, j1: 2,
    parts: [
      { id: 'deck', use: 'built', rect: { u0: .06, u1: .94, v0: .08, v1: .92 }, shape: 'box', height: 27, levels: 8, style: 'parking-slat', name: 'Northgate Deck', roof: 'parapet' },
      { id: 'apron', use: 'open', rect: { u0: .06, u1: .94, v0: .92, v1: 1 }, surface: 'apron', feature: 'none' },
    ],
  },
  {
    id: 'fenwick-green', name: 'Fenwick Green', kind: 'park', i0: 7, i1: 7, j0: 9, j1: 9,
    parts: [
      { id: 'green', use: 'open', rect: { u0: .04, u1: .96, v0: .06, v1: .72 }, surface: 'lawn', feature: 'bosque' },
      { id: 'pavilion', use: 'built', rect: { u0: .34, u1: .58, v0: .18, v1: .42 }, shape: 'box', height: 7, style: 'service-wall', name: 'Fenwick Kiosk', roof: 'flat' },
      { id: 'ramp', use: 'open', rect: { u0: .06, u1: .40, v0: .74, v1: .98 }, surface: 'apron', feature: 'none' },
      { id: 'lawn', use: 'open', rect: { u0: .44, u1: .96, v0: .74, v1: .98 }, surface: 'lawn', feature: 'terrace' },
    ],
    garage: { levels: 2, depth: 3.6, entries: [{ side: 'v1', at: .22, width: 8 }] },
  },
  {
    id: 'lantern-court', name: 'Lantern Court Garage', kind: 'garage', i0: 9, i1: 9, j0: 3, j1: 3,
    parts: [
      { id: 'court', use: 'open', rect: { u0: .05, u1: .95, v0: .05, v1: .72 }, surface: 'plaza', feature: 'bosque' },
      { id: 'kiosk', use: 'built', rect: { u0: .62, u1: .84, v0: .10, v1: .34 }, shape: 'box', height: 6, style: 'service-wall', name: 'Lantern Court Kiosk', roof: 'flat' },
      { id: 'ramp', use: 'open', rect: { u0: .05, u1: .45, v0: .74, v1: .98 }, surface: 'apron', feature: 'none' },
      { id: 'paving', use: 'open', rect: { u0: .49, u1: .95, v0: .74, v1: .98 }, surface: 'plaza', feature: 'none' },
    ],
    garage: { levels: 2, depth: 3.6, entries: [{ side: 'v1', at: .25, width: 8 }] },
  },
  {
    id: 'wren-park', name: 'Wren Park', kind: 'park', i0: 1, i1: 1, j0: 3, j1: 3,
    parts: [
      { id: 'green', use: 'open', rect: { u0: .04, u1: .96, v0: .04, v1: .96 }, surface: 'lawn', feature: 'playground' },
    ],
  },
  {
    id: 'anchor-square', name: 'Anchor Square', kind: 'plaza', i0: 13, i1: 13, j0: 12, j1: 12,
    parts: [
      { id: 'square', use: 'open', rect: { u0: .05, u1: .95, v0: .05, v1: .95 }, surface: 'plaza', feature: 'bosque' },
      { id: 'kiosk', use: 'built', rect: { u0: .40, u1: .62, v0: .40, v1: .62 }, shape: 'octagon', height: 6, style: 'service-wall', name: 'Anchor Square Kiosk', roof: 'flat' },
    ],
  },
];

/** Cell → site lookup used while the grid is being cut. */
export const SITE_BY_CELL = new Map<string, Site>();
for (const site of SITES) {
  for (let i = site.i0; i <= site.i1; i++) for (let j = site.j0; j <= site.j1; j++) SITE_BY_CELL.set(`${i}:${j}`, site);
}
export function siteAtCell(i: number, j: number): Site | undefined {
  return SITE_BY_CELL.get(`${i}:${j}`);
}
/** True when a site swallows the grid line of the given axis/index inside a span. */
export function siteCutsLine(axis: 'u' | 'v', index: number): boolean {
  return SITES.some(site => axis === 'u'
    ? (index > site.i0 && index <= site.i1)
    : (index > site.j0 && index <= site.j1));
}
