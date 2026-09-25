import test from 'node:test';
import assert from 'node:assert/strict';
import { IND_NETWORK, LEVEL_CROSSINGS, nearestIndStreet } from '../src/industrial/plan';
import { RAIL_LINES, YARD_TRACKS, railLength } from '../src/industrial/rail';
import { SITES, siteSummary } from '../src/industrial/sites';
import { IND_BUILDINGS, IND_LANDMARKS, IND_INTERIOR_BUILDINGS, buildingsInBounds, indSummary } from '../src/industrial/buildings';
import { IND_PROPS, propSummary } from '../src/industrial/props';
import { LANES, VEHICLES, advanceTraffic, vehiclePose, trafficSummary } from '../src/industrial/traffic';
import { auditIndustrial, industrialSummary } from '../src/industrial/verification';
import { IND_POLYGON } from '../src/industrial/frame';

test('the industrial street network is connected and contrasts downtown', () => {
  assert.equal(IND_POLYGON.length, 6, 'the district keeps its authored footprint');
  assert.equal(industrialSummary.streets, 26);
  assert.ok(industrialSummary.streetKm > 25, 'haulways, boulevards and service lanes span the flats');
  assert.equal(industrialSummary.junctions, 69);
  assert.ok(industrialSummary.gates >= 12, 'gates connect downtown, the river crossing and the reserved port');
  const kinds = new Set(IND_NETWORK.streets.map(s => s.kind));
  for (const kind of ['haulway', 'boulevard', 'service', 'yard'] as const) assert.ok(kinds.has(kind));
  const controls = industrialSummary.controls;
  assert.ok(controls.signal >= 4 && controls.stop >= 15 && controls.yield >= 10 && controls.gateway >= 15);
});

test('rail infrastructure reaches the works and leaves toward the reserved port', () => {
  assert.ok(RAIL_LINES.length >= 6, 'main line, port branch and works spurs');
  assert.ok(RAIL_LINES.some(l => l.id.includes('port')), 'a branch is aimed at the future port district');
  assert.equal(YARD_TRACKS.length, 6, 'the yard station keeps six tracks');
  const rail = railLength();
  assert.ok(rail.corridorKm > 3 && rail.trackKm > 6);
  assert.equal(LEVEL_CROSSINGS.length, 7);
  assert.ok(LEVEL_CROSSINGS.every(c => c.barriers), 'every road/rail crossing is a declared, barriered level crossing');
});

test('plots and buildings fill the district with all four ground conditions', () => {
  assert.equal(siteSummary.count, SITES.length);
  assert.ok(SITES.length > 180 && siteSummary.areaHa > 170);
  assert.ok(Object.keys(siteSummary.byUse).length >= 8, 'yards, warehouses, factories, offices, workshops, parking, derelict, construction');
  assert.ok(Object.keys(siteSummary.byCondition).length === 4, 'active, renovated, abandoned and construction ground all exist');
  assert.equal(indSummary.buildings, IND_BUILDINGS.length);
  assert.ok(IND_BUILDINGS.length > 140 && IND_LANDMARKS.length >= 9);
  const kinds = new Set(IND_BUILDINGS.map(b => b.kind));
  for (const kind of ['warehouse', 'hall', 'shed', 'office', 'workshop', 'gatehouse', 'cabin', 'ruin'] as const) {
    assert.ok(kinds.has(kind), `building roster should include ${kind}`);
  }
  assert.equal(buildingsInBounds({ minX: 1800, minZ: -800, maxX: 4500, maxZ: 2200 }).length, IND_BUILDINGS.length);
});

test('only six buildings are interior-ready', () => {
  assert.equal(IND_INTERIOR_BUILDINGS.length, 6, 'factory floor, two warehouses, workshop, office, canteen');
  assert.ok(IND_INTERIOR_BUILDINGS.every(b => b.interior), 'interior buildings expose interior data');
  const share = IND_INTERIOR_BUILDINGS.length / IND_BUILDINGS.length;
  assert.ok(share < 0.1, 'not every building is enterable');
});

test('props, fencing and the kinetic fleet are prepared for later gameplay systems', () => {
  assert.ok(IND_PROPS.length > 4_000);
  assert.ok(Object.keys(propSummary.byKind).length >= 20, 'containers, vehicles, pallets, barrels, pipes, plant, power, crossings…');
  for (const kind of ['container20', 'container40', 'pallet', 'barrel', 'dumpster', 'floodlight', 'pipe', 'crossbuck'] as const) {
    assert.ok((propSummary.byKind[kind] ?? 0) > 0, `props should include ${kind}`);
  }
  assert.ok(industrialSummary.fenceKm > 60, 'yards and works are fenced');
  assert.ok(LANES.length > 50 && trafficSummary.laneKm > 60);
  assert.equal(VEHICLES.length, 50);
  const kinds = new Set(VEHICLES.map(v => v.kind));
  assert.ok(kinds.has('truck') && kinds.has('lorry') && kinds.has('van') && kinds.has('car'));
  advanceTraffic(0.5);
  const poses = VEHICLES.map(vehiclePose).filter(p => p !== null);
  assert.ok(poses.length === VEHICLES.length, 'every vehicle keeps a valid pose while advancing');
  for (const pose of poses) {
    assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.angle));
    const near = nearestIndStreet(pose.x, pose.z);
    assert.ok(near && near.distance < 30, 'vehicles stay on the street network');
  }
});

test('the full industrial audit passes', () => {
  const failures = auditIndustrial().filter(check => !check.ok);
  assert.deepEqual(failures, [], failures.map(check => `${check.name}: ${check.detail}`).join('\n'));
  assert.ok(industrialSummary.lod0Triangles < 200_000, 'the detailed ring stays inside the static triangle budget');
  assert.ok(industrialSummary.lod0Triangles > 60_000, 'the district should still read as built-up geometry');
  assert.equal(industrialSummary.buildings + industrialSummary.landmarks,
    IND_BUILDINGS.length + IND_LANDMARKS.length);
});
