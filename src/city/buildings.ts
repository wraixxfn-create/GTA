/**
 * Buildings: how a parcel becomes a volume, a facade, an entrance and a tenant.
 *
 * Heights follow distance from the Meridian core and the use assigned to the frontage, so
 * the skyline peaks where the financial district is and falls away towards the residential
 * edges. Landmark sites are authored instead of generated, but they use the same volume,
 * facade and roof vocabulary as everything around them.
 */
import type { Point } from '../world/data';
import { FACADE_STYLES, LANDMARK_BY_SITE, TENANTS, facadeStyle, type FacadeStyleId } from './identity';
import { PLAN, type Parcel, type Use } from './blocks';
import { SITES, type BuildingShape, type SitePart } from './sites';
import {
  CITY_LIMITS, coreDistance, hash01, makeRandom, type ZoneId,
} from './frame';
import {
  clipLeft, distance2d, ensureCCW, insetConvex, lerp2, normalize, polygonArea, polygonCentroid,
  regularPolygon, scale, sub,
} from './geometry2d';

export type RoofKind = 'flat' | 'parapet' | 'mechanical' | 'garden' | 'mast' | 'vault' | 'sawtooth' | 'spire' | 'plant';

export type Volume = {
  polygon: Point[];
  base: number;
  top: number;
  style: FacadeStyleId;
  roof: RoofKind;
  /** Setback distance from the volume below, for terraces and cornices. */
  setback: number;
};

export type Building = {
  id: string;
  name?: string;
  use: Use;
  zone: ZoneId;
  style: FacadeStyleId;
  volumes: Volume[];
  height: number;
  levels: number;
  centre: Point;
  ground: number;
  footprint: Point[];
  roof: RoofKind;
  /** Street entrance: where the doors are and which way they face. */
  entrance: { point: Point; dir: Point; kind: EntranceKind };
  tenants: string[];
  signs: { text: string; kind: TenantKindOf }[];
  tint: number;
  year: number;
  interior?: string;
  landmark?: string;
  cell: { i: number; j: number };
  /** Width of the street frontage, which sets how many shop units fit along it. */
  frontageLength: number;
  /** True when the ground floor is built as shopfronts with awnings and signs. */
  shopfront: boolean;
  /** Rooftop clutter and masts are only worth drawing close up. */
  clutter: number;
};

export type EntranceKind = 'shop' | 'office' | 'lobby' | 'hotel' | 'service' | 'bank' | 'station' | 'museum' | 'civic';
type TenantKindOf = 'shop' | 'office' | 'hotel' | 'bank' | 'civic' | 'transit' | 'none';

const ROOF_BY_STYLE: Record<FacadeStyleId, RoofKind> = {
  'glass-blue': 'mechanical', 'glass-green': 'mechanical', 'glass-silver': 'mechanical',
  'glass-bronze': 'mechanical', 'luxury-stone': 'garden', 'office-ribbon': 'parapet',
  'office-brutal': 'parapet', 'office-terracotta': 'parapet', 'historic-masonry': 'parapet',
  'historic-terracotta': 'parapet', 'historic-renovated': 'parapet', 'mixed-use': 'parapet',
  'residential-balcony': 'plant', 'residential-brick': 'parapet', 'hotel': 'mechanical',
  'civic-stone': 'mast', 'museum-stone': 'sawtooth', 'parking-slat': 'parapet', 'service-wall': 'parapet',
};

/** Height band by use, then scaled by how close the plot is to the core. */
const HEIGHT_BY_USE: Record<Use, [number, number]> = {
  office: [58, 196], retail: [13, 34], apartment: [40, 146], hotel: [52, 168],
  civic: [20, 58], museum: [16, 42], parking: [16, 30], service: [10, 26],
  mixed: [22, 66], market: [14, 30], transit: [14, 32],
};

