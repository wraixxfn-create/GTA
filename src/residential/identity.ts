/**
 * Residential Valley identity: the district's own names, its cladding language, the
 * signs you read on the shopfronts and the four landmarks that anchor it.
 *
 * Every name here is invented for Morrow Reach. No street, shop, school or estate is
 * modelled on a real place; the vocabulary is authored so the district reads as one
 * lived-in valley town — Victorian terraces by the old chapel, interwar semis, postwar
 * rebuild and 1990s closes — ordinary, not luxurious.
 */
import type { Point } from '../world/data';
import { fromGrid, type HoodId, type Vintage } from './frame';

export const RES_IDENTITY = {
  city: 'Lowmere',
  district: 'Residential',
  longName: 'Residential Valley',
  subtitle: 'The broad central valley',
  plan: 'Township Survey',
  survey: 'DISTRICT SURVEY 05',
  note: 'Fourth constructed district: apartment blocks, terraces, small houses, local shops, schools and parks in the valley between the mountains and the city.',
} as const;

/* ── cladding ─────────────────────────────────────────────────────────────────── */

/**
 * Cladding families. Middle-class stock: painted brick, render, timber boarding,
 * postwar concrete panels — plus the glazed shopfronts the high street needs. Tints are
 * per building so the district costs a handful of materials, the same contract every
 * other district uses.
 */
export type FacadeFamily = 'brick' | 'render' | 'timber' | 'panel' | 'shopfront';
export type FacadeId =
  | 'brick-red' | 'brick-buff' | 'brick-london'
  | 'render-cream' | 'render-mint' | 'render-white'
  | 'timber-white' | 'timber-sage'
  | 'panel-concrete' | 'panel-painted'
  | 'shopfront-painted' | 'shopfront-tile';

export type Facade = {
  id: FacadeId;
  family: FacadeFamily;
  label: string;
  vintage: Vintage;
  tint: readonly [number, number, number];
  /** 0 = solid wall, 1 = fully glazed. Drives the mesh pass. */
  glazing: number;
  storey: number;
};

export const FACADES: readonly Facade[] = [
  { id: 'brick-red', family: 'brick', label: 'Red stock brick', vintage: 'victorian', tint: [.58, .36, .30], glazing: .16, storey: 3.1 },
  { id: 'brick-buff', family: 'brick', label: 'Buff brick', vintage: 'interwar', tint: [.68, .58, .46], glazing: .18, storey: 3.0 },
  { id: 'brick-london', family: 'brick', label: 'Yellow-grey brick', vintage: 'victorian', tint: [.58, .52, .44], glazing: .15, storey: 3.1 },
  { id: 'render-cream', family: 'render', label: 'Cream render', vintage: 'interwar', tint: [.82, .76, .62], glazing: .2, storey: 2.9 },
  { id: 'render-mint', family: 'render', label: 'Pale green render', vintage: 'nineties', tint: [.72, .78, .68], glazing: .24, storey: 2.8 },
  { id: 'render-white', family: 'render', label: 'White painted render', vintage: 'postwar', tint: [.88, .87, .82], glazing: .22, storey: 2.9 },
  { id: 'timber-white', family: 'timber', label: 'White boarding', vintage: 'nineties', tint: [.88, .88, .86], glazing: .24, storey: 2.7 },
  { id: 'timber-sage', family: 'timber', label: 'Sage boarding', vintage: 'nineties', tint: [.62, .68, .58], glazing: .24, storey: 2.7 },
  { id: 'panel-concrete', family: 'panel', label: 'Precast concrete panel', vintage: 'postwar', tint: [.62, .61, .58], glazing: .2, storey: 2.9 },
  { id: 'panel-painted', family: 'panel', label: 'Painted system build', vintage: 'postwar', tint: [.72, .68, .6], glazing: .22, storey: 2.9 },
  { id: 'shopfront-painted', family: 'shopfront', label: 'Painted timber shopfront', vintage: 'victorian', tint: [.4, .44, .4], glazing: .55, storey: 3.4 },
  { id: 'shopfront-tile', family: 'shopfront', label: 'Glazed tile shopfront', vintage: 'interwar', tint: [.5, .58, .56], glazing: .5, storey: 3.4 },
];
export const FACADE_BY_ID = new Map(FACADES.map(f => [f.id, f]));
export const facade = (id: FacadeId): Facade => FACADE_BY_ID.get(id)!;

