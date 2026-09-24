import { DISTRICTS, NODES, ROADS, WORLD, type Point, type Road } from './data';
import {
  lakeDistance, nearestRiver, pointInPolygon, polygonArea, sectorAt,
  sectorsNear, signedCoastDistance, terrainSample,
} from './geometry';
import { closestRoadDistance, SAMPLED_ROADS } from './roads';
import { SECTOR_LAYOUT } from './streaming';

export type DistrictAudit={id:string;areaKm2:number;dryFraction:number;minimumHeight:number;maximumHeight:number;nearestRoad:number;tiles:number};
export type RoadAudit={id:string;type:Road['type'];lengthKm:number;maximumGrade:number;unbridgedWaterSamples:number};
export type BridgeAudit={id:string;waterSamples:number;minimumClearance:number};
export type WorldAudit={issues:string[];districts:DistrictAudit[];roads:RoadAudit[];bridges:BridgeAudit[];roadsKm:number;sectorTotal:number;sectorOverview:number;sectorNear:number};

function isWater(point:Point):boolean {
  const sample=terrainSample(point.x,point.z);
  return sample.coast<-3 || sample.lake<.995 || sample.river.distance<sample.river.width || sample.height<-.25;
}
export function reachable(start:string,end:string,closedRoadIds:ReadonlySet<string>=new Set()):boolean {
  const seen=new Set([start]),pending=[start];
  for(let i=0;i<pending.length;i++){
    const node=pending[i];
    for(const road of ROADS){
      if(closedRoadIds.has(road.id))continue;
      const next=road.from===node?road.to:road.to===node?road.from:null;
      if(!next||seen.has(next))continue;
      if(next===end)return true;
      seen.add(next);pending.push(next);
    }
  }
  return start===end;
}