const STYLE_BY_USE: Record<Use, FacadeStyleId[]> = {
  office: ['glass-blue', 'glass-green', 'glass-silver', 'office-ribbon', 'office-brutal', 'office-terracotta', 'luxury-stone'],
  retail: ['historic-masonry', 'mixed-use', 'historic-renovated', 'historic-terracotta'],
  apartment: ['residential-balcony', 'residential-brick', 'mixed-use', 'glass-silver'],
  hotel: ['hotel', 'luxury-stone', 'glass-bronze'],
  civic: ['civic-stone', 'historic-renovated'],
  museum: ['museum-stone', 'glass-silver'],
  parking: ['parking-slat', 'service-wall'],
  service: ['service-wall', 'office-brutal', 'historic-terracotta'],
  mixed: ['mixed-use', 'historic-renovated', 'office-ribbon', 'residential-brick'],
  market: ['historic-renovated', 'historic-masonry'],
  transit: ['glass-silver', 'museum-stone'],
};

const TENANT_BY_USE: Record<Use, (keyof typeof TENANTS)[]> = {
  office: ['office', 'bank', 'service'], retail: ['retail', 'cafe', 'market'],
  apartment: ['retail', 'cafe', 'service'], hotel: ['hotel'], civic: ['civic'],
  museum: ['culture'], parking: ['service'], service: ['service', 'retail'],
  mixed: ['retail', 'cafe', 'restaurant'], market: ['market', 'restaurant'],
  transit: ['transit', 'cafe'],
};

const ENTRANCE_BY_USE: Record<Use, EntranceKind> = {
  office: 'office', retail: 'shop', apartment: 'lobby', hotel: 'hotel', civic: 'civic',
  museum: 'museum', parking: 'service', service: 'service', mixed: 'shop',
  market: 'shop', transit: 'station',
};

/** Style families whose height band suits this building; glass goes up, brick stays low. */
function pickStyle(pool: FacadeStyleId[], height: number, centre: Point): FacadeStyleId {
  const suited = pool.filter(id => {
    const style = facadeStyle(id);
    return height >= style.minHeight * .8 && height <= style.maxHeight * 1.15;
  });
  const list = suited.length ? suited : pool;
  return list[Math.floor(hash01(Math.round(centre.x / 45), Math.round(centre.z / 45), 3) * list.length)];
}

function pickTenant(kind: keyof typeof TENANTS, seed: number, count = 1): string[] {
  const pool = TENANTS[kind];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pool[Math.floor(hash01(seed, i * 37 + 11, kind.length) * pool.length)]);
  return out;
}

/** Height multiplier from the core: the skyline is a single readable mass, not noise. */
function coreFactor(distance: number, zone: ZoneId): number {
  const falloff = zone === 'residential' ? 900 : zone === 'core' || zone === 'financial' ? 1500 : 1150;
  return 0.42 + 0.58 * Math.exp(-Math.pow(distance / falloff, 1.7));
}

function stackVolumes(footprint: Point[], height: number, style: FacadeStyleId, random: () => number): Volume[] {
  const stacks = height > 150 ? 3 : height > 78 ? 2 : 1;
  const volumes: Volume[] = [];
  let current = ensureCCW(footprint);
  let base = 0;
  for (let i = 0; i < stacks; i++) {
    const top = i === stacks - 1 ? height : height * (0.55 + 0.24 * i + random() * 0.08);
    volumes.push({
      polygon: current, base, top, style,
      roof: i === stacks - 1 ? ROOF_BY_STYLE[style] : 'flat',
      setback: i === 0 ? 0 : 3 + random() * 4,
    });
    if (i < stacks - 1) {
      const shrink = 0.1 + random() * 0.12;
      const next = insetConvex(current, shrink * Math.sqrt(polygonArea(current)) * 0.14);
      if (next.length >= 3 && polygonArea(next) > 90) current = next;
    }
    base = top;
  }
  return volumes;
}

