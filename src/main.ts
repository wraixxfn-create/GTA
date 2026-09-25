import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import '@fontsource/outfit/latin-600.css';
import '@fontsource/outfit/latin-700.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';
import { DISTRICTS, type District } from './world/data';
import { polygonArea, terrainHeight } from './world/geometry';
import { WorldScene } from './scene/WorldScene';
import { Atlas } from './ui/atlas';
import './style.css';

const icon = {
  atlas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></svg>',
  arrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
  layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>',
  route:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v5a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V9"/><path d="m15 10 3-3 3 3"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5 19 19M19 5 5 19"/></svg>',
  expand:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>',
};

const $=(selector:string)=>document.querySelector(selector) as HTMLElement;
const formatKm=(n:number)=>`${n<0?'−':'+'}${Math.abs(n/1000).toFixed(1)}`;

$('#app').innerHTML=`
  <main class="app-shell">
    <div id="world-view" class="world-view" aria-label="Interactive three-dimensional terrain of Morrow Reach"></div>
    <div id="label-layer" class="label-layer"></div>
    <div class="world-vignette" aria-hidden="true"></div>

    <header class="topbar">
      <div class="brand">
        <div class="brand-icon" aria-hidden="true"><span class="brand-icon__north"></span><span class="brand-icon__land"></span><span class="brand-icon__shore"></span></div>
        <div class="brand-wordmark"><strong>MORROW<span> REACH</span></strong><small>REGIONAL SURVEY OFFICE</small></div>
      </div>
      <div class="topbar-center"><span class="topbar-index">02 / DOWNTOWN DISTRICT</span><span class="topbar-divider"></span><span>LOWMERE · MERIDIAN CORE</span></div>
      <div class="topbar-actions"><div class="live-indicator"><span class="live-dot"></span> CITY + TERRAIN</div><button class="topbar-atlas" id="open-atlas">${icon.atlas}<span>OPEN ATLAS</span><kbd>M</kbd></button></div>
    </header>

    <aside class="sidebar" aria-label="Regional map information and reserved districts">
      <div class="sidebar-intro">
        <div class="eyebrow"><span class="eyebrow-rule"></span> FIELD NOTES <span class="eyebrow-no">/ VOL. 02</span></div>
        <h1>A coast with<br><em>room to grow.</em></h1>
        <p>A dense original city at the bay's edge: a glass skyline, civic square, market streets, and a station stitched into the regional network.</p>
      </div>
      <div class="world-facts">
        <div><strong>18 <i>×</i> 14</strong><span>KM WORLD EXTENT</span></div>
        <div><strong>252</strong><span>STREAMING SECTORS</span></div>
        <div><strong>05</strong><span>MAJOR BRIDGES</span></div>
      </div>
      <div class="sidebar-section-heading"><span>DISTRICT STATUS</span><span class="heading-count">02 BUILT / 10 RESERVED</span></div>
      <div id="district-list" class="district-list" role="list" aria-label="Built and reserved districts"></div>
      <div class="sidebar-note"><span class="note-symbol">◌</span><span>Downtown and the Industrial Flats are built and streaming.<br>The other 10 districts remain reserved.</span></div>
    </aside>

    <div class="right-panel">
      <section class="mini-card" aria-label="Interactive regional minimap">
        <div class="mini-header"><span><span class="mini-tick"></span> REGIONAL OVERVIEW</span><button id="mini-expand" aria-label="Open full atlas" title="Open full atlas">${icon.expand}</button></div>
        <canvas id="mini-map" aria-label="Click to move around the world"></canvas>
        <div class="mini-footer"><span>MAINLAND + SOUND ISLAND</span><span>18 KM &rarr;</span></div>
      </section>
      <div class="map-key"><span><i class="key-forest"></i> WOODLAND</span><span><i class="key-road"></i> ROUTES</span><span><i class="key-zone"></i> DISTRICT LIMITS</span></div>
      <section id="selected-card" class="selected-card" aria-live="polite"></section>
    </div>

    <div class="scene-tools"><button id="toggle-boundaries" class="tool-button is-on" aria-pressed="true" title="Toggle district boundaries (B)">${icon.layers}<span>BOUNDARIES</span><small>ON</small></button><button id="toggle-navigation" class="tool-button" aria-pressed="false" title="Toggle traffic and pedestrian network (N)">${icon.route}<span>NAVIGATION</span><small>OFF</small></button><button id="reset-camera" class="tool-button" title="Return to downtown">${icon.target}<span>RESET VIEW</span></button></div>
    <footer class="statusbar"><div class="status-readout"><span class="status-pulse"></span><span id="sector-status">PREPARING SECTORS</span></div><div class="status-separator"></div><div id="coordinate-status">X +0.0 / Z +0.8 KM</div><div id="city-status">DOWNTOWN · 00 TILES</div><div class="status-controls">DRAG TO PAN <span>·</span> SCROLL TO ZOOM <span>·</span> RIGHT-DRAG TO ORBIT <span>·</span> WASD TO MOVE <span>·</span> N TOGGLE NAV</div></footer>

    <div id="atlas-overlay" class="atlas-overlay" role="dialog" aria-modal="true" aria-labelledby="atlas-heading" aria-hidden="true">
      <header class="atlas-topbar"><div><div class="atlas-kicker">MORROW REACH <span>/</span> DISTRICT SURVEY 02</div><h2 id="atlas-heading">The regional atlas<span>.</span></h2></div><button id="close-atlas" class="atlas-close" aria-label="Close atlas">${icon.close}<span>CLOSE MAP</span><kbd>ESC</kbd></button></header>
      <div class="atlas-body"><div class="atlas-map-frame"><div class="atlas-map-corner atlas-map-corner--tl"></div><div class="atlas-map-corner atlas-map-corner--tr"></div><div class="atlas-map-corner atlas-map-corner--bl"></div><div class="atlas-map-corner atlas-map-corner--br"></div><canvas id="atlas-map" aria-label="Click any reserved footprint to inspect and focus that location"></canvas><div class="atlas-compass">N <span>↑</span></div><div class="atlas-map-caption"><span>COASTLINE · RELIEF · TRANSPORT</span><span>18 KM E–W / 14 KM N–S</span></div></div>
      <aside class="atlas-inspector"><div class="inspector-index">SURVEY INDEX / 001—012</div><h3>Land first.<br><em>Everything follows.</em></h3><p>Downtown is built and streaming. The other eleven district footprints remain reserved for future work.</p><div class="atlas-hover" id="atlas-hover">HOVER A FOOTPRINT TO INSPECT</div><div class="inspector-divider"></div><div class="inspector-selected" id="inspector-selected"></div><button class="inspect-action" id="atlas-explore">EXPLORE THIS AREA ${icon.arrow}</button><div class="inspector-legend"><div><i class="legend-box legend-highway"></i> HIGHWAY / PARKWAY</div><div><i class="legend-box legend-secondary"></i> LOCAL / RURAL ROUTE</div><div><i class="legend-box legend-river"></i> FRESH + TIDAL WATER</div><div><i class="legend-box legend-reserve"></i> FUTURE DISTRICT LIMIT</div></div></aside></div>
    </div>
  </main>
`;