/** Deterministic survey, shared by the CLI report and automated regression tests. */
export function auditWorld():WorldAudit {
  const issues:string[]=[],districts:DistrictAudit[]=[],roads:RoadAudit[]=[],bridges:BridgeAudit[]=[];
  const roadIds=new Set<string>();
  const nodeDegrees=new Map(Object.keys(NODES).map(id=>[id,0]));
  for(const road of ROADS){
    if(roadIds.has(road.id))issues.push(`Duplicate road id ${road.id}`);
    roadIds.add(road.id);
    if(!NODES[road.from]||!NODES[road.to])issues.push(`${road.id} has a missing junction`);
    nodeDegrees.set(road.from,(nodeDegrees.get(road.from)??0)+1);
    nodeDegrees.set(road.to,(nodeDegrees.get(road.to)??0)+1);
  }
  for(const [id,degree] of nodeDegrees)if(degree<2)issues.push(`${id} is a road dead end (${degree} connections)`);
  for(const id of Object.keys(NODES))if(!reachable('downtownCore',id))issues.push(`${id} is unreachable from the city`);
  for(const bridge of ROADS.filter(r=>r.bridge)){
    if(!reachable('downtownCore','islandEast',new Set([bridge.id])))issues.push(`Closing ${bridge.id} strands the sound island`);
    if(!reachable('westGate','airportEast',new Set([bridge.id])))issues.push(`Closing ${bridge.id} strands the eastern region`);
  }

  for(const district of DISTRICTS){
    const xs=district.polygon.map(p=>p.x),zs=district.polygon.map(p=>p.z);
    let sampleCount=0,wetCount=0,lo=Infinity,hi=-Infinity,overlap='';
    for(let x=Math.min(...xs)+80;x<Math.max(...xs);x+=160)
      for(let z=Math.min(...zs)+80;z<Math.max(...zs);z+=160){
        if(!pointInPolygon(x,z,district.polygon))continue;
        sampleCount++;
        const point={x,z},wet=isWater(point);
        if(wet)wetCount++;
        const h=terrainSample(x,z).height;
        lo=Math.min(lo,h);hi=Math.max(hi,h);
        const other=DISTRICTS.find(d=>d.id!==district.id&&pointInPolygon(x,z,d.polygon));
        if(other)overlap=other.id;
      }
    const area=polygonArea(district.polygon)/1e6,dry=1-wetCount/sampleCount;
    const access=closestRoadDistance(district.focus.x,district.focus.z);
    const tiles=SECTOR_LAYOUT.tilesFor(district).length;
    districts.push({id:district.id,areaKm2:area,dryFraction:dry,minimumHeight:lo,maximumHeight:hi,nearestRoad:access,tiles});
    if(area<2.9)issues.push(`${district.id} has only ${area.toFixed(1)} km²`);
    if(dry<(district.id==='rural'?.78:.94))issues.push(`${district.id} is ${(dry*100).toFixed(0)}% dry`);
    if(overlap)issues.push(`${district.id} overlaps ${overlap}`);
    if(access>1200)issues.push(`${district.id} is ${access.toFixed(0)} m from a road`);
    if(!pointInPolygon(district.focus.x,district.focus.z,district.polygon))issues.push(`${district.id} focus is outside its footprint`);
    if(!sectorAt(district.focus.x,district.focus.z)||!tiles)issues.push(`${district.id} has no streaming tile`);
  }
  const airport=districts.find(d=>d.id==='airport')!;
  if(airport.maximumHeight-airport.minimumHeight>30)issues.push('Airfield reservation is too steep');

  for(const sampled of SAMPLED_ROADS){
    const {road,samples,length}=sampled;
    let maxGrade=0,water=0,minClearance=Infinity;
    const points:Point[]=[...samples];
    for(let i=0;i<samples.length-1;i++){
      const a=samples[i],b=samples[i+1];
      const spacing=Math.hypot(a.x-b.x,a.z-b.z);
      if(spacing>0)maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/spacing);
      points.push({x:(a.x+b.x)/2,z:(a.z+b.z)/2});
    }
    for(const point of points){
      if(!sectorAt(point.x,point.z))issues.push(`${road.id} runs outside the world`);
      if(!isWater(point))continue;
      if(!road.bridge)water++;
      else {
        const waterLevel=road.bridge==='river'?nearestRiver(point.x,point.z).level:0;
        const sample=samples.reduce((best,s)=>Math.hypot(point.x-s.x,point.z-s.z)<Math.hypot(point.x-best.x,point.z-best.z)?s:best,samples[0]);
        minClearance=Math.min(minClearance,sample.y-waterLevel);
      }
    }
    if(water)issues.push(`${road.id} has ${water} unbridged water samples`);
    const gradeLimit={highway:.10,arterial:.12,secondary:.13,local:.15,rural:.18}[road.type];
    if(maxGrade>gradeLimit)issues.push(`${road.id} reaches ${(maxGrade*100).toFixed(1)}% grade`);
    roads.push({id:road.id,type:road.type,lengthKm:length/1000,maximumGrade:maxGrade,unbridgedWaterSamples:water});
    if(road.bridge){
      const crossing=points.filter(p=>road.bridge==='river'
        ? nearestRiver(p.x,p.z).distance<nearestRiver(p.x,p.z).width
        : signedCoastDistance(p.x,p.z)<0);
      const minAllowed=road.bridge==='river'?12:18;
      if(crossing.length<2)issues.push(`${road.id} bridge does not cross water`);
      if(minClearance<minAllowed)issues.push(`${road.id} clearance ${minClearance.toFixed(1)} m`);
      if(isWater(NODES[road.from])||isWater(NODES[road.to]))issues.push(`${road.id} lands in water`);
      bridges.push({id:road.id,waterSamples:crossing.length,minimumClearance:minClearance});
    }
  }
  const overview=sectorsNear(0,1000,5700).length,near=sectorsNear(0,1000,2600).length;
  if(SECTOR_LAYOUT.total!==252||overview>=SECTOR_LAYOUT.total||near>=overview)
    issues.push('Streaming radius loads the wrong number of 1 km tiles');
  return {issues,districts,roads,bridges,roadsKm:roads.reduce((sum,r)=>sum+r.lengthKm,0),sectorTotal:SECTOR_LAYOUT.total,sectorOverview:overview,sectorNear:near};
}
