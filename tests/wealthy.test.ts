import test from 'node:test';
import assert from 'node:assert/strict';
import { DISTRICTS } from '../src/world/data';
import { pointInPolygon } from '../src/world/geometry';
import { W_POLYGON, ESTATE_LIMITS } from '../src/wealthy/frame';
import { LANDMARK_ESTATES, INTERIORS, facadeForVintage } from '../src/wealthy/identity';
import { W_NETWORK, nearestStreet, streetGrade } from '../src/wealthy/plan';
import { PLOTS, ESTATE_GROUNDS, siteSummary } from '../src/wealthy/sites';
import { W_BUILDINGS, W_GARDENS, W_WALLS, W_GATES, W_WATERS, W_INTERIOR_BUILDINGS, buildingsInBounds, wSummary } from '../src/wealthy/buildings';
import { W_PROPS, propSummary } from '../src/wealthy/props';
import { LANES, VEHICLES, advanceTraffic, vehiclePose, trafficSummary } from '../src/wealthy/traffic';
import { auditWealthy, wealthySummary } from '../src/wealthy/verification';
import * as THREE from 'three';
import { WealthyLayer } from '../src/scene/WealthyLayer';

const WEALTHY = DISTRICTS.find(d => d.id === 'wealthy')!;

test('the hillside keeps its authored footprint and the base map reservation', () => {
  assert.equal(W_POLYGON.length, 6, 'the district keeps its authored footprint');
  assert.equal(WEALTHY.name, 'Hillside');
  assert.equal(WEALTHY.subtitle, 'Sheltered bluff');
  assert.equal(WEALTHY.kind, 'urban');
  // The district polygon reuses the reservation's own corners, and the crossing-number
  // test reports an exactly-on-boundary point as outside, so each corner is tested 4 m
  // inboard toward the focus.
  const focus = WEALTHY.focus;
  for (const corner of W_POLYGON) {
    const dx = focus.x - corner.x, dz = focus.z - corner.z, d = Math.hypot(dx, dz);
    const inset = { x: corner.x + dx / d * 4, z: corner.z + dz / d * 4 };
    assert.ok(pointInPolygon(inset.x, inset.z, WEALTHY.polygon),
      `${corner.x},${corner.z} sits on the reservation boundary`);
  }
  // The centre of the district is unambiguously inside, and its area is the reserved area.
  assert.ok(pointInPolygon(focus.x, focus.z, WEALTHY.polygon), 'the focus is inside the district');
});

test('the street network is connected, gated and free of signals', () => {
  assert.equal(wealthySummary.streets, 30);
  assert.ok(wealthySummary.streetKm > 20, 'a boulevard, ridge roads, a scenic route and private drives span the hill');
  assert.equal(wealthySummary.junctions, 61);
  const kinds = new Set(W_NETWORK.streets.map(s => s.kind));
  for (const kind of ['boulevard', 'ridge', 'scenic', 'collector', 'private', 'lane', 'pedestrian'] as const) {
    assert.ok(kinds.has(kind), `the district needs ${kind} roads`);
  }
  assert.equal(wealthySummary.signals, 0, 'an exclusive district has no traffic lights');
  assert.ok(wealthySummary.roundabouts >= 3, 'junctions are circled instead of signalised');
  assert.ok(wealthySummary.gates >= 6 && wealthySummary.estateGates >= 8, 'gated communities and a gated district');
  // The audit walks the graph from a single seed; a disconnected estate lane fails it.
  const failures = auditWealthy().filter(c => !c.ok && c.name.includes('street graph'));
  assert.deepEqual(failures, []);
});

test('grades suit a hillside and stay inside the regional audit limits', () => {
  let worst = 0;
  for (const street of W_NETWORK.streets) worst = Math.max(worst, streetGrade(street).max);
  assert.ok(worst <= 0.12, `no street is steeper than the audit allows (worst ${(worst * 100).toFixed(1)}%)`);
  assert.ok(wealthySummary.grades.through <= 9, 'through routes stay drivable');
  assert.ok(worst > 0.04, 'the district is genuinely on a slope, not flattened');
});

