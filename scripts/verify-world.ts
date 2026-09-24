import { auditWorld } from '../src/world/verification';
import { DISTRICTS, WORLD } from '../src/world/data';

const report=auditWorld();
console.log(`\n${WORLD.name.toUpperCase()} — GEOGRAPHIC FOUNDATION AUDIT`);
console.log('─'.repeat(79));
console.log(`Extent: 18 × 14 km | ${report.sectorTotal} 1 km² sectors | ${report.roads.length} road segments / ${report.roadsKm.toFixed(1)} km | ${report.bridges.length} bridges`);
console.log(`Streaming: ${report.sectorNear} nearby tiles, ${report.sectorOverview} maximum overview tiles (of ${report.sectorTotal})\n`);
console.log('FUTURE FOOTPRINT     AREA    DRY    HEIGHT RANGE    NEAREST ROAD  SECTORS');
for(const d of report.districts){
  const name=DISTRICTS.find(x=>x.id===d.id)!.name;
  console.log(`${name.padEnd(20)} ${(d.areaKm2.toFixed(1)+' km²').padStart(7)}  ${(d.dryFraction*100).toFixed(0).padStart(3)}%  ${(`${Math.round(d.minimumHeight)}–${Math.round(d.maximumHeight)} m`).padEnd(15)} ${(`${Math.round(d.nearestRoad)} m`).padStart(9)}  ${String(d.tiles).padStart(4)}`);
}
console.log('\nBRIDGES                   WATER SAMPLES   MINIMUM CLEARANCE');
for(const b of report.bridges)console.log(`${b.id.padEnd(25)} ${String(b.waterSamples).padStart(4)}          ${b.minimumClearance.toFixed(1).padStart(6)} m`);
console.log('\nROAD GRADES (MAX)');
for(const type of ['highway','arterial','secondary','local','rural'] as const){
  const roads=report.roads.filter(r=>r.type===type),steep=roads.reduce((best,r)=>r.maximumGrade>best.maximumGrade?r:best,roads[0]);
  console.log(`  ${type.padEnd(11)} ${(steep.maximumGrade*100).toFixed(1)}% (${steep.id})`);
}
console.log('\n'+(report.issues.length?'ISSUES:\n  - '+report.issues.join('\n  - '):'PASS — no stranded regions, unsupported bridges, flooded roads, or sector gaps.')+'\n');
if(report.issues.length)process.exitCode=1;