const FACADE_BY_VINTAGE: Record<Vintage, FacadeId[]> = {
  victorian: ['brick-red', 'brick-london', 'shopfront-painted'],
  interwar: ['brick-buff', 'render-cream', 'shopfront-tile'],
  postwar: ['panel-concrete', 'panel-painted', 'render-white'],
  nineties: ['render-mint', 'timber-white', 'timber-sage', 'render-white'],
};
export function facadeForVintage(vintage: Vintage, seed: number): FacadeId {
  const pool = FACADE_BY_VINTAGE[vintage];
  return pool[Math.floor(seed * pool.length) % pool.length];
}

/* ── names ────────────────────────────────────────────────────────────────────── */

export const STREET_NAMES: readonly string[] = [
  'Grand Valley Road', 'Mill Street', 'Chapel Lane', 'Brook Lane', 'Maple Way', 'Orchard Way',
  'Fyfe Street', 'Market Row', 'Bakers Lane', 'Weaver Street', 'Cooper Street', 'Slate Street',
  'Alma Terrace', 'Cranmer Terrace', 'Wesley Terrace', 'Chapel Row', 'Friar Street',
  'Willow Crescent', 'Willow Close', 'Orchard Close', 'Larkspur Drive', 'Sparrow Close',
  'Kestrel Close', 'Beechwood Rise', 'Elm Road', 'Sunnybank Close', 'School Street',
  'Rosecourt Way', 'Fell Way', 'Quarry Road', 'Tannery Lane', 'Gasworks Lane',
];
export const ALLEY_NAMES: readonly string[] = [
  'Market Alley', 'Alma Mews', 'Cranmer Mews', 'Mill Lane', 'Cooper Alley',
  'Weaver Alley', 'Bakers Cut', 'Tanner Mews',
];

/** Homes read off the door: house names for villas, plain numbering for the rest. */
export const HOUSE_NAMES: readonly string[] = [
  'Rose Cottage', 'Ivy Dene', 'Sunnyside', 'The Old Forge', 'Mayfield', 'Melrose',
  'Braemar', 'Craigmore', 'Kirklee', 'Endsleigh', 'Normanhurst', 'Belle Vue',
];

export const SHOPS: readonly string[] = [
  'Marlow & Sons', 'The Hardware Box', 'Ferndale Barbers', 'Paper Lane News',
  'The Wool Room', 'Kavanagh Shoes', 'Rowe & Daughter Books', 'The Music Chest',
  'Valley Pets', 'Greenfield Flowers', 'Northspan Outfitters', 'The Key Cutters',
  'Bellamy Frames', 'Toy Box', 'The Fabric Nook', 'Halbert Tobacconist',
];
export const GROCERS: readonly string[] = [
  'Valley Foods', 'Freshmart Express', 'Brook Lane Grocers', 'Sunrise Mini Market',
];
export const PHARMACIES: readonly string[] = ['Marlow’s Pharmacy', 'Valley Chemist'];
export const LAUNDRIES: readonly string[] = ['Spin & Dry', 'The Valley Launderette'];
export const RESTAURANTS: readonly string[] = [
  'The Copper Kettle', 'Saffron & Sage', 'Basil & Vine', 'The Valley Diner',
  'Nonna Piero’s', 'The Wok House', 'Tandoori Nights', 'Café Millgate',
];
export const SERVICES: readonly string[] = [
  'Valley Dental', 'The Print Shop', 'Keystone Estates', 'Northspan Tutors',
  'The Repair Shop', 'Valley Fitness', 'Bingo Hall', 'The Job Centre',
];
export const SCHOOLS: readonly string[] = ['Millgate Primary School', 'Brook Lane Academy'];
export const COMMUNITY_NAMES: readonly string[] = [
  'Warfield Hall', 'Valley Library', 'St Brendan’s Chapel', 'Millgate Community Rooms',
];

/** Signage atlas names: fascia signs, street plates and estate boards. */
export const SIGN_POOL: readonly string[] = [
  ...SHOPS, ...GROCERS, ...PHARMACIES, ...LAUNDRIES, ...RESTAURANTS, ...SERVICES,
  ...SCHOOLS, ...COMMUNITY_NAMES,
  'TO LET', 'FOR SALE', 'CAR PARK', 'PLAYGROUND', 'MARKET ROW', 'MILL GREEN', 'WARFIELD HALL',
  'BUS STOP', 'VALLEY GARAGE', 'POST OFFICE', 'LIBRARY', 'COMMUNITY CENTRE', 'SLOW — CHILDREN',
];

/* ── landmark sites ───────────────────────────────────────────────────────────── */

