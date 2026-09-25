/**
 * Industrial district audit: roads, rail, fabric, navigation surfaces, connectivity to
 * downtown and the reserved port, streaming and the performance budget.
 * `npm run verify:industrial` — exits non-zero if any line fails.
 */
import { IND_IDENTITY, ANCHORS } from '../src/industrial/identity';
import { IND_NETWORK, LEVEL_CROSSINGS } from '../src/industrial/plan';
import { railLength } from '../src/industrial/rail';
import { siteSummary } from '../src/industrial/sites';
import { indSummary } from '../src/industrial/buildings';
import { propSummary } from '../src/industrial/props';
import { trafficSummary } from '../src/industrial/traffic';
import { auditIndustrial, industrialSummary as S } from '../src/industrial/verification';

console.log(`\n${IND_IDENTITY.district.toUpperCase()} — INDUSTRIAL CONSTRUCTION AUDIT`);
console.log('─'.repeat(79));
console.log(`${S.streets} streets / ${S.streetKm} km · ${S.junctions} junctions (${S.controls.signal ?? 0} signalised · ${S.gates} gates · ${S.controls.terminal ?? 0} terminals) · ${S.edges} edges`);
console.log(`${S.buildings} buildings + ${S.landmarks} landmarks · ${S.sites} plots / ${S.siteAreaHa} ha · ${S.interiors} interior destinations · ${propSummary.count.toLocaleString('en-GB')} props · ${S.fenceKm} km fencing`);
const rail = railLength();
console.log(`rail: ${rail.corridorKm.toFixed(2)} km corridor · ${rail.trackKm.toFixed(2)} km laid track · ${LEVEL_CROSSINGS.length} level crossings (${LEVEL_CROSSINGS.filter(c => c.barriers).length} barriered)`);
console.log(`traffic: ${trafficSummary.lanes} lanes / ${trafficSummary.laneKm} km · ${trafficSummary.vehicles} vehicles ${JSON.stringify(trafficSummary.byKind)}`);
console.log(`LOD0 static triangles: ${S.lod0Triangles.toLocaleString('en-GB')}`);

console.log('\nANCHOR FACILITIES');
for (const anchor of ANCHORS) {
  console.log(`  ${anchor.name.padEnd(34)} ${anchor.zone.padEnd(13)} ${anchor.condition.padEnd(13)} ${anchor.fenced ? 'fenced' : 'open'}${anchor.railServed ? ' · rail-served' : ''}`);
}
console.log('\nLAND USE              ' + Object.entries(siteSummary.byUse).sort((a, b) => b[1] - a[1]).map(([use, n]) => `${use} ${n}`).join(' · '));
const kindCounts = IND_NETWORK.streets.reduce<Record<string, number>>((acc, st) => { acc[st.kind] = (acc[st.kind] ?? 0) + 1; return acc; }, {});
console.log('STREET KINDS          ' + Object.entries(kindCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('BUILDING KINDS        ' + Object.entries(indSummary.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));

console.log('\nCHECKS');
const checks = auditIndustrial();
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(78)} ${c.detail}`);
const failed = checks.filter(c => !c.ok);
console.log(`\n${failed.length ? `${failed.length} FAILED:\n  - ` + failed.map(f => `${f.name}: ${f.detail}`).join('\n  - ') : `PASS — ${checks.length} checks, ${S.buildings} buildings, ${S.sites} plots, no defects found.`}\n`);
if (failed.length) process.exitCode = 1;
