/**
 * Vantage Heights identity: the district's own name, its estates and properties, its
 * cladding language and the signs you read on the gates.
 *
 * Every name here is invented for Morrow Reach. No estate, house, club, hotel, shop or
 * street is modelled on a real place or on another game's map; the vocabulary is authored
 * so the district reads as one wealthy hillside with its own history — old stone money on
 * the ridge, new glass money on the downtown-facing terrace, and a village between them.
 */
import { fromGrid, type EstateId, type Vintage } from './frame';
import type { Point } from '../world/data';

export const W_IDENTITY = {
  city: 'Lowmere',
  district: 'Hillside',
  longName: 'Vantage Heights',
  subtitle: 'The sheltered bluff above the bay',
  plan: 'Estate Survey',
  survey: 'DISTRICT SURVEY 04',
  note: 'Third constructed district: terraced villas, gated compounds and landmark properties on the hill west of downtown.',
} as const;

/* ── cladding ─────────────────────────────────────────────────────────────────── */

/**
 * Cladding families. A family owns one texture; styles are that texture tinted per
 * building, so the whole district costs a handful of materials — the same contract the
 * downtown and works facades use, with a luxury vocabulary: dressed stone, smooth render,
 * bronze glazing, cedar and anodised metal.
 */
export type FacadeFamily = 'stone' | 'render' | 'glass' | 'timber' | 'metal' | 'brick';
export type FacadeId =
  | 'stone-limestone' | 'stone-travertine' | 'stone-granite'
  | 'render-white' | 'render-lime' | 'render-sand'
  | 'glass-bronze' | 'glass-silver' | 'glass-dark'
  | 'timber-cedar' | 'timber-bronze'
  | 'metal-bronze' | 'metal-zinc'
  | 'brick-warm' | 'brick-grey';

export type Facade = {
  id: FacadeId;
  family: FacadeFamily;
  label: string;
  vintage: Vintage;
  tint: readonly [number, number, number];
  /** 0 = solid wall, 1 = fully glazed. Drives the mesh pass. */
  glazing: number;
  /** Floor-to-floor height this style was built to. */
  storey: number;
};

export const FACADES: readonly Facade[] = [
  { id: 'stone-limestone', family: 'stone', label: 'Ashlar limestone', vintage: 'estate', tint: [.80, .77, .69], glazing: .18, storey: 3.9 },
  { id: 'stone-travertine', family: 'stone', label: 'Travertine', vintage: 'estate', tint: [.76, .69, .57], glazing: .16, storey: 3.8 },
  { id: 'stone-granite', family: 'stone', label: 'Granite plinth', vintage: 'classic', tint: [.58, .58, .58], glazing: .12, storey: 4.1 },
  { id: 'render-white', family: 'render', label: 'Lime render', vintage: 'modern', tint: [.90, .89, .86], glazing: .34, storey: 3.4 },
  { id: 'render-lime', family: 'render', label: 'Pale lime wash', vintage: 'classic', tint: [.85, .83, .76], glazing: .26, storey: 3.5 },
  { id: 'render-sand', family: 'render', label: 'Sand render', vintage: 'estate', tint: [.80, .74, .62], glazing: .22, storey: 3.6 },
  { id: 'glass-bronze', family: 'glass', label: 'Bronze curtain wall', vintage: 'modern', tint: [.36, .31, .26], glazing: .92, storey: 3.7 },
  { id: 'glass-silver', family: 'glass', label: 'Silver curtain wall', vintage: 'modern', tint: [.56, .61, .65], glazing: .94, storey: 3.8 },
  { id: 'glass-dark', family: 'glass', label: 'Smoked structural glass', vintage: 'modern', tint: [.20, .24, .27], glazing: .96, storey: 3.6 },
  { id: 'timber-cedar', family: 'timber', label: 'Cedar boarding', vintage: 'modern', tint: [.56, .42, .30], glazing: .3, storey: 3.3 },
  { id: 'timber-bronze', family: 'timber', label: 'Bronzed hardwood', vintage: 'modern', tint: [.42, .33, .26], glazing: .32, storey: 3.3 },
  { id: 'metal-bronze', family: 'metal', label: 'Bronze panel', vintage: 'modern', tint: [.52, .43, .30], glazing: .2, storey: 3.5 },
  { id: 'metal-zinc', family: 'metal', label: 'Standing-seam zinc', vintage: 'modern', tint: [.62, .64, .65], glazing: .18, storey: 3.4 },
  { id: 'brick-warm', family: 'brick', label: 'Warm brick', vintage: 'classic', tint: [.60, .45, .36], glazing: .2, storey: 3.5 },
  { id: 'brick-grey', family: 'brick', label: 'Grey brick', vintage: 'classic', tint: [.53, .53, .52], glazing: .2, storey: 3.5 },
];
export const FACADE_BY_ID = new Map(FACADES.map(f => [f.id, f]));
export const facade = (id: FacadeId): Facade => FACADE_BY_ID.get(id)!;

