/**
 * Industrial identity: the district's own name, its works and companies, its cladding
 * language and the signs you read on the gates.
 *
 * Every name here is invented for Morrow Reach. No company, works, yard or street is
 * modelled on a real place; the vocabulary is authored so the district reads as one
 * working landscape with its own history — and its own decline and renewal.
 */

export const IND_IDENTITY = {
  city: 'Lowmere',
  district: 'Industrial',
  longName: 'Lowmere Industrial Flats',
  subtitle: 'The riverward works',
  plan: 'Works Grid',
  survey: 'DISTRICT SURVEY 03',
  note: 'Second constructed district: the riverward flats between downtown and the reserved port.',
} as const;

/**
 * Cladding families. A family owns one texture; styles are that texture tinted per
 * building, so the whole district costs a handful of materials — the same contract the
 * downtown facades use, with an industrial vocabulary.
 */
export type CladdingFamily = 'corrugated' | 'panel' | 'brick' | 'steel' | 'office' | 'shed';
export type CladdingId =
  | 'corrugated-steel' | 'corrugated-rust' | 'corrugated-painted'
  | 'panel-grey' | 'panel-sand' | 'panel-blue'
  | 'brick-mill' | 'brick-works'
  | 'steel-frame' | 'steel-glazed'
  | 'office-strip' | 'office-brick'
  | 'shed-metal';

export type Cladding = {
  id: CladdingId;
  family: CladdingFamily;
  label: string;
  era: 'works' | 'postwar' | 'modern' | 'derelict';
  tint: readonly [number, number, number];
  trim: readonly [number, number, number];
  /** Module in metres the texture is authored against. */
  bay: number;
  floor: number;
};

export const CLADDING: readonly Cladding[] = [
  { id: 'corrugated-steel', family: 'corrugated', label: 'Bare corrugated steel', era: 'works', tint: [.62, .63, .64], trim: [.45, .46, .47], bay: 1.2, floor: 4 },
  { id: 'corrugated-rust', family: 'corrugated', label: 'Rusted corrugated steel', era: 'derelict', tint: [.58, .42, .30], trim: [.42, .32, .24], bay: 1.2, floor: 4 },
  { id: 'corrugated-painted', family: 'corrugated', label: 'Painted corrugated steel', era: 'modern', tint: [.68, .70, .68], trim: [.50, .52, .50], bay: 1.2, floor: 4 },
  { id: 'panel-grey', family: 'panel', label: 'Grey composite panel', era: 'modern', tint: [.66, .67, .68], trim: [.80, .81, .82], bay: 3.0, floor: 4 },
  { id: 'panel-sand', family: 'panel', label: 'Sand composite panel', era: 'modern', tint: [.72, .68, .60], trim: [.84, .82, .76], bay: 3.0, floor: 4 },
  { id: 'panel-blue', family: 'panel', label: 'Blue steel liner panel', era: 'postwar', tint: [.52, .60, .68], trim: [.66, .72, .78], bay: 2.4, floor: 4 },
  { id: 'brick-mill', family: 'brick', label: 'Mill brick', era: 'works', tint: [.56, .42, .36], trim: [.66, .56, .48], bay: 2.6, floor: 3.6 },
  { id: 'brick-works', family: 'brick', label: 'Works brick, soot band', era: 'works', tint: [.48, .40, .36], trim: [.58, .50, .44], bay: 2.6, floor: 3.6 },
  { id: 'steel-frame', family: 'steel', label: 'Riveted steel frame', era: 'works', tint: [.44, .45, .46], trim: [.58, .59, .60], bay: 4.0, floor: 5 },
  { id: 'steel-glazed', family: 'steel', label: 'Steel frame, glazed', era: 'works', tint: [.47, .49, .50], trim: [.60, .62, .63], bay: 4.0, floor: 5 },
  { id: 'office-strip', family: 'office', label: 'Strip-window site office', era: 'postwar', tint: [.70, .69, .65], trim: [.78, .77, .73], bay: 3.0, floor: 3.4 },
  { id: 'office-brick', family: 'office', label: 'Brick administration block', era: 'works', tint: [.60, .50, .43], trim: [.70, .62, .54], bay: 2.8, floor: 3.6 },
  { id: 'shed-metal', family: 'shed', label: 'Open shed steel', era: 'postwar', tint: [.55, .56, .55], trim: [.62, .63, .62], bay: 2.0, floor: 4 },
];
export const CLADDING_BY_ID = new Map(CLADDING.map(c => [c.id, c]));
export const cladding = (id: CladdingId): Cladding => CLADDING_BY_ID.get(id)!;

