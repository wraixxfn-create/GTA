import test from 'node:test';
import assert from 'node:assert/strict';
import { DISTRICTS, isBuiltDistrictId } from '../src/world/data';
import { pointInPolygon } from '../src/world/geometry';
import { RES_POLYGON, RES_LIMITS, insideDistrict, hoodAt, vintageAt, type HoodId, type Vintage } from '../src/residential/frame';
import { LANDMARK_SITES, INTERIORS, facadeForVintage } from '../src/residential/identity';
import { RES_NETWORK, streetGrade, type StreetKind } from '../src/residential/plan';
import { PLOTS, GROUNDS, siteSummary } from '../src/residential/sites';
import { RES_BUILDINGS, RES_INTERIOR_BUILDINGS, RES_INTERIOR_READY, buildingsInBounds, wSummary } from '../src/residential/buildings';
import { RES_PROPS, propSummary } from '../src/residential/props';
import { LANES, CROSSINGS, PED_NODES, PARKING_BAYS, BUS_STOPS, VEHICLES, advanceTraffic, vehiclePose } from '../src/residential/traffic';
import { piecesForBounds, surfaceSummary } from '../src/residential/surfaces';
import { auditResidential, resSummary } from '../src/residential/verification';
import * as THREE from 'three';
import { ResidentialLayer } from '../src/scene/ResidentialLayer';

const RESIDENTIAL = DISTRICTS.find(d => d.id === 'residential')!;

test('the valley keeps its authored footprint and is a built district', () => {
  assert.equal(RES_POLYGON.length, 6, 'the district keeps its authored footprint');
  assert.equal(RESIDENTIAL.name, 'Residential');
  assert.equal(RESIDENTIAL.subtitle, 'Broad central valley');
  assert.equal(RESIDENTIAL.kind, 'urban');
  assert.ok(isBuiltDistrictId('residential'), 'the valley is registered as built');
  // The crossing-number test reads exactly-on-boundary points as outside, so corners are
  // tested 4 m inboard toward the focus.
  const focus = RESIDENTIAL.focus;
  for (const corner of RES_POLYGON) {
    const dx = focus.x - corner.x, dz = focus.z - corner.z, d = Math.hypot(dx, dz);
    const inset = { x: corner.x + dx / d * 4, z: corner.z + dz / d * 4 };
    assert.ok(pointInPolygon(inset.x, inset.z, RESIDENTIAL.polygon),
      `${corner.x},${corner.z} sits on the reservation boundary`);
  }
  assert.ok(pointInPolygon(focus.x, focus.z, RESIDENTIAL.polygon), 'the focus is inside the district');
  assert.ok(insideDistrict(focus, 20), 'the focus clears the district limit');
});

test('the street network spans main roads, residential streets, alleys and closes', () => {
  assert.ok(resSummary.streets >= 35, 'the valley carries a full street network');
  assert.ok(resSummary.streetKm > 25, 'main roads, side streets and alleys span the valley');
  const kinds = new Set<StreetKind>(RES_NETWORK.streets.map(s => s.kind));
  for (const kind of ['arterial', 'collector', 'local', 'terrace', 'close', 'alley', 'pedestrian', 'legacy'] as const) {
    assert.ok(kinds.has(kind), `the district needs ${kind} streets`);
  }
  assert.ok(resSummary.gates >= 6, 'regional routes arrive through declared gates');
  assert.ok(resSummary.turningCircles >= 5, 'the 1990s closes end on turning circles');
  assert.ok(resSummary.edges > 60, 'the junction graph carries vehicle edges');
  // Carried regional routes keep the valley wired into the world graph.
  const legacy = RES_NETWORK.streets.filter(s => s.legacy);
  assert.ok(legacy.length >= 4, 'Northspan Freeway, Valley Road, Inner Belt and Willow Lane run through');
  // The audit walks the vehicle graph; a stranded close fails it.
  const failures = auditResidential().filter(c => !c.ok && c.name.includes('ROADS'));
  assert.deepEqual(failures, [], failures.map(f => `${f.name}: ${f.detail}`).join('\n'));
  // Street grades stay ordinary.
  for (const street of RES_NETWORK.streets) {
    const { max } = streetGrade(street);
    assert.ok(max < 0.14, `${street.id} grade ${(max * 100).toFixed(1)}% stays walkable`);
  }
});

test('pedestrian surfaces cross the whole valley', () => {
  assert.ok(CROSSINGS.length >= 12, 'people can cross the roads');
  assert.ok(CROSSINGS.some(c => c.kind === 'zebra'), 'the busy junctions carry zebra crossings');
  assert.ok(PED_NODES.size > 500, 'the sidewalk graph covers the neighbourhoods');
  let crossLinks = 0, footLinks = 0;
  for (const node of PED_NODES.values()) {
    for (const link of node.links) {
      if (link.kind === 'cross') crossLinks++;
      if (link.kind === 'footway') footLinks++;
    }
  }
  assert.ok(crossLinks >= 24, 'crossings tie the two sides of the network');
  assert.ok(footLinks > 1000, 'pavements link the nodes');
  const ped = auditResidential().filter(c => !c.ok && c.name.includes('PEDESTRIAN'));
  assert.deepEqual(ped, [], ped.map(f => `${f.name}: ${f.detail}`).join('\n'));
});

