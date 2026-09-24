/**
 * Downtown identity: the district's own name, its original places, its facade language
 * and the shop signs you read at street level.
 *
 * Every name and form here is invented for this region. No landmark, tower, hotel,
 * museum, station, bank or street is modelled on a real building or a real city plan.
 */
import type { Point } from '../world/data';

export const IDENTITY = {
  city: 'Lowmere',
  district: 'Downtown',
  longName: 'Lowmere Downtown',
  subtitle: 'The Meridian core',
  plan: 'Reach Grid',
  survey: 'DISTRICT SURVEY 02',
  note: 'One complete district: the Meridian core. The other eleven regional districts remain reserved.',
} as const;

/**
 * Facade families. A family owns one texture; the individual styles are that texture
 * tinted and scaled per building. Nineteen styles therefore cost eight materials, which
 * is what keeps a dense block down to a handful of draw calls.
 */
export type FacadeFamily = 'glass' | 'ribbon' | 'masonry' | 'terracotta' | 'balcony' | 'stone' | 'slat' | 'service';
export type FacadeStyleId =
  | 'glass-blue' | 'glass-green' | 'glass-silver' | 'glass-bronze'
  | 'office-ribbon' | 'office-brutal' | 'office-terracotta'
  | 'historic-masonry' | 'historic-renovated' | 'historic-terracotta'
  | 'mixed-use' | 'luxury-stone' | 'residential-balcony' | 'residential-brick'
  | 'hotel' | 'civic-stone' | 'parking-slat' | 'service-wall' | 'museum-stone';

export type FacadeStyle = {
  id: FacadeStyleId;
  family: FacadeFamily;
  label: string;
  era: 'contemporary' | 'late-modern' | 'interwar' | 'renovated';
  /** Base tint multiplied into the facade texture; variance per building is applied on top. */
  tint: readonly [number, number, number];
  glass: readonly [number, number, number];
  /** Module size in metres: the design grid the facade texture is authored against. */
  bay: number;
  floor: number;
  /** Recommended height band in metres; landmarks override it. */
  minHeight: number;
  maxHeight: number;
  /** Relative share when the generator picks a style for an ordinary parcel. */
  weight: number;
  detail: 'curtain' | 'ribbon' | 'punched' | 'balcony' | 'slat' | 'plain';
  trim: readonly [number, number, number];
};

