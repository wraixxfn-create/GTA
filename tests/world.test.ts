import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, Mesh } from 'three';
import { DISTRICTS, LAKE, ROADS, WORLD } from '../src/world/data';
import {
  COASTS, pointInPolygon, riverLevel, sectorAt,
  sectorsNear, signedCoastDistance, terrainHeight,
} from '../src/world/geometry';
import { roadGraph } from '../src/world/roads';
import { SECTOR_LAYOUT } from '../src/world/streaming';
import { auditWorld, reachable } from '../src/world/verification';
import { buildSector } from '../src/scene/sector';

const audit=auditWorld();

test('two separate original landmasses, descending river, elevated lake and mountain relief',()=>{
  assert.ok(signedCoastDistance(0,800)>0);
  assert.ok(signedCoastDistance(6600,4450)>0);
  assert.ok(signedCoastDistance(4640,3850)<0,'the sound is water between the two islands');
  assert.ok(signedCoastDistance(0,6400)<0,'the bay opens to the southern sea');
  assert.ok(terrainHeight(LAKE.center.x,LAKE.center.z)<LAKE.level-5);
  assert.ok(terrainHeight(LAKE.center.x+LAKE.radiusX*1.3,LAKE.center.z)>LAKE.level);
  for(let i=1;i<=20;i++)assert.ok(riverLevel(i/20)<=riverLevel((i-1)/20));
  assert.ok(terrainHeight(-1600,-5720)>800,'ridge must be visible from the lowlands');
  assert.ok(terrainHeight(1100,600)<65,'city floor needs to remain buildable');
});

test('coast spatial index preserves exact polygon membership and distance',()=>{
  for(let i=0;i<120;i++){
    const x=WORLD.minX+((i*73)%121)/120*(WORLD.maxX-WORLD.minX);
    const z=WORLD.minZ+((i*49)%127)/126*(WORLD.maxZ-WORLD.minZ);
    const inside=COASTS.some(coast=>pointInPolygon(x,z,coast));
    assert.equal(signedCoastDistance(x,z)>0,inside,`shore sign at ${x},${z}`);
    let expected=Infinity;
    for(const coast of COASTS)for(let j=0;j<coast.length-1;j++){
      const a=coast[j],b=coast[j+1],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
      expected=Math.min(expected,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    }
    assert.ok(Math.abs(Math.abs(signedCoastDistance(x,z))-expected)<.00001);
  }
});

test('12 roomy, non-overlapping, accessible reservations keep the airport level',()=>{
  assert.equal(DISTRICTS.length,12);
  assert.equal(new Set(DISTRICTS.map(d=>d.id)).size,12);
  for(const d of DISTRICTS){
    const result=audit.districts.find(a=>a.id===d.id)!;
    assert.ok(result.areaKm2>=2.9,`${d.id} footprint too small`);
    assert.ok(result.dryFraction>(d.id==='rural'?.78:.94),`${d.id} inundated`);
    assert.ok(result.nearestRoad<1200,`${d.id} lacks access`);
    assert.ok(pointInPolygon(d.focus.x,d.focus.z,d.polygon));
    assert.ok(SECTOR_LAYOUT.tilesFor(d).length>0);
  }
  const airfield=audit.districts.find(d=>d.id==='airport')!;
  assert.ok(airfield.maximumHeight-airfield.minimumHeight<30);
  assert.ok(!audit.issues.some(s=>s.includes('overlaps')));
});

test('road hierarchy connects every node with several alternatives between key regions',()=>{
  assert.ok(ROADS.length>=70);
  assert.deepEqual(new Set(ROADS.map(r=>r.type)),new Set(['highway','arterial','secondary','local','rural']));
  const graph=roadGraph();
  for(const [id,neighbors] of graph){
    assert.ok(neighbors.size>=2,`${id} dead end`);
    assert.ok(reachable('downtownCore',id),`${id} unreachable`);
  }
  for(const bridge of ROADS.filter(r=>r.bridge)){
    assert.ok(reachable('westGate','airportEast',new Set([bridge.id])),`one closure strands the airport: ${bridge.id}`);
    assert.ok(reachable('downtownCore','islandEast',new Set([bridge.id])),`one closure strands the island: ${bridge.id}`);
  }
  assert.equal(audit.roads.filter(r=>r.unbridgedWaterSamples>0).length,0);
  assert.ok(audit.roads.filter(r=>r.type==='highway').every(r=>r.maximumGrade<=.10));
});

test('all five declared bridges span water and land above it on dry road junctions',()=>{
  assert.equal(audit.bridges.length,5);
  assert.equal(audit.bridges.filter(b=>b.waterSamples>=2).length,5);
  assert.ok(audit.bridges.every(b=>b.minimumClearance>12));
  assert.ok(!audit.issues.some(s=>s.includes('lands in water')));
});

test('streaming is bounded and terrain height matches along a river-sector seam',()=>{
  assert.equal(SECTOR_LAYOUT.columns,18);
  assert.equal(SECTOR_LAYOUT.rows,14);
  assert.equal(SECTOR_LAYOUT.total,252);
  assert.ok(sectorsNear(0,0,2600).length<sectorsNear(0,0,5700).length);
  assert.ok(sectorsNear(0,0,5700).length<252);
  assert.equal(sectorAt(WORLD.minX-1,0),null);
  for(const d of DISTRICTS){
    const tile=sectorAt(d.focus.x,d.focus.z)!;
    assert.ok(SECTOR_LAYOUT.districtIds(tile.x,tile.z).includes(d.id));
  }
  const west=buildSector(12,5),east=buildSector(13,5);
  const westMesh=west.group.children[0],eastMesh=east.group.children[0];
  assert.ok(westMesh instanceof Mesh&&eastMesh instanceof Mesh);
  const w=westMesh.geometry.getAttribute('position') as BufferAttribute;
  const e=eastMesh.geometry.getAttribute('position') as BufferAttribute;
  for(let row=0;row<=24;row++)assert.equal(w.getY(row*25+24),e.getY(row*25));
  west.dispose();east.dispose();
});

test('complete foundation audit is clean',()=>assert.deepEqual(audit.issues,[]));