test('vehicle surfaces leave room for driving and parking', () => {
  assert.ok(LANES.length >= 50, 'lanes cover the network');
  assert.ok(PARKING_BAYS.length >= 200, 'the valley parks its cars');
  assert.ok(BUS_STOPS.length >= 4, 'buses serve the main roads');
  assert.ok(VEHICLES.length >= 30, 'ordinary traffic runs the through routes');
  const seen = new Set<string>();
  for (const v of VEHICLES) {
    assert.ok(!seen.has(v.id), 'vehicle ids are unique');
    seen.add(v.id);
  }
  advanceTraffic(0.5);
  for (const v of VEHICLES) {
    const pose = vehiclePose(v);
    assert.ok(pose && Number.isFinite(pose.x) && Number.isFinite(pose.y), `${v.id} keeps a valid pose`);
  }
  const veh = auditResidential().filter(c => !c.ok && c.name.includes('VEHICLE'));
  assert.deepEqual(veh, [], veh.map(f => `${f.name}: ${f.detail}`).join('\n'));
});

test('plots and buildings mix all four generations of ordinary building', () => {
  assert.ok(PLOTS.length > 300, 'the valley is subdivided into plots');
  for (const use of ['house', 'townhouse', 'apartment', 'mixed'] as const) {
    assert.ok((siteSummary.byUse[use] ?? 0) > 10, `the valley needs ${use} plots`);
  }
  const hoods = new Set<HoodId>(PLOTS.map(p => p.hood));
  assert.ok(hoods.size >= 7, 'nearly every neighbourhood carries plots');
  const vintages = new Set<Vintage>(PLOTS.map(p => p.vintage));
  assert.equal(vintages.size, 4, 'Victorian, interwar, postwar and nineties all appear');
  // No single vintage may swallow the valley.
  for (const count of Object.values(siteSummary.byVintage)) {
    assert.ok(count > 3, 'every era contributes');
    assert.ok(count < PLOTS.length * 0.75, 'no era dominates');
  }
  // Heights stay ordinary: lived-in, not luxurious.
  for (const building of RES_BUILDINGS) {
    const cap = building.landmark ? RES_LIMITS.maxLandmarkHeight : RES_LIMITS.maxOrdinaryHeight;
    assert.ok(building.height <= cap + 0.5, `${building.id} at ${building.height} m stays under ${cap} m`);
    assert.ok(building.footprint.length >= 3, `${building.id} has a real footprint`);
    assert.ok(wSummary.facades >= 8, 'the cladding language is mixed');
  }
  assert.ok(wSummary.terraceRows >= 4 && wSummary.terraceUnits >= 30, 'terraces read as rows');
  const variety = auditResidential().filter(c => !c.ok && c.name.includes('VARIETY'));
  assert.deepEqual(variety, [], variety.map(f => `${f.name}: ${f.detail}`).join('\n'));
});

test('landmarks anchor the neighbourhood', () => {
  const landmarks = LANDMARK_SITES.filter(s => s.landmark);
  assert.equal(landmarks.length, 4, 'park, shopping street, community centre and flats');
  const names = landmarks.map(l => l.name);
  assert.ok(names.includes('Mill Green'), 'the large neighbourhood park');
  assert.ok(names.includes('Market Row'), 'the local shopping street');
  assert.ok(names.includes('Warfield Hall'), 'the community centre');
  assert.ok(names.includes('Rosecourt'), 'the distinctive apartment complex');
  for (const site of LANDMARK_SITES) {
    const centre = { x: (site.rect.x0 + site.rect.x1) / 2, z: (site.rect.z0 + site.rect.z1) / 2 };
    assert.ok(insideDistrict(centre, -60), `${site.name} sits within the district`);
  }
  // Everyday facilities: two schools, two filling stations, shops and a park.
  assert.equal(LANDMARK_SITES.filter(s => s.kind === 'school').length, 2);
  assert.equal(LANDMARK_SITES.filter(s => s.kind === 'gas-station').length, 2);
  assert.equal(LANDMARK_SITES.filter(s => s.kind === 'community').length, 1);
  // Market Row signs its shopfronts.
  assert.ok(wSummary.shopUnits >= 18, `${wSummary.shopUnits} shop units signed`);
});

test('interiors open four doors and prepare the rest', () => {
  const kinds = Object.values(INTERIORS).map(i => i.kind).sort();
  assert.deepEqual(kinds, ['apartment', 'community', 'restaurant', 'shop'],
    'a flat, a shop, a restaurant and the community hall');
  assert.equal(RES_INTERIOR_BUILDINGS.length, 4);
  for (const building of RES_INTERIOR_BUILDINGS) {
    assert.ok(insideDistrict(building.centre, -50), `${building.id} interior is inside the district`);
  }
  assert.ok(RES_INTERIOR_READY.length >= 3, 'more doors are prepared for future interiors');
});

