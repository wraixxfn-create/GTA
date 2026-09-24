/**
 * The downtown street plan: grid lines, their hierarchy, widths and names.
 *
 * The plan is an irregular orthogonal grid rotated onto the reservation's long axis and
 * wrapped by a perimeter distributor. Spacing, widths and one-way assignments vary by a
 * deterministic hash, so blocks differ in size the way a real grid does after a century
 * of separate subdivisions — but the layout never changes between runs.
 */
import { CITY_GRID_BOUNDS, makeRandom, hash01 } from './frame';

export type StreetKind =
  | 'boulevard'   // grand multi-lane avenue, two-way
  | 'avenue'      // four-lane avenue, two-way
  | 'street'      // two-lane local street
  | 'lane'        // narrow one-way street
  | 'pedestrian'  // paved, no vehicles
  | 'transit'     // bus / tram priority avenue
  | 'alley'       // service alley inside a block
  | 'service'     // parking access road
  | 'ring';       // perimeter distributor

export type LinePlan = {
  index: number;
  axis: 'u' | 'v';
  offset: number;
  name: string;
  kind: StreetKind;
  width: number;      // carriageway between curbs
  sidewalk: number;   // clear walkway each side
  lanes: number;
  oneWay: 0 | 1 | -1; // 0 = two-way; ±1 = travel direction along +axis
  transit: boolean;
  cycle: boolean;     // kerbside cycle lane
  parking: boolean;   // signed parking bays on one or both sides
};

const PROFILE: Record<StreetKind, { width: number; sidewalk: number; lanes: number }> = {
  boulevard: { width: 33, sidewalk: 6.4, lanes: 6 },
  avenue: { width: 24, sidewalk: 5.4, lanes: 4 },
  street: { width: 15.5, sidewalk: 4.2, lanes: 2 },
  lane: { width: 11.5, sidewalk: 3.6, lanes: 2 },
  pedestrian: { width: 14, sidewalk: 0, lanes: 0 },
  transit: { width: 27, sidewalk: 5.8, lanes: 5 },
  alley: { width: 7.5, sidewalk: 0, lanes: 1 },
  service: { width: 9, sidewalk: 2.6, lanes: 1 },
  ring: { width: 21, sidewalk: 5, lanes: 4 },
};

/** N–S routes (constant u): the district's avenues. */
export const AVENUE_NAMES: readonly string[] = [
  'Sable Avenue', 'Wren Avenue', 'Alder Avenue', 'Kestrel Avenue', 'Vesper Avenue',
  'Fennel Walk', 'Calder Avenue', 'Pike Avenue', 'Meridian Avenue', 'Foundry Avenue',
  'Marlow Avenue', 'Trent Avenue', 'Harrow Avenue', 'Bexley Avenue', 'Corvid Avenue',
  'Saltgate Avenue', 'Anchor Avenue', 'Quill Avenue', 'Emberline Avenue', 'Tidewater Avenue',
];
/** E–W routes (constant v): the district's streets. */
export const STREET_NAMES: readonly string[] = [
  'Northgate Street', 'Chandlery Street', 'Bellhouse Street', 'Tannery Row', 'Glasshouse Street',
  'Cordwain Street', 'Lantern Avenue', 'Market Street', 'Saltmarsh Street', 'Kiln Street',
  'Copperfield Street', 'Verge Street', 'Anchor Street', 'Fairhaven Street', 'Quayside Street',
  'Southgate Street', 'Willowbed Street', 'Brindle Street', 'Press Yard', 'Halcyon Street',
];

/** The two grand E–W routes and the central N–S axis of the plan. */
const GRAND_CROSS_V = 6;      // Lantern Avenue
const MARKET_V = 7;           // Market Street: the pedestrian mall
const MERIDIAN_U = 8;         // Meridian Avenue
const TRANSIT_U = 11;         // Trent Avenue: north–south bus corridor
const WALK_U = 5;             // Fennel Walk: north–south pedestrian link
const CYCLE_U = 3;            // Kestrel Avenue: cycle route

