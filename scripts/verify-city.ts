/**
 * Downtown audit: streets, fabric, architecture, traffic surfaces, streaming and density.
 * `npm run verify:city` — exits non-zero if any line fails.
 */
import { CITY, HEIGHT_RANGE, USE_COUNT } from '../src/city/buildings';
import { citySummary, auditCity } from '../src/city/verification';
import { IDENTITY, LANDMARKS } from '../src/city/identity';
import { PLAN } from '../src/city/blocks';
import { NETWORK } from '../src/city/streets';

const summary = citySummary;
console.log(`\n${IDENTITY.district.toUpperCase()} — DOWNTOWN CONSTRUCTION AUDIT`);
console.log('─'.repeat(79));
console.log(`${summary.streets} streets / ${summary.streetKm.toFixed(1)} km · ${summary.junctions} junctions (${summary.junctionsSignalised} signalised) · ${summary.blocks} blocks · ${summary.parcels} parcels`);
console.log(`${summary.buildings.toLocaleString('en-GB')} buildings + ${summary.landmarks} landmark volumes · ${(summary.floorArea / 1e6).toFixed(1)} M m² floor area · ${summary.interiors} interior destinations · tallest ${summary.tallest.name} ${summary.tallest.height.toFixed(0)} m`);
console.log(`${summary.lanes} lanes / ${summary.laneKm.toFixed(0)} km · ${summary.crossings} crossings · ${summary.signals} signal heads · ${summary.busStops} transit stops · ${summary.pedNodes.toLocaleString('en-GB')} footway nodes`);
console.log(`parking ${summary.parking.toLocaleString('en-GB')} spaces (${summary.kerbside} kerbside · ${summary.decks} decks · ${summary.underground} underground) · ${summary.props.toLocaleString('en-GB')} street props`);

console.log('\nSKYLINE                                 HEIGHT   FLOORS  STYLE');
for (const landmark of [...LANDMARKS].sort((a, b) => b.height - a.height).slice(0, 8)) {
  const built = CITY.landmarks.filter(b => b.landmark === landmark.id)
    .reduce<typeof CITY.landmarks[number] | undefined>((tallest, building) =>
      !tallest || building.height > tallest.height ? building : tallest, undefined);
  console.log(`${landmark.name.padEnd(38)} ${(built ? built.height.toFixed(0) + ' m' : '—').padStart(7)}   ${String(landmark.floors).padStart(4)}   ${landmark.style}`);
}
console.log(`\nHEIGHT PERCENTILES    ${[5, 25, 50, 75, 95].map(p => `p${p} ${HEIGHT_RANGE.percentile(p).toFixed(0)}m`).join('  ·  ')}`);
console.log(`LAND USE              ${Object.entries(USE_COUNT).sort((a, b) => b[1] - a[1]).map(([use, n]) => `${use} ${n}`).join(' · ')}`);
console.log(`OPEN SPACE            ${PLAN.courtyards.length} courtyards · ${CITY.openSpace.length} plazas and parks · ${PLAN.alleys.length} service alleys`);

console.log('\nSELECTED STREETS');
for (const street of NETWORK.streets.filter(s => s.kind === 'boulevard' || s.kind === 'ring' || s.transit).slice(0, 10)) {
  console.log(`  ${street.name.padEnd(26)} ${street.kind.padEnd(10)} ${street.lanes} lane${street.oneWay ? ' one-way' : ''}  ${(street.length / 1000).toFixed(2)} km`);
}

console.log('\nCHECKS');
const checks = auditCity();
for (const check of checks) console.log(`  ${check.ok ? '✓' : '✗'} ${check.name.padEnd(64)} ${check.detail}`);
const failed = checks.filter(c => !c.ok);
console.log(`\n${failed.length ? `${failed.length} FAILED:\n  - ` + failed.map(f => `${f.name}: ${f.detail}`).join('\n  - ') : `PASS — ${checks.length} checks, ${summary.buildings.toLocaleString('en-GB')} buildings, no defects found.`}\n`);
if (failed.length) process.exitCode = 1;