const list=$('#district-list');
const groupLabel=(district:District)=>district.kind==='landscape'?'LANDSCAPE':district.kind==='infrastructure'?'INFRASTRUCTURE':'URBAN FOOTPRINT';
DISTRICTS.forEach((district,i)=>{
  const button=document.createElement('button');button.type='button';
  button.className='district-row';button.dataset.district=district.id;
  const state=district.id==='downtown'||district.id==='industrial'?'BUILT':'RESERVED';
  button.setAttribute('aria-label',`${district.name} — ${state.toLowerCase()} district`);
  button.innerHTML=`<span class="district-no">${String(i+1).padStart(2,'0')}</span><span class="district-color" style="--district-color:${district.color}"></span><span class="district-name">${district.name}<small>${district.subtitle}</small></span><span class="district-state">${state}</span><span class="district-arrow">↗</span>`;
  button.addEventListener('click',()=>selectDistrict(district.id,true));
  list.append(button);
});

const scene=new WorldScene($('#world-view'),$('#label-layer'));
const atlas=new Atlas($('#mini-map') as HTMLCanvasElement,$('#atlas-map') as HTMLCanvasElement);
let selectedId='downtown';
let atlasOpen=false;
let boundariesOn=true;
let navigationOn=false;

function districtDetails(district:District,full=false){
  const area=(polygonArea(district.polygon)/1_000_000).toFixed(1);
  const elevation=Math.max(0,Math.round(terrainHeight(district.focus.x,district.focus.z)));
  const built=district.id==='downtown'||district.id==='industrial';
  const state=built?'BUILT':'RESERVED';
  if(full)return `<div class="inspector-district-type">${groupLabel(district)} <span>· ${state}</span></div><h4>${district.name}</h4><div class="inspector-subtitle">${district.subtitle}</div><dl><div><dt>${built?'CITY AREA':'LAND RESERVED'}</dt><dd>${area} km²</dd></div><div><dt>FOCUS ELEVATION</dt><dd>${elevation} m</dd></div><div><dt>ROAD ACCESS</dt><dd class="dd-access">${district.access}</dd></div></dl>`;
  return `<div class="selected-card-top"><span><i></i> ${built?'ACTIVE DISTRICT':'SELECTED LOCATION'}</span><span>${String(DISTRICTS.indexOf(district)+1).padStart(2,'0')} / 12</span></div><div class="selected-card-name"><div><small>${groupLabel(district)} · ${state}</small><h2>${district.name}</h2><p>${district.subtitle}</p></div><div class="card-height"><strong>${elevation}<small>M</small></strong><span>ELEV.</span></div></div><div class="selected-card-bottom"><div><span>${built?'CITY FOOTPRINT':'RESERVED AREA'}</span><strong>${area} KM²</strong></div><div><span>ROAD ACCESS</span><strong>${district.access}</strong></div></div><button class="card-focus" id="focus-selected">FOCUS LOCATION ${icon.arrow}</button>`;
}
function selectDistrict(id:string,moveCamera:boolean){
  const district=DISTRICTS.find(d=>d.id===id);
  if(!district)return;
  selectedId=id;
  document.querySelectorAll('.district-row').forEach(el=>el.classList.toggle('is-active',(el as HTMLElement).dataset.district===id));
  $('#selected-card').innerHTML=districtDetails(district);
  $('#inspector-selected').innerHTML=districtDetails(district,true);
  $('#focus-selected').addEventListener('click',()=>{scene.focus(district.focus,district.kind==='landscape'?3600:2750);if(atlasOpen)closeAtlas();});
  scene.setSelectedDistrict(id);atlas.setSelected(id);
  if(moveCamera){scene.focus(district.focus,district.kind==='landscape'?3650:2950);atlas.setFocus(district.focus,2950);}
}
scene.onDistrictClick=id=>selectDistrict(id,true);
scene.onStats=stats=>{
  $('#sector-status').textContent=`${String(stats.loaded).padStart(2,'0')} / ${String(stats.wanted).padStart(2,'0')} SECTORS ACTIVE`;
  $('#coordinate-status').textContent=`X ${formatKm(stats.coordinate.x)} / Z ${formatKm(stats.coordinate.z)} KM · ${Math.round(stats.altitude)} M ASL`;
  $('#city-status').textContent=`DOWNTOWN ${String(stats.downtown?.chunks??0).padStart(2,'0')} · FLATS ${String(stats.industrial?.chunks??0).padStart(2,'0')} TILES`;
  atlas.setFocus(stats.coordinate,stats.distance);
};
scene.onMove=point=>atlas.setFocus(point,scene.getZoom());
atlas.onSelect=id=>selectDistrict(id,false);
atlas.onPan=point=>{
  scene.focus(point,atlasOpen?3600:3000);
  atlas.setFocus(point,atlasOpen?3600:3000);
};
atlas.onHover=(district,point)=>{
  $('#atlas-hover').innerHTML=district
    ? `<span class="hover-point" style="background:${district.color}"></span>${district.name.toUpperCase()} <span class="hover-right">${groupLabel(district)}</span>`
    : `X ${formatKm(point.x)} / Z ${formatKm(point.z)} KM <span class="hover-right">UNRESERVED LAND</span>`;
};
selectDistrict(selectedId,true);