const FACADE_BY_VINTAGE: Record<Vintage, FacadeId[]> = {
  estate: ['stone-limestone', 'stone-travertine', 'render-sand', 'brick-warm'],
  classic: ['render-lime', 'brick-warm', 'brick-grey', 'stone-granite'],
  modern: ['render-white', 'glass-bronze', 'timber-cedar', 'metal-zinc'],
};
export function facadeForVintage(vintage: Vintage, seed: number): FacadeId {
  const pool = FACADE_BY_VINTAGE[vintage];
  return pool[Math.floor(seed * pool.length) % pool.length];
}

/* ── names ────────────────────────────────────────────────────────────────────── */

export const HOUSE_NAMES: readonly string[] = [
  'Vantage', 'Belvedere', 'Ashcombe', 'Wych Elm', 'Larchmere', 'Marchmont',
  'Cloudberry', 'Ferngate', 'Hollowmere', 'Kestrel', 'Lantern', 'Mereview',
  'Norland', 'Oakfield', 'Peregrine', 'Quarrywood', 'Ravenscar', 'Silverbrook',
  'Thornbury', 'Underhill', 'Verity', 'Windmere', 'Yew Court', 'Alderney',
  'Bayhouse', 'Cinderford', 'Dovestone', 'Elmgrove', 'Foxglove', 'Goldstone',
];
export const ESTATE_NAMES: Record<EstateId, string> = {
  'crown': 'The Crown', 'wych-elm': 'Wych Elm Park', 'ashcombe': 'Ashcombe Rise',
  'larchmere': 'Larchmere', 'marchmont': 'Marchmont', 'clublands': 'The Clublands',
  'village': 'Belvedere Village', 'parkland': 'Vantage Parkland',
};
export const GATE_NAMES: Record<EstateId, string> = {
  'crown': 'Crown Gate', 'wych-elm': 'Wych Elm Gate', 'ashcombe': 'Ashcombe Gate',
  'larchmere': 'Larchmere Gate', 'marchmont': 'Marchmont Gate', 'clublands': 'Club Gate',
  'village': 'Belvedere Gate', 'parkland': 'Park Gate',
};

export const VILLA_STREET_NAMES: readonly string[] = [
  'Vantage Boulevard', 'Ridge Road', 'Serpentine Drive', 'Bluff Rise', 'Marchmont Avenue',
  'Crown Lane', 'Wych Elm Lane', 'Ashcombe Lane', 'Larchmere Lane', 'Belvedere Walk',
  'Orchard Rise', 'Terrace Lane', 'Kestrel Way', 'Yew Tree Lane', 'Ferngate Rise',
  'Hollowmere Lane', 'Quarry Wood Lane', 'Silverbrook Lane', 'Thornbury Lane', 'Windmere Rise',
];

export const RESTAURANTS: readonly string[] = [
  'The Orangery', 'Mere & Marrow', 'Saltwick', 'The Lantern Room', 'Olive & Ash',
  'Belvedere Grill', 'The Cliff Table', 'Vantage Terrace',
];
export const SHOPS: readonly string[] = [
  'Verity Jewels', 'Marchmont Haberdashery', 'The Glasshouse Florist', 'Alderney Fine Wines',
  'Peregrine Gallery', 'Silverbrook Linen', 'The Vantage Bookroom', 'Norland Atelier',
  'Dovestone Antiques', 'Bayhouse Marine', 'Foxglove Apothecary', 'Goldstone Timepieces',
];
export const CLUB_NAMES: readonly string[] = [
  'Vantage Country Club', 'The Lantern Club', 'Marchmont Racquet Club', 'Belvedere Swimming Club',
];
export const HOTEL_NAMES: readonly string[] = ['The Meridian Bay', 'The Vantage Grand', 'Belvedere House Hotel'];

