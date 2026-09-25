import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DISTRICTS, LAKE, WORLD, type District, type Point } from '../world/data';
import {
  COASTS, RIVER_CURVE, clamp, distance, lakeRadius, riverHalfWidth,
  riverLevel, sectorKey, sectorsNear, terrainHeight,
} from '../world/geometry';
import { buildSector, createDistantTerrain, type ActiveSector } from './sector';
import { CityLayer, type ChunkStats } from './CityLayer';
import { IndustrialLayer } from './IndustrialLayer';

export type SceneStats = {loaded:number;wanted:number;coordinate:Point;altitude:number;distance:number;downtown?:ChunkStats;industrial?:ChunkStats};
type Flight = {start:number;duration:number;fromTarget:THREE.Vector3;toTarget:THREE.Vector3;fromCamera:THREE.Vector3;toCamera:THREE.Vector3};

function makeWaterMesh():THREE.Mesh {
  const geometry=new THREE.PlaneGeometry(70000,70000);
  geometry.rotateX(-Math.PI/2);
  const material=new THREE.MeshPhongMaterial({
    color:0x5c9ca7,emissive:0x0d3039,emissiveIntensity:.12,
    specular:0x7fbcc1,shininess:62,side:THREE.DoubleSide,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.y=-.25;mesh.name='Open sea / tidal pools';
  return mesh;
}

function makeRiver():THREE.Mesh {
  const positions:number[]=[],indices:number[]=[];
  const length:number[]=[0];
  for(let i=1;i<RIVER_CURVE.length;i++) length.push(length[i-1]+distance(RIVER_CURVE[i-1],RIVER_CURVE[i]));
  const total=length[length.length-1];
  for(let i=0;i<RIVER_CURVE.length;i++) {
    const p=RIVER_CURVE[i],prev=RIVER_CURVE[Math.max(0,i-1)],next=RIVER_CURVE[Math.min(RIVER_CURVE.length-1,i+1)];
    const dx=next.x-prev.x,dz=next.z-prev.z,m=Math.hypot(dx,dz)||1;
    const t=length[i]/total,w=riverHalfWidth(t),y=riverLevel(t)+.4;
    positions.push(p.x+dz/m*w,y,p.z-dx/m*w,p.x-dz/m*w,y,p.z+dx/m*w);
    if(i<RIVER_CURVE.length-1){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshPhongMaterial({color:0x6aabb1,specular:0xa8d1ce,shininess:68,side:THREE.DoubleSide}));
  mesh.name='Descending inland river'; return mesh;
}

function makeLake():THREE.Mesh {
  const positions:number[]=[LAKE.center.x,LAKE.level+.4,LAKE.center.z],indices:number[]=[];
  const count=128;
  for(let i=0;i<=count;i++) {
    const angle=i/count*2*Math.PI,r=lakeRadius(angle);
    positions.push(LAKE.center.x+Math.cos(angle)*LAKE.radiusX*r,LAKE.level+.4,LAKE.center.z+Math.sin(angle)*LAKE.radiusZ*r);
    if(i>0) indices.push(0,i,i+1);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshPhongMaterial({color:0x72aaa3,specular:0xd1dfc8,shininess:82,side:THREE.DoubleSide}));
  mesh.name='Elevated inland lake';return mesh;
}

function makeCoastFoam():THREE.Mesh {
  const pos:number[]=[],ids:number[]=[];
  for(const coast of COASTS) for(let i=0;i<coast.length-1;i++) {
    const a=coast[i],b=coast[i+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz)||1;
    const nx=dz/len*11,nz=-dx/len*11,j=pos.length/3;
    pos.push(a.x-nx,1.1,a.z-nz,a.x+nx,1.1,a.z+nz,
      b.x-nx,1.1,b.z-nz,b.x+nx,1.1,b.z+nz);
    ids.push(j,j+1,j+2,j+1,j+3,j+2);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setIndex(ids);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xd9e6d7,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide}));
  mesh.name='Shoreline surf';return mesh;
}

function makeBoundary(district:District):THREE.Line {
  const vertices:number[]=[];
  for(let i=0;i<district.polygon.length;i++) {
    const a=district.polygon[i],b=district.polygon[(i+1)%district.polygon.length];
    const n=Math.ceil(distance(a,b)/75);
    for(let j=0;j<n;j++) {
      const t=j/n,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      vertices.push(x,Math.max(0,terrainHeight(x,z))+12,z);
    }
  }
  const first=district.polygon[0];vertices.push(first.x,Math.max(0,terrainHeight(first.x,first.z))+12,first.z);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const material=new THREE.LineDashedMaterial({color:district.color,transparent:true,opacity:.62,dashSize:72,gapSize:56,depthTest:false});
  const line=new THREE.Line(geometry,material);line.computeLineDistances();
  line.renderOrder=8;line.name=`${district.id==='downtown'||district.id==='industrial'?'Built':'Reserved'}: ${district.name}`;return line;
}

export class WorldScene {
  readonly scene=new THREE.Scene();
  readonly camera:THREE.PerspectiveCamera;
  readonly renderer:THREE.WebGLRenderer;
  readonly controls:OrbitControls;
  readonly element:HTMLElement;
  readonly labelLayer:HTMLElement;
  onStats?: (stats:SceneStats)=>void;
  onDistrictClick?: (id:string)=>void;
  onMove?: (point:Point)=>void;
  readonly city=new CityLayer();
  readonly industrial=new IndustrialLayer();
  private readonly active=new Map<string,ActiveSector>();
  private readonly boundaryGroup=new THREE.Group();
  private readonly boundaryLines=new Map<string,THREE.Line>();
  private readonly labels=new Map<string,HTMLElement>();
  private readonly keys=new Set<string>();
  private readonly temp=new THREE.Vector3();
  private lastTime=performance.now();
  private lastSectorCheck=0;
  private lastStats=0;
  private lastPosition='';
  private flight:Flight|null=null;
  private selected='downtown';
  private boundariesVisible=true;
  private paused=false;

  constructor(element:HTMLElement,labelLayer:HTMLElement) {
    this.element=element;this.labelLayer=labelLayer;
    this.scene.background=new THREE.Color(0xbcd6d3);
    this.scene.fog=new THREE.FogExp2(0xbcd6d3,.000076);
    this.camera=new THREE.PerspectiveCamera(52,1,1.5,33000);
    // Approach over the southern water so the opening view actually reads as a
    // coastal region, with the bayfront and inland relief beyond it.
    this.camera.position.set(2150,1120,7030);
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.02;
    this.renderer.setSize(element.clientWidth,element.clientHeight);
    element.appendChild(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.target.set(0,38,1850);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=.075;
    this.controls.screenSpacePanning=true;
    // Close enough to stand inside the enterable buildings of the flats.
    this.controls.minDistance=42;
    this.controls.maxDistance=10200;
    this.controls.minPolarAngle=.13;
    this.controls.maxPolarAngle=Math.PI/2-.045;
    this.controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
    this.controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};
    this.controls.update();
    this.renderer.domElement.addEventListener('pointerdown',()=>{this.flight=null;});
    this.renderer.domElement.addEventListener('contextmenu',event=>event.preventDefault());

    this.scene.add(new THREE.HemisphereLight(0xeaf5eb,0x627c73,1.28));
    const sunlight=new THREE.DirectionalLight(0xffebc9,1.36);
    sunlight.position.set(-5300,9200,-3900);this.scene.add(sunlight);
    this.scene.add(makeWaterMesh());
    this.scene.add(createDistantTerrain());
    this.scene.add(makeRiver(),makeLake(),makeCoastFoam());
    this.scene.add(this.city.group);
    this.scene.add(this.industrial.group);
    for(const district of DISTRICTS) {
      const line=makeBoundary(district);this.boundaryGroup.add(line);this.boundaryLines.set(district.id,line);
      const label=document.createElement('button');
      label.className='world-label';label.type='button';label.dataset.district=district.id;
      label.innerHTML=`<span class="world-label__dot"></span><span>${district.name}</span>`;
      label.addEventListener('click',()=>this.onDistrictClick?.(district.id));
      labelLayer.appendChild(label);this.labels.set(district.id,label);
    }
    this.scene.add(this.boundaryGroup);
    this.setSelectedDistrict(this.selected);
    window.addEventListener('resize',()=>this.resize());
    window.addEventListener('keydown',this.onKeyDown);
    window.addEventListener('keyup',this.onKeyUp);
    window.addEventListener('blur',()=>this.keys.clear());
    this.render= this.render.bind(this);
    requestAnimationFrame(this.render);
  }

  private onKeyDown=(event:KeyboardEvent)=>{
    if(event.target instanceof HTMLInputElement || event.metaKey || event.altKey || event.ctrlKey) return;
    const key=event.key.toLowerCase();
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','q','e','shift'].includes(key)) {
      this.keys.add(key);
      if(key.startsWith('arrow')) event.preventDefault();
      this.flight=null;
    }
  };
  private onKeyUp=(event:KeyboardEvent)=>this.keys.delete(event.key.toLowerCase());

  resize() {
    const w=this.element.clientWidth,h=this.element.clientHeight;
    if(!w||!h)return;
    this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.7));
    this.renderer.setSize(w,h);
  }

  setSelectedDistrict(id:string) {
    this.selected=id;
    for(const district of DISTRICTS) {
      const line=this.boundaryLines.get(district.id)!;
      const mat=line.material as THREE.LineDashedMaterial;
      mat.opacity=id===district.id?.98:.51;
      mat.color.set(id===district.id?0xffda96:district.color);
      this.labels.get(district.id)?.classList.toggle('is-selected',id===district.id);
    }
  }
  setBoundaries(visible:boolean) {
    this.boundariesVisible=visible;
    this.boundaryGroup.visible=visible;
    this.labelLayer.classList.toggle('is-hidden',!visible);
  }
  getBoundaries(){return this.boundariesVisible;}
  setNavigation(visible:boolean){this.city.setNavigation(visible);this.industrial.setNavigation(visible);}
  getNavigation(){return this.city.getNavigation()||this.industrial.getNavigation();}
  setPaused(paused:boolean){this.paused=paused;}

  focus(point:Point,zoom=3200) {
    const fromTarget=this.controls.target.clone(),fromCamera=this.camera.position.clone();
    const toTarget=new THREE.Vector3(clamp(point.x,WORLD.minX+250,WORLD.maxX-250),Math.max(12,terrainHeight(point.x,point.z)+32),clamp(point.z,WORLD.minZ+250,WORLD.maxZ-250));
    const offset=this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(zoom);
    const toCamera=toTarget.clone().add(offset);
    // Stay above a rising ridge when focusing a mountain floor from sea level.
    toCamera.y=Math.max(toCamera.y,toTarget.y+550);
    this.flight={start:performance.now(),duration:1050,fromTarget,toTarget,fromCamera,toCamera};
  }
  resetView(){this.focus({x:160,z:920},2450);}
  getFocus():Point{return{x:this.controls.target.x,z:this.controls.target.z};}
  getZoom():number{return this.camera.position.distanceTo(this.controls.target);}

  private keyboardMotion(dt:number) {
    const horiz=Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'));
    const vert=Number(this.keys.has('w')||this.keys.has('arrowup'))-Number(this.keys.has('s')||this.keys.has('arrowdown'));
    const rotate=Number(this.keys.has('e'))-Number(this.keys.has('q'));
    if(rotate) {
      const angle=rotate*dt*.8,offset=this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    if(horiz||vert) {
      const forward=this.controls.target.clone().sub(this.camera.position);forward.y=0;forward.normalize();
      const right=new THREE.Vector3(-forward.z,0,forward.x);
      const speed=clamp(this.getZoom()*.47,260,2350)*(this.keys.has('shift')?2:1)*dt;
      const delta=forward.multiplyScalar(vert*speed).add(right.multiplyScalar(horiz*speed));
      this.camera.position.add(delta);this.controls.target.add(delta);
    }
  }

  private updateSectors(now:number) {
    if(now-this.lastSectorCheck<130) return;
    this.lastSectorCheck=now;
    const target=this.controls.target,distance=this.getZoom();
    const radius=clamp(distance*.64+750,2500,5700);
    const wanted=sectorsNear(target.x,target.z,radius).slice(0,125);
    const keys=new Set(wanted.map(s=>sectorKey(s.x,s.z)));
    for(const [key,sector] of this.active) if(!keys.has(key)) {
      this.scene.remove(sector.group);sector.dispose();this.active.delete(key);
    }
    // Limit synchronous construction on each frame; arriving tiles stream in nearest first.
    let created=0;
    const frameStart=performance.now();
    for(const tile of wanted) {
      const key=sectorKey(tile.x,tile.z);
      if(this.active.has(key)) continue;
      const sector=buildSector(tile.x,tile.z);
      this.active.set(key,sector);this.scene.add(sector.group);
      created++;
      if(created>=3 || performance.now()-frameStart>11) break;
    }
    if(now-this.lastStats>380) {
      this.lastStats=now;
      this.onStats?.({loaded:this.active.size,wanted:wanted.length,coordinate:{x:target.x,z:target.z},altitude:Math.max(0,terrainHeight(target.x,target.z)),distance,downtown:this.city.stats,industrial:this.industrial.stats});
    }
  }

  /** The built districts stream on their own 500 m tiles, in a separate budget from
   * the terrain; the flats also animate their fleet every frame. */
  private updateCity(now:number,dt:number) {
    this.city.update(this.controls.target,now,7);
    this.industrial.update(this.controls.target,now,7);
    this.industrial.updateTraffic(dt);
  }

  private updateLabels() {
    if(!this.boundariesVisible) return;
    const width=this.element.clientWidth,height=this.element.clientHeight;
    const camDistance=this.getZoom();
    for(const district of DISTRICTS) {
      const label=this.labels.get(district.id)!;
      const h=Math.max(terrainHeight(district.focus.x,district.focus.z),2)+48;
      this.temp.set(district.focus.x,h,district.focus.z).project(this.camera);
      const x=(this.temp.x*.5+.5)*width,y=(-this.temp.y*.5+.5)*height;
      const hidden=this.temp.z>1||this.temp.z<0||x<38||x>width-38||y<48||y>height-52;
      label.style.display=hidden?'none':'flex';
      if(!hidden){
        label.style.transform=`translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
        const dis=Math.hypot(district.focus.x-this.controls.target.x,district.focus.z-this.controls.target.z);
        label.style.opacity=String(clamp(1-dis/(camDistance*1.75),.3,1));
      }
    }
  }

  private render(now:number) {
    requestAnimationFrame(this.render);
    if(this.paused){this.lastTime=now;return;}
    const dt=Math.min((now-this.lastTime)/1000,.05);this.lastTime=now;
    if(this.flight) {
      const f=this.flight,t=clamp((now-f.start)/f.duration,0,1),ease=1-Math.pow(1-t,3);
      this.controls.target.copy(f.fromTarget).lerp(f.toTarget,ease);
      this.camera.position.copy(f.fromCamera).lerp(f.toCamera,ease);
      if(t===1) this.flight=null;
    }
    this.keyboardMotion(dt);
    this.controls.update();
    const focus=this.controls.target;
    const x=clamp(focus.x,WORLD.minX+100,WORLD.maxX-100);
    const z=clamp(focus.z,WORLD.minZ+100,WORLD.maxZ-100);
    if(x!==focus.x||z!==focus.z) {
      this.camera.position.x+=x-focus.x;this.camera.position.z+=z-focus.z;
      focus.x=x;focus.z=z;
    }
    this.updateSectors(now);
    this.updateCity(now,dt);
    this.updateLabels();
    this.renderer.render(this.scene,this.camera);
    const coordinate=`${Math.round(focus.x/15)},${Math.round(focus.z/15)}`;
    if(this.lastPosition!==coordinate){this.lastPosition=coordinate;this.onMove?.({x:focus.x,z:focus.z});}
  }
}