/** Merge neighbouring parcels of the same use into one plot: towers need frontage. */
function mergeParcels(parcels: Parcel[]): Parcel[][] {
  // Lots may only merge along one straight frontage of one carved piece. Merging across
  // a piece boundary would let the union hull span an alley or a service corridor, and
  // merging across a corner would square off the block.
  const byEdge = new Map<string, Parcel[]>();
  for (const parcel of parcels) {
    const key = `${parcel.cell.i}:${parcel.cell.j}:${parcel.serial}:${parcel.band}`;
    const list = byEdge.get(key) ?? [];
    list.push(parcel);
    byEdge.set(key, list);
  }
  const groups: Parcel[][] = [];
  for (const list of byEdge.values()) {
    const axis = list[0].frontage.dir;
    const station = (parcel: Parcel) => {
      const middle = {
        x: (parcel.frontage.a.x + parcel.frontage.b.x) / 2,
        z: (parcel.frontage.a.z + parcel.frontage.b.z) / 2,
      };
      return middle.x * axis.x + middle.z * axis.z;
    };
    list.sort((a, b) => station(a) - station(b));
    let run: Parcel[] = [];
    const flush = () => { if (run.length) groups.push(run); run = []; };
    for (const parcel of list) {
      const previous = run[run.length - 1];
      const touching = !previous || Math.min(
        distance2d(previous.frontage.a, parcel.frontage.a), distance2d(previous.frontage.a, parcel.frontage.b),
        distance2d(previous.frontage.b, parcel.frontage.a), distance2d(previous.frontage.b, parcel.frontage.b),
      ) < 1.5;
      if (previous && !touching) flush();
      const merging = run.length > 0 && run[0].use === parcel.use && touching &&
        hash01(Math.round(parcel.frontage.a.x), Math.round(parcel.frontage.a.z), 91) < mergeChance(parcel.use);
      const width = run.reduce((sum, p) => sum + p.frontage.length, 0) + parcel.frontage.length;
      if (merging && width < 96) run.push(parcel);
      else { flush(); run = [parcel]; }
    }
    flush();
  }
  return groups;
}
function mergeChance(use: Use): number {
  return use === 'office' ? .42 : use === 'apartment' ? .3 : use === 'retail' ? .12 : .2;
}

function mergedFootprint(group: Parcel[]): { polygon: Point[]; frontage: Parcel['frontage'] } {
  if (group.length === 1) return { polygon: group[0].polygon, frontage: group[0].frontage };
  // Union of convex neighbours along a straight frontage: hull of all their corners.
  const points = group.flatMap(p => p.polygon);
  const centre = polygonCentroid(points);
  const sorted = [...points].sort((a, b) =>
    Math.atan2(a.z - centre.z, a.x - centre.x) - Math.atan2(b.z - centre.z, b.x - centre.x));
  const hull: Point[] = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
    hull.push(point);
  }
  const frontages = group.map(p => p.frontage);
  const a = frontages.reduce((best, f) => (distance2d(f.a, frontages[0].a) > distance2d(best.a, frontages[0].a) ? f : best), frontages[0]);
  const b = frontages.reduce((best, f) => (distance2d(f.b, frontages[0].a) > distance2d(best.b, frontages[0].a) ? f : best), frontages[0]);
  return {
    polygon: hull.length >= 3 ? hull : group[0].polygon,
    frontage: { a: a.a, b: b.b, length: distance2d(a.a, b.b), dir: a.dir, normal: a.normal },
  };
}
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function entranceFor(parcel: Parcel, footprint: Point[], use: Use): Building['entrance'] {
  const { a, b, normal } = parcel.frontage;
  const mid = lerp2(a, b, 0.5);
  // Push the door slightly into the facade so it reads as a recessed entrance.
  const point = { x: mid.x + normal.x * 0.4, z: mid.z + normal.z * 0.4 };
  return { point, dir: { x: -normal.x, z: -normal.z }, kind: ENTRANCE_BY_USE[use] };
}

export type BuildResult = {
  buildings: Building[];
  landmarks: Building[];
  openSpace: { polygon: Point[]; kind: 'plaza' | 'lawn' | 'apron' | 'cobbles' | 'terrace'; feature: string; site?: string }[];
};

