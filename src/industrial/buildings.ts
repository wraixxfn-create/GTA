/**
 * Buildings of the flats: anchored works, generated tenants, and the tall structures
 * that give the district its skyline — stacks, silos, cranes and frames.
 *
 * Anchor facilities are laid out from their authored part lists; every remaining plot
 * takes a building or a yard use from its zone and condition. Each building carries the
 * side its doors face, so docks, roller doors and aprons land on the street. Six
 * buildings are interior-ready; the rest are shells. Fences follow plot and anchor
 * boundaries with gaps at the gates.
 */
import type { Point } from '../world/data';
import {
  ensureCCW, insetConvex, clipLeft, polygonArea, polygonCentroid, pointToSegment, distance2d,
  pointInPolygon, normalize, sub, scale, add, splitConvex, extentAlong,
} from '../city/geometry2d';
import { IND_POLYGON, fromGrid, hash01, makeRandom, WORKS_LIMITS, type Condition } from './frame';
import { ANCHORS, COMPANIES, type AnchorPart, type CladdingId } from './identity';
import { SITES, type Site, type YardContent } from './sites';
import { IND_NETWORK, nearestIndStreet } from './plan';

export type IndRoof = 'flat' | 'sawtooth' | 'barrel' | 'gable' | 'open';
export type IndBuildingKind =
  | 'hall' | 'warehouse' | 'workshop' | 'office' | 'canteen' | 'shed' | 'gatehouse'
  | 'substation' | 'cabin' | 'ruin' | 'frame';

export type IndDoor = {
  point: Point; dir: Point; width: number;
  kind: 'roller' | 'dock' | 'person' | 'gate';
};

export type IndBuilding = {
  id: string;
  name?: string;
  kind: IndBuildingKind;
  polygon: Point[];
  centre: Point;
  base: number;
  height: number;
  cladding: CladdingId;
  roof: IndRoof;
  condition: Condition;
  doors: IndDoor[];
  sign?: { text: string; point: Point; dir: Point };
  interior?: string;
  anchorId?: string;
  siteId?: string;
  tint: number;
  /** Open yard around the building (loading aprons, pallets, plant). */
  yard?: YardContent;
};

export type LandmarkKind =
  | 'stack' | 'silo' | 'tank' | 'water-tower' | 'gantry-crane' | 'tower-crane'
  | 'magnet-crane' | 'frame';

export type Landmark = {
  id: string;
  kind: LandmarkKind;
  name?: string;
  centre: Point;
  height: number;
  radius: number;
  /** Portal cranes and frames span along this direction. */
  dir?: Point;
  span?: number;
  condition: Condition;
  anchorId?: string;
  siteId?: string;
};

export type FenceRun = {
  points: Point[];
  height: number;
  kind: 'panel' | 'mesh' | 'barbed';
  condition: Condition;
  owner: string;
};

export type YardPatch = {
  polygon: Point[];
  content: YardContent;
  condition: Condition;
  owner: string;
};

const CLADDING_BY_CONDITION: Record<Condition, CladdingId[]> = {
  renovated: ['panel-grey', 'corrugated-painted', 'office-strip', 'steel-glazed'],
  active: ['panel-blue', 'panel-sand', 'corrugated-steel', 'shed-metal', 'brick-mill'],
  abandoned: ['corrugated-rust', 'brick-works', 'steel-frame'],
  construction: ['steel-frame', 'shed-metal'],
};
const OFFICE_CLADDING: Record<Condition, CladdingId> = {
  renovated: 'office-strip', active: 'office-strip', abandoned: 'office-brick', construction: 'office-brick',
};

function pickCladding(condition: Condition, seed: number, office = false): CladdingId {
  if (office) return OFFICE_CLADDING[condition];
  const pool = CLADDING_BY_CONDITION[condition];
  return pool[Math.floor(hash01(seed, 7, 3) * pool.length) % pool.length];
}

/* ── doors: which side faces the street ──────────────────────────────────────── */

