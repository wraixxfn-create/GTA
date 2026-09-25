import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DISTRICTS, WORLD, isBuiltDistrictId, type Point } from '../world/data';
import { clamp, sectorKey, sectorsNear, terrainHeight } from '../world/geometry';
import { DISTRICT_INVENTORY } from '../world/inventory';
import { buildSector, createDistantTerrain, type ActiveSector } from './sector';
import { CityLayer, type ChunkStats } from './CityLayer';
import { IndustrialLayer } from './IndustrialLayer';
import { WealthyLayer } from './WealthyLayer';
import { ResidentialLayer } from './ResidentialLayer';
import { FreeFlyControls } from './FreeFlyControls';
import {
  FOG_DENSITY, SKY_COLOR, WORLD_EXTENT, createLights, makeBoundary, makeCoastFoam,
  makeLake, makeRegionRoads, makeRiver, makeWaterMesh,
} from './worldContent';

export type CameraMode = 'orbit' | 'fly' | 'map';

export type DistrictSceneStats = Readonly<{
  id: string; name: string; built: boolean; chunks: number; detailed: number;
  triangles: number; drawCalls: number;
}>;

export type SceneStats = {
  loaded: number; wanted: number; coordinate: Point; altitude: number; distance: number;
  mode: CameraMode; fps: number; triangles: number; drawCalls: number;
  districts: DistrictSceneStats[];
  downtown?: ChunkStats; industrial?: ChunkStats; wealthy?: ChunkStats; residential?: ChunkStats;
};
type Flight = { start: number; duration: number; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromCamera: THREE.Vector3; toCamera: THREE.Vector3 };