test('every carried regional route has a gate, and gates face adjoining districts', () => {
  const carried = new Set(W_NETWORK.streets.filter(s => s.legacy).map(s => s.name));
  for (const route of ['Coastway', 'Bluff Road', 'Valley Road', 'Foothill Road', 'Coastal Rise']) {
    assert.ok(carried.has(route), `${route} is carried through on its authored alignment`);
  }
  assert.ok(W_NETWORK.gateways.length >= 6, 'one gate per boundary approach');
  for (const gate of W_NETWORK.gateways) {
    assert.ok(W_NETWORK.streets.some(s => s.legacy && Math.hypot(
      s.samples[s.samples.length - 1].x - gate.point.x, s.samples[s.samples.length - 1].z - gate.point.z,
    ) < 200 || (s.legacy && Math.hypot(s.samples[0].x - gate.point.x, s.samples[0].z - gate.point.z) < 200)),
      `the gate at ${gate.point.x.toFixed(0)},${gate.point.z.toFixed(0)} sits on a route that continues outside`);
  }
});

test('plots and estates fill the district, with gardens on every plot', () => {
  assert.equal(siteSummary.count, PLOTS.length);
  assert.equal(PLOTS.length, 304);
  assert.ok(siteSummary.areaHa > 300);
  assert.equal(ESTATE_GROUNDS.length, LANDMARK_ESTATES.length, 'every landmark property has ground reserved whole');
  assert.ok(Object.keys(siteSummary.byUse).length >= 8, 'villas, mansions, apartments, shops, restaurants, clubs, gate lodges, parkland');
  for (const use of ['villa', 'mansion', 'apartments', 'shops', 'restaurant', 'club', 'gate-lodge', 'parkland']) {
    assert.ok((siteSummary.byUse[use] ?? 0) > 0, `${use} plots exist`);
  }
  assert.ok(siteSummary.gardenFraction > 0.6, 'gardens dominate the built footprint');
  for (const plot of PLOTS) {
    assert.ok(plot.area >= ESTATE_LIMITS.minPlotArea, `plot ${plot.id} is not smaller than the minimum`);
    assert.ok(plot.gardenFraction >= ESTATE_LIMITS.minGardenFraction, `plot ${plot.id} keeps a garden`);
  }
});

test('every landmark property is built, and only five buildings are enterable', () => {
  for (const estate of LANDMARK_ESTATES) {
    const built = W_BUILDINGS.filter(b => b.estateId === estate.id);
    assert.ok(built.length > 0, `${estate.name} is built`);
  }
  const kinds = new Set(LANDMARK_ESTATES.map(e => e.kind));
  for (const kind of ['mansion', 'hotel', 'country-club', 'villa', 'arcade', 'apartments', 'club']) {
    assert.ok(kinds.has(kind as never), `a ${kind} landmark exists`);
  }
  assert.equal(wSummary.interiors, 5);
  assert.equal(W_INTERIOR_BUILDINGS.length, 5);
  assert.equal(Object.keys(INTERIORS).length, 5);
  const interiorIds = Object.keys(INTERIORS);
  assert.deepEqual(interiorIds.sort(),
    ['marchmont-apartment', 'meridian-hotel', 'the-orangery', 'vantage-club', 'vantage-house']);
  for (const id of interiorIds) {
    assert.ok(INTERIORS[id as keyof typeof INTERIORS].kind, `${id} has an authored interior`);
    assert.ok(W_INTERIOR_BUILDINGS.some(b => b.interior === id), `${id} is a building`);
  }
  // A mansion, a hotel, a restaurant, a luxury apartment and the club.
  const interiorKinds: readonly string[] = interiorIds.map(id => INTERIORS[id as keyof typeof INTERIORS].kind);
  for (const kind of ['mansion', 'hotel', 'restaurant', 'apartment', 'club']) {
    assert.ok(interiorKinds.includes(kind), `a ${kind} interior exists`);
  }
  assert.ok(W_INTERIOR_BUILDINGS.length / W_BUILDINGS.length < 0.05, 'not every building is enterable');
  // Every building declares a facade, and each generation has its own cladding family.
  for (const building of W_BUILDINGS) {
    assert.ok(typeof building.facade === 'string' && building.facade.length > 0, `${building.id} has cladding`);
  }
  const byVintage = new Map<string, Set<string>>();
  for (const building of W_BUILDINGS) {
    const key = building.vintage ?? 'classic';
    if (!byVintage.has(key)) byVintage.set(key, new Set());
    byVintage.get(key)!.add(building.facade);
  }
  assert.equal(byVintage.size, 3);
  const estateOnly = facadeForVintage('estate', 0.5);
  assert.notEqual(estateOnly, facadeForVintage('modern', 0.5), 'generations are clad differently');
  assert.ok(typeof facadeForVintage('classic', 0.25) === 'string');
});