export const CITY: BuildResult = (() => {
  const random = makeRandom(0x2b19c7);
  const buildings: Building[] = [];
  const groups = mergeParcels(PLAN.parcels);

  for (const group of groups) {
    const parcel = group[0];
    const { polygon, frontage } = mergedFootprint(group);
    let footprint = ensureCCW(polygon);
    if (footprint.length < 3 || polygonArea(footprint) < CITY_LIMITS.minParcelArea * .8) continue;
    const centre = polygonCentroid(footprint);
    const use = parcel.use;
    const [lo, hi] = HEIGHT_BY_USE[use];
    const factor = coreFactor(coreDistance(centre.x, centre.z), parcel.zone);
    const noise = 0.72 + 0.56 * hash01(Math.round(centre.x), Math.round(centre.z), 5);
    let height = (lo + (hi - lo) * Math.pow(hash01(Math.round(centre.x), Math.round(centre.z), 9), 1.35)) * factor * noise;
    height = Math.max(6.5, Math.min(CITY_LIMITS.maxOrdinaryHeight, height));
    // Facades are picked from the families that suit the height, then correlated along
    // the street, so a row arrives in runs instead of alternating at random.
    const styleId = pickStyle(STYLE_BY_USE[use], height, centre);
    const style = facadeStyle(styleId);
    // A podium under a tower: the first three floors hold the street frontage.
    const podium = height > 55 && polygonArea(footprint) > 700 ? 12 + random() * 6 : 0;
    const towerFootprint = podium ? insetConvex(footprint, 4 + random() * 4) : footprint;
    const volumes: Volume[] = [];
    if (podium) {
      volumes.push({ polygon: footprint, base: 0, top: podium, style: styleId, roof: 'garden', setback: 0 });
      if (towerFootprint.length >= 3 && polygonArea(towerFootprint) > 120) {
        // `height` is the building's total height, including its podium. Stacking the full
        // target above the podium silently exceeded the ordinary skyline cap by 12–18 m.
        volumes.push(...stackVolumes(towerFootprint, height - podium, styleId, random).map(v => ({
          ...v, base: v.base + podium, top: v.top + podium,
        })));
      }
    } else {
      volumes.push(...stackVolumes(footprint, height, styleId, random));
    }
    if (!volumes.length) continue;
    const levels = Math.max(1, Math.round(height / style.floor));
    const tenantKinds = TENANT_BY_USE[use];
    const kind = tenantKinds[Math.floor(hash01(Math.round(centre.x), Math.round(centre.z), 13) * tenantKinds.length)];
    const shopfront = (use === 'retail' || use === 'mixed' || use === 'market') ||
      (height < 46 && hash01(Math.round(centre.x), Math.round(centre.z), 17) < .55);
    const units = shopfront ? Math.max(1, Math.round(frontage.length / (use === 'retail' ? 8 : 12))) : 1;
    const signs = shopfront
      ? pickTenant(kind, Math.round(centre.x), Math.min(4, units)).map(text => ({ text, kind: 'shop' as TenantKindOf }))
      : use === 'office' || use === 'hotel' || use === 'civic'
        ? [{ text: pickTenant(use === 'office' ? 'office' : use === 'hotel' ? 'hotel' : 'civic', Math.round(centre.x))[0], kind: 'office' as TenantKindOf }]
        : [];
    buildings.push({
      id: `bld-${parcel.id}`,
      use, zone: parcel.zone, style: styleId, volumes,
      height: volumes.reduce((top, v) => Math.max(top, v.top), 0),
      levels,
      centre,
      ground: 0,
      footprint,
      roof: volumes[volumes.length - 1].roof,
      entrance: entranceFor(parcel, footprint, use),
      tenants: shopfront ? pickTenant(kind, Math.round(centre.x), Math.max(1, units)) : [],
      signs,
      tint: hash01(Math.round(centre.x), Math.round(centre.z), 23),
      year: Math.round(1908 + hash01(Math.round(centre.x), Math.round(centre.z), 29) * 116),
      cell: parcel.cell,
      frontageLength: frontage.length,
      shopfront,
      clutter: Math.min(1, polygonArea(footprint) / 1400),
    });
  }

  // Landmark sites.
  const landmarks: Building[] = [];
  const openSpace: BuildResult['openSpace'] = [];
  for (const area of PLAN.siteAreas) {
    const site = area.site;
    const landmark = LANDMARK_BY_SITE.get(site.id);
    for (const part of area.parts) {
      if (part.part.use === 'open') {
        openSpace.push({
          polygon: part.polygon,
          kind: (part.part.surface ?? 'plaza') as 'plaza' | 'lawn' | 'apron' | 'cobbles' | 'terrace',
          feature: part.part.feature ?? 'none',
          site: site.id,
        });
        continue;
      }
      const built = landmarkBuilding(site.id, part.part, part.polygon, landmark?.id, random);
      if (built) landmarks.push(built);
    }
  }

  return { buildings, landmarks, openSpace };
})();

/* ── landmark architecture ─────────────────────────────────────────────────────── */