test('ground surfaces cover roads, pavements, gardens and the park', () => {
  const sample = { minX: -1500, minZ: -2400, maxX: -500, maxZ: -1400 };
  const pieces = piecesForBounds(sample, { markings: true, detail: true });
  assert.ok(pieces.length > 100, 'the sample km² is dressed');
  assert.ok(surfaceSummary.kinds >= 4, 'asphalt, paving, grass and paint all appear');
  const kinds = new Set(pieces.map(p => p.kind));
  assert.ok(kinds.has('asphalt') || kinds.has('asphalt-worn'), 'carriageways');
  assert.ok(kinds.has('paving') || kinds.has('paving-warm'), 'pavements');
  assert.ok(kinds.has('grass'), 'gardens and verges');
  const grounds = new Set(GROUNDS.map(g => g.kind));
  assert.ok(grounds.has('playground'), 'playgrounds exist');
  assert.ok(grounds.has('garden') || grounds.has('lawn'), 'gardens and greens exist');
});

test('streaming: a tile only draws the buildings it touches', () => {
  const bounds = { minX: -1200, minZ: -2000, maxX: -700, maxZ: -1500 };
  const drawn = buildingsInBounds(bounds);
  assert.ok(drawn.length > 20 && drawn.length < RES_BUILDINGS.length, 'a tile draws part of the district, not all of it');
  for (const building of drawn) {
    assert.ok(building.footprint.some(p =>
      p.x >= bounds.minX - 20 && p.x <= bounds.maxX + 20 && p.z >= bounds.minZ - 20 && p.z <= bounds.maxZ + 20),
      `${building.id} touches the tile it is drawn in`);
  }
});

test('the streaming layer builds, moves and disposes tiles for real', () => {
  const layer = new ResidentialLayer();
  assert.equal(layer.group.name, 'Residential Valley');
  assert.ok(layer.group.children.length >= 1, 'the fleet is instanced into the group');

  // Stand at the mill crossroads and let the streamer run several frames.
  const crossroads = new THREE.Vector3(-750, 30, -1560);
  let now = 0;
  for (let frame = 0; frame < 24; frame++) {
    now += 150;
    layer.update(crossroads, now, 9);
  }
  assert.ok(layer.stats.chunks > 0, `tiles streamed (got ${layer.stats.chunks})`);
  assert.ok(layer.stats.triangles > 0, `the tiles carry geometry (${layer.stats.triangles} triangles)`);
  assert.ok(layer.stats.detailed > 0, 'the near ring streams at full detail');
  assert.ok(layer.stats.drawCalls > 0, 'the tiles issue draw calls');

  // The navigation overlay builds lazily and hides again.
  layer.setNavigation(true);
  assert.equal(layer.getNavigation(), true);
  assert.ok(layer.navigation.children.length > 0, 'lanes, crossings and footways are drawn');
  layer.setNavigation(false);
  assert.equal(layer.getNavigation(), false);

  const nearCount = layer.stats.chunks;
  let released = 0;
  const flyTo = (target: THREE.Vector3, frames: number): void => {
    for (let frame = 0; frame < frames; frame++) {
      now += 150;
      layer.update(target, now, 9);
      released += layer.stats.disposed;
    }
  };
  // Halfway across the region the valley drops to massing, then nothing.
  flyTo(new THREE.Vector3(3400, 40, -2200), 24);
  assert.ok(layer.stats.chunks < nearCount, `the streamer sheds tiles as the camera leaves (${nearCount} → ${layer.stats.chunks})`);
  assert.equal(layer.stats.detailed, 0, 'no detailed tiles survive a flight away from the valley');
  flyTo(new THREE.Vector3(6000, 40, -5000), 24);
  assert.equal(layer.stats.chunks, 0, `past the silhouette range every tile is released (got ${layer.stats.chunks})`);
  assert.ok(released > 0, `tiles were disposed on the way out (${released} released)`);

  // Traffic advances without throwing and keeps the instances populated.
  layer.updateTraffic(0.4);
  for (const child of layer.group.children) {
    if (child instanceof THREE.InstancedMesh) {
      assert.ok(child.count > 0 && Number.isFinite(child.count));
    }
  }
  layer.dispose();
  assert.equal(layer.stats.chunks, 0);
});

test('the full residential audit passes and the budgets hold', () => {
  const failures = auditResidential().filter(check => !check.ok);
  assert.deepEqual(failures, [], failures.map(check => `${check.name}: ${check.detail}`).join('\n'));
  assert.ok(resSummary.lod0Triangles < 2_400_000, 'the detailed ring stays inside the static triangle budget');
  assert.ok(resSummary.lod0Triangles > 100_000, 'the district should read as built-up geometry');
  assert.ok(resSummary.lod2Triangles * 6 < resSummary.lod0Triangles, 'the distant LOD collapses to massing');
  assert.ok(propSummary.count < 6500, 'props stay instanced and bounded');
  assert.ok(RES_PROPS.length === propSummary.count, 'the prop roster is coherent');
});