function facingEdge(polygon: readonly Point[], toward: Point): { index: number; point: Point; dir: Point } {
  let best = { index: 0, distance: Infinity, point: polygon[0], dir: { x: 0, z: 1 } };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const hit = pointToSegment(toward, a, b);
    if (hit.distance < best.distance) {
      const point = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
      best = { index: i, distance: hit.distance, point, dir: normalize(sub(point, toward)) };
    }
  }
  return best;
}

function streetToward(centre: Point): Point {
  const near = nearestIndStreet(centre.x, centre.z);
  return near ? near.point : { x: centre.x, z: centre.z - 100 };
}

function makeDoors(polygon: readonly Point[], kind: IndBuildingKind, condition: Condition): IndDoor[] {
  if (condition === 'abandoned' && kind !== 'warehouse' && hash01(Math.round(polygon[0].x), 3, 9) < 0.5) return [];
  const centre = polygonCentroid(polygon);
  const face = facingEdge(polygon, streetToward(centre));
  const a = polygon[face.index], b = polygon[(face.index + 1) % polygon.length];
  const edgeDir = normalize(sub(b, a));
  const edgeLen = distance2d(a, b);
  const out: IndDoor[] = [];
  const place = (t: number, width: number, doorKind: IndDoor['kind']): void => {
    out.push({
      point: add(a, scale(edgeDir, t * edgeLen)),
      dir: { x: -face.dir.x, z: -face.dir.z },
      width, kind: doorKind,
    });
  };
  if (kind === 'warehouse') {
    // A dock run: doors every 12 m where the edge is long enough.
    const count = Math.max(1, Math.min(8, Math.floor((edgeLen - 10) / 12)));
    for (let i = 0; i < count; i++) place((i + 0.5) / count, 3.4, 'dock');
  } else if (kind === 'hall') {
    const count = edgeLen > 60 ? 2 : 1;
    for (let i = 0; i < count; i++) place((i + 0.5) / count, 5.2, 'roller');
    place(0.94, 1.4, 'person');
  } else if (kind === 'workshop') {
    place(0.3, 4.2, 'roller'); place(0.75, 1.4, 'person');
  } else if (kind === 'office' || kind === 'canteen') {
    place(0.5, 1.8, 'person');
  } else if (kind === 'shed') {
    place(0.5, 3.6, 'roller');
  } else if (kind === 'gatehouse') {
    place(0.5, 1.2, 'person');
  } else if (kind === 'ruin') {
    place(0.5, 4, 'roller');
  } else if (kind === 'cabin') {
    place(0.5, 1, 'person');
  }
  return out;
}

/* ── anchors ─────────────────────────────────────────────────────────────────── */

const buildings: IndBuilding[] = [];
const landmarks: Landmark[] = [];
const fences: FenceRun[] = [];
const yards: YardPatch[] = [];

const HEIGHT_DEFAULT: Record<IndBuildingKind, number> = {
  hall: 22, warehouse: 14, workshop: 11, office: 15, canteen: 8, shed: 9,
  gatehouse: 4.5, substation: 0, cabin: 3.4, ruin: 5, frame: 14,
};

const FOOTPRINT_INSET = insetConvex([...IND_POLYGON], 8);
function anchorPartRect(anchorRect: { u0: number; u1: number; v0: number; v1: number }, part: AnchorPart): Point[] {
  const u0 = anchorRect.u0 + (anchorRect.u1 - anchorRect.u0) * part.rect.u0;
  const u1 = anchorRect.u0 + (anchorRect.u1 - anchorRect.u0) * part.rect.u1;
  const v0 = anchorRect.v0 + (anchorRect.v1 - anchorRect.v0) * part.rect.v0;
  const v1 = anchorRect.v0 + (anchorRect.v1 - anchorRect.v0) * part.rect.v1;
  // Authored parts are clipped to the district fence like everything else.
  let poly = ensureCCW([fromGrid(u0, v0), fromGrid(u1, v0), fromGrid(u1, v1), fromGrid(u0, v1)]);
  for (let i = 0; i < FOOTPRINT_INSET.length && poly.length >= 3; i++) {
    poly = clipLeft(poly, FOOTPRINT_INSET[i], FOOTPRINT_INSET[(i + 1) % FOOTPRINT_INSET.length]);
  }
  return poly;
}