test('buildings stand inside the district, clear of carriageways and on their terrace', () => {
  assert.equal(wSummary.buildings, W_BUILDINGS.length);
  assert.equal(W_BUILDINGS.length, 396);
  for (const building of W_BUILDINGS) {
    assert.ok(pointInPolygon(building.centre.x, building.centre.z, W_POLYGON), `${building.id} is inside the district`);
    assert.ok(Number.isFinite(building.base) && Number.isFinite(building.height));
    assert.ok(building.height <= ESTATE_LIMITS.maxLandmarkHeight + 1, `${building.id} respects the height limit`);
  }
  // The full audit does the carriageway and terrace arithmetic; keep it as the authority.
  const failures = auditWealthy().filter(c => !c.ok && c.name.includes('clear of carriageways'));
  assert.deepEqual(failures, []);
});

test('grounds, water, walls and gates dress the district', () => {
  assert.ok(W_GARDENS.length > 400 && wSummary.gardenHa > 400);
  for (const kind of ['lawn', 'formal', 'drive', 'terrace', 'forecourt', 'tennis']) {
    assert.ok((wSummary.gardenByKind[kind] ?? 0) > 0, `${kind} ground exists`);
  }
  assert.ok((wSummary.waterByKind.pool ?? 0) > 20, 'swimming pools');
  assert.ok((wSummary.waterByKind.infinity ?? 0) > 4, 'infinity pools on the bluff');
  assert.ok((wSummary.waterByKind.fountain ?? 0) >= 1, 'a fountain');
  assert.equal(wSummary.waters, W_WATERS.length);
  assert.ok(wSummary.wallKm > 20, 'walled compounds');
  assert.equal(wSummary.walls, W_WALLS.length);
  assert.ok((wSummary.wallByKind.hedge ?? 0) > 0, 'hedges as well as stone');
  assert.equal(wSummary.gates, W_GATES.length);
  assert.ok((wSummary.gatesByKind.estate ?? 0) > 0 && (wSummary.gatesByKind.district ?? 0) >= 6);
});

test('world detail is static dressing: cameras, sentries, planting, lighting, parked cars', () => {
  assert.equal(propSummary.count, W_PROPS.length);
  assert.ok(propSummary.kinds >= 20);
  assert.ok((propSummary.byKind['camera'] ?? 0) > 20, 'security cameras');
  assert.ok((propSummary.byKind['guard-stand'] ?? 0) >= 10, 'private guards stand sentry at the gates');
  assert.ok(propSummary.planting > 400 && propSummary.lighting > 400);
  assert.ok(propSummary.parkedVehicles > 100, 'expensive cars are parked as future traffic placeholders');
  for (const prop of W_PROPS) {
    assert.ok(Number.isFinite(prop.x) && Number.isFinite(prop.z) && Number.isFinite(prop.y));
    assert.ok(Number.isFinite(prop.angle));
  }
});

test('a deliberately light fleet is prepared for future vehicle gameplay', () => {
  assert.ok(LANES.length > 30 && trafficSummary.laneKm > 40);
  assert.ok(VEHICLES.length >= 15 && VEHICLES.length <= 40, 'far lighter than downtown or the works');
  for (const kind of ['saloon', 'coupe', 'suv', 'limousine'] as const) {
    assert.ok((trafficSummary.byKind[kind] ?? 0) > 0, `${kind} traffic exists`);
  }
  assert.ok(trafficSummary.quietStreets >= 15, 'private drives and estate lanes carry no traffic');
  advanceTraffic(2.0);
  for (const vehicle of VEHICLES) {
    const pose = vehiclePose(vehicle);
    assert.ok(pose && Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.angle));
    const near = nearestStreet(pose.x, pose.z);
    assert.ok(near && near.distance < 34, 'vehicles stay on the street network');
  }
});

test('the architecture contrasts the poorer districts', () => {
  assert.ok(Object.keys(wSummary.byFacade).length >= 10, 'stone, render, bronze glass, cedar, zinc');
  assert.equal(Object.keys(wSummary.byVintage).length, 3, 'estate, classic and modern generations');
  for (const vintage of ['estate', 'classic', 'modern'] as const) {
    assert.ok((wSummary.byVintage[vintage] ?? 0) > 50, `${vintage} generation is well represented`);
  }
  assert.ok(wSummary.tallest >= 40, 'the hotel tower reads above the villas');
  assert.ok(wSummary.meanHeight < 14, 'the district stays low compared with downtown');
});