/** Signage atlas names: gate boards, fascia signs and estate plaques. */
export const SIGN_POOL: readonly string[] = [
  ...RESTAURANTS, ...SHOPS, ...CLUB_NAMES, ...HOTEL_NAMES,
  'PRIVATE', 'RESIDENTS ONLY', 'PRIVATE ROAD', 'NO THROUGH ROAD', 'MEMBERS ONLY',
  'GATE LODGE', 'CONCIERGE', 'VALET PARKING', 'THE ESTATES OFFICE', 'VIEWPOINT',
];

/* ── landmark properties ──────────────────────────────────────────────────────── */

export type EstatePartKind =
  | 'house' | 'wing' | 'lodge' | 'garage' | 'pool-house' | 'orangery' | 'pavilion'
  | 'tower' | 'block' | 'podium' | 'clubhouse' | 'shop-block' | 'mall' | 'gatehouse'
  | 'stable' | 'spa' | 'none';

/** Ground features a part carries on its own terrace. */
export type EstateFeature =
  | 'pool' | 'infinity-pool' | 'fountain' | 'formal-garden' | 'lawn' | 'tennis'
  | 'practice-ground' | 'drive' | 'forecourt' | 'roof-terrace' | 'orchard' | 'kitchen-garden';

export type EstatePart = {
  id: string;
  kind: EstatePartKind;
  /** Fractions of the estate rectangle, 0..1. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  height?: number;
  facade?: FacadeId;
  name?: string;
  interior?: InteriorId;
  feature?: EstateFeature;
  /** Cantilevered upper floors overhanging the slope (the modern villa language). */
  cantilever?: number;
};