function partKindToBuilding(kind: AnchorPart['kind']): IndBuildingKind | null {
  switch (kind) {
    case 'hall': return 'hall';
    case 'warehouse': return 'warehouse';
    case 'workshop': return 'workshop';
    case 'office': return 'office';
    case 'canteen': return 'canteen';
    case 'shed': return 'shed';
    case 'gatehouse': return 'gatehouse';
    case 'cabin-row': return 'cabin';
    default: return null;
  }
}

for (const anchor of ANCHORS) {
  const seedBase = Math.round(anchor.rect.u0 * 1.7 + anchor.rect.v0 * 3.1);
  const random = makeRandom(seedBase + 991);
  for (const part of anchor.parts) {
    const polygon = anchorPartRect(anchor.rect, part);
    const centre = polygonCentroid(polygon);
    const seed = seedBase + Math.round(centre.x + centre.z);
    if (part.kind === 'none') {
      if (part.yard) yards.push({ polygon, content: part.yard, condition: anchor.condition, owner: anchor.id });
      continue;
    }
    if (part.kind === 'stack') {
      const count = 2;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const p = { x: polygon[0].x + (polygon[1].x - polygon[0].x) * 0.5 + (polygon[3].x - polygon[0].x) * t,
          z: polygon[0].z + (polygon[1].z - polygon[0].z) * 0.5 + (polygon[3].z - polygon[0].z) * t };
        landmarks.push({ id: `${anchor.id}-stack${i}`, kind: 'stack', centre: p, height: part.height ?? 68, radius: 3.4, condition: anchor.condition, anchorId: anchor.id });
      }
      continue;
    }
    if (part.kind === 'tank') {
      const r = Math.min(distance2d(polygon[0], polygon[1]), distance2d(polygon[1], polygon[2])) / 2.4;
      landmarks.push({ id: `${anchor.id}-${part.id}`, kind: 'tank', centre, height: part.height ?? 14, radius: Math.max(6, r), condition: anchor.condition, anchorId: anchor.id });
      continue;
    }
    if (part.kind === 'silo') {
      const r = Math.min(distance2d(polygon[0], polygon[1]), distance2d(polygon[1], polygon[2])) / 2.4;
      landmarks.push({ id: `${anchor.id}-${part.id}`, kind: 'water-tower', name: part.name, centre, height: part.height ?? 30, radius: Math.max(5, r), condition: anchor.condition, anchorId: anchor.id });
      continue;
    }
    if (part.kind === 'frame') {
      const dir = normalize(sub(polygon[1], polygon[0]));
      landmarks.push({ id: `${anchor.id}-${part.id}`, kind: 'frame', name: part.name, centre, height: part.height ?? 14, radius: 0, dir, span: distance2d(polygon[0], polygon[1]), condition: anchor.condition, anchorId: anchor.id });
      // The frame also stands as a building volume so it occludes and casts properly.
      buildings.push({
        id: `${anchor.id}-${part.id}-b`, name: part.name, kind: 'frame', polygon, centre,
        base: 0, height: part.height ?? 14, cladding: 'steel-frame', roof: 'open',
        condition: anchor.condition, doors: [], anchorId: anchor.id, tint: random(),
      });
      continue;
    }
    if (part.kind === 'substation') {
      yards.push({ polygon, content: 'machinery', condition: anchor.condition, owner: `${anchor.id}-substation` });
      continue;
    }
    const kind = partKindToBuilding(part.kind)!;
    if (part.kind === 'cabin-row') {
      const count = 3;
      for (let i = 0; i < count; i++) {
        const t0 = i / count + 0.02, t1 = (i + 1) / count - 0.04;
        const cabin = ensureCCW([
          { x: polygon[0].x + (polygon[1].x - polygon[0].x) * t0, z: polygon[0].z + (polygon[1].z - polygon[0].z) * t0 },
          { x: polygon[0].x + (polygon[1].x - polygon[0].x) * t1, z: polygon[0].z + (polygon[1].z - polygon[0].z) * t1 },
          { x: polygon[2].x + (polygon[3].x - polygon[2].x) * t1, z: polygon[2].z + (polygon[3].z - polygon[2].z) * t1 },
          { x: polygon[2].x + (polygon[3].x - polygon[2].x) * t0, z: polygon[2].z + (polygon[3].z - polygon[2].z) * t0 },
        ]);
        buildings.push({
          id: `${anchor.id}-${part.id}-${i}`, kind: 'cabin', polygon: cabin, centre: polygonCentroid(cabin),
          base: 0, height: 3.4, cladding: 'panel-sand', roof: 'flat', condition: anchor.condition,
          doors: makeDoors(cabin, 'cabin', anchor.condition), anchorId: anchor.id, tint: random(),
        });
      }
      continue;
    }
    const office = kind === 'office';
    const height = part.height ?? HEIGHT_DEFAULT[kind];
    const cladding = part.cladding ?? pickCladding(anchor.condition, seed, office);
    const roof: IndRoof = part.roof ?? (kind === 'hall' ? 'sawtooth' : kind === 'workshop' ? 'barrel' : 'flat');
    const doors = makeDoors(polygon, kind, anchor.condition);
    const building: IndBuilding = {
      id: `${anchor.id}-${part.id}`, name: part.name, kind, polygon, centre,
      base: 0, height, cladding, roof, condition: anchor.condition, doors,
      interior: part.interior, anchorId: anchor.id, tint: random(), yard: part.yard,
    };
    if (part.name && !office) building.sign = { text: part.name, point: doors[0]?.point ?? centre, dir: doors[0]?.dir ?? { x: 0, z: 1 } };
    buildings.push(building);
  }
  // Perimeter fence with a gap at every gatehouse.
  if (anchor.fenced) {
    const poly = anchorPartRect(anchor.rect, { rect: { u0: 0, u1: 1, v0: 0, v1: 1 } } as AnchorPart);
    const gates = anchor.parts.filter(p => p.kind === 'gatehouse')
      .map(p => polygonCentroid(anchorPartRect(anchor.rect, p)));
    const run: Point[] = [];
    const flush = (): void => {
      if (run.length >= 2) fences.push({ points: [...run], height: 2.6, kind: 'panel', condition: anchor.condition, owner: anchor.id });
      run.length = 0;
    };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = distance2d(a, b);
      const steps = Math.max(1, Math.ceil(len / 24));
      for (let s = 0; s <= steps; s++) {
        const p = { x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) };
        const atGate = gates.some(g => distance2d(g, p) < 12);
        if (atGate) flush(); else run.push(p);
      }
    }
    flush();
  }
}