export type SitePartKind =
  | 'block' | 'terrace-row' | 'house' | 'shop-row' | 'hall' | 'pavilion' | 'school'
  | 'flat-block' | 'kiosk' | 'garage' | 'canopy' | 'store' | 'none';

/** Ground features a part carries on its own ground. */
export type SiteFeature =
  | 'lawn' | 'pond' | 'playground' | 'ball-court' | 'muga' | 'parking' | 'plaza'
  | 'market-square' | 'bowling-green' | 'allotments' | 'kickabout' | 'park-path';

export type SitePart = {
  id: string;
  kind: SitePartKind;
  /** Fractions of the site rectangle, 0..1. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  height?: number;
  facade?: FacadeId;
  name?: string;
  interior?: InteriorId;
  feature?: SiteFeature;
  /** Preparing a door for a future interior without opening one now. */
  interiorReady?: boolean;
};

export type LandmarkSite = {
  id: string;
  name: string;
  kind: 'park' | 'shopping-street' | 'community' | 'apartments' | 'school' | 'supermarket' | 'gas-station';
  zone: HoodId;
  vintage: Vintage;
  /** World-space rectangle the whole site occupies. */
  rect: { x0: number; x1: number; z0: number; z1: number };
  blurb: string;
  landmark?: boolean;
  parts: SitePart[];
};

const rectOf = (x0: number, x1: number, z0: number, z1: number) => ({ x0, x1, z0, z1 });