test('streaming: a tile only draws the buildings it touches', () => {
  const bounds = { minX: -4200, minZ: 1100, maxX: -3200, maxZ: 2100 };
  const drawn = buildingsInBounds(bounds);
  assert.ok(drawn.length > 20 && drawn.length < W_BUILDINGS.length, 'a tile draws part of the district, not all of it');
  for (const building of drawn) {
    assert.ok(building.polygon.some(p =>
      p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ),
      `${building.id} touches the tile it is drawn in`);
  }
});

test('the streaming layer builds, moves and disposes tiles for real', () => {
  const layer = new WealthyLayer();
  assert.equal(layer.group.name, 'Vantage Heights');
  assert.ok(layer.group.children.length >= 1, 'the fleet is instanced into the group');

  // Stand on the crown and let the streamer run several frames.
  const crown = new THREE.Vector3(-3630, 132, 1700);
  let now = 0;
  for (let frame = 0; frame < 24; frame++) {
    now += 150;
    layer.update(crown, now, 9);
  }
  assert.ok(layer.stats.chunks > 0, `tiles streamed (got ${layer.stats.chunks})`);
  assert.ok(layer.stats.triangles > 0, `the tiles carry geometry (${layer.stats.triangles} triangles)`);
  assert.ok(layer.stats.detailed > 0, 'the near ring streams at full detail');
  assert.ok(layer.stats.buildMs >= 0 && layer.stats.drawCalls > 0, 'the tiles issue draw calls');

  // The navigation overlay builds lazily on first request and hides again.
  layer.setNavigation(true);
  assert.equal(layer.getNavigation(), true);
  assert.ok(layer.navigation.children.length > 0, 'lanes, gates and viewpoints are drawn');
  layer.setNavigation(false);
  assert.equal(layer.getNavigation(), false);

  const nearCount = layer.stats.chunks;

  // Halfway across the map the hill is still inside the 7 km silhouette range, so a few
  // LOD3 massing tiles correctly remain — but nothing detailed may. `stats.disposed` is a
  // per-frame counter, so disposals are summed across the flight rather than read at the end.
  let released = 0;
  const flyTo = (target: THREE.Vector3, frames: number): void => {
    for (let frame = 0; frame < frames; frame++) {
      now += 150;
      layer.update(target, now, 9);
      released += layer.stats.disposed;
    }
  };
  flyTo(new THREE.Vector3(3400, 40, -2200), 24);
  assert.ok(layer.stats.chunks < nearCount, `the streamer sheds tiles as the camera leaves (${nearCount} → ${layer.stats.chunks})`);
  assert.equal(layer.stats.detailed, 0, 'no detailed tiles survive a flight away from the hill');
  assert.ok(released > 0, `tiles were disposed on the way out (${released} released)`);

  // Beyond the silhouette range nothing at all may remain.
  flyTo(new THREE.Vector3(6000, 40, -5000), 24);
  assert.equal(layer.stats.chunks, 0, `past 7 km every hillside tile is released (got ${layer.stats.chunks})`);
  assert.ok(released >= nearCount, `every tile that streamed in was eventually released (${released} released, ${nearCount} seen)`);

  // Traffic advances without throwing and keeps the instances populated.
  layer.updateTraffic(0.4);
  for (const child of layer.group.children) {
    if (child instanceof THREE.InstancedMesh) {
      assert.ok(child.count > 0 && Number.isFinite(child.count));
    }
  }
});

test('the full hillside audit passes and the LOD budgets hold', () => {
  const failures = auditWealthy().filter(check => !check.ok);
  assert.deepEqual(failures, [], failures.map(check => `${check.name}: ${check.detail}`).join('\n'));
  assert.ok(wealthySummary.lod0Triangles < 160_000, 'the detailed ring stays inside the static triangle budget');
  assert.ok(wealthySummary.lod0Triangles > 40_000, 'the district should still read as built-up geometry');
  assert.ok(wealthySummary.lod2Triangles * 8 < wealthySummary.lod0Triangles, 'the distant LOD collapses to massing');
});