/* ── generated tenants on the remaining plots ────────────────────────────────── */

function capBuildingArea(polygon: Point[], toward: Point, maxArea: number): Point[] {
  // Trim the plot's deep end so halls stay a buildable, drawable size; the trimmed
  // ground becomes yard.
  if (polygonArea(polygon) <= maxArea) return polygon;
  const centre = polygonCentroid(polygon);
  const extent = extentAlong(polygon, centre, toward);
  let keep = polygon;
  for (let pass = 0; pass < 6; pass++) {
    const cutAt = extent.max - (extent.max - extent.min) * (0.55 + pass * 0.07);
    const p = add(centre, scale(toward, cutAt));
    // clipLeft of the cut line is the deep end; the street side is the right piece.
    const [, near] = splitConvex(keep, add(p, { x: -toward.z, z: toward.x }), add(p, { x: toward.z, z: -toward.x }));
    if (near.length >= 3) keep = near;
    if (polygonArea(keep) <= maxArea) break;
  }
  return keep;
}

const companySeed = (p: Point, k: number) => Math.abs(Math.round(p.x * 0.11 + p.z * 0.17 + k * 37));

for (const site of SITES) {
  const random = makeRandom(companySeed(site.centre, 1));
  const seed = companySeed(site.centre, 5);
  const yardOf = (content: YardContent | null, owner: string, polygon: Point[]): void => {
    if (content) yards.push({ polygon, content, condition: site.condition, owner });
  };

  if (site.use === 'yard') {
    // Open storage: a cabin or shed on some plots, otherwise just fenced ground.
    if (site.area > 6000 && random() < 0.55) {
      const inset = insetConvex(site.polygon, 10);
      const cabin = capBuildingArea(inset, site.frontage ? { x: -site.frontage.dir.x, z: -site.frontage.dir.z } : { x: 1, z: 0 }, 320);
      if (polygonArea(cabin) > 60) {
        buildings.push({
          id: `${site.id}-shed`, kind: 'shed', polygon: cabin, centre: polygonCentroid(cabin),
          base: 0, height: 7 + random() * 3, cladding: pickCladding(site.condition, seed), roof: 'gable',
          condition: site.condition, doors: makeDoors(cabin, 'shed', site.condition),
          siteId: site.id, tint: random(),
          name: site.condition === 'abandoned' ? undefined : pickCompany(site, seed),
        });
      }
    }
    yardOf(site.yard, site.id, site.polygon);
    siteFence(site, fences);
    continue;
  }
  if (site.use === 'parking') {
    yardOf(site.yard ?? 'parking', site.id, site.polygon);
    if (random() < 0.4) {
      const gate = gateHut(site, `${site.id}-gate`, random);
      if (gate) buildings.push(gate);
    }
    siteFence(site, fences, 0.55);
    continue;
  }
  if (site.use === 'construction') {
    yardOf('plant', site.id, site.polygon);
    const dir = site.frontage ? { x: -site.frontage.dir.x, z: -site.frontage.dir.z } : { x: 1, z: 0 };
    const inset = insetConvex(site.polygon, 16);
    const frame = capBuildingArea(inset, dir, 5200);
    if (polygonArea(frame) > 900) {
      const centre = polygonCentroid(frame);
      landmarks.push({ id: `${site.id}-frame`, kind: 'frame', name: 'Warehouse (rising)', centre, height: 12 + random() * 6, radius: 0, dir: normalize(sub(frame[1], frame[0])), span: distance2d(frame[0], frame[1]), condition: 'construction', siteId: site.id });
      buildings.push({
        id: `${site.id}-frame-b`, kind: 'frame', polygon: frame, centre,
        base: 0, height: 13, cladding: 'steel-frame', roof: 'open', condition: 'construction',
        doors: [], siteId: site.id, tint: random(),
      });
    }
    if (random() < 0.55) {
      const tower = polygonCentroid(site.polygon);
      landmarks.push({ id: `${site.id}-crane`, kind: 'tower-crane', centre: tower, height: 42 + random() * 8, radius: 2.2, condition: 'construction', siteId: site.id });
    }
    if (random() < 0.8) {
      const cabins = gateHut(site, `${site.id}-cabins`, random, 'cabin');
      if (cabins) buildings.push(cabins);
    }
    siteFence(site, fences, 1, 'barbed');
    continue;
  }
  if (site.use === 'derelict') {
    yardOf(site.yard ?? 'wrecks', site.id, site.polygon);
    if (random() < 0.45 && site.area > 2400) {
      const inset = insetConvex(site.polygon, 12);
      const ruin = capBuildingArea(inset, { x: 1, z: 0 }, 2600);
      if (polygonArea(ruin) > 400) {
        buildings.push({
          id: `${site.id}-ruin`, kind: 'ruin', polygon: ruin, centre: polygonCentroid(ruin),
          base: 0, height: 3.5 + random() * 3.5, cladding: 'corrugated-rust', roof: 'open',
          condition: 'abandoned', doors: makeDoors(ruin, 'ruin', 'abandoned'),
          siteId: site.id, tint: random(),
        });
      }
    }
    if (random() < 0.5) siteFence(site, fences, 0.35, 'barbed');
    continue;
  }
  // factory / warehouse / workshop / office: one building on the street half of the
  // plot, yard behind and beside it.
  const kind: IndBuildingKind = site.use === 'factory' ? 'hall' : site.use;
  const dir = site.frontage ? { x: -site.frontage.dir.x, z: -site.frontage.dir.z } : { x: 1, z: 0 };
  const margin = kind === 'office' ? 10 : 14;
  const inset = insetConvex(site.polygon, margin);
  const maxArea = kind === 'hall' ? 9000 : kind === 'warehouse' ? 7500 : kind === 'workshop' ? 4200 : 1600;
  const plot = capBuildingArea(inset, dir, maxArea);
  if (polygonArea(plot) < WORKS_LIMITS.minPlotArea * 0.6) {
    yardOf(site.yard ?? 'pallets', site.id, site.polygon);
    siteFence(site, fences);
    continue;
  }
  const centre = polygonCentroid(plot);
  const height = kind === 'hall' ? 16 + random() * 9
    : kind === 'warehouse' ? 10 + random() * 6
      : kind === 'workshop' ? 8 + random() * 4
        : 11 + random() * 7;
  const roof: IndRoof = kind === 'hall' ? (random() < 0.55 ? 'sawtooth' : 'barrel')
    : kind === 'workshop' ? 'barrel' : 'flat';
  const office = kind === 'office';
  const condition = site.condition === 'construction' ? 'active' : site.condition;
  const name = condition === 'abandoned' && random() < 0.6 ? undefined : pickCompany(site, seed);
  const doors = makeDoors(plot, kind, condition);
  const building: IndBuilding = {
    id: `${site.id}-b`, name, kind, polygon: plot, centre,
    base: 0, height: Math.min(height, WORKS_LIMITS.maxOrdinaryHeight),
    cladding: pickCladding(condition, seed, office), roof, condition, doors,
    siteId: site.id, tint: random(), yard: condition === 'abandoned' ? undefined : site.yard ?? undefined,
  };
  if (name && doors.length) building.sign = { text: name, point: doors[0].point, dir: doors[0].dir };
  buildings.push(building);
  yardOf(site.yard, site.id, site.polygon);
  siteFence(site, fences);
}

