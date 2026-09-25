/**
 * Residential Valley audit: roads, pedestrian surfaces, vehicle surfaces, streaming,
 * performance, visual variety, landmarks and interiors.
 * `npm run verify:residential` — exits non-zero if any line fails.
 */
import { RES_IDENTITY, LANDMARK_SITES, INTERIORS } from '../src/residential/identity';
import { RES_NETWORK } from '../src/residential/plan';
import { siteSummary } from '../src/residential/sites';
import { wSummary } from '../src/residential/buildings';
import { propSummary } from '../src/residential/props';
import { trafficSummary } from '../src/residential/traffic';
import { surfaceSummary } from '../src/residential/surfaces';
import { auditResidential, resSummary as S } from '../src/residential/verification';

console.log(`\n${RES_IDENTITY.longName.toUpperCase()} — VALLEY CONSTRUCTION AUDIT`);
console.log('─'.repeat(79));
console.log(`${S.streets} streets / ${S.streetKm} km · ${S.junctions} junctions (${S.gates} district gates · ${S.turningCircles} turning circles · ${S.controls.signal ?? 0} signals · ${S.controls.stop ?? 0} stops) · ${S.edges} edges`);
console.log(`${S.buildings} buildings on ${S.plots} plots / ${siteSummary.plotAreaHa} ha · ${siteSummary.grounds} grounds / ${siteSummary.groundAreaHa} ha · ${S.interiors} interiors + ${S.interiorReady} interior-ready · ${propSummary.count.toLocaleString('en-GB')} props`);
console.log(`carried regional routes: ${S.legacyRoutes.join(' · ')}`);
console.log(`traffic: ${trafficSummary.lanes} lanes / ${trafficSummary.laneKm} km · ${trafficSummary.vehicles} vehicles ${JSON.stringify(trafficSummary.byKind)} · ${trafficSummary.crossings} crossings · ${trafficSummary.parkingBays} parking bays`);
console.log(`pedestrian: ${trafficSummary.pedNodes} nodes / ${trafficSummary.footwayKm} km of footway · ${trafficSummary.busStops} bus stops`);
console.log(`grades: through ${S.grades.through}% · local ${S.grades.local}% · worst ${S.grades.worst}% (${S.grades.worstId})`);
console.log(`LOD0 static triangles: ${S.lod0Triangles.toLocaleString('en-GB')} · LOD2 massing: ${S.lod2Triangles.toLocaleString('en-GB')}`);

console.log('\nLANDMARKS');
for (const site of LANDMARK_SITES) {
  if (!site.landmark) continue;
  console.log(`  ${site.name.padEnd(24)} ${site.kind.padEnd(16)} ${site.zone}`);
}
console.log('\nNEIGHBOURHOOD FACILITIES');
for (const site of LANDMARK_SITES) {
  if (site.landmark) continue;
  console.log(`  ${site.name.padEnd(24)} ${site.kind.padEnd(16)} ${site.zone}`);
}
console.log('\nINTERIORS             ' + Object.entries(INTERIORS).map(([id, i]) => `${id} (${i.kind})`).join(' · '));
console.log('STREET KINDS          ' + Object.entries(S.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('BUILDING KINDS        ' + Object.entries(wSummary.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('ROOFS                 ' + Object.entries(wSummary.byRoof).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('VINTAGE               ' + Object.entries(siteSummary.byVintage).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('PLOT USES             ' + Object.entries(siteSummary.byUse).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('NEIGHBOURHOODS        ' + Object.entries(siteSummary.byHood).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('SURFACES              ' + `${surfaceSummary.pieces} pieces / ${surfaceSummary.kinds} kinds · road ${surfaceSummary.roadHa} ha · ground ${surfaceSummary.groundHa} ha · water ${surfaceSummary.waterHa} ha in the sample km²`);
console.log('GATES                 ' + RES_NETWORK.gateways.map(g => `${g.point.x.toFixed(0)},${g.point.z.toFixed(0)}`).join(' · '));

console.log('\nCHECKS');
const checks = auditResidential();
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(78)} ${c.detail}`);
const failed = checks.filter(c => !c.ok);
console.log(`\n${failed.length ? `${failed.length} FAILED:\n  - ` + failed.map(f => `${f.name}: ${f.detail}`).join('\n  - ') : `PASS — ${checks.length} checks, ${S.buildings} buildings, ${S.plots} plots, no defects found.`}\n`);
if (failed.length) process.exitCode = 1;