/** Invented operators of the flats. Assigned by land use, then hashed per plot. */
export const COMPANIES = {
  steel: ['Kilnside Steel Co', 'Marrow Metal Works', 'Anvil Reach Forging'],
  logistics: ['Reachside Freight', 'Tideway Logistics', 'Northspan Haulage', 'Bayline Distribution'],
  containers: ['Marrow Container Yard', 'Lowmere Terminal Services', 'Gantry Reach Stevedores'],
  scrap: ['Brackewater Scrap & Salvage', 'Cinder Reach Metals', 'Torch & Shear Reclaim'],
  warehousing: ['Depot Nine Storage', 'Coldreach Provision Stores', 'Fenward Bonded Warehouse', 'Saltline Dry Stores'],
  repair: ['Tidehall Maintenance', 'Reachwheel Fleet Service', 'Girderspan Engineering'],
  construction: ['Eastbank Civil Works', 'Marrow Construction Yard', 'Pile & Beam Contractors'],
  utility: ['Cinder Point Power', 'Reachside Grid Substation', 'Lowmere Water Board'],
  bulk: ['Aggregate Reach', 'Bulkline Terminals', 'Marrow Sand & Ballast', 'Coalfen Bulk Stores'],
  office: ['Works Administration', 'Flats Business Centre', 'Meridian Trade Offices'],
  food: ['Marrow Canteen', 'Haul Road Diner', 'Works Tea Bar'],
  fleet: ['Flats Truck Stop', 'Gantry Fuel Point', 'Reachside Tyre & Lube'],
} as const;
export type CompanyKind = keyof typeof COMPANIES;

/** Street vocabulary: haulways, ways, reaches, rows and the old belt names. */
export const WAY_NAMES: readonly string[] = [
  'Westworks Way', 'Bellmouth Way', 'Girderspan Way', 'Gantry Way', 'Eastbank Way',
];
export const ROAD_NAMES: readonly string[] = [
  'Cinder Road', 'Furnace Road', 'Foundry Road', 'Tanner Road', 'Haulgate Road', 'Quayside Road',
];
export const SERVICE_NAMES: readonly string[] = [
  'Works Lane', 'Depot Lane', 'Yard Lane', 'Shed Lane', 'Belt Lane', 'Siding Lane',
  'Pallet Lane', 'Drum Lane', 'Gauge Lane', 'Anvil Lane', 'Pier Lane', 'Wagon Lane',
];

/**
 * Anchor facilities: the authored heart of the district. Anchors are defined as
 * rectangles in works-grid space and carry their own part lists; the plan clips them to
 * the footprint, the regional corridors and the rail before parts are laid out.
 */
export type AnchorPartKind =
  | 'hall' | 'warehouse' | 'office' | 'workshop' | 'canteen' | 'gatehouse' | 'silo'
  | 'tank' | 'stack' | 'shed' | 'substation' | 'frame' | 'cabin-row' | 'none';

export type AnchorPart = {
  id: string;
  kind: AnchorPartKind;
  /** Normalised rectangle inside the anchor's clipped area. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  height?: number;
  cladding?: CladdingId;
  name?: string;
  company?: CompanyKind;
  interior?: string;
  /** Yard content the part lays around itself. */
  yard?: 'containers' | 'scrap' | 'logs' | 'trailers' | 'trucks' | 'vans' | 'aggregate'
    | 'pipe' | 'barrels' | 'pallets' | 'machinery' | 'wrecks' | 'frames' | 'plant';
  roof?: 'sawtooth' | 'barrel' | 'flat' | 'gable';
};

export type Anchor = {
  id: string;
  name: string;
  company: CompanyKind;
  zone: string;
  /** Works-grid rectangle, clipped to the district by the plan. */
  rect: { u0: number; u1: number; v0: number; v1: number };
  parts: readonly AnchorPart[];
  condition: 'active' | 'renovated' | 'construction' | 'abandoned';
  fenced: boolean;
  /** Rail-served: a stub is cut into the site from the nearest corridor track. */
  railServed?: boolean;
  blurb: string;
};