function pickCompany(site: Site, seed: number): string {
  const poolKey = site.zone === 'heavy' ? 'steel'
    : site.zone === 'logistics' ? 'logistics'
      : site.zone === 'containers' ? 'containers'
        : site.zone === 'scrap' ? 'scrap'
          : site.zone === 'repair' ? 'repair'
            : site.zone === 'utility' ? 'utility'
              : site.zone === 'bulk' ? 'bulk'
                : site.zone === 'offices' ? 'office'
                  : site.zone === 'construction' ? 'construction'
                    : site.use === 'workshop' ? 'repair' : 'warehousing';
  const pool = COMPANIES[poolKey];
  return pool[seed % pool.length];
}

function gateHut(site: Site, id: string, random: () => number, kind: 'gatehouse' | 'cabin' = 'gatehouse'): IndBuilding | null {
  if (!site.frontage) return null;
  const dir = site.frontage.dir;
  const side = { x: -dir.z, z: dir.x };
  const w = kind === 'cabin' ? 9 : 5, d = kind === 'cabin' ? 3.6 : 4;
  const street = IND_NETWORK.streetById.get(site.frontage.streetId);
  const clear = street ? street.width / 2 + street.shoulder + 2.5 : 12;
  const build = (centre: Point): Point[] => ensureCCW([
    add(centre, add(scale(dir, -d / 2), scale(side, -w / 2))),
    add(centre, add(scale(dir, -d / 2), scale(side, w / 2))),
    add(centre, add(scale(dir, d / 2), scale(side, w / 2))),
    add(centre, add(scale(dir, d / 2), scale(side, -w / 2))),
  ]);
  const valid = (polygon: Point[]): boolean => polygon.every(p =>
    pointInPolygon(IND_POLYGON, p) &&
    (nearestIndStreet(p.x, p.z)?.distance ?? Infinity) > (street ? street.width / 2 + 2 : 8));
  // Stand the hut clear of the carriageway; try both kerbs, then give up.
  let polygon: Point[] | null = null;
  const lateral = random() < 0.5 ? 1 : -1;
  for (const flip of [1, -1] as const) {
    for (const standOff of [clear + w / 2 + 2, clear + w / 2 + 5]) {
      const candidate = build(add(site.frontage.point, add(scale(dir, standOff), scale(side, lateral * flip * (8 + w / 2)))));
      if (valid(candidate)) { polygon = candidate; break; }
    }
    if (polygon) break;
  }
  if (!polygon) return null;
  const centre = polygonCentroid(polygon);
  return {
    id, kind, polygon, centre, base: 0, height: kind === 'cabin' ? 3.4 : 4.2,
    cladding: kind === 'cabin' ? 'panel-sand' : 'corrugated-painted', roof: 'flat',
    condition: site.condition, doors: makeDoors(polygon, kind === 'cabin' ? 'cabin' : 'gatehouse', site.condition),
    siteId: site.id, tint: random(),
  };
}