function openAtlas(){
  if(atlasOpen)return;
  atlasOpen=true;
  $('#atlas-overlay').classList.add('is-open');
  $('#atlas-overlay').setAttribute('aria-hidden','false');
  atlas.setFullVisible(true);
  scene.setPaused(true);
  ($('#close-atlas') as HTMLButtonElement).focus();
}
function closeAtlas(){
  if(!atlasOpen)return;
  atlasOpen=false;
  $('#atlas-overlay').classList.remove('is-open');
  $('#atlas-overlay').setAttribute('aria-hidden','true');
  atlas.setFullVisible(false);
  scene.setPaused(false);
  ($('#open-atlas') as HTMLButtonElement).focus();
}
$('#open-atlas').addEventListener('click',openAtlas);
$('#mini-expand').addEventListener('click',openAtlas);
$('#close-atlas').addEventListener('click',closeAtlas);
$('#atlas-explore').addEventListener('click',()=>{const district=DISTRICTS.find(d=>d.id===selectedId)!;scene.focus(district.focus,district.kind==='landscape'?3650:3000);closeAtlas();});
$('#toggle-boundaries').addEventListener('click',()=>{
  boundariesOn=!boundariesOn;scene.setBoundaries(boundariesOn);atlas.setBoundaries(boundariesOn);
  $('#toggle-boundaries').classList.toggle('is-on',boundariesOn);
  $('#toggle-boundaries').setAttribute('aria-pressed',String(boundariesOn));
  $('#toggle-boundaries small').textContent=boundariesOn?'ON':'OFF';
});
$('#toggle-navigation').addEventListener('click',()=>{
  navigationOn=!navigationOn;scene.setNavigation(navigationOn);
  $('#toggle-navigation').classList.toggle('is-on',navigationOn);
  $('#toggle-navigation').setAttribute('aria-pressed',String(navigationOn));
  $('#toggle-navigation small').textContent=navigationOn?'ON':'OFF';
});
$('#reset-camera').addEventListener('click',()=>scene.resetView());
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&atlasOpen){event.preventDefault();closeAtlas();}
  if(event.key.toLowerCase()==='m'&&!event.repeat){event.preventDefault();atlasOpen?closeAtlas():openAtlas();}
  if(event.key.toLowerCase()==='b'&&!event.repeat&&!atlasOpen){event.preventDefault();($('#toggle-boundaries') as HTMLButtonElement).click();}
  if(event.key.toLowerCase()==='n'&&!event.repeat&&!atlasOpen){event.preventDefault();($('#toggle-navigation') as HTMLButtonElement).click();}
});
