import * as THREE from 'three';
import { WORLD, type RoadClass } from '../world/data';
import {
  forestDensity, isConstructedDowntown, isReservedBuiltArea, nearestRiver,
  sectorAt, sectorKey, terrainColor, terrainSample,
} from '../world/geometry';
import { SAMPLED_ROADS, type RoadSample, type SampledRoad } from '../world/roads';

const terrainMaterial = new THREE.MeshLambertMaterial({vertexColors:true, side:THREE.FrontSide});
const roadMaterial = new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.DoubleSide});
const shoulderMaterial = new THREE.MeshBasicMaterial({color:0x9a9f91, side:THREE.DoubleSide});
const markingMaterial = new THREE.MeshBasicMaterial({color:0xeee3be, side:THREE.DoubleSide});
const railMaterial = new THREE.MeshBasicMaterial({color:0xb7c5b8, side:THREE.DoubleSide});
const pierMaterial = new THREE.MeshLambertMaterial({color:0xa4aca7});
const pineMaterial = new THREE.MeshLambertMaterial({color:0xffffff});
const trunkMaterial = new THREE.MeshLambertMaterial({color:0x746a50});
const pineGeometry = new THREE.ConeGeometry(1,1,5);
const trunkGeometry = new THREE.CylinderGeometry(1,1,1,5);
const pierGeometry = new THREE.BoxGeometry(1,1,1);
const up = new THREE.Object3D();

const roadPaint: Record<RoadClass, readonly [number,number,number]> = {
  highway:[.25,.29,.28], arterial:[.28,.32,.30], secondary:[.34,.37,.34],
  local:[.37,.40,.36], rural:[.53,.49,.39],
};
const toLinear=(rgb:readonly [number,number,number]):readonly [number,number,number]=>{
  const c=new THREE.Color().setRGB(rgb[0],rgb[1],rgb[2],THREE.SRGBColorSpace);
  return [c.r,c.g,c.b];
};
const roadColors:Record<RoadClass,readonly [number,number,number]>={
  highway:toLinear(roadPaint.highway),arterial:toLinear(roadPaint.arterial),
  secondary:toLinear(roadPaint.secondary),local:toLinear(roadPaint.local),
  rural:toLinear(roadPaint.rural),
};

function pseudoRandom(seed: number): () => number {
  let s=seed|0;
  return () => { s=(Math.imul(s,1664525)+1013904223)|0; return (s>>>0)/4294967296; };
}

type Segment = { road: SampledRoad; a: RoadSample; b: RoadSample; index: number };
const roadBySector = new Map<string,Segment[]>();
for (const road of SAMPLED_ROADS) {
  for (let i=0; i<road.samples.length-1; i++) {
    const a=road.samples[i], b=road.samples[i+1];
    const tile=sectorAt((a.x+b.x)/2,(a.z+b.z)/2);
    if (!tile) continue;
    const key=sectorKey(tile.x,tile.z);
    const list=roadBySector.get(key) ?? [];
    list.push({road,a,b,index:i}); roadBySector.set(key,list);
  }
}

function tooCloseToRoad(x:number,z:number,ix:number,iz:number): boolean {
  for (let tz=iz-1;tz<=iz+1;tz++) for (let tx=ix-1;tx<=ix+1;tx++) {
    const segments=roadBySector.get(sectorKey(tx,tz));
    if (!segments) continue;
    for (const {road,a,b} of segments) {
      if (Math.abs(a.x-x)>105 && Math.abs(b.x-x)>105) continue;
      if (Math.abs(a.z-z)>105 && Math.abs(b.z-z)>105) continue;
      const dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
      if (Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<road.width/2+24) return true;
    }
  }
  return false;
}

type QuadBuffer = { positions:number[]; indices:number[]; colors?:number[] };
const makeBuffer = (vertexColors=false):QuadBuffer => ({positions:[],indices:[],...(vertexColors?{colors:[]}: {})});
function addQuad(buf:QuadBuffer, a:readonly number[],b:readonly number[],c:readonly number[],d:readonly number[], color?:readonly number[]) {
  const offset=buf.positions.length/3;
  buf.positions.push(...a,...b,...c,...d);
  buf.indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  if (buf.colors && color) for(let j=0;j<4;j++) buf.colors.push(...color);
}
function meshFromQuads(buf:QuadBuffer,material:THREE.Material):THREE.Mesh|undefined {
  if (!buf.positions.length) return undefined;
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(buf.positions,3));
  if(buf.colors) geo.setAttribute('color',new THREE.Float32BufferAttribute(buf.colors,3));
  geo.setIndex(buf.indices);
  // Roads are nearly horizontal; a lightweight flat normal is sufficient.
  const normals=new Float32Array(buf.positions.length);
  for(let j=1;j<normals.length;j+=3) normals[j]=1;
  geo.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  return new THREE.Mesh(geo,material);
}