export type LandmarkEstate = {
  id: string;
  name: string;
  kind: 'mansion' | 'hotel' | 'country-club' | 'villa' | 'arcade' | 'apartments' | 'club';
  zone: EstateId;
  vintage: Vintage;
  /** Survey-grid rectangle the whole property occupies. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  walled: boolean;
  blurb: string;
  parts: EstatePart[];
};

export const LANDMARK_ESTATES: readonly LandmarkEstate[] = [
  {
    id: 'vantage-house', name: 'Vantage House', kind: 'mansion', zone: 'crown', vintage: 'estate',
    rect: { u0: -1330, u1: -900, v0: -330, v1: 90 },
    walled: true,
    blurb: 'The largest private house on the hill: a limestone mansion of four ranges cut into three terraces, with an orangery, a walled formal garden, a 25 m pool and its own gate lodge on Ridge Road. It has looked down on the bay for a hundred years.',
    parts: [
      { id: 'lodge', kind: 'lodge', rect: { u0: .04, u1: .16, v0: .06, v1: .22 }, height: 8, facade: 'stone-limestone', name: 'Vantage Gate Lodge' },
      { id: 'drive', kind: 'none', rect: { u0: .04, u1: .62, v0: .26, v1: .44 }, feature: 'drive' },
      { id: 'house', kind: 'house', rect: { u0: .20, u1: .58, v0: .46, v1: .86 }, height: 17, facade: 'stone-limestone', name: 'Vantage House', interior: 'vantage-house' },
      { id: 'wing', kind: 'wing', rect: { u0: .62, u1: .84, v0: .50, v1: .70 }, height: 12, facade: 'stone-travertine', name: 'Vantage House East Wing' },
      { id: 'orangery', kind: 'orangery', rect: { u0: .62, u1: .84, v0: .74, v1: .90 }, height: 9, facade: 'glass-bronze', name: 'The Vantage Orangery' },
      { id: 'terrace', kind: 'none', rect: { u0: .20, u1: .88, v0: .38, v1: .44 }, feature: 'roof-terrace' },
      { id: 'pool', kind: 'none', rect: { u0: .22, u1: .50, v0: .10, v1: .32 }, feature: 'pool' },
      { id: 'pool-house', kind: 'pool-house', rect: { u0: .54, u1: .68, v0: .10, v1: .24 }, height: 6, facade: 'render-sand', name: 'Pool House' },
      { id: 'garden', kind: 'none', rect: { u0: .70, u1: .96, v0: .08, v1: .44 }, feature: 'formal-garden' },
      { id: 'garage', kind: 'garage', rect: { u0: .86, u1: .97, v0: .62, v1: .86 }, height: 6, facade: 'brick-warm', name: 'Vantage Garages' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .04, u1: .14, v0: .26, v1: .40 }, name: 'Vantage Gate' },
    ],
  },
  {
    id: 'meridian-hotel', name: 'The Meridian Bay Hotel', kind: 'hotel', zone: 'marchmont', vintage: 'modern',
    rect: { u0: 660, u1: 1090, v0: -1120, v1: -700 },
    walled: false,
    blurb: 'Five-star glass on the downtown-facing terrace: a 46 m bedroom tower over a five-storey podium, porte-cochère, spa wing, roof pool and terraced gardens. Every east-facing room looks straight down on the Lowmere skyline and the bay beyond it.',
    parts: [
      { id: 'porte-cochere', kind: 'none', rect: { u0: .06, u1: .38, v0: .06, v1: .24 }, feature: 'forecourt' },
      { id: 'podium', kind: 'podium', rect: { u0: .06, u1: .62, v0: .26, v1: .62 }, height: 21, facade: 'stone-travertine', name: 'The Meridian Bay Hotel', interior: 'meridian-hotel' },
      { id: 'tower', kind: 'tower', rect: { u0: .30, u1: .56, v0: .64, v1: .94 }, height: 46, facade: 'glass-bronze', name: 'Meridian Bay Tower' },
      { id: 'spa', kind: 'spa', rect: { u0: .66, u1: .96, v0: .28, v1: .50 }, height: 10, facade: 'glass-silver', name: 'Meridian Spa' },
      { id: 'roof-pool', kind: 'none', rect: { u0: .66, u1: .96, v0: .54, v1: .72 }, feature: 'pool' },
      { id: 'gardens', kind: 'none', rect: { u0: .66, u1: .96, v0: .76, v1: .96 }, feature: 'formal-garden' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .06, u1: .16, v0: .10, v1: .22 }, name: 'Hotel Entrance' },
    ],
  },
  {
    id: 'vantage-country-club', name: 'Vantage Country Club', kind: 'country-club', zone: 'clublands', vintage: 'classic',
    rect: { u0: 80, u1: 700, v0: 470, v1: 1080 },
    walled: true,
    blurb: 'Thirty-eight hectares of private grounds behind the Club Gate: a stone clubhouse with a long verandah, a 25 m pool, four tennis courts, a practice ground, kitchen gardens and an avenue of limes up to the gate lodge.',
    parts: [
      { id: 'lodge', kind: 'lodge', rect: { u0: .04, u1: .12, v0: .06, v1: .16 }, height: 7, facade: 'brick-warm', name: 'Club Gate Lodge' },
      { id: 'avenue', kind: 'none', rect: { u0: .04, u1: .30, v0: .20, v1: .34 }, feature: 'drive' },
      { id: 'clubhouse', kind: 'clubhouse', rect: { u0: .10, u1: .38, v0: .36, v1: .62 }, height: 13, facade: 'stone-limestone', name: 'Vantage Country Club', interior: 'vantage-club' },
      { id: 'pavilion', kind: 'pavilion', rect: { u0: .42, u1: .54, v0: .40, v1: .54 }, height: 7, facade: 'timber-cedar', name: 'The Long Pavilion' },
      { id: 'pool', kind: 'none', rect: { u0: .42, u1: .62, v0: .60, v1: .76 }, feature: 'pool' },
      { id: 'pool-house', kind: 'pool-house', rect: { u0: .64, u1: .74, v0: .62, v1: .74 }, height: 6, facade: 'render-lime', name: 'Pool Pavilion' },
      { id: 'tennis', kind: 'none', rect: { u0: .42, u1: .78, v0: .10, v1: .34 }, feature: 'tennis' },
      { id: 'practice', kind: 'none', rect: { u0: .80, u1: .97, v0: .10, v1: .58 }, feature: 'practice-ground' },
      { id: 'kitchen-garden', kind: 'none', rect: { u0: .10, u1: .34, v0: .68, v1: .94 }, feature: 'kitchen-garden' },
      { id: 'lawn', kind: 'none', rect: { u0: .40, u1: .78, v0: .80, v1: .96 }, feature: 'lawn' },
      { id: 'stables', kind: 'stable', rect: { u0: .82, u1: .96, v0: .64, v1: .82 }, height: 7, facade: 'brick-warm', name: 'Club Stables' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .04, u1: .14, v0: .18, v1: .30 }, name: 'Club Gate' },
    ],
  },
  {
    id: 'casa-lumen', name: 'Casa Lumen', kind: 'villa', zone: 'larchmere', vintage: 'modern',
    rect: { u0: -1050, u1: -700, v0: 520, v1: 880 },
    walled: true,
    blurb: 'The architectural showpiece of the cliff enclave: a two-storey glass and bronze box cantilevered nine metres over the slope, an infinity pool on the fall line, a roof deck and nothing but hedged privacy between it and the view to the coast.',
    parts: [
      { id: 'gate', kind: 'gatehouse', rect: { u0: .04, u1: .16, v0: .78, v1: .94 }, name: 'Casa Lumen Gate' },
      { id: 'drive', kind: 'none', rect: { u0: .04, u1: .44, v0: .56, v1: .74 }, feature: 'drive' },
      { id: 'garage', kind: 'garage', rect: { u0: .06, u1: .28, v0: .30, v1: .50 }, height: 5, facade: 'metal-zinc', name: 'Casa Lumen Garage' },
      { id: 'villa', kind: 'house', rect: { u0: .30, u1: .74, v0: .28, v1: .66 }, height: 11, facade: 'glass-dark', name: 'Casa Lumen', cantilever: 9 },
      { id: 'roof-deck', kind: 'none', rect: { u0: .34, u1: .70, v0: .32, v1: .62 }, feature: 'roof-terrace' },
      { id: 'pool', kind: 'none', rect: { u0: .30, u1: .74, v0: .06, v1: .24 }, feature: 'infinity-pool' },
      { id: 'garden', kind: 'none', rect: { u0: .78, u1: .96, v0: .08, v1: .62 }, feature: 'lawn' },
    ],
  },
  {
    id: 'belvedere-arcade', name: 'Belvedere Arcade', kind: 'arcade', zone: 'village', vintage: 'classic',
    rect: { u0: 760, u1: 1200, v0: 140, v1: 560 },
    walled: false,
    blurb: 'The district\u2019s exclusive shopping complex: two stone shop blocks facing a glazed, top-lit mall, a fountain court, a roof garden and The Orangery at the south end. Twelve boutiques, a jeweller, a florist and the only wine merchant on the hill.',
    parts: [
      { id: 'north-block', kind: 'shop-block', rect: { u0: .06, u1: .94, v0: .06, v1: .28 }, height: 15, facade: 'stone-travertine', name: 'Belvedere Arcade North' },
      { id: 'mall', kind: 'mall', rect: { u0: .10, u1: .90, v0: .30, v1: .52 }, height: 12, facade: 'glass-silver', name: 'The Belvedere Mall' },
      { id: 'south-block', kind: 'shop-block', rect: { u0: .06, u1: .66, v0: .54, v1: .78 }, height: 15, facade: 'stone-limestone', name: 'Belvedere Arcade South' },
      { id: 'orangery', kind: 'orangery', rect: { u0: .70, u1: .94, v0: .54, v1: .78 }, height: 10, facade: 'glass-bronze', name: 'The Orangery', interior: 'the-orangery' },
      { id: 'fountain-court', kind: 'none', rect: { u0: .16, u1: .58, v0: .82, v1: .96 }, feature: 'fountain' },
      { id: 'car-court', kind: 'none', rect: { u0: .62, u1: .94, v0: .82, v1: .96 }, feature: 'forecourt' },
    ],
  },
  {
    id: 'marchmont-heights', name: 'Marchmont Heights', kind: 'apartments', zone: 'marchmont', vintage: 'modern',
    rect: { u0: 520, u1: 890, v0: -1390, v1: -1020 },
    walled: false,
    blurb: 'Luxury apartments on the north terrace: two glass blocks of nine and eleven storeys over a shared lobby podium, concierge, a 20 m residents\u2019 pool and walled gardens that step down the slope in three terraces.',
    parts: [
      { id: 'tower-a', kind: 'tower', rect: { u0: .08, u1: .36, v0: .30, v1: .74 }, height: 38, facade: 'glass-silver', name: 'Marchmont Heights North' },
      { id: 'tower-b', kind: 'tower', rect: { u0: .58, u1: .86, v0: .34, v1: .78 }, height: 33, facade: 'glass-bronze', name: 'Marchmont Heights South' },
      { id: 'podium', kind: 'podium', rect: { u0: .08, u1: .86, v0: .78, v1: .94 }, height: 12, facade: 'stone-granite', name: 'Marchmont Concierge', interior: 'marchmont-apartment' },
      { id: 'pool', kind: 'none', rect: { u0: .14, u1: .50, v0: .08, v1: .26 }, feature: 'pool' },
      { id: 'gardens', kind: 'none', rect: { u0: .54, u1: .94, v0: .08, v1: .26 }, feature: 'lawn' },
    ],
  },
  {
    id: 'lantern-club', name: 'The Lantern Club', kind: 'club', zone: 'village', vintage: 'classic',
    rect: { u0: 300, u1: 640, v0: -120, v1: 220 },
    walled: true,
    blurb: 'A private members\u2019 club of grey brick and bronze: dining rooms and a library below, a lantern-lit roof terrace above, a small spa in the lower garden and a discreet gate on Vantage Boulevard.',
    parts: [
      { id: 'clubhouse', kind: 'clubhouse', rect: { u0: .10, u1: .56, v0: .30, v1: .74 }, height: 14, facade: 'brick-grey', name: 'The Lantern Club' },
      { id: 'roof-terrace', kind: 'none', rect: { u0: .14, u1: .52, v0: .34, v1: .70 }, feature: 'roof-terrace' },
      { id: 'spa', kind: 'spa', rect: { u0: .62, u1: .92, v0: .58, v1: .88 }, height: 8, facade: 'glass-silver', name: 'Lantern Spa' },
      { id: 'garden', kind: 'none', rect: { u0: .62, u1: .92, v0: .14, v1: .52 }, feature: 'formal-garden' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .10, u1: .22, v0: .78, v1: .94 }, name: 'Lantern Gate' },
    ],
  },
];
export const LANDMARK_BY_ID = new Map(LANDMARK_ESTATES.map(a => [a.id, a]));

/** Corner points of a landmark estate rectangle in world space. */
export function estatePolygon(estate: LandmarkEstate): Point[] {
  const r = estate.rect;
  return [fromGrid(r.u0, r.v0), fromGrid(r.u1, r.v0), fromGrid(r.u1, r.v1), fromGrid(r.u0, r.v1)];
}
/** World-space rectangle of one part inside its estate. */
export function partPolygon(estate: LandmarkEstate, part: EstatePart): Point[] {
  const r = estate.rect, q = part.rect;
  const u0 = r.u0 + (r.u1 - r.u0) * q.u0, u1 = r.u0 + (r.u1 - r.u0) * q.u1;
  const v0 = r.v0 + (r.v1 - r.v0) * q.v0, v1 = r.v0 + (r.v1 - r.v0) * q.v1;
  return [fromGrid(u0, v0), fromGrid(u1, v0), fromGrid(u1, v1), fromGrid(u0, v1)];
}

/* ── interiors ────────────────────────────────────────────────────────────────── */

/**
 * Interior-ready destinations. Four of these are the interiors this district was asked
 * for — mansion, hotel, restaurant and luxury apartment — plus the clubhouse. That is a
 * small fraction of the roster: almost every house on the hill is a closed door.
 */
export const INTERIORS = {
  'vantage-house': { estate: 'vantage-house', part: 'house', kind: 'mansion', name: 'Vantage House' },
  'meridian-hotel': { estate: 'meridian-hotel', part: 'podium', kind: 'hotel', name: 'The Meridian Bay Hotel' },
  'the-orangery': { estate: 'belvedere-arcade', part: 'orangery', kind: 'restaurant', name: 'The Orangery' },
  'marchmont-apartment': { estate: 'marchmont-heights', part: 'podium', kind: 'apartment', name: 'Marchmont Heights' },
  'vantage-club': { estate: 'vantage-country-club', part: 'clubhouse', kind: 'club', name: 'Vantage Country Club' },
} as const;
export type InteriorId = keyof typeof INTERIORS;
export const INTERIOR_IDS: readonly InteriorId[] = Object.keys(INTERIORS) as InteriorId[];
