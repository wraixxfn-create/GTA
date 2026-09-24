import { DISTRICTS, LAKE, WORLD, type District, type Point } from '../world/data';
import {
  COASTS, RIVER_CURVE, clamp, districtAt, lakeRadius,
  terrainColor, terrainSample,
} from '../world/geometry';
import { SAMPLED_ROADS } from '../world/roads';

type MapRect={x:number;y:number;width:number;height:number};
const width=WORLD.maxX-WORLD.minX,height=WORLD.maxZ-WORLD.minZ;
const colorToCss=(hex:string,alpha=1)=>{
  const n=parseInt(hex.slice(1),16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`;
};

function mapRect(canvas:HTMLCanvasElement,pad:number):MapRect {
  const availableW=canvas.clientWidth-2*pad,availableH=canvas.clientHeight-2*pad;
  const scale=Math.min(availableW/width,availableH/height);
  const w=width*scale,h=height*scale;
  return{x:(canvas.clientWidth-w)/2,y:(canvas.clientHeight-h)/2,width:w,height:h};
}
function toScreen(point:Point,r:MapRect):[number,number] {
  return [r.x+(point.x-WORLD.minX)/width*r.width,r.y+(point.z-WORLD.minZ)/height*r.height];
}
function toWorld(px:number,py:number,r:MapRect):Point {
  return {x:WORLD.minX+clamp((px-r.x)/r.width,0,1)*width,z:WORLD.minZ+clamp((py-r.y)/r.height,0,1)*height};
}
function tracePoints(ctx:CanvasRenderingContext2D,points:readonly Point[],rect:MapRect,close=false){
  ctx.beginPath();
  points.forEach((p,i)=>{const [x,y]=toScreen(p,rect);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});
  if(close)ctx.closePath();
}
function resizeCanvas(canvas:HTMLCanvasElement):CanvasRenderingContext2D {
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(canvas.clientWidth*dpr)),h=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);return ctx;
}

/** The atlas is a second view of the same world function, not a hand-drawn mockup. */
export class Atlas {
  private mini:HTMLCanvasElement;
  private full:HTMLCanvasElement;
  private raster=document.createElement('canvas');
  private elevation:Float32Array;
  private miniRect:MapRect={x:0,y:0,width:1,height:1};
  private fullRect:MapRect={x:0,y:0,width:1,height:1};
  private focus:Point={x:0,z:760};
  private zoom=5100;
  private selected='downtown';
  private boundaries=true;
  private fullVisible=false;
  onSelect?: (id:string)=>void;
  onPan?: (point:Point)=>void;
  onHover?: (district:District|null,point:Point)=>void;

  constructor(mini:HTMLCanvasElement,full:HTMLCanvasElement) {
    this.mini=mini;this.full=full;
    const rw=360,rh=280;
    this.raster.width=rw;this.raster.height=rh;
    this.elevation=new Float32Array(rw*rh);
    const ctx=this.raster.getContext('2d')!;
    const image=ctx.createImageData(rw,rh);
    for(let row=0;row<rh;row++) for(let col=0;col<rw;col++) {
      const x=WORLD.minX+(col+.5)/rw*width,z=WORLD.minZ+(row+.5)/rh*height;
      const sample=terrainSample(x,z);
      this.elevation[row*rw+col]=sample.height;
      let rgb=terrainColor(x,z,sample);
      if(sample.coast<0) {
        const near=clamp(1+sample.coast/850,0,1);
        rgb=[.19+.19*near,.39+.22*near,.46+.18*near];
      } else if(sample.lake<1 || sample.river.distance<sample.river.width+.5 || sample.height<0) {
        rgb=[.35,.60,.62];
      } else {
        const north=this.elevation[Math.max(0,row-1)*rw+col];
        const west=this.elevation[row*rw+Math.max(0,col-1)];
        const shade=clamp(1 + (sample.height-north)*.005+(sample.height-west)*.002,.74,1.13);
        rgb=[rgb[0]*shade,rgb[1]*shade,rgb[2]*shade];
      }
      const j=(row*rw+col)*4;
      image.data[j]=Math.round(rgb[0]*255);image.data[j+1]=Math.round(rgb[1]*255);
      image.data[j+2]=Math.round(rgb[2]*255);image.data[j+3]=255;
    }
    ctx.putImageData(image,0,0);
    mini.addEventListener('click',e=>this.handleClick(e,this.miniRect));
    full.addEventListener('click',e=>this.handleClick(e,this.fullRect));
    full.addEventListener('mousemove',e=>this.handleHover(e));
    full.addEventListener('mouseleave',()=>this.onHover?.(null,this.focus));
    window.addEventListener('resize',()=>this.draw());
    this.draw();
  }

  private handleClick(event:MouseEvent,rect:MapRect) {
    const bounds=(event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x=event.clientX-bounds.left,y=event.clientY-bounds.top;
    if(x<rect.x||x>rect.x+rect.width||y<rect.y||y>rect.y+rect.height)return;
    const point=toWorld(x,y,rect);
    const district=districtAt(point.x,point.z);
    if(district){this.onSelect?.(district.id);this.onPan?.(district.focus);}
    else this.onPan?.(point);
  }
  private handleHover(event:MouseEvent) {
    const bounds=this.full.getBoundingClientRect(),r=this.fullRect;
    const x=event.clientX-bounds.left,y=event.clientY-bounds.top;
    if(x<r.x||x>r.x+r.width||y<r.y||y>r.y+r.height){this.onHover?.(null,this.focus);return;}
    const point=toWorld(x,y,r),district=districtAt(point.x,point.z)??null;
    this.full.style.cursor=district?'pointer':'crosshair';
    this.onHover?.(district,point);
  }

  setFocus(point:Point,zoom:number){this.focus=point;this.zoom=zoom;this.drawMini();}
  setSelected(id:string){this.selected=id;this.draw();}
  setBoundaries(value:boolean){this.boundaries=value;this.draw();}
  setFullVisible(value:boolean){this.fullVisible=value;if(value)this.drawFull();}
  draw(){this.drawMini();if(this.fullVisible)this.drawFull();}
  private base(ctx:CanvasRenderingContext2D,rect:MapRect,detail:boolean) {
    const c=ctx.canvas;
    ctx.clearRect(0,0,c.clientWidth,c.clientHeight);
    ctx.fillStyle='#17333c';ctx.fillRect(0,0,c.clientWidth,c.clientHeight);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(this.raster,rect.x,rect.y,rect.width,rect.height);
    ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
    // A thin coast contour clarifies the two landmasses without masking the beaches.
    ctx.lineWidth=detail?1.2:.7;ctx.strokeStyle='rgba(244,235,203,.55)';
    for(const coast of COASTS){tracePoints(ctx,coast,rect);ctx.stroke();}
    if(detail)this.contours(ctx,rect);
    this.drawWater(ctx,rect,detail);
    this.drawRoads(ctx,rect,detail);
    if(this.boundaries)this.drawDistricts(ctx,rect,detail);
    this.drawFocus(ctx,rect,detail);
    ctx.restore();
    ctx.strokeStyle=detail?'rgba(240,237,217,.22)':'rgba(235,231,203,.26)';
    ctx.lineWidth=1;ctx.strokeRect(rect.x+.5,rect.y+.5,rect.width-1,rect.height-1);
  }

  private contours(ctx:CanvasRenderingContext2D,r:MapRect) {
    // Sparse elevation isolines; peaks remain readable beneath the district overlay.
    const cols=this.raster.width,rows=this.raster.height;
    for(const level of [100,250,450,700]) {
      ctx.beginPath();
      for(let j=1;j<rows-1;j+=2)for(let i=1;i<cols-1;i+=2){
        const a=this.elevation[j*cols+i],b=this.elevation[j*cols+i+2];
        const c=this.elevation[(j+2)*cols+i],d=this.elevation[(j+2)*cols+i+2];
        if((a<level)===(b<level) && (a<level)===(c<level) && (a<level)===(d<level))continue;
        const px=r.x+i/cols*r.width,py=r.y+j/rows*r.height;
        const sx=2/cols*r.width,sy=2/rows*r.height;
        const edge: [number,number][]=[];
        if((a<level)!==(b<level))edge.push([px+sx*clamp((level-a)/(b-a),0,1),py]);
        if((b<level)!==(d<level))edge.push([px+sx,py+sy*clamp((level-b)/(d-b),0,1)]);
        if((c<level)!==(d<level))edge.push([px+sx*clamp((level-c)/(d-c),0,1),py+sy]);
        if((a<level)!==(c<level))edge.push([px,py+sy*clamp((level-a)/(c-a),0,1)]);
        if(edge.length>=2){ctx.moveTo(...edge[0]);ctx.lineTo(...edge[1]);}
      }
      ctx.strokeStyle=level===700?'rgba(251,239,210,.30)':'rgba(241,244,217,.18)';
      ctx.lineWidth=level===700?.8:.65;ctx.stroke();
    }
  }

  private drawWater(ctx:CanvasRenderingContext2D,r:MapRect,detail:boolean){
    // Crisp vector rivers/shorelines atop the raster's shaded water pixels.
    ctx.strokeStyle=detail?'#82b8b5':'#79b0b1';
    ctx.lineJoin='round';ctx.lineCap='round';
    ctx.lineWidth=detail?Math.max(2,r.width/width*140):1.6;
    tracePoints(ctx,RIVER_CURVE,r);ctx.stroke();
    ctx.fillStyle='#80b5af';ctx.beginPath();
    const count=100;
    for(let i=0;i<=count;i++){
      const a=i/count*Math.PI*2,rad=lakeRadius(a);
      const [x,y]=toScreen({x:LAKE.center.x+LAKE.radiusX*rad*Math.cos(a),z:LAKE.center.z+LAKE.radiusZ*rad*Math.sin(a)},r);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.fill();
    ctx.strokeStyle='rgba(227,236,210,.55)';ctx.lineWidth=.9;ctx.stroke();
  }

  private drawRoads(ctx:CanvasRenderingContext2D,r:MapRect,detail:boolean) {
    const ordered=[...SAMPLED_ROADS].sort((a,b)=>{
      const priority={rural:0,local:1,secondary:2,arterial:3,highway:4};
      return priority[a.road.type]-priority[b.road.type];
    });
    ctx.lineCap='round';ctx.lineJoin='round';
    for(const road of ordered) {
      const t=road.road.type;
      const roadWidth=detail?({highway:3.7,arterial:2.8,secondary:1.9,local:1.25,rural:1.1}[t]):({highway:2.3,arterial:1.5,secondary:1,local:.75,rural:.7}[t]);
      tracePoints(ctx,road.samples,r);
      ctx.lineWidth=roadWidth+(.8*(detail?1:.5));
      ctx.strokeStyle=road.road.bridge?'rgba(12,43,53,.95)':'rgba(32,59,56,.68)';ctx.stroke();
      ctx.lineWidth=roadWidth;
      ctx.strokeStyle=road.road.bridge?'#e6f3e9':t==='highway'?'#e9d7a4':t==='rural'?'#cfc4a0':'#f0e8ce';
      ctx.stroke();
    }
  }

  private drawDistricts(ctx:CanvasRenderingContext2D,r:MapRect,detail:boolean) {
    const compact=r.width<500;
    const occupied:{x:number;y:number;w:number;h:number}[]=[];
    for(const district of DISTRICTS) {
      const selected=district.id===this.selected;
      tracePoints(ctx,district.polygon,r,true);
      ctx.fillStyle=colorToCss(district.color,selected ? .25 : .11);ctx.fill();
      ctx.strokeStyle=colorToCss(district.color,selected?1:.75);
      ctx.lineWidth=selected?(detail?2.2:1.4):(detail?1.25:.8);
      ctx.setLineDash(detail?[5,4]:[3,2]);ctx.stroke();ctx.setLineDash([]);
      if(!detail)continue;
      const [px,py]=toScreen(district.focus,r);
      ctx.font=`600 ${compact?8:10}px "DM Mono", monospace`;
      const label=district.name.toUpperCase(),w=ctx.measureText(label).width+(compact?10:15),h=compact?16:20;
      // At phone widths the central footprints sit close together. Keep their
      // markers on the correct land but nudge labels rather than stack text.
      const offsets:readonly [number,number][]=[[0,0],[0,-19],[0,19],[-24,-17],[24,17],[-42,0],[42,0],[0,-36],[0,36]];
      const choice=offsets.find(([dx,dy])=>{
        const box={x:px+dx-w/2,y:py+dy-h/2,w,h};
        return box.x>=r.x+4&&box.x+w<=r.x+r.width-4&&box.y>=r.y+4&&box.y+h<=r.y+r.height-4&&
          occupied.every(other=>box.x+box.w+3<other.x||other.x+other.w+3<box.x||box.y+box.h+3<other.y||other.y+other.h+3<box.y);
      })??offsets[0];
      const x=px+choice[0],y=py+choice[1];
      occupied.push({x:x-w/2,y:y-h/2,w,h});
      if(choice!==offsets[0]){
        ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);
        ctx.lineWidth=.8;ctx.strokeStyle='rgba(237,231,203,.68)';ctx.stroke();
        ctx.beginPath();ctx.arc(px,py,2,0,Math.PI*2);ctx.fillStyle='#f5e9c9';ctx.fill();
      }
      ctx.fillStyle=selected?'#e9bd82':'rgba(13,38,44,.88)';
      ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,compact?3:4);ctx.fill();
      ctx.fillStyle=selected?'#1a3338':'#f6f0df';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(label,x,y+.5);
    }
  }

  private drawFocus(ctx:CanvasRenderingContext2D,r:MapRect,detail:boolean){
    const [x,y]=toScreen(this.focus,r),rad=Math.max(12,this.zoom/width*r.width*.62);
    ctx.beginPath();ctx.arc(x,y,Math.min(rad,r.width*.35),0,Math.PI*2);
    ctx.strokeStyle=detail?'rgba(244,222,175,.52)':'rgba(250,233,196,.7)';
    ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(x,y,detail?4:3,0,Math.PI*2);
    ctx.fillStyle='#fff4d5';ctx.fill();
    ctx.strokeStyle='#233c3d';ctx.lineWidth=1.3;ctx.stroke();
  }
  drawMini(){
    if(!this.mini.clientWidth||!this.mini.clientHeight)return;
    const ctx=resizeCanvas(this.mini);this.miniRect=mapRect(this.mini,3);
    this.base(ctx,this.miniRect,false);
  }
  drawFull(){
    if(!this.full.clientWidth||!this.full.clientHeight)return;
    const ctx=resizeCanvas(this.full);this.fullRect=mapRect(this.full,24);
    this.base(ctx,this.fullRect,true);
  }
}
