import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, ALL_BUILDINGS, INTERIOR_BUILDINGS } from '../src/city/buildings';
import { CITY_POLYGON } from '../src/city/frame';
import { LANDMARKS } from '../src/city/identity';
import { auditCity, citySummary } from '../src/city/verification';
import { LANES, LANE_LINKS, PED_NODES, BUS_STOPS, CROSSINGS, PARKING_BAYS } from '../src/city/traffic';

test('downtown retains its authored footprint and landmark roster', () => {
  assert.equal(CITY_POLYGON.length, 6);
  assert.equal(CITY.landmarks.length, 19);
  assert.ok(ALL_BUILDINGS.length > 3_000, 'downtown should read as a dense urban core');
  assert.ok(LANDMARKS.length >= 15, 'the city should have an original landmark roster');
  assert.equal(INTERIOR_BUILDINGS.length, 6, 'only selected important buildings get interior-ready building entries');
  assert.equal(citySummary.interiors, 7, 'the underground Fenwick garage is also an interior destination');
});

test('downtown traffic and pedestrian surfaces are prepared for later AI', () => {
  assert.ok(LANES.length > 2_000);
  assert.ok(LANE_LINKS.length > LANES.length * 5);
  assert.ok(CROSSINGS.length > 1_000);
  assert.ok(PARKING_BAYS.length > 5_000);
  assert.ok(BUS_STOPS.length >= 50);
  assert.ok(PED_NODES.size > 8_000);
  assert.ok(citySummary.laneKm > 250);
});

test('streets, building placement, landmark coverage, navigation and streaming all pass the city audit', () => {
  const failures = auditCity().filter(check => !check.ok);
  assert.deepEqual(failures, [], failures.map(check => `${check.name}: ${check.detail}`).join('\n'));
  assert.equal(citySummary.buildings + citySummary.landmarks, ALL_BUILDINGS.length);
  assert.ok(citySummary.parcels > 3_500);
  assert.ok(citySummary.sites >= 15);
  assert.ok(citySummary.parking > 30_000);
});