function landmarkBuilding(
  siteId: string, part: SitePart, polygon: Point[], landmarkId: string | undefined, random: () => number,
): Building | null {
  const poly = ensureCCW(polygon);
  if (poly.length < 3) return null;
  const centre = polygonCentroid(poly);
  const styleId = part.style ?? 'civic-stone';
  const style = facadeStyle(styleId);
  const height = part.height ?? 20;
  const base = part.base ?? 0;
  const shape: BuildingShape = part.shape ?? 'box';
  const volumes = shapeVolumes(shape, poly, base, height, styleId, random);
  if (!volumes.length) return null;
  const use: Use = siteId === 'station' ? 'transit'
    : siteId === 'museum' ? 'museum'
      : siteId === 'market' ? 'market'
        : siteId === 'hotel' ? 'hotel'
          : siteId === 'civic' ? 'civic'
            : siteId === 'northgate-deck' || siteId === 'lantern-court' ? 'parking'
              : 'office';
  const frontage = longestFrontage(poly);
  const entranceKind: EntranceKind =
    use === 'transit' ? 'station' : use === 'museum' ? 'museum' : use === 'hotel' ? 'hotel'
      : use === 'civic' ? 'civic' : use === 'parking' ? 'service' : 'lobby';
  const interior = part.interior;
  return {
    id: `landmark-${siteId}-${part.id}`,
    name: part.name,
    use, zone: 'core', style: styleId, volumes,
    height: volumes.reduce((top, v) => Math.max(top, v.top), 0),
    levels: Math.max(1, Math.round(height / style.floor)),
    centre, ground: 0, footprint: poly,
    roof: volumes[volumes.length - 1].roof,
    entrance: {
      point: { x: (frontage.a.x + frontage.b.x) / 2, z: (frontage.a.z + frontage.b.z) / 2 },
      dir: normalize({ x: -(frontage.b.z - frontage.a.z), z: frontage.b.x - frontage.a.x }),
      kind: entranceKind,
    },
    tenants: [],
    signs: part.name ? [{ text: part.name, kind: 'office' as TenantKindOf }] : [],
    tint: .5,
    year: siteId === 'market' ? 1897 : siteId === 'anvil' ? 1911 : siteId === 'trust' ? 1926 : 2000 + Math.floor(random() * 24),
    interior,
    landmark: landmarkId,
    cell: { i: 0, j: 0 },
    frontageLength: distance2d(frontage.a, frontage.b),
    shopfront: use === 'market' || use === 'transit' || use === 'museum',
    clutter: .8,
  };
}

function longestFrontage(poly: Point[]): { a: Point; b: Point } {
  let best = { a: poly[0], b: poly[1] ?? poly[0], length: -1 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const length = distance2d(a, b);
    if (length > best.length) best = { a, b, length };
  }
  return best;
}