export const FACADE_STYLES: readonly FacadeStyle[] = [
  { id: 'glass-blue', family: 'glass', label: 'Blue curtain wall', era: 'contemporary', tint: [.62, .70, .78], glass: [.30, .44, .56], bay: 3.2, floor: 3.9, minHeight: 60, maxHeight: 300, weight: 1.5, detail: 'curtain', trim: [.70, .74, .78] },
  { id: 'glass-green', family: 'glass', label: 'Green curtain wall', era: 'contemporary', tint: [.58, .70, .68], glass: [.26, .42, .40], bay: 3.2, floor: 3.9, minHeight: 48, maxHeight: 240, weight: 1.25, detail: 'curtain', trim: [.66, .72, .71] },
  { id: 'glass-silver', family: 'glass', label: 'Silver curtain wall', era: 'contemporary', tint: [.74, .76, .78], glass: [.52, .58, .63], bay: 3.2, floor: 3.8, minHeight: 55, maxHeight: 280, weight: 1.15, detail: 'curtain', trim: [.78, .80, .82] },
  { id: 'glass-bronze', family: 'glass', label: 'Bronze curtain wall', era: 'contemporary', tint: [.70, .63, .52], glass: [.42, .36, .27], bay: 3.3, floor: 3.9, minHeight: 70, maxHeight: 260, weight: .8, detail: 'curtain', trim: [.74, .68, .55] },
  { id: 'luxury-stone', family: 'stone', label: 'Polished stone tower', era: 'contemporary', tint: [.80, .76, .68], glass: [.44, .50, .55], bay: 3.5, floor: 3.7, minHeight: 80, maxHeight: 240, weight: .7, detail: 'ribbon', trim: [.86, .83, .75] },
  { id: 'office-ribbon', family: 'ribbon', label: 'Ribbon-window office', era: 'late-modern', tint: [.72, .71, .66], glass: [.38, .44, .48], bay: 3.1, floor: 3.7, minHeight: 28, maxHeight: 130, weight: 1.35, detail: 'ribbon', trim: [.78, .77, .72] },
  { id: 'office-brutal', family: 'ribbon', label: 'Concrete-frame office', era: 'late-modern', tint: [.66, .65, .60], glass: [.34, .38, .40], bay: 3.4, floor: 3.8, minHeight: 32, maxHeight: 120, weight: 1, detail: 'ribbon', trim: [.72, .71, .66] },
  { id: 'office-terracotta', family: 'terracotta', label: 'Terracotta office', era: 'interwar', tint: [.69, .58, .46], glass: [.36, .36, .34], bay: 3.0, floor: 3.9, minHeight: 24, maxHeight: 90, weight: .85, detail: 'punched', trim: [.76, .66, .52] },
  { id: 'historic-masonry', family: 'masonry', label: 'Masonry commercial', era: 'interwar', tint: [.66, .55, .46], glass: [.33, .34, .33], bay: 3.0, floor: 4.1, minHeight: 14, maxHeight: 46, weight: 1.1, detail: 'punched', trim: [.74, .65, .56] },
  { id: 'historic-terracotta', family: 'terracotta', label: 'Glazed terracotta', era: 'interwar', tint: [.68, .60, .47], glass: [.34, .34, .32], bay: 2.9, floor: 4.0, minHeight: 18, maxHeight: 60, weight: .75, detail: 'punched', trim: [.78, .71, .56] },
  { id: 'historic-renovated', family: 'masonry', label: 'Renovated heritage', era: 'renovated', tint: [.74, .70, .63], glass: [.40, .46, .50], bay: 3.1, floor: 4.0, minHeight: 16, maxHeight: 58, weight: .9, detail: 'punched', trim: [.82, .78, .70] },
  { id: 'mixed-use', family: 'masonry', label: 'Mixed-use block', era: 'renovated', tint: [.70, .65, .57], glass: [.38, .42, .44], bay: 3.1, floor: 3.8, minHeight: 12, maxHeight: 52, weight: 1.4, detail: 'punched', trim: [.78, .73, .65] },
  { id: 'residential-balcony', family: 'balcony', label: 'Balcony apartment tower', era: 'contemporary', tint: [.73, .70, .64], glass: [.42, .47, .50], bay: 3.3, floor: 3.4, minHeight: 34, maxHeight: 190, weight: 1.2, detail: 'balcony', trim: [.81, .78, .72] },
  { id: 'residential-brick', family: 'masonry', label: 'Brick apartment house', era: 'interwar', tint: [.64, .50, .43], glass: [.34, .35, .34], bay: 2.9, floor: 3.4, minHeight: 12, maxHeight: 34, weight: 1, detail: 'punched', trim: [.72, .58, .50] },
  { id: 'hotel', family: 'balcony', label: 'Hotel slab', era: 'late-modern', tint: [.72, .68, .60], glass: [.40, .44, .46], bay: 3.1, floor: 3.5, minHeight: 40, maxHeight: 190, weight: .5, detail: 'balcony', trim: [.79, .75, .67] },
  { id: 'civic-stone', family: 'stone', label: 'Civic stone', era: 'interwar', tint: [.76, .73, .66], glass: [.38, .42, .46], bay: 3.2, floor: 4.4, minHeight: 18, maxHeight: 70, weight: .35, detail: 'punched', trim: [.85, .82, .75] },
  { id: 'museum-stone', family: 'stone', label: 'Gallery stone', era: 'contemporary', tint: [.82, .80, .75], glass: [.44, .50, .54], bay: 3.6, floor: 4.6, minHeight: 12, maxHeight: 42, weight: .2, detail: 'plain', trim: [.88, .87, .83] },
  { id: 'parking-slat', family: 'slat', label: 'Open parking deck', era: 'contemporary', tint: [.63, .63, .60], glass: [.18, .19, .20], bay: 2.8, floor: 3.1, minHeight: 12, maxHeight: 34, weight: .35, detail: 'slat', trim: [.70, .70, .67] },
  { id: 'service-wall', family: 'service', label: 'Service wall', era: 'late-modern', tint: [.58, .58, .56], glass: [.30, .31, .31], bay: 3.0, floor: 3.6, minHeight: 6, maxHeight: 30, weight: .3, detail: 'plain', trim: [.64, .64, .62] },
];
export const STYLE_BY_ID = new Map(FACADE_STYLES.map(s => [s.id, s]));
export const facadeStyle = (id: FacadeStyleId): FacadeStyle => STYLE_BY_ID.get(id)!;