export const LANDMARK_SITES: readonly LandmarkSite[] = [
  {
    id: 'mill-green', name: 'Mill Green', kind: 'park', zone: 'millgate', vintage: 'victorian',
    rect: rectOf(-1750, -1380, -1480, -1880), landmark: true,
    blurb: 'The big neighbourhood park on the old mill meadow: fifteen hectares of lawn, two playgrounds, ball courts, a duck pond, the Green Pavilion café and paths worn by a century of school runs and dog walks.',
    parts: [
      { id: 'lawn-n', kind: 'none', rect: { u0: .04, u1: .96, v0: .04, v1: .4 }, feature: 'lawn' },
      { id: 'pond', kind: 'none', rect: { u0: .5, u1: .8, v0: .1, v1: .3 }, feature: 'pond' },
      { id: 'playground-a', kind: 'none', rect: { u0: .08, u1: .3, v0: .44, v1: .6 }, feature: 'playground' },
      { id: 'ball-court', kind: 'none', rect: { u0: .55, u1: .9, v0: .44, v1: .62 }, feature: 'muga' },
      { id: 'pavilion', kind: 'pavilion', rect: { u0: .38, u1: .54, v0: .46, v1: .58 }, height: 5.5, facade: 'render-cream', name: 'The Green Pavilion', interior: 'green-pavilion' },
      { id: 'playground-b', kind: 'none', rect: { u0: .1, u1: .34, v0: .68, v1: .84 }, feature: 'playground' },
      { id: 'bowling', kind: 'none', rect: { u0: .58, u1: .86, v0: .68, v1: .86 }, feature: 'bowling-green' },
      { id: 'kickabout', kind: 'none', rect: { u0: .3, u1: .66, v0: .82, v1: .96 }, feature: 'kickabout' },
      { id: 'kiosk', kind: 'kiosk', rect: { u0: .06, u1: .14, v0: .64, v1: .72 }, height: 3.2, facade: 'timber-sage', name: 'Mill Green Kiosk' },
    ],
  },
  {
    id: 'market-row', name: 'Market Row', kind: 'shopping-street', zone: 'millgate', vintage: 'victorian',
    rect: rectOf(-1350, -450, -1740, -1830), landmark: true,
    blurb: 'The local shopping street: two storeys of flats over forty small shopfronts, a supermarket at the west end with its car park, and delivery vans working Market Alley behind. Grocers, pharmacy, launderette, cafés — everything a valley needs within a walk.',
    parts: [
      { id: 'foods', kind: 'store', rect: { u0: .01, u1: .13, v0: .1, v1: .85 }, height: 7.5, facade: 'panel-painted', name: 'Valley Foods', interior: 'valley-foods' },
      { id: 'shops-n', kind: 'shop-row', rect: { u0: .15, u1: .97, v0: .08, v1: .42 }, height: 9.5, name: 'Market Row North' },
      { id: 'shops-s', kind: 'shop-row', rect: { u0: .15, u1: .97, v0: .58, v1: .92 }, height: 9.5, name: 'Market Row South' },
      { id: 'market-square', kind: 'none', rect: { u0: .3, u1: .55, v0: .44, v1: .56 }, feature: 'market-square' },
    ],
  },
  {
    id: 'warfield-hall', name: 'Warfield Hall', kind: 'community', zone: 'warfield', vintage: 'interwar',
    rect: rectOf(-1700, -1400, -2000, -2250), landmark: true,
    blurb: 'The community centre the valley actually uses: a 1930s civic hall with a stage and badminton court, the branch library in the east wing, the health clinic upstairs, a car park and a green with benches where the pensioners play bowls.',
    parts: [
      { id: 'hall', kind: 'hall', rect: { u0: .12, u1: .58, v0: .3, v1: .78 }, height: 9.5, facade: 'brick-buff', name: 'Warfield Hall', interior: 'warfield-hall' },
      { id: 'library', kind: 'block', rect: { u0: .62, u1: .88, v0: .34, v1: .7 }, height: 7, facade: 'brick-buff', name: 'Valley Library' },
      { id: 'clinic', kind: 'block', rect: { u0: .12, u1: .4, v0: .06, v1: .24 }, height: 7, facade: 'render-cream', name: 'Warfield Clinic', interiorReady: true },
      { id: 'plaza', kind: 'none', rect: { u0: .44, u1: .9, v0: .76, v1: .94 }, feature: 'plaza' },
      { id: 'parking', kind: 'none', rect: { u0: .04, u1: .3, v0: .8, v1: .96 }, feature: 'parking' },
    ],
  },
  {
    id: 'rosecourt', name: 'Rosecourt', kind: 'apartments', zone: 'rosecourt', vintage: 'postwar',
    rect: rectOf(-700, -300, -2250, -2600), landmark: true,
    blurb: 'The distinctive apartment complex: three five-storey slab blocks — Alder, Beech and Chestnut — stepped around a shared green, with drying lines, a playground, a bin store and the parking court. Postwar rebuild done properly, still the valley’s address for first flats.',
    parts: [
      { id: 'alder', kind: 'flat-block', rect: { u0: .06, u1: .42, v0: .08, v1: .3 }, height: 16.5, facade: 'panel-painted', name: 'Alder Court', interior: 'rosecourt-flat' },
      { id: 'beech', kind: 'flat-block', rect: { u0: .5, u1: .86, v0: .14, v1: .36 }, height: 16.5, facade: 'panel-concrete', name: 'Beech Court', interiorReady: true },
      { id: 'chestnut', kind: 'flat-block', rect: { u0: .2, u1: .56, v0: .46, v1: .68 }, height: 13.6, facade: 'panel-painted', name: 'Chestnut Court', interiorReady: true },
      { id: 'green', kind: 'none', rect: { u0: .3, u1: .8, v0: .7, v1: .94 }, feature: 'lawn' },
      { id: 'playground', kind: 'none', rect: { u0: .06, u1: .24, v0: .72, v1: .9 }, feature: 'playground' },
      { id: 'parking', kind: 'none', rect: { u0: .6, u1: .94, v0: .44, v1: .64 }, feature: 'parking' },
    ],
  },
  {
    id: 'millgate-primary', name: 'Millgate Primary School', kind: 'school', zone: 'sunnybank', vintage: 'interwar',
    rect: rectOf(0, 350, -750, -1000),
    blurb: 'The valley’s primary school: a low brick range around a hall, a playground painted with hopscotch grids, a playing field and a staff car park on School Street.',
    parts: [
      { id: 'range', kind: 'school', rect: { u0: .1, u1: .7, v0: .5, v1: .8 }, height: 7.5, facade: 'brick-buff', name: 'Millgate Primary School', interiorReady: true },
      { id: 'hall', kind: 'block', rect: { u0: .72, u1: .9, v0: .55, v1: .78 }, height: 8, facade: 'brick-buff', name: 'School Hall' },
      { id: 'playground', kind: 'none', rect: { u0: .1, u1: .6, v0: .14, v1: .44 }, feature: 'playground' },
      { id: 'field', kind: 'none', rect: { u0: .64, u1: .94, v0: .08, v1: .48 }, feature: 'kickabout' },
      { id: 'parking', kind: 'none', rect: { u0: .04, u1: .2, v0: .84, v1: .96 }, feature: 'parking' },
    ],
  },
  {
    id: 'brook-lane-academy', name: 'Brook Lane Academy', kind: 'school', zone: 'willowbank', vintage: 'postwar',
    rect: rectOf(-2350, -1950, -2350, -2620),
    blurb: 'The secondary school on the south side: postwar classroom blocks, a sports hall, hard courts and the big field the Sunday league plays on.',
    parts: [
      { id: 'blocks', kind: 'school', rect: { u0: .08, u1: .62, v0: .4, v1: .78 }, height: 9, facade: 'panel-concrete', name: 'Brook Lane Academy', interiorReady: true },
      { id: 'sports-hall', kind: 'block', rect: { u0: .66, u1: .92, v0: .5, v1: .8 }, height: 9, facade: 'panel-painted', name: 'Sports Hall' },
      { id: 'courts', kind: 'none', rect: { u0: .08, u1: .4, v0: .1, v1: .34 }, feature: 'muga' },
      { id: 'field', kind: 'none', rect: { u0: .44, u1: .94, v0: .06, v1: .42 }, feature: 'kickabout' },
      { id: 'parking', kind: 'none', rect: { u0: .68, u1: .94, v0: .84, v1: .96 }, feature: 'parking' },
    ],
  },
  {
    id: 'valley-garage', name: 'Valley Garage', kind: 'gas-station', zone: 'millgate', vintage: 'interwar',
    rect: rectOf(-1180, -1020, -1540, -1640),
    blurb: 'The filling station at the Mill Street crossing: four pumps under a flat canopy, a small shop, the air line and the tyre bay that everyone in the valley has used at least once.',
    parts: [
      { id: 'shop', kind: 'store', rect: { u0: .6, u1: .95, v0: .1, v1: .55 }, height: 4.5, facade: 'render-white', name: 'Valley Garage Shop' },
      { id: 'canopy', kind: 'canopy', rect: { u0: .05, u1: .5, v0: .12, v1: .7 }, height: 5 },
      { id: 'tyre-bay', kind: 'garage', rect: { u0: .6, u1: .95, v0: .62, v1: .92 }, height: 4.5, facade: 'panel-painted', name: 'Tyre & Service Bay' },
    ],
  },
  {
    id: 'orchard-fuel', name: 'Orchard Fuel', kind: 'gas-station', zone: 'rosecourt', vintage: 'postwar',
    rect: rectOf(380, 530, -2230, -2330),
    blurb: 'The small filling station on the Brook Lane corner, with a corner shop attached.',
    parts: [
      { id: 'shop', kind: 'store', rect: { u0: .55, u1: .95, v0: .15, v1: .7 }, height: 4.5, facade: 'render-mint', name: 'Orchard Corner Store' },
      { id: 'canopy', kind: 'canopy', rect: { u0: .05, u1: .45, v0: .2, v1: .8 }, height: 5 },
    ],
  },
];
export const LANDMARK_BY_ID = new Map(LANDMARK_SITES.map(s => [s.id, s]));
export const LANDMARK_LANDMARKS = LANDMARK_SITES.filter(s => s.landmark);