/** Plots are fenced where they meet the world; gate gaps face the frontage. */
function siteFence(site: Site, out: FenceRun[], coverage = 1, kind: FenceRun['kind'] = 'mesh'): void {
  if (site.use === 'derelict' && coverage >= 1) coverage = 0.5;
  const gate = site.frontage ? add(site.frontage.point, scale(site.frontage.dir, 6)) : null;
  const run: Point[] = [];
  const flush = (): void => {
    if (run.length >= 2) out.push({ points: [...run], height: kind === 'barbed' ? 1.6 : 2.2, kind, condition: site.condition, owner: site.id });
    run.length = 0;
  };
  const random = makeRandom(companySeed(site.centre, 17));
  for (let i = 0; i < site.polygon.length; i++) {
    const a = site.polygon[i], b = site.polygon[(i + 1) % site.polygon.length];
    const len = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(len / 20));
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) };
      const gap = (gate && distance2d(gate, p) < 7) || random() > coverage;
      if (gap) flush(); else run.push(p);
    }
  }
  flush();
}

/* ── crane landmarks over the container yard and the scrap yard ──────────────── */

for (const anchor of ANCHORS) {
  if (anchor.id === 'marrow-yard') {
    for (const [i, v] of [0.3, 0.72].entries()) {
      const centre = fromGrid(anchor.rect.u0 + (anchor.rect.u1 - anchor.rect.u0) * 0.5,
        anchor.rect.v0 + (anchor.rect.v1 - anchor.rect.v0) * v);
      landmarks.push({ id: `marrow-gantry${i}`, kind: 'gantry-crane', centre, height: 24, radius: 1.6, dir: normalize(sub(fromGrid(1, 0), fromGrid(0, 0))), span: (anchor.rect.u1 - anchor.rect.u0) * 0.86, condition: anchor.condition, anchorId: anchor.id });
    }
  }
  if (anchor.id === 'brackewater') {
    const cranePart = anchor.parts.find(p => p.id === 'crane')!;
    const centre = polygonCentroid(anchorPartRect(anchor.rect, cranePart));
    landmarks.push({ id: 'brackewater-magnet', kind: 'magnet-crane', centre, height: 17, radius: 1.4, dir: normalize(sub(fromGrid(1, 0), fromGrid(0, 0))), span: 46, condition: anchor.condition, anchorId: anchor.id });
  }
}