/** Street-level tenants. Assigned to ground-floor units by zone, not at random. */
export const TENANTS = {
  bank: ['Meridian Trust', 'Lowmere Savings', 'Harbour & Fen', 'Cordwain Mutual', 'Northgate Provident', 'Sable & Pike Bank'],
  cafe: ['Kiln Coffee', 'Fennel & Fig', 'Steam Row Roasters', 'Bellhouse Coffee', 'The Copper Pot', 'Press Yard Espresso', 'Parade Café'],
  restaurant: ['The Salt Cellar', 'Verge Kitchen', 'Anvil & Ash', 'The Lantern Room', 'Trent Oyster Bar', 'Sable & Sage', 'Chandlery Table', 'Harrow Noodle House'],
  retail: ['Wren & Co', 'Chandlers', 'Glasshouse Books', 'Tannery Leather', 'Marlow Menswear', 'Corvid Records', 'Bexley Pharmacy', 'Alder Hardware', 'Kestrel Optics', 'Quill Stationers'],
  market: ['Copperfield Fishmonger', 'Verge Greengrocer', 'Lowmere Cheese Co', 'Saltmarsh Flowers', 'Anchor Baker', 'Fairhaven Butchery'],
  service: ['City Laundry', 'Quick Copy', 'Parade Barbers', 'Meridian Dry Cleaners', 'Reach Repair', 'Lowmere Post'],
  office: ['Kestrel Group', 'Reachmark Capital', 'Halcyon Hotels', 'Lowmere Herald', 'Fennel Studio', 'Anvil Works', 'Verge Architects'],
  hotel: ['Halcyon Grand Hotel'],
  civic: ['Lowmere City Hall', 'Downtown Library', 'Municipal Court', 'Registry Office'],
  transit: ['Meridian Interchange'],
  culture: ['The Verge', 'Copperfield Market Hall', 'Sable Playhouse'],
} as const;
export type TenantKind = keyof typeof TENANTS;