/** World-space rectangle of one part inside its site. */
export function partPolygon(site: LandmarkSite, part: SitePart): Point[] {
  const r = site.rect, q = part.rect;
  const x0 = r.x0 + (r.x1 - r.x0) * q.u0, x1 = r.x0 + (r.x1 - r.x0) * q.u1;
  const z0 = r.z0 + (r.z1 - r.z0) * q.v0, z1 = r.z0 + (r.z1 - r.z0) * q.v1;
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}
export function sitePolygon(site: LandmarkSite): Point[] {
  const r = site.rect;
  return [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
}

/* ── interiors ────────────────────────────────────────────────────────────────── */

/**
 * Interior-ready destinations. Four of these are the interiors this district was asked
 * for — a flat, a shop, a restaurant and the community hall. Everything else on the
 * estate is a closed door with a recorded entrance, ready for future interior expansion.
 */
export const INTERIORS = {
  'rosecourt-flat': { site: 'rosecourt', part: 'alder', kind: 'apartment', name: 'Alder Court Flat 14' },
  'valley-foods': { site: 'market-row', part: 'foods', kind: 'shop', name: 'Valley Foods' },
  'green-pavilion': { site: 'mill-green', part: 'pavilion', kind: 'restaurant', name: 'The Green Pavilion' },
  'warfield-hall': { site: 'warfield-hall', part: 'hall', kind: 'community', name: 'Warfield Hall' },
} as const;
export type InteriorId = keyof typeof INTERIORS;
export const INTERIOR_IDS: readonly InteriorId[] = Object.keys(INTERIORS) as InteriorId[];

/** The valley's sign vocabulary, exported for the signage atlas. */
export { fromGrid };
