import { NODES, ROADS, ROAD_WIDTH, type Point, type Road } from './data';
import { clamp, distance, lerp, nearestRiver, riverLevel, sampleCurve, terrainHeight } from './geometry';

export type RoadSample = Point & { y: number; t: number };
export type SampledRoad = { road: Road; samples: RoadSample[]; width: number; length: number };

export function sampleRoad(road: Road, spacing=38): SampledRoad {
  const from=NODES[road.from], to=NODES[road.to];
  if (!from || !to) throw new Error(`Unknown endpoint of road ${road.id}`);
  const points=road.bridge ? [from,to] : [from,...(road.via ?? []),to];
  const curve=sampleCurve(points,spacing);
  const cumulative=[0];
  for (let i=1;i<curve.length;i++) cumulative.push(cumulative[i-1]+distance(curve[i-1],curve[i]));
  const length=cumulative[cumulative.length-1];
  const a=terrainHeight(from.x,from.z)+2.3, b=terrainHeight(to.x,to.z)+2.3;
  const middle=road.bridge==='river' ? nearestRiver((from.x+to.x)/2,(from.z+to.z)/2).level : 0;
  const clearance=road.bridge==='river' ? 17 : 28;
  const rise=road.bridge ? Math.max(0,middle+clearance-(a+b)/2) : 0;
  const samples=curve.map((p,i)=>{
    const t=cumulative[i]/(length||1);
    // A smooth central rise gives ships clearance without abrupt slopes at either approach.
    const y=road.bridge
      ? lerp(a,b,t)+rise*Math.pow(Math.sin(Math.PI*t),2)
      : terrainHeight(p.x,p.z)+(road.type==='highway' ? 2.6 : 1.7);
    return {...p,t,y};
  });
  return {road,samples,width:ROAD_WIDTH[road.type],length};
}

export const SAMPLED_ROADS: readonly SampledRoad[] = ROADS.map(road=>sampleRoad(road));

export function closestRoadDistance(x:number,z:number,roads:readonly SampledRoad[]=SAMPLED_ROADS): number {
  let nearest=Infinity;
  for (const road of roads) {
    for (let i=0;i<road.samples.length-1;i++) {
      const a=road.samples[i], b=road.samples[i+1];
      if(x<Math.min(a.x,b.x)-nearest||x>Math.max(a.x,b.x)+nearest||
         z<Math.min(a.z,b.z)-nearest||z>Math.max(a.z,b.z)+nearest)continue;
      const dx=b.x-a.x,dz=b.z-a.z;
      const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);
      nearest=Math.min(nearest,Math.hypot(x-a.x-dx*t,z-a.z-dz*t)-road.width/2);
    }
  }
  return nearest;
}

export function roadGraph(): Map<string, Set<string>> {
  const graph=new Map<string,Set<string>>(Object.keys(NODES).map(id=>[id,new Set<string>()]));
  for (const road of ROADS) {
    graph.get(road.from)?.add(road.to);
    graph.get(road.to)?.add(road.from);
  }
  return graph;
}

export function bridgeWaterLevel(road: Road, point: Point): number {
  return road.bridge==='river' ? riverLevel(nearestRiver(point.x,point.z).t) : 0;
}