/** Author landmark silhouettes out of the same stacked volumes the generator uses. */
function shapeVolumes(
  shape: BuildingShape, poly: Point[], base: number, height: number, style: FacadeStyleId, random: () => number,
): Volume[] {
  const centre = polygonCentroid(poly);
  switch (shape) {
    case 'taper': {
      // Kestrel Tower: three setbacks, a slanted crown and a lit mast.
      const steps = [
        { from: 0, to: .46, shrink: 0 },
        { from: .46, to: .74, shrink: .13 },
        { from: .74, to: .93, shrink: .27 },
        { from: .93, to: 1, shrink: .46 },
      ];
      return steps.map((step, index) => {
        const inner = step.shrink ? insetConvex(poly, step.shrink * Math.sqrt(polygonArea(poly)) * .5) : poly;
        return {
          polygon: inner.length >= 3 ? inner : poly,
          base: base + height * step.from,
          top: base + height * step.to,
          style,
          roof: index === steps.length - 1 ? 'spire' : 'flat',
          setback: index ? 2.5 : 0,
        };
      });
    }
    case 'stepped': {
      // Reachmark: two offset slabs sharing a sky lobby.
      const half = insetConvex(poly, Math.sqrt(polygonArea(poly)) * .12);
      const slab: Point[] = half.length >= 3 ? half : poly;
      const offset = scale(normalize(sub(slab[1], slab[0])), Math.sqrt(polygonArea(slab)) * .16);
      return [
        { polygon: poly, base, top: base + height * .3, style, roof: 'garden', setback: 0 },
        { polygon: slab.map(p => ({ x: p.x + offset.x, z: p.z + offset.z })), base, top: base + height * .58, style, roof: 'flat', setback: 0 },
        { polygon: slab.map(p => ({ x: p.x - offset.x * .6, z: p.z - offset.z * .6 })), base: base + height * .3, top: base + height, style, roof: 'mechanical', setback: 3 },
      ];
    }
    case 'octagon': {
      const radius = Math.sqrt(polygonArea(poly) / 2.8);
      const ring = regularPolygon(centre, radius, 8, Math.PI / 8);
      return [{ polygon: ring, base, top: base + height, style, roof: 'parapet', setback: 0 }];
    }
    case 'barrel': {
      // Station concourse and market hall: a vaulted shed.
      return [{
        polygon: poly, base, top: base + height * .72, style,
        roof: 'vault', setback: 0,
      }];
    }
    case 'cantilever': {
      // The Verge: stacked galleries, the top two oversailing the court.
      const upper = poly.map(p => ({
        x: p.x + (p.x - centre.x) * .1, z: p.z + (p.z - centre.z) * .1,
      }));
      return [
        { polygon: poly, base, top: base + height * .42, style, roof: 'flat', setback: 0 },
        { polygon: poly.map(p => ({ x: p.x + (centre.x - p.x) * .08, z: p.z + (centre.z - p.z) * .08 })),
          base: base + height * .42, top: base + height * .74, style, roof: 'flat', setback: 0 },
        { polygon: upper, base: base + height * .74, top: base + height, style, roof: 'sawtooth', setback: 0 },
      ];
    }
    case 'curved': {
      // Solstice: rounded ends and a winter garden on top.
      const radius = Math.sqrt(polygonArea(poly)) * .5;
      const ring = regularPolygon(centre, radius, 14, random() * Math.PI);
      const clipped = clipToRect(ring, poly);
      return [
        { polygon: clipped, base, top: base + height * .88, style, roof: 'flat', setback: 0 },
        { polygon: insetConvex(clipped, 3).length >= 3 ? insetConvex(clipped, 3) : clipped,
          base: base + height * .88, top: base + height, style, roof: 'garden', setback: 2 },
      ];
    }
    case 'colonnade': {
      // City hall: a masonry block with a colonnaded base and a clock tower.
      return [
        { polygon: poly, base, top: base + Math.min(9, height * .2), style, roof: 'flat', setback: 0 },
        { polygon: insetConvex(poly, 2.4).length >= 3 ? insetConvex(poly, 2.4) : poly,
          base: base + Math.min(9, height * .2), top: base + height, style, roof: 'mast', setback: 0 },
      ];
    }
    case 'lshape': {
      // Split the rectangle into two volumes forming an L.
      const a = poly, n = a.length;
      const mid: Point[] = a.map((p, i) => lerp2(p, a[(i + 2) % n], .38));
      return [
        { polygon: mid, base, top: base + height, style, roof: 'parapet', setback: 0 },
      ];
    }
    case 'podium-tower':
    default:
      return [{ polygon: poly, base, top: base + height, style, roof: ROOF_BY_STYLE[style], setback: 0 }];
  }
}

function clipToRect(poly: Point[], bounds: Point[]): Point[] {
  let result = poly;
  for (let i = 0; i < bounds.length && result.length >= 3; i++) {
    result = clipLeft(result, bounds[i], bounds[(i + 1) % bounds.length]);
  }
  return result.length >= 3 ? result : poly;
}

export const ALL_BUILDINGS: readonly Building[] = [...CITY.buildings, ...CITY.landmarks];
export const INTERIOR_BUILDINGS = ALL_BUILDINGS.filter(b => b.interior);
export const HEIGHT_RANGE = (() => {
  let min = Infinity, max = 0;
  for (const b of ALL_BUILDINGS) { min = Math.min(min, b.height); max = Math.max(max, b.height); }
  const sorted = ALL_BUILDINGS.map(b => b.height).sort((a, b) => a - b);
  return {
    min, max, sorted,
    percentile(p: number): number {
      return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
    },
  };
})();
export const USE_COUNT = ALL_BUILDINGS.reduce<Record<string, number>>((counts, b) => {
  counts[b.use] = (counts[b.use] ?? 0) + 1;
  return counts;
}, {});
export { FACADE_STYLES };
export const LANDMARK_SITES = SITES;
