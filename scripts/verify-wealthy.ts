/**
 * Vantage Heights audit: roads, gates, fabric, grounds, connectivity to the base map and
 * the neighbouring districts, streaming and the performance budget.
 * `npm run verify:wealthy` — exits non-zero if any line fails.
 */
import { W_IDENTITY, LANDMARK_ESTATES, INTERIORS } from '../src/wealthy/identity';
import { W_NETWORK } from '../src/wealthy/plan';
import { siteSummary } from '../src/wealthy/sites';
import { wSummary } from '../src/wealthy/buildings';
import { propSummary } from '../src/wealthy/props';
import { trafficSummary } from '../src/wealthy/traffic';
import { surfaceSummary } from '../src/wealthy/surfaces';
import { auditWealthy, wealthySummary as S } from '../src/wealthy/verification';

console.log(`\n${W_IDENTITY.longName.toUpperCase()} — HILLSIDE CONSTRUCTION AUDIT`);
console.log('─'.repeat(79));
console.log(`${S.streets} streets / ${S.streetKm} km · ${S.junctions} junctions (${S.roundabouts} roundabouts · ${S.signals} signals · ${S.gates} district gates · ${S.estateGates} estate gates · ${S.controls.terminal ?? 0} terminals) · ${S.edges} edges`);
console.log(`${S.buildings} buildings on ${S.landmarks} landmark grounds · ${S.plots} plots / ${S.plotAreaHa} ha (+${S.estateAreaHa} ha of estate ground) · ${S.interiors} interiors · ${propSummary.count.toLocaleString('en-GB')} props`);
console.log(`grounds: ${wSummary.gardens} patches / ${wSummary.gardenHa} ha · ${wSummary.waters} water features · ${wSummary.wallKm} km of wall · ${wSummary.gates} gates`);
console.log(`carried regional routes: ${S.legacyRoutes.join(' · ')}`);
console.log(`traffic: ${trafficSummary.lanes} lanes / ${trafficSummary.laneKm} km · ${trafficSummary.vehicles} vehicles ${JSON.stringify(trafficSummary.byKind)} · ${trafficSummary.quietStreets} quiet streets`);
console.log(`grades: through ${S.grades.through}% · private ${S.grades.local}% · worst ${S.grades.worst}% (${S.grades.worstId})`);
console.log(`LOD0 static triangles: ${S.lod0Triangles.toLocaleString('en-GB')} · LOD2 massing: ${S.lod2Triangles.toLocaleString('en-GB')}`);

console.log('\nLANDMARK PROPERTIES');
for (const estate of LANDMARK_ESTATES) {
  const buildings = wSummary.buildings;
  void buildings;
  console.log(`  ${estate.name.padEnd(30)} ${estate.kind.padEnd(14)} ${estate.zone.padEnd(11)} ${estate.walled ? 'walled' : 'open'}`);
}
console.log('\nINTERIORS             ' + Object.entries(INTERIORS).map(([id, i]) => `${id} (${i.kind})`).join(' · '));
console.log('STREET KINDS          ' + Object.entries(S.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('BUILDING KINDS        ' + Object.entries(wSummary.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('LAND USE              ' + Object.entries(siteSummary.byUse).sort((a, b) => b[1] - a[1]).map(([use, n]) => `${use} ${n}`).join(' · '));
console.log('ZONES                 ' + Object.entries(siteSummary.byZone).sort((a, b) => b[1] - a[1]).map(([zone, n]) => `${zone} ${n}`).join(' · '));
console.log('SURFACES              ' + `${surfaceSummary.pieces} pieces / ${surfaceSummary.kinds} kinds in a sample km²`);
console.log('GATES                 ' + W_NETWORK.gateways.map(g => `${g.point.x.toFixed(0)},${g.point.z.toFixed(0)}`).join(' · '));

console.log('\nCHECKS');
const checks = auditWealthy();
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(78)} ${c.detail}`);
const failed = checks.filter(c => !c.ok);
console.log(`\n${failed.length ? `${failed.length} FAILED:\n  - ` + failed.map(f => `${f.name}: ${f.detail}`).join('\n  - ') : `PASS — ${checks.length} checks, ${S.buildings} buildings, ${S.plots} plots, no defects found.`}\n`);
if (failed.length) process.exitCode = 1;