export const ANCHORS: readonly Anchor[] = [
  {
    id: 'kilnside', name: 'Kilnside Steel Works', company: 'steel', zone: 'heavy',
    rect: { u0: -545, u1: -110, v0: -1045, v1: -640 },
    condition: 'renovated', fenced: true, railServed: true,
    blurb: 'The anchor of the north flats: two riveted mill halls under sawtooth glass, a pair of 68 m stacks, a transformer yard and its own rail stub. Re-lined and working.',
    parts: [
      { id: 'mill-a', kind: 'hall', rect: { u0: .05, u1: .40, v0: .10, v1: .56 }, height: 24, cladding: 'steel-glazed', name: 'Kilnside Mill Hall A', interior: 'kilnside-floor', roof: 'sawtooth', yard: 'pipe' },
      { id: 'mill-b', kind: 'hall', rect: { u0: .44, u1: .74, v0: .10, v1: .56 }, height: 21, cladding: 'steel-frame', name: 'Kilnside Mill Hall B', roof: 'barrel', yard: 'machinery' },
      { id: 'stacks', kind: 'stack', rect: { u0: .78, u1: .86, v0: .14, v1: .50 }, height: 68 },
      { id: 'office', kind: 'office', rect: { u0: .05, u1: .17, v0: .64, v1: .88 }, height: 15, cladding: 'office-brick', name: 'Kilnside Counting House' },
      { id: 'substation', kind: 'substation', rect: { u0: .21, u1: .38, v0: .64, v1: .88 } },
      { id: 'store', kind: 'shed', rect: { u0: .44, u1: .62, v0: .64, v1: .88 }, height: 10, cladding: 'corrugated-painted', yard: 'barrels' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .80, u1: .90, v0: .68, v1: .84 }, name: 'Kilnside Gate' },
    ],
  },
  {
    id: 'cinder-point', name: 'Cinder Point Power Yard', company: 'utility', zone: 'utility',
    rect: { u0: -1025, u1: -855, v0: -1045, v1: -500 },
    condition: 'active', fenced: true,
    blurb: 'The flats\' own supply: a fenced substation, a bank of generator sets, a water tower and two fuel tanks behind the Westworks gate.',
    parts: [
      { id: 'substation', kind: 'substation', rect: { u0: .08, u1: .88, v0: .06, v1: .34 } },
      { id: 'gen-hall', kind: 'shed', rect: { u0: .08, u1: .52, v0: .40, v1: .66 }, height: 12, cladding: 'panel-grey', name: 'Cinder Point Generator Hall', yard: 'machinery' },
      { id: 'tank-a', kind: 'tank', rect: { u0: .60, u1: .78, v0: .40, v1: .58 }, height: 14 },
      { id: 'tank-b', kind: 'tank', rect: { u0: .60, u1: .78, v0: .62, v1: .80 }, height: 14 },
      { id: 'tower', kind: 'silo', rect: { u0: .30, u1: .46, v0: .72, v1: .94 }, height: 30, name: 'Cinder Point Water Tower' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .08, u1: .22, v0: .78, v1: .94 } },
    ],
  },
  {
    id: 'works-admin', name: 'Westworks Administration', company: 'office', zone: 'offices',
    rect: { u0: -1020, u1: -600, v0: 400, v1: 715 },
    condition: 'renovated', fenced: false,
    blurb: 'The front door from downtown: a renovated four-storey administration block, the Marrow Canteen and gate plaza, van and cycle courts, and a worker bus stop on Sound Parkway.',
    parts: [
      { id: 'admin', kind: 'office', rect: { u0: .06, u1: .40, v0: .10, v1: .55 }, height: 21, cladding: 'office-strip', name: 'Westworks Administration', interior: 'works-office' },
      { id: 'canteen', kind: 'canteen', rect: { u0: .46, u1: .74, v0: .10, v1: .38 }, height: 8, cladding: 'brick-mill', name: 'Marrow Canteen', interior: 'marrow-canteen', yard: 'vans' },
      { id: 'plaza', kind: 'none', rect: { u0: .06, u1: .74, v0: .58, v1: .96 }, yard: 'vans' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .80, u1: .94, v0: .60, v1: .78 } },
    ],
  },
  {
    id: 'meridian-freight', name: 'Meridian Freight Hub', company: 'logistics', zone: 'logistics',
    rect: { u0: 20, u1: 380, v0: 320, v1: 730 },
    condition: 'active', fenced: true, railServed: true,
    blurb: 'A cross-dock big box with twenty-four dock doors on the Gantry Reach apron, forty trailer stalls, a fuel canopy and a rail stub at its east gable. The busiest gate on the flats.',
    parts: [
      { id: 'hub', kind: 'warehouse', rect: { u0: .06, u1: .74, v0: .08, v1: .58 }, height: 17, cladding: 'panel-blue', name: 'Meridian Freight Hub', interior: 'freight-warehouse', roof: 'flat', yard: 'pallets' },
      { id: 'dock-apron', kind: 'none', rect: { u0: .06, u1: .74, v0: .60, v1: .72 }, yard: 'trailers' },
      { id: 'trailer-park', kind: 'none', rect: { u0: .06, u1: .50, v0: .74, v1: .96 }, yard: 'trailers' },
      { id: 'fuel', kind: 'shed', rect: { u0: .56, u1: .74, v0: .76, v1: .94 }, height: 7, cladding: 'corrugated-painted', name: 'Gantry Fuel Point', yard: 'trucks' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .02, u1: .10, v0: .40, v1: .56 }, name: 'Hub Gate 1' },
    ],
  },
  {
    id: 'tidehall', name: 'Tidehall Maintenance Depot', company: 'repair', zone: 'repair',
    rect: { u0: -545, u1: -265, v0: 325, v1: 730 },
    condition: 'active', fenced: true,
    blurb: 'Fleet repair for the flats: a six-bay workshop with inspection pits, a parts store, a tyre cage and a motor pool of vans and lorries behind the Dock Road fence.',
    parts: [
      { id: 'workshop', kind: 'workshop', rect: { u0: .06, u1: .58, v0: .08, v1: .44 }, height: 11, cladding: 'corrugated-painted', name: 'Tidehall Workshop', interior: 'tidehall-workshop', roof: 'barrel' },
      { id: 'parts', kind: 'warehouse', rect: { u0: .62, u1: .94, v0: .08, v1: .40 }, height: 9, cladding: 'panel-sand', yard: 'barrels' },
      { id: 'pool', kind: 'none', rect: { u0: .06, u1: .62, v0: .48, v1: .96 }, yard: 'vans' },
      { id: 'tyres', kind: 'none', rect: { u0: .66, u1: .94, v0: .48, v1: .74 }, yard: 'barrels' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .66, u1: .86, v0: .78, v1: .94 } },
    ],
  },
  {
    id: 'marrow-yard', name: 'Marrow Container Yard', company: 'containers', zone: 'containers',
    rect: { u0: 260, u1: 505, v0: 790, v1: 1255 },
    condition: 'active', fenced: true, railServed: true,
    blurb: 'Gated rows of colour-coded boxes on reach tracks, a reefer rack, two straddle cranes and a cabin office — the yard that will feed the future port directly over its south gate.',
    parts: [
      { id: 'stacks-w', kind: 'none', rect: { u0: .05, u1: .44, v0: .08, v1: .92 }, yard: 'containers' },
      { id: 'stacks-e', kind: 'none', rect: { u0: .56, u1: .92, v0: .08, v1: .70 }, yard: 'containers' },
      { id: 'reefer', kind: 'none', rect: { u0: .56, u1: .92, v0: .72, v1: .86 }, yard: 'containers' },
      { id: 'cabin', kind: 'office', rect: { u0: .47, u1: .53, v0: .74, v1: .92 }, height: 7, cladding: 'panel-sand', name: 'Marrow Yard Office' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .47, u1: .53, v0: .02, v1: .06 }, name: 'Marrow Gate' },
    ],
  },
  {
    id: 'brackewater', name: 'Brackewater Scrap & Salvage', company: 'scrap', zone: 'scrap',
    rect: { u0: 610, u1: 790, v0: -152, v1: 360 },
    condition: 'abandoned', fenced: true, railServed: true,
    blurb: 'Half-given-back-to-the-river salvage yard: bale mountains, a rail-fed magnet crane, a crusher shed, stacked wrecks and an office whose windows went years ago. Favourite ground of anyone who does not want to be seen.',
    parts: [
      { id: 'bales', kind: 'none', rect: { u0: .05, u1: .52, v0: .05, v1: .55 }, yard: 'scrap' },
      { id: 'crusher', kind: 'shed', rect: { u0: .56, u1: .92, v0: .05, v1: .34 }, height: 14, cladding: 'corrugated-rust', name: 'Brackewater Crusher', yard: 'machinery' },
      { id: 'wrecks', kind: 'none', rect: { u0: .05, u1: .44, v0: .60, v1: .95 }, yard: 'wrecks' },
      { id: 'crane', kind: 'none', rect: { u0: .48, u1: .72, v0: .44, v1: .95 }, yard: 'scrap' },
      { id: 'office', kind: 'office', rect: { u0: .76, u1: .94, v0: .44, v1: .62 }, height: 8, cladding: 'brick-works', name: 'Brackewater Office (derelict)' },
      { id: 'gate', kind: 'gatehouse', rect: { u0: .76, u1: .92, v0: .78, v1: .94 } },
    ],
  },
  {
    id: 'eastbank', name: 'Eastbank Civil Works Site', company: 'construction', zone: 'construction',
    rect: { u0: 690, u1: 830, v0: 395, v1: 730 },
    condition: 'construction', fenced: true,
    blurb: 'The newest ground on the flats: a warehouse rising on an exposed steel frame under a tower crane, with excavators, pipe stacks, site cabins and concrete barriers at the gate.',
    parts: [
      { id: 'frame', kind: 'frame', rect: { u0: .08, u1: .62, v0: .10, v1: .70 }, height: 14, name: 'Eastbank Warehouse (rising)' },
      { id: 'crane', kind: 'none', rect: { u0: .66, u1: .78, v0: .16, v1: .34 }, yard: 'plant' },
      { id: 'laydown', kind: 'none', rect: { u0: .08, u1: .62, v0: .74, v1: .95 }, yard: 'pipe' },
      { id: 'cabins', kind: 'cabin-row', rect: { u0: .66, u1: .94, v0: .42, v1: .66 } },
      { id: 'plant-yard', kind: 'none', rect: { u0: .66, u1: .94, v0: .72, v1: .95 }, yard: 'plant' },
    ],
  },
];
export const ANCHOR_BY_ID = new Map(ANCHORS.map(a => [a.id, a]));