function classifyAvenue(index: number, random: () => number): Pick<LinePlan, 'kind' | 'transit' | 'cycle' | 'oneWay' | 'parking'> {
  if (index === MERIDIAN_U) return { kind: 'boulevard', transit: false, cycle: false, oneWay: 0, parking: false };
  if (index === TRANSIT_U) return { kind: 'transit', transit: true, cycle: false, oneWay: 0, parking: false };
  if (index === WALK_U) return { kind: 'pedestrian', transit: false, cycle: false, oneWay: 0, parking: false };
  if (index === CYCLE_U) return { kind: 'avenue', transit: false, cycle: true, oneWay: 0, parking: false };
  // A repeating A/b/A/b rhythm: a wide avenue, then a one-way pair of narrow lanes.
  const role = index % 3;
  if (role === 0) return { kind: 'avenue', transit: false, cycle: false, oneWay: 0, parking: true };
  if (role === 1) return { kind: 'lane', transit: false, cycle: false, oneWay: index % 2 === 1 ? 1 : -1, parking: true };
  return { kind: random() < .55 ? 'street' : 'avenue', transit: false, cycle: false, oneWay: 0, parking: random() < .6 };
}
function classifyStreet(index: number, random: () => number): Pick<LinePlan, 'kind' | 'transit' | 'cycle' | 'oneWay' | 'parking'> {
  if (index === GRAND_CROSS_V) return { kind: 'transit', transit: true, cycle: false, oneWay: 0, parking: false };
  if (index === MARKET_V) return { kind: 'pedestrian', transit: false, cycle: false, oneWay: 0, parking: false };
  if (index === 1 || index === 13) return { kind: 'avenue', transit: false, cycle: false, oneWay: 0, parking: true };
  const role = index % 2;
  if (role === 0) return { kind: 'street', transit: false, cycle: false, oneWay: 0, parking: random() < .8 };
  return { kind: 'lane', transit: false, cycle: false, oneWay: index % 4 === 1 ? 1 : -1, parking: random() < .5 };
}

/** Walk out from one edge with hashed, irregular spacing until the other edge is passed. */
function lineOffsets(min: number, max: number, target: number, seed: number): number[] {
  const random = makeRandom(seed);
  const offsets: number[] = [];
  let u = min + 26 + random() * 24;
  while (u < max - 26) {
    offsets.push(Math.round(u));
    u += target * (.78 + .46 * random());
  }
  return offsets;
}

function build(axis: 'u' | 'v', names: readonly string[], target: number, seed: number,
  classify: (index: number, random: () => number) => Pick<LinePlan, 'kind' | 'transit' | 'cycle' | 'oneWay' | 'parking'>): LinePlan[] {
  const bounds = CITY_GRID_BOUNDS;
  const offsets = lineOffsets(axis === 'u' ? bounds.minU : bounds.minV, axis === 'u' ? bounds.maxU : bounds.maxV, target, seed);
  const random = makeRandom(seed ^ 0x5f3a);
  return offsets.map((offset, index) => {
    const role = classify(index, random);
    const profile = PROFILE[role.kind];
    return {
      index, axis, offset,
      name: names[index % names.length],
      kind: role.kind,
      width: profile.width,
      sidewalk: profile.sidewalk,
      lanes: profile.lanes,
      oneWay: role.oneWay,
      transit: role.transit,
      cycle: role.cycle,
      parking: role.parking,
    };
  });
}

export const AVENUES: readonly LinePlan[] = build('u', AVENUE_NAMES, 196, 0x1d7a, classifyAvenue);
export const STREETS: readonly LinePlan[] = build('v', STREET_NAMES, 158, 0x2f19, classifyStreet);

/** Cell (i,j) is the block bounded by avenues i, i+1 and streets j, j+1. */
export const CELLS_U = Math.max(0, AVENUES.length - 1);
export const CELLS_V = Math.max(0, STREETS.length - 1);

export function cellRect(i0: number, i1: number, j0: number, j1: number) {
  const a = AVENUES[Math.max(0, Math.min(AVENUES.length - 1, i0))];
  const b = AVENUES[Math.max(0, Math.min(AVENUES.length - 1, i1 + 1))];
  const c = STREETS[Math.max(0, Math.min(STREETS.length - 1, j0))];
  const d = STREETS[Math.max(0, Math.min(STREETS.length - 1, j1 + 1))];
  return {
    minU: Math.min(a.offset, b.offset), maxU: Math.max(a.offset, b.offset),
    minV: Math.min(c.offset, d.offset), maxV: Math.max(c.offset, d.offset),
  };
}
/** Deterministic per-cell variation, shared by parcels, planting and facades. */
export function cellNoise(i: number, j: number, salt = 0): number {
  return hash01(i * 73 + 17, j * 131 + 41, salt);
}