function quadAlong(a:RoadSample,b:RoadSample,width:number,offset:number,buf:QuadBuffer,color?:readonly number[]) {
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
  const nx=dz/len*width/2,nz=-dx/len*width/2;
  addQuad(buf,
    [a.x-nx,a.y+offset,a.z-nz], [a.x+nx,a.y+offset,a.z+nz],
    [b.x+nx,b.y+offset,b.z+nz], [b.x-nx,b.y+offset,b.z-nz],color);
}

function makeTerrain(minX:number,minZ:number,size:number,steps:number,yOffset=0):THREE.Mesh {
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let iz=0;iz<=steps;iz++) for(let ix=0;ix<=steps;ix++) {
    const x=minX+ix*size/steps,z=minZ+iz*size/steps;
    const sample=terrainSample(x,z);
    const c=terrainColor(x,z,sample);
    positions.push(x,sample.height+yOffset,z);
    const linear=new THREE.Color().setRGB(c[0],c[1],c[2],THREE.SRGBColorSpace);
    colors.push(linear.r,linear.g,linear.b);
  }
  for(let iz=0;iz<steps;iz++) for(let ix=0;ix<steps;ix++) {
    const a=iz*(steps+1)+ix,b=a+1,c=a+steps+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setIndex(indices); geo.computeVertexNormals();
  return new THREE.Mesh(geo,terrainMaterial);
}

/** An intentionally coarse all-region silhouette; detailed meshes/assets are streamed. */
export function createDistantTerrain():THREE.Mesh {
  const width=WORLD.maxX-WORLD.minX, height=WORLD.maxZ-WORLD.minZ;
  // Use a 150m base grid over the 18 x 14 km region, then stream 42m local detail.
  // The coarse surface is recessed to avoid z fighting with active sectors.
  const nx=120,nz=94;
  const positions:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let iz=0;iz<=nz;iz++) for(let ix=0;ix<=nx;ix++) {
    const x=WORLD.minX+width*ix/nx,z=WORLD.minZ+height*iz/nz;
    const sample=terrainSample(x,z),c=terrainColor(x,z,sample);
    positions.push(x,sample.height-2.2,z);
    const linear=new THREE.Color().setRGB(c[0],c[1],c[2],THREE.SRGBColorSpace);
    colors.push(linear.r,linear.g,linear.b);
  }
  for(let iz=0;iz<nz;iz++) for(let ix=0;ix<nx;ix++) {
    const a=iz*(nx+1)+ix,c=a+nx+1;
    indices.push(a,c,a+1,a+1,c,c+1);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,terrainMaterial);
  mesh.name='Low-detail regional silhouette';
  return mesh;
}