/** Landmark catalogue. These are the places the skyline is organised around. */
export type Landmark = {
  id: string;
  name: string;
  kind: string;
  height: number;
  floors: number;
  blurb: string;
  style: FacadeStyleId;
  site: string;
  interior?: string;
  address: string;
};
export const LANDMARKS: readonly Landmark[] = [
  { id: 'kestrel', name: 'Kestrel Tower', kind: 'Corporate headquarters', height: 292, floors: 68, blurb: 'The tallest structure in Morrow Reach: a faceted glass shaft stepping back three times to a slanted crown and a lit mast.', style: 'glass-blue', site: 'kestrel', interior: 'kestrel-lobby', address: 'Meridian Avenue' },
  { id: 'meridian-plaza', name: 'Meridian Plaza', kind: 'Central plaza', height: 0, floors: 0, blurb: 'The civic room of downtown: a granite forum with a fountain, plane trees and an amphitheatre facing City Hall.', style: 'civic-stone', site: 'civic', address: 'Lantern Avenue' },
  { id: 'civic-hall', name: 'Lowmere Civic Hall', kind: 'City hall', height: 54, floors: 11, blurb: 'A stone council hall with a colonnade and a clock tower, holding the east end of Meridian Plaza.', style: 'civic-stone', site: 'civic', interior: 'civic-hall', address: 'Meridian Plaza' },
  { id: 'halcyon', name: 'Halcyon Grand Hotel', kind: 'Grand hotel', height: 152, floors: 42, blurb: 'A 42-storey hotel slab on a limestone podium with a porte-cochère, ballroom wing and roof garden.', style: 'hotel', site: 'hotel', interior: 'halcyon-lobby', address: 'Market Street' },
  { id: 'reachmark', name: 'Reachmark Financial Center', kind: 'Financial headquarters', height: 214, floors: 49, blurb: 'Two offset glass slabs sharing a sky lobby above a full-block colonnade and a sunken trading floor.', style: 'glass-green', site: 'reachmark', interior: 'reachmark-hall', address: 'Lantern Avenue' },
  { id: 'trust', name: 'Lowmere Trust Building', kind: 'Renovated bank headquarters', height: 71, floors: 16, blurb: 'A 1920s masonry bank headquarters, cleaned and re-glazed, with a new glass banking hall cut into its courtyard.', style: 'historic-renovated', site: 'trust', address: 'Cordwain Street' },
  { id: 'verge', name: 'The Verge', kind: 'Museum of modern art', height: 33, floors: 5, blurb: 'Stacked stone galleries cantilevered over a sculpture court, with a sawtooth roof over the top-lit hall.', style: 'museum-stone', site: 'museum', interior: 'verge-gallery', address: 'Verge Street' },
  { id: 'interchange', name: 'Meridian Interchange', kind: 'Central transit station', height: 27, floors: 2, blurb: 'A glazed barrel-vaulted concourse over underground platforms, with a bus forecourt and tram stops on Lantern Avenue.', style: 'glass-silver', site: 'station', interior: 'interchange', address: 'Lantern Avenue' },
  { id: 'market-hall', name: 'Copperfield Market Hall', kind: 'Renovated market hall', height: 21, floors: 2, blurb: 'An iron-and-glass market hall of 1897, rebuilt as food hall and shops around a cobbled market square.', style: 'historic-renovated', site: 'market', address: 'Copperfield Street' },
  { id: 'anvil', name: 'The Anvil', kind: 'Converted industrial building', height: 38, floors: 8, blurb: 'A former ironworks office block converted to loft offices, keeping its riveted frame and hoist tower.', style: 'historic-terracotta', site: 'anvil', address: 'Verge Street' },
  { id: 'solstice', name: 'Solstice Residences', kind: 'Luxury apartment tower', height: 186, floors: 54, blurb: 'A curved tower of stacked balconies with a winter garden at the top and a private court below.', style: 'residential-balcony', site: 'solstice', address: 'Copperfield Street' },
  { id: 'northgate-deck', name: 'Northgate Deck', kind: 'Multi-storey car park', height: 27, floors: 8, blurb: 'An eight-level open-deck garage with a planted screen, serving the northern office blocks.', style: 'parking-slat', site: 'northgate-deck', address: 'Tannery Row' },
  { id: 'fenwick-green', name: 'Fenwick Green', kind: 'Park over underground parking', height: 0, floors: 0, blurb: 'A lawn square with two levels of public parking beneath, reached by ramps off Saltmarsh Street.', style: 'service-wall', site: 'fenwick-green', interior: 'fenwick-garage', address: 'Saltmarsh Street' },
  { id: 'lantern-court', name: 'Lantern Court Garage', kind: 'Underground parking', height: 0, floors: 0, blurb: 'Two basement levels under a paved court, entered from the service alley off Tannery Row.', style: 'service-wall', site: 'lantern-court', address: 'Tannery Row' },
  { id: 'wren-park', name: 'Wren Park', kind: 'Neighbourhood park', height: 0, floors: 0, blurb: 'A small park with a playground, a dog run and a drinking fountain on the residential west side.', style: 'service-wall', site: 'wren-park', address: 'Tannery Row' },
  { id: 'anchor-square', name: 'Anchor Square', kind: 'Residential square', height: 0, floors: 0, blurb: 'A granite-paved square with a bosque of lindens, benches and a kiosk café on the south-east edge.', style: 'service-wall', site: 'anchor-square', address: 'Anchor Street' },
];
export const LANDMARK_BY_SITE = new Map(LANDMARKS.map(l => [l.site, l]));

/** Public transport identity used by stops, shelters and station signage. */
export const TRANSIT = {
  operator: 'Lowmere Transit',
  routes: ['M1 Meridian', 'T2 Lantern', 'B4 Tannery', 'B9 Fairhaven', 'X12 Airport', 'C1 Circuit'],
} as const;

export type LandmarkPoint = { id: string; name: string; point: Point; height: number };