/* ── the named cold store takes the largest western warehouse ────────────────── */

(() => {
  let best: IndBuilding | null = null;
  for (const b of buildings) {
    if (b.interior || b.kind !== 'warehouse' || b.anchorId) continue;
    if (b.centre.x > 3100) continue; // keep it on the downtown side of the works
    if (!best || polygonArea(b.polygon) > polygonArea(best.polygon)) best = b;
  }
  if (best) {
    best.interior = 'depot-warehouse';
    best.name = 'Depot Nine Cold Store';
    if (best.doors.length) best.sign = { text: best.name, point: best.doors[0].point, dir: best.doors[0].dir };
  }
})();

/* ── exports ─────────────────────────────────────────────────────────────────── */

export const IND_BUILDINGS: readonly IndBuilding[] = buildings;
export const IND_LANDMARKS: readonly Landmark[] = landmarks;
export const IND_FENCES: readonly FenceRun[] = fences;
export const IND_YARDS: readonly YardPatch[] = yards;
export const IND_INTERIOR_BUILDINGS: readonly IndBuilding[] = buildings.filter(b => b.interior);

export const indSummary = (() => {
  const byKind: Record<string, number> = {};
  for (const b of buildings) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
  let fenceKm = 0;
  for (const f of fences) for (let i = 0; i + 1 < f.points.length; i++) fenceKm += distance2d(f.points[i], f.points[i + 1]);
  return {
    buildings: buildings.length, landmarks: landmarks.length, fences: fences.length,
    yards: yards.length, interiors: IND_INTERIOR_BUILDINGS.length,
    byKind, fenceKm: Math.round(fenceKm / 100) / 10,
  };
})();