function addRoads(group:THREE.Group,ix:number,iz:number,owned:THREE.BufferGeometry[]) {
  const surface=makeBuffer(true),shoulder=makeBuffer(),markings=makeBuffer(),rails=makeBuffer();
  const piers:{x:number;y:number;z:number;height:number}[]=[];
  for(const {road,a,b,index} of roadBySector.get(sectorKey(ix,iz))??[]) {
    // Both ends inside downtown: the district draws this alignment itself, at pad height.
    if(isConstructedDowntown(a.x,a.z)&&isConstructedDowntown(b.x,b.z)) continue;
    const bridge=!!road.road.bridge;
    quadAlong(a,b,road.width+9,-.48,shoulder);
    quadAlong(a,b,road.width,0,surface,roadColors[road.road.type]);
    const phase=(a.t*road.length)%78;
    if ((road.road.type==='highway'||road.road.type==='arterial') && phase<42) {
      quadAlong(a,b,road.road.type==='highway'?1.8:1.2,.07,markings);
    }
    if(bridge) {
      // Continuous side rails, even where the span crosses a tile boundary.
      const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
      const nx=dz/len*(road.width/2+1),nz=-dx/len*(road.width/2+1);
      for (const side of [-1,1]) addQuad(rails,
        [a.x+side*nx,a.y+2.4,a.z+side*nz],[a.x+side*nx,a.y+3.7,a.z+side*nz],
        [b.x+side*nx,b.y+3.7,b.z+side*nz],[b.x+side*nx,b.y+2.4,b.z+side*nz]);
      if(index%5===0 && index>1 && index<road.samples.length-3) {
        const base=terrainSample(a.x,a.z).height;
        if(a.y-base>10) {
          const footing=road.road.bridge==='river' ? Math.max(base,nearestRiver(a.x,a.z).level-4) : Math.max(base,-4);
          piers.push({x:a.x,z:a.z,y:(a.y+footing)/2-1,height:Math.max(4,a.y-footing-2)});
        }
      }
    }
  }
  for(const [buf,mat] of [[shoulder,shoulderMaterial],[surface,roadMaterial],[markings,markingMaterial],[rails,railMaterial]] as const) {
    const mesh=meshFromQuads(buf,mat);
    if(mesh){group.add(mesh);owned.push(mesh.geometry);}
  }
  if(piers.length) {
    const mesh=new THREE.InstancedMesh(pierGeometry,pierMaterial,piers.length);
    piers.forEach((pier,i)=>{
      up.position.set(pier.x,pier.y,pier.z);up.scale.set(6,pier.height,6);up.rotation.set(0,0,0);
      up.updateMatrix();mesh.setMatrixAt(i,up.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
}

function addForest(group:THREE.Group,ix:number,iz:number) {
  const size=WORLD.sectorSize,minX=WORLD.minX+ix*size,minZ=WORLD.minZ+iz*size;
  const random=pseudoRandom(24077+ix*7919+iz*104729);
  const trees:{x:number;z:number;y:number;radius:number;height:number;shade:number}[]=[];
  const grid=13,spacing=size/grid;
  for(let gz=0;gz<grid;gz++) for(let gx=0;gx<grid;gx++) {
    const x=minX+(gx+.16+.68*random())*spacing;
    const z=minZ+(gz+.16+.68*random())*spacing;
    const density=forestDensity(x,z);
    if(random()>density*.93 || density<.08) continue;
    const sample=terrainSample(x,z);
    if(sample.coast<85 || sample.lake<1.16 || sample.river.distance<sample.river.width+48) continue;
    if(isReservedBuiltArea(x,z)||tooCloseToRoad(x,z,ix,iz)) continue;
    trees.push({x,z,y:sample.height,radius:7+7*random(),height:22+23*random(),shade:random()});
  }
  if(!trees.length) return;
  const canopy=new THREE.InstancedMesh(pineGeometry,pineMaterial,trees.length);
  const trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
  trees.forEach((tree,i)=>{
    up.position.set(tree.x,tree.y+tree.height*.55,tree.z);
    up.scale.set(tree.radius,tree.height*.9,tree.radius);up.rotation.set(0,tree.shade*Math.PI*2,0);
    up.updateMatrix();canopy.setMatrixAt(i,up.matrix);
    const color=new THREE.Color().setRGB(.20+tree.shade*.12,.39+tree.shade*.13,.30+tree.shade*.09);
    canopy.setColorAt(i,color);
    up.position.set(tree.x,tree.y+tree.height*.19,tree.z);
    up.scale.set(tree.radius*.18,tree.height*.38,tree.radius*.18);up.rotation.set(0,0,0);
    up.updateMatrix();trunks.setMatrixAt(i,up.matrix);
  });
  canopy.instanceMatrix.needsUpdate=true;canopy.instanceColor!.needsUpdate=true;
  trunks.instanceMatrix.needsUpdate=true;
  canopy.computeBoundingSphere();trunks.computeBoundingSphere();
  group.add(trunks,canopy);
}

export type ActiveSector = {group:THREE.Group;dispose:()=>void};
export function buildSector(ix:number,iz:number):ActiveSector {
  const group=new THREE.Group();group.name=`Sector ${ix}:${iz}`;
  const x=WORLD.minX+ix*WORLD.sectorSize,z=WORLD.minZ+iz*WORLD.sectorSize;
  const terrain=makeTerrain(x,z,WORLD.sectorSize,24);
  group.add(terrain);
  const owned=[terrain.geometry];
  addRoads(group,ix,iz,owned);
  addForest(group,ix,iz);
  return {group,dispose:()=>{
    for(const child of group.children)if(child instanceof THREE.InstancedMesh)child.dispose();
    for(const geo of owned)geo.dispose();
  }};
}