/** Half-height of the world, in metres, framed by the map camera at zoom 1. */
const MAP_HALF = 7600;
const MAP_ALTITUDE = 20000;
/** Almost straight down: OrbitControls clamps the polar angle, so a hair of tilt keeps it stable. */
const MAP_TILT = 0.045;
const MIN_ZOOM = 0.45, MAX_ZOOM = 26;

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly mapCamera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly fly: FreeFlyControls;
  readonly element: HTMLElement;
  readonly labelLayer: HTMLElement;
  readonly regionRoads: THREE.Mesh;
  onStats?: (stats: SceneStats) => void;
  onDistrictClick?: (id: string) => void;
  onMove?: (point: Point) => void;
  onMode?: (mode: CameraMode) => void;
  readonly city = new CityLayer();
  readonly industrial = new IndustrialLayer();
  readonly wealthy = new WealthyLayer();
  readonly residential = new ResidentialLayer();
  private readonly active = new Map<string, ActiveSector>();
  private readonly boundaryGroup = new THREE.Group();
  private readonly boundaryLines = new Map<string, THREE.Line>();
  private readonly labels = new Map<string, HTMLElement>();
  private readonly keys = new Set<string>();
  private readonly temp = new THREE.Vector3();
  private readonly focusTemp = new THREE.Vector3();
  private lastTime = performance.now();
  private lastSectorCheck = 0;
  private lastStats = 0;
  private lastPosition = '';
  private flight: Flight | null = null;
  private frames = 0;
  private fpsWindow = performance.now();
  private fps = 0;
  private sectorTriangles = 0;
  private selected = 'downtown';
  private boundariesVisible = true;
  private paused = false;
  private mode: CameraMode = 'orbit';
  private readonly userBoundaries: { value: boolean } = { value: true };

  /**
   * `injected.renderer` exists so the scene can be assembled and stepped without a WebGL
   * context — the headless audit (`npm run verify:scene`) uses it to prove the generated
   * world really reaches the renderer. The browser always takes the real WebGLRenderer.
   */
  constructor(element: HTMLElement, labelLayer: HTMLElement, injected?: { renderer?: THREE.WebGLRenderer }) {
    this.element = element; this.labelLayer = labelLayer;
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(SKY_COLOR, FOG_DENSITY);
    this.camera = new THREE.PerspectiveCamera(52, 1, 1.5, 46000);
    // Approach over the southern water so the opening view actually reads as a coastal
    // region, with the bayfront and inland relief beyond it.
    this.camera.position.set(2150, 1120, 7030);
    this.mapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 20, 90000);
    this.mapCamera.position.set(WORLD_EXTENT.centre.x, MAP_ALTITUDE, WORLD_EXTENT.centre.z + MAP_ALTITUDE * Math.tan(MAP_TILT));
    this.mapCamera.zoom = 1;
    this.renderer = injected?.renderer ?? new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.setSize(element.clientWidth, element.clientHeight);
    element.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 38, 1850);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .075;
    this.controls.screenSpacePanning = true;
    // Close enough to stand inside the enterable buildings of the flats.
    this.controls.minDistance = 42;
    this.controls.maxDistance = 13500;
    this.controls.minPolarAngle = .13;
    this.controls.maxPolarAngle = Math.PI / 2 - .045;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.update();
    this.fly = new FreeFlyControls(this.camera, this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', () => { this.flight = null; });
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());

    for (const light of createLights()) this.scene.add(light);
    this.scene.add(makeWaterMesh());
    this.scene.add(createDistantTerrain());
    this.scene.add(makeRiver(), makeLake(), makeCoastFoam());
    this.regionRoads = makeRegionRoads();
    this.scene.add(this.regionRoads);
    this.scene.add(this.city.group);
    this.scene.add(this.industrial.group);
    this.scene.add(this.wealthy.group);
    this.scene.add(this.residential.group);
    for (const district of DISTRICTS) {
      const line = makeBoundary(district); this.boundaryGroup.add(line); this.boundaryLines.set(district.id, line);
      const label = document.createElement('button');
      label.className = 'world-label'; label.type = 'button'; label.dataset.district = district.id;
      label.innerHTML = `<span class="world-label__dot"></span><span>${district.name}</span>`;
      label.addEventListener('click', () => this.onDistrictClick?.(district.id));
      labelLayer.appendChild(label); this.labels.set(district.id, label);
    }
    this.scene.add(this.boundaryGroup);
    this.setSelectedDistrict(this.selected);
    this.layoutMapCamera();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    this.render = this.render.bind(this);
    requestAnimationFrame(this.render);
  }

  /* ── camera modes ─────────────────────────────────────────────────────────────── */

  private get activeCamera(): THREE.Camera { return this.mode === 'map' ? this.mapCamera : this.camera; }

  getMode(): CameraMode { return this.mode; }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.flight = null;
    if (mode !== 'fly') this.setFlyMode(false);
    if (mode !== 'map') this.setMapMode(false);
    if (mode === 'fly') this.setFlyMode(true);
    if (mode === 'map') this.setMapMode(true);
    this.onMode?.(this.mode);
  }

  toggleFly(): void { this.setMode(this.mode === 'fly' ? 'orbit' : 'fly'); }
  toggleMap(): void { this.setMode(this.mode === 'map' ? 'orbit' : 'map'); }

  private setFlyMode(on: boolean): void {
    if (on === (this.mode === 'fly')) {
      if (on) return;
      this.fly.enabled = false;
      return;
    }
    if (on) {
      // Start the flight where the orbit camera was already looking.
      const focus = this.getFocusPoint();
      const direction = this.controls.target.clone().sub(this.camera.position);
      if (direction.lengthSq() < 1) direction.set(0, -.4, -1);
      this.camera.position.set(focus.x, Math.max(28, terrainHeight(focus.x, focus.z) + 46), focus.z);
      this.camera.lookAt(this.camera.position.clone().add(direction.normalize()));
      this.fly.syncFromCamera();
      this.fly.enabled = true;
      this.controls.enabled = false;
      this.mode = 'fly';
    } else {
      this.fly.enabled = false;
      this.fly.reset();
      this.controls.enabled = true;
      // Hand the orbit camera a sensible pivot in front of wherever the flight ended.
      const point = this.fly.focus(900);
      this.controls.target.set(point.x, Math.max(0, terrainHeight(point.x, point.z)) + 24, point.z);
      this.mode = 'orbit';
    }
  }

  private setMapMode(on: boolean): void {
    if (on === (this.mode === 'map')) return;
    if (on) {
      const focus = this.getFocusPoint();
      this.mode = 'map';
      this.controls.object = this.mapCamera;
      this.controls.target.set(focus.x, Math.max(0, terrainHeight(focus.x, focus.z)), focus.z);
      this.placeMapCamera();
      this.mapCamera.zoom = clamp(2 * MAP_HALF / 3200, MIN_ZOOM, MAX_ZOOM);
      this.mapCamera.updateProjectionMatrix();
      // A flat survey view: no orbiting, no distance fog, boundaries always readable.
      this.scene.fog = null;
      this.controls.enableRotate = false;
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = MAP_TILT * 2;
      this.boundaryGroup.visible = true;
      this.labelLayer.classList.remove('is-hidden');
    } else {
      const focus = { x: this.controls.target.x, z: this.controls.target.z };
      this.mode = 'orbit';
      this.controls.object = this.camera;
      this.scene.fog = new THREE.FogExp2(SKY_COLOR, FOG_DENSITY);
      this.controls.enableRotate = true;
      this.controls.minPolarAngle = .13;
      this.controls.maxPolarAngle = Math.PI / 2 - .045;
      const height = Math.max(26, terrainHeight(focus.x, focus.z)) + 900;
      this.camera.position.set(focus.x, height, focus.z + 2400);
      this.controls.target.set(focus.x, Math.max(0, terrainHeight(focus.x, focus.z)) + 30, focus.z);
      this.boundaryGroup.visible = this.boundariesVisible;
      this.labelLayer.classList.toggle('is-hidden', !this.boundariesVisible);
      this.camera.lookAt(this.controls.target);
    }
    this.controls.update();
  }

  private placeMapCamera(): void {
    const target = this.controls.target;
    this.mapCamera.position.set(
      target.x,
      target.y + MAP_ALTITUDE * Math.cos(MAP_TILT),
      target.z + MAP_ALTITUDE * Math.sin(MAP_TILT),
    );
  }

  private layoutMapCamera(): void {
    const aspect = this.element.clientHeight ? this.element.clientWidth / this.element.clientHeight : 16 / 9;
    const halfHeight = Math.max(MAP_HALF, (WORLD_EXTENT.width / 2 + 1400) / Math.max(.2, aspect));
    this.mapCamera.left = -halfHeight * aspect;
    this.mapCamera.right = halfHeight * aspect;
    this.mapCamera.top = halfHeight;
    this.mapCamera.bottom = -halfHeight;
    this.mapCamera.updateProjectionMatrix();
  }

  /* ── input ────────────────────────────────────────────────────────────────────── */

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.altKey || event.ctrlKey) return;
    if (this.mode === 'fly') return;   // the free-fly controller owns the keyboard there
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e', 'shift'].includes(key)) {
      this.keys.add(key);
      if (key.startsWith('arrow')) event.preventDefault();
      this.flight = null;
    }
  };
  private onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());

  resize() {
    const w = this.element.clientWidth, h = this.element.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.layoutMapCamera();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    this.renderer.setSize(w, h);
  }

  setSelectedDistrict(id: string) {
    this.selected = id;
    for (const district of DISTRICTS) {
      const line = this.boundaryLines.get(district.id)!;
      const mat = line.material as THREE.LineDashedMaterial;
      mat.opacity = id === district.id ? .98 : .51;
      mat.color.set(id === district.id ? 0xffda96 : district.color);
      this.labels.get(district.id)?.classList.toggle('is-selected', id === district.id);
    }
  }
  setBoundaries(visible: boolean) {
    this.boundariesVisible = visible;
    this.userBoundaries.value = visible;
    this.boundaryGroup.visible = visible || this.mode === 'map';
    this.labelLayer.classList.toggle('is-hidden', !this.boundaryGroup.visible);
  }
  getBoundaries() { return this.userBoundaries.value; }
  setNavigation(visible: boolean) { this.city.setNavigation(visible); this.industrial.setNavigation(visible); this.wealthy.setNavigation(visible); this.residential.setNavigation(visible); }
  getNavigation() { return this.city.getNavigation() || this.industrial.getNavigation() || this.wealthy.getNavigation() || this.residential.getNavigation(); }
  setPaused(paused: boolean) { this.paused = paused; }

  focus(point: Point, zoom = 3200) {
    if (this.mode === 'fly') this.setMode('orbit');
    if (this.mode === 'map') {
      this.controls.target.set(
        clamp(point.x, WORLD.minX + 250, WORLD.maxX - 250),
        Math.max(0, terrainHeight(point.x, point.z)),
        clamp(point.z, WORLD.minZ + 250, WORLD.maxZ - 250),
      );
      this.placeMapCamera();
      this.mapCamera.zoom = clamp(2 * MAP_HALF / zoom, MIN_ZOOM, MAX_ZOOM);
      this.mapCamera.updateProjectionMatrix();
      return;
    }
    const fromTarget = this.controls.target.clone(), fromCamera = this.camera.position.clone();
    const toTarget = new THREE.Vector3(clamp(point.x, WORLD.minX + 250, WORLD.maxX - 250), Math.max(12, terrainHeight(point.x, point.z) + 32), clamp(point.z, WORLD.minZ + 250, WORLD.maxZ - 250));
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(zoom);
    const toCamera = toTarget.clone().add(offset);
    // Stay above a rising ridge when focusing a mountain floor from sea level.
    toCamera.y = Math.max(toCamera.y, toTarget.y + 550);
    this.flight = { start: performance.now(), duration: 1050, fromTarget, toTarget, fromCamera, toCamera };
  }
  resetView() { this.focus({ x: 160, z: 920 }, 2450); }
  getFocus(): Point { return { x: this.controls.target.x, z: this.controls.target.z }; }
  getZoom(): number {
    if (this.mode === 'map') return 2 * MAP_HALF / this.mapCamera.zoom;
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Where the world should stream around: the orbit pivot, or the point flown at. */
  private getFocusPoint(): Point {
    if (this.mode === 'fly') return this.fly.focus();
    return { x: this.controls.target.x, z: this.controls.target.z };
  }

  private keyboardMotion(dt: number) {
    const horiz = Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft'));
    const vert = Number(this.keys.has('w') || this.keys.has('arrowup')) - Number(this.keys.has('s') || this.keys.has('arrowdown'));
    const rotate = Number(this.keys.has('e')) - Number(this.keys.has('q'));
    if (rotate) {
      const angle = rotate * dt * .8, offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    if (horiz || vert) {
      const forward = this.controls.target.clone().sub(this.camera.position); forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const speed = clamp(this.getZoom() * .47, 260, 2350) * (this.keys.has('shift') ? 2 : 1) * dt;
      const delta = forward.multiplyScalar(vert * speed).add(right.multiplyScalar(horiz * speed));
      this.camera.position.add(delta); this.controls.target.add(delta);
    }
  }

  private sectorRadius(): number {
    if (this.mode === 'map') return 2900;
    if (this.mode === 'fly') return clamp(this.camera.position.y * 2.4 + 950, 1900, 4800);
    return clamp(this.getZoom() * .64 + 750, 2500, 5700);
  }

  private updateSectors(now: number) {
    if (now - this.lastSectorCheck < 130) return;
    this.lastSectorCheck = now;
    const focus = this.getFocusPoint();
    const radius = this.sectorRadius();
    const wanted = sectorsNear(focus.x, focus.z, radius).slice(0, 125);
    const keys = new Set(wanted.map(s => sectorKey(s.x, s.z)));
    for (const [key, sector] of this.active) if (!keys.has(key)) {
      this.scene.remove(sector.group); sector.dispose(); this.sectorTriangles -= sector.triangles; this.active.delete(key);
    }
    // Limit synchronous construction on each frame; arriving tiles stream in nearest first.
    let created = 0;
    const frameStart = performance.now();
    for (const tile of wanted) {
      const key = sectorKey(tile.x, tile.z);
      if (this.active.has(key)) continue;
      const sector = buildSector(tile.x, tile.z);
      this.active.set(key, sector); this.scene.add(sector.group);
      this.sectorTriangles += sector.triangles;
      created++;
      if (created >= 3 || performance.now() - frameStart > 11) break;
    }
    this.lastWanted = wanted.length;
  }
  private lastWanted = 0;

  /** The built districts stream on their own 500 m tiles, in a separate budget from
   * the terrain; the flats and the bluff also animate their fleets every frame. */
  private updateCity(now: number, dt: number) {
    const focus = this.getFocusPoint();
    this.focusTemp.set(focus.x, 0, focus.z);
    this.city.update(this.focusTemp, now, 7);
    this.industrial.update(this.focusTemp, now, 7);
    this.industrial.updateTraffic(dt);
    this.wealthy.update(this.focusTemp, now, 7);
    this.wealthy.updateTraffic(dt);
    this.residential.update(this.focusTemp, now, 7);
    this.residential.updateTraffic(dt);
  }

  private districtStats(): DistrictSceneStats[] {
    const rows: [string, ChunkStats][] = [
      ['downtown', this.city.stats], ['industrial', this.industrial.stats],
      ['wealthy', this.wealthy.stats], ['residential', this.residential.stats],
    ];
    return DISTRICT_INVENTORY.map(inventory => {
      const row = rows.find(([id]) => id === inventory.id);
      const stats = row?.[1];
      return {
        id: inventory.id, name: inventory.name, built: inventory.built,
        chunks: stats?.chunks ?? 0, detailed: stats?.detailed ?? 0,
        triangles: stats?.triangles ?? 0, drawCalls: stats?.drawCalls ?? 0,
      };
    }).filter(row => row.built);
  }

  private emitStats(now: number, distance: number) {
    const focus = this.getFocusPoint();
    const districts = this.districtStats();
    this.onStats?.({
      loaded: this.active.size, wanted: this.lastWanted,
      coordinate: focus, altitude: Math.max(0, terrainHeight(focus.x, focus.z)), distance,
      mode: this.mode, fps: this.fps,
      triangles: this.sectorTriangles + districts.reduce((total, row) => total + row.triangles, 0),
      drawCalls: districts.reduce((total, row) => total + row.drawCalls, 0) + this.active.size * 6 + 5,
      districts,
      downtown: this.city.stats, industrial: this.industrial.stats,
      wealthy: this.wealthy.stats, residential: this.residential.stats,
    });
    this.lastStats = now;
  }

  private updateLabels() {
    if (!this.boundaryGroup.visible) return;
    const width = this.element.clientWidth, height = this.element.clientHeight;
    const camDistance = this.getZoom();
    const camera = this.activeCamera;
    for (const district of DISTRICTS) {
      const label = this.labels.get(district.id)!;
      const h = Math.max(terrainHeight(district.focus.x, district.focus.z), 2) + 48;
      this.temp.set(district.focus.x, h, district.focus.z).project(camera);
      const x = (this.temp.x * .5 + .5) * width, y = (-this.temp.y * .5 + .5) * height;
      const hidden = this.temp.z > 1 || this.temp.z < 0 || x < 38 || x > width - 38 || y < 48 || y > height - 52;
      label.style.display = hidden ? 'none' : 'flex';
      if (!hidden) {
        label.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
        const focus = this.getFocusPoint();
        const dis = Math.hypot(district.focus.x - focus.x, district.focus.z - focus.z);
        label.style.opacity = String(clamp(1 - dis / (camDistance * 1.75), .3, 1));
      }
    }
  }

  private render(now: number) {
    requestAnimationFrame(this.render);
    if (this.paused) { this.lastTime = now; return; }
    const dt = Math.min((now - this.lastTime) / 1000, .05); this.lastTime = now;
    this.frames++;
    if (now - this.fpsWindow > 500) {
      this.fps = Math.round(this.frames * 1000 / (now - this.fpsWindow));
      this.frames = 0; this.fpsWindow = now;
    }
    if (this.mode === 'fly') {
      this.fly.update(dt);
    } else {
      if (this.flight) {
        const f = this.flight, t = clamp((now - f.start) / f.duration, 0, 1), ease = 1 - Math.pow(1 - t, 3);
        this.controls.target.copy(f.fromTarget).lerp(f.toTarget, ease);
        this.camera.position.copy(f.fromCamera).lerp(f.toCamera, ease);
        if (t === 1) this.flight = null;
      }
      this.keyboardMotion(dt);
      this.controls.update();
    }
    if (this.mode !== 'fly') {
      const focus = this.controls.target;
      const x = clamp(focus.x, WORLD.minX + 100, WORLD.maxX - 100);
      const z = clamp(focus.z, WORLD.minZ + 100, WORLD.maxZ - 100);
      if (x !== focus.x || z !== focus.z) {
        this.camera.position.x += x - focus.x; this.camera.position.z += z - focus.z;
        if (this.mode === 'map') this.placeMapCamera();
        focus.x = x; focus.z = z;
      }
    }
    // Far enough out that the streamed road ribbons stop being built: show the whole
    // authored network instead, so the region still reads as a road map.
    const far = this.mode === 'map' ? this.mapCamera.zoom < 1.5 : this.getZoom() > 5200;
    if (this.regionRoads.visible !== far) this.regionRoads.visible = far;

    this.updateSectors(now);
    this.updateCity(now, dt);
    this.updateLabels();
    this.renderer.render(this.scene, this.activeCamera);
    if (now - this.lastStats > 380) {
      const focus = this.getFocusPoint();
      const coordinate = `${Math.round(focus.x / 15)},${Math.round(focus.z / 15)}`;
      if (this.lastPosition !== coordinate) { this.lastPosition = coordinate; this.onMove?.(focus); }
      this.emitStats(now, this.getZoom());
    }
  }
}

export const isBuiltDistrict = isBuiltDistrictId;