/* ── spatial index (500 m tiles, matching the streaming layout) ──────────────── */

const TILE = 500;
type Indexed = { minX: number; minZ: number; maxX: number; maxZ: number };
function boundsOf(polygon: readonly Point[]): Indexed {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}
function indexByTile(items: readonly { bounds: Indexed; index: number }[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const item of items) {
    for (let iz = Math.floor((item.bounds.minZ - 2) / TILE); iz <= Math.floor((item.bounds.maxZ + 2) / TILE); iz++) {
      for (let ix = Math.floor((item.bounds.minX - 2) / TILE); ix <= Math.floor((item.bounds.maxX + 2) / TILE); ix++) {
        const key = `${ix}:${iz}`;
        const list = map.get(key) ?? [];
        list.push(item.index);
        map.set(key, list);
      }
    }
  }
  return map;
}

const BUILDING_BOUNDS = buildings.map(b => boundsOf(b.polygon));
const BUILDING_TILES = indexByTile(BUILDING_BOUNDS.map((bounds, index) => ({ bounds, index })));
const LANDMARK_BOUNDS = landmarks.map(l => ({ minX: l.centre.x - 40, minZ: l.centre.z - 40, maxX: l.centre.x + 40, maxZ: l.centre.z + 40 }));
const LANDMARK_TILES = indexByTile(LANDMARK_BOUNDS.map((bounds, index) => ({ bounds, index })));

function inBounds(bounds: Indexed, query: { minX: number; minZ: number; maxX: number; maxZ: number }): boolean {
  return bounds.minX <= query.maxX && bounds.maxX >= query.minX && bounds.minZ <= query.maxZ && bounds.maxZ >= query.minZ;
}

export function buildingsInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): IndBuilding[] {
  const out: IndBuilding[] = [];
  const seen = new Set<number>();
  for (let iz = Math.floor(bounds.minZ / TILE); iz <= Math.floor(bounds.maxZ / TILE); iz++) {
    for (let ix = Math.floor(bounds.minX / TILE); ix <= Math.floor(bounds.maxX / TILE); ix++) {
      for (const index of BUILDING_TILES.get(`${ix}:${iz}`) ?? []) {
        if (seen.has(index) || !inBounds(BUILDING_BOUNDS[index], bounds)) continue;
        seen.add(index);
        out.push(buildings[index]);
      }
    }
  }
  return out;
}

export function landmarksInBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): Landmark[] {
  const out: Landmark[] = [];
  const seen = new Set<number>();
  for (let iz = Math.floor(bounds.minZ / TILE); iz <= Math.floor(bounds.maxZ / TILE); iz++) {
    for (let ix = Math.floor(bounds.minX / TILE); ix <= Math.floor(bounds.maxX / TILE); ix++) {
      for (const index of LANDMARK_TILES.get(`${ix}:${iz}`) ?? []) {
        if (seen.has(index) || !inBounds(LANDMARK_BOUNDS[index], bounds)) continue;
        seen.add(index);
        out.push(landmarks[index]);
      }
    }
  }
  return out;
}