/** Interior-ready destinations: the enterable buildings of the flats. */
export const INTERIORS = {
  'kilnside-floor': { anchor: 'kilnside', part: 'mill-a', kind: 'factory', name: 'Kilnside Mill Hall A' },
  'freight-warehouse': { anchor: 'meridian-freight', part: 'hub', kind: 'warehouse', name: 'Meridian Freight Hub' },
  'tidehall-workshop': { anchor: 'tidehall', part: 'workshop', kind: 'workshop', name: 'Tidehall Workshop' },
  'works-office': { anchor: 'works-admin', part: 'admin', kind: 'office', name: 'Westworks Administration' },
  'depot-warehouse': { kind: 'warehouse', name: 'Depot Nine Cold Store' },
  'marrow-canteen': { anchor: 'works-admin', part: 'canteen', kind: 'canteen', name: 'Marrow Canteen' },
} as const;
export type InteriorId = keyof typeof INTERIORS;

/** Signage atlas names: gate boards, fascia signs and hazard placards. */
export const SIGN_POOL: readonly string[] = [
  ...COMPANIES.steel, ...COMPANIES.logistics, ...COMPANIES.containers, ...COMPANIES.scrap,
  ...COMPANIES.warehousing, ...COMPANIES.repair, ...COMPANIES.construction, ...COMPANIES.utility,
  ...COMPANIES.bulk, ...COMPANIES.office, ...COMPANIES.food, ...COMPANIES.fleet,
  'HARD HAT AREA', 'SITE OFFICE', 'NO ENTRY', 'LOADING ZONE', 'KEEP CLEAR',
];
