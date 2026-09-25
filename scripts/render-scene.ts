/**
 * Headless render audit for the map checkpoint.
 *
 * This is *not* a re-implementation of the viewer and it is *not* a screenshot: it builds
 * the real `WorldScene`, streams real sectors and real district tiles through the real
 * generators, then projects the resulting Three.js scene graph through the real camera
 * matrices with a small software rasteriser and writes a PNG.
 *
 * It exists because the generated world has to be provably on screen, and because a
 * browser cannot always be driven automatically. If world generation stops feeding
 * geometry to the renderer, this produces a blank image and the check fails.
 *
 * `npm run verify:scene`
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { BUILT_DISTRICT_IDS, DISTRICTS, WORLD } from '../src/world/data';
import { WORLD_INVENTORY } from '../src/world/inventory';
import type { SceneStats } from '../src/scene/WorldScene';

/* ── 1. the smallest possible DOM, just enough to construct the viewer ─────────── */

type Handler = (event: unknown) => void;

class FakeEventTarget {
  private readonly listeners = new Map<string, Set<Handler>>();
  style: Record<string, string> = {};
  classList = { add() { /* headless */ }, remove() { /* headless */ }, toggle() { /* headless */ }, contains: () => false };
  dataset: Record<string, string> = {};
  className = '';
  type = '';
  innerHTML = '';
  width = 1280;
  height = 800;
  clientWidth = 1280;
  clientHeight = 800;
  readonly children: FakeEventTarget[] = [];
  addEventListener(type: string, handler: Handler): void {
    const set = this.listeners.get(type) ?? new Set<Handler>();
    set.add(handler); this.listeners.set(type, set);
  }
  removeEventListener(type: string, handler: Handler): void { this.listeners.get(type)?.delete(handler); }
  appendChild(child: FakeEventTarget): void { this.children.push(child); }
  setPointerCapture(): void { /* headless: nothing to capture */ }
  releasePointerCapture(): void { /* headless: nothing to release */ }
  getContext(): unknown { return context2d(); }
  getRootNode(): unknown { return this; }
}

/** Every 2D call the procedural texture painters make, answered with a no-op. */
function context2d(): unknown {
  const gradient = { addColorStop() { /* headless */ } };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, key) {
      if (typeof key === 'string' && key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => gradient;
      if (key === 'measureText') return () => ({ width: 8 });
      if (key === 'getImageData' || key === 'createImageData') {
        return (w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
      }
      return () => undefined;
    },
    set(target, key, value) { target[key as string] = value; return true; },
  };
  return new Proxy({ canvas: null }, handler);
}

const canvas = new FakeEventTarget();
const labelLayer = new FakeEventTarget();
const worldView = new FakeEventTarget();

const documentStub = Object.assign(new FakeEventTarget(), {
  createElement: () => new FakeEventTarget(),
  querySelector: () => new FakeEventTarget(),
});
// OrbitControls asks the canvas for its root node before it attaches document key handlers.
canvas.getRootNode = (): unknown => documentStub;
const windowStub = Object.assign(new FakeEventTarget(), {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
});

const globals = globalThis as unknown as Record<string, unknown>;
globals.document = documentStub;
globals.window = windowStub;

let frameCallback: ((time: number) => void) | null = null;
globals.requestAnimationFrame = (callback: (time: number) => void) => { frameCallback = callback; return 1; };

/* ── 2. a renderer that accepts draw calls without a GPU ───────────────────────── */

let drawCalls = 0;
const rendererStub = Object.assign(new FakeEventTarget(), {
  setPixelRatio() { /* headless */ },
  setSize() { /* headless */ },
  render() { drawCalls++; },
  outputColorSpace: '',
  toneMapping: 0,
  toneMappingExposure: 1,
  domElement: canvas,
}) as unknown as THREE.WebGLRenderer;

/* ── 3. build and stream the real scene ────────────────────────────────────────── */

const { WorldScene } = await import('../src/scene/WorldScene.ts');

const world = new WorldScene(
  worldView as unknown as HTMLElement,
  labelLayer as unknown as HTMLElement,
  { renderer: rendererStub },
);

const statsBox: { current: SceneStats | null } = { current: null };
world.onStats = stats => { statsBox.current = stats; };

/** Step the real animation loop on a virtual clock until streaming settles. */
function stream(frames = 480, stepMs = 200): void {
  for (let i = 0; i < frames; i++) {
    const callback = frameCallback;
    if (!callback) throw new Error('the scene never asked for an animation frame');
    callback(i * stepMs);
  }
}
stream();
// Snapshot the streamed stats once, typed, so control-flow narrowing cannot collapse it to `never`.
const latest: SceneStats | null = statsBox.current;

/* ── 4. software rasteriser over the real scene graph ──────────────────────────── */

type Frame = { width: number; height: number; rgba: Uint8Array };

const SKY: [number, number, number] = [.737, .839, .827];
const SUN = new THREE.Vector3(-5300, 9200, -3900).normalize();
const toSrgb = (c: number): number => {
  const v = c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - .055;
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
};

function rasterise(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): Frame {
  const rgba = new Uint8Array(width * height * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  const skyR = toSrgb(SKY[0]), skyG = toSrgb(SKY[1]), skyB = toSrgb(SKY[2]);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = skyR; rgba[i + 1] = skyG; rgba[i + 2] = skyB; rgba[i + 3] = 255; }

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(vp);

  const worldMatrix = new THREE.Matrix4();
  const instanceMatrix4 = new THREE.Matrix4();
  const mvp = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const centre = new THREE.Vector3();
  const wx = new THREE.Vector3(), wy = new THREE.Vector3(), wz = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const s = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  const shadeRGB: [number, number, number][] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  let triangles = 0;

  const paint = (index: number, r: number, g: number, b: number): void => {
    const o = index * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };

  const fillTriangle = (): void => {
    const minX = Math.max(0, Math.floor(Math.min(s[0].x, s[1].x, s[2].x)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(s[0].x, s[1].x, s[2].x)));
    const minY = Math.max(0, Math.floor(Math.min(s[0].y, s[1].y, s[2].y)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(s[0].y, s[1].y, s[2].y)));
    if (minX > maxX || minY > maxY) return;
    const area = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[2].x - s[0].x) * (s[1].y - s[0].y);
    if (!(Math.abs(area) > 1e-7)) return;
    const negative = area < 0;
    const inv = 1 / Math.abs(area);
    for (let y = minY; y <= maxY; y++) {
      const py = y + .5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + .5;
        let w0 = (s[1].x - s[0].x) * (py - s[0].y) - (s[1].y - s[0].y) * (px - s[0].x);
        let w1 = (s[2].x - s[1].x) * (py - s[1].y) - (s[2].y - s[1].y) * (px - s[1].x);
        let w2 = area - w0 - w1;
        if (negative) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = (w0 * s[0].z + w1 * s[1].z + w2 * s[2].z) * inv;
        const index = y * width + x;
        if (z >= depth[index]) continue;
        depth[index] = z;
        paint(index,
          toSrgb((w0 * shadeRGB[0][0] + w1 * shadeRGB[1][0] + w2 * shadeRGB[2][0]) * inv),
          toSrgb((w0 * shadeRGB[0][1] + w1 * shadeRGB[1][1] + w2 * shadeRGB[2][1]) * inv),
          toSrgb((w0 * shadeRGB[0][2] + w1 * shadeRGB[1][2] + w2 * shadeRGB[2][2]) * inv));
      }
    }
  };

  const lines: { points: Float32Array; count: number; colour: THREE.Color }[] = [];

  scene.traverse(object => {
    if (!object.visible) return;
    const mesh = object as unknown as {
      visible: boolean; isLine?: boolean; isMesh?: boolean; isInstancedMesh?: boolean; count?: number;
      geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] | null;
      matrixWorld: THREE.Matrix4; instanceMatrix?: THREE.InstancedBufferAttribute | null;
      instanceColor?: THREE.InstancedBufferAttribute | null;
    };
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;

    if (mesh.isLine) {
      const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!position) return;
      const source = position.array as ArrayLike<number>;
      const points = new Float32Array(position.count * 4);
      const p = new THREE.Vector4();
      for (let i = 0; i < position.count; i++) {
        p.set(source[i * 3], source[i * 3 + 1], source[i * 3 + 2], 1).applyMatrix4(mesh.matrixWorld).applyMatrix4(vp);
        points[i * 4] = p.x; points[i * 4 + 1] = p.y; points[i * 4 + 2] = p.z; points[i * 4 + 3] = p.w;
      }
      lines.push({ points, count: position.count, colour: (mesh.material as THREE.LineDashedMaterial).color.clone() });
      return;
    }
    if (!mesh.isMesh) return;

    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) return;
    const material = mesh.material as THREE.Material | null;
    if (!material) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius ?? 0;
    const scale = Math.max(
      mesh.matrixWorld.elements[0], mesh.matrixWorld.elements[5], mesh.matrixWorld.elements[10], 1e-3,
    );
    const instanced = mesh.isInstancedMesh ? mesh.count ?? 1 : 1;

    const basic = (material as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    const lambert = material as THREE.MeshLambertMaterial;
    const vertexColours = !!lambert.vertexColors && !!geometry.getAttribute('color');
    const colourAttr = geometry.getAttribute('color') as THREE.BufferAttribute | null;
    const pos = position.array as ArrayLike<number>;
    const col = colourAttr ? colourAttr.array as ArrayLike<number> : null;
    const index = geometry.getIndex();
    const indexArray = index ? index.array as ArrayLike<number> : null;
    const triangleCount = index ? index.count / 3 : position.count / 3;
    const base = lambert.color ?? new THREE.Color(1, 1, 1);
    const instanceMatrices = mesh.isInstancedMesh && mesh.instanceMatrix
      ? mesh.instanceMatrix.array as ArrayLike<number> : null;
    const instanceColours = mesh.isInstancedMesh && mesh.instanceColor
      ? mesh.instanceColor.array as ArrayLike<number> : null;

    for (let inst = 0; inst < instanced; inst++) {
      if (instanceMatrices) instanceMatrix4.fromArray(instanceMatrices, inst * 16);
      else instanceMatrix4.identity();
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix4);
      // Frustum-cull the object exactly as the real renderer does, before touching vertices.
      centre.copy(geometry.boundingSphere?.center ?? new THREE.Vector3()).applyMatrix4(worldMatrix);
      if (!frustum.intersectsSphere(new THREE.Sphere(centre, radius * Math.max(scale, 1)))) continue;
      mvp.multiplyMatrices(vp, worldMatrix);
      normalMatrix.getNormalMatrix(worldMatrix);

      const tintR = instanceColours ? instanceColours[inst * 3] : 1;
      const tintG = instanceColours ? instanceColours[inst * 3 + 1] : 1;
      const tintB = instanceColours ? instanceColours[inst * 3 + 2] : 1;

      for (let t = 0; t < triangleCount; t++) {
        const i0 = indexArray ? indexArray[t * 3] : t * 3;
        const i1 = indexArray ? indexArray[t * 3 + 1] : t * 3 + 1;
        const i2 = indexArray ? indexArray[t * 3 + 2] : t * 3 + 2;
        triangles++;

        let visible = false, degenerate = false;
        const ids = [i0, i1, i2];
        for (let k = 0; k < 3; k++) {
          const i = ids[k];
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          const e = mvp.elements;
          const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
          const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
          const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
          if (cw <= 1e-4) { degenerate = true; break; }
          const sx = (cx / cw * .5 + .5) * width, sy = (1 - (cy / cw * .5 + .5)) * height;
          s[k].x = sx; s[k].y = sy; s[k].z = cz / cw * .5 + .5;
          if (sx >= -2 && sx <= width + 2 && sy >= -2 && sy <= height + 2) visible = true;
        }
        if (degenerate || !visible) continue;

        // Flat face normal, lit by the same sun the viewer uses.
        wx.set(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]).applyMatrix4(worldMatrix);
        wy.set(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]).applyMatrix4(worldMatrix);
        wz.set(pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]).applyMatrix4(worldMatrix);
        cross.crossVectors(wy.sub(wx), wz.sub(wx)).applyMatrix3(normalMatrix).normalize();
        const factor = basic ? 1 : .42 + .58 * Math.max(0, Math.abs(cross.dot(SUN)));

        for (let k = 0; k < 3; k++) {
          const i = ids[k];
          const r = (col ? col[i * 3] : base.r) * tintR * factor;
          const g = (col ? col[i * 3 + 1] : base.g) * tintG * factor;
          const b = (col ? col[i * 3 + 2] : base.b) * tintB * factor;
          shadeRGB[k][0] = r; shadeRGB[k][1] = g; shadeRGB[k][2] = b;
        }
        fillTriangle();
      }
    }
  });

  // Boundary lines last, matching the `depthTest:false` dashed lines in the viewer.
  for (const line of lines) {
    const { points, count, colour } = line;
    const r = toSrgb(colour.r), g = toSrgb(colour.g), b = toSrgb(colour.b);
    for (let i = 0; i < count - 1; i++) {
      const w0 = points[i * 4 + 3], w1 = points[(i + 1) * 4 + 3];
      if (w0 <= 1e-4 || w1 <= 1e-4) continue;
      const x0 = (points[i * 4] / w0 * .5 + .5) * width, y0 = (1 - (points[i * 4 + 1] / w0 * .5 + .5)) * height;
      const x1 = (points[(i + 1) * 4] / w1 * .5 + .5) * width, y1 = (1 - (points[(i + 1) * 4 + 1] / w1 * .5 + .5)) * height;
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      if (steps > 8000) continue;
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(x0 + (x1 - x0) * k / steps), y = Math.round(y0 + (y1 - y0) * k / steps);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        paint(y * width + x, r, g, b);
      }
    }
  }

  return { width, height, rgba, triangles } as Frame & { triangles: number };
}

/* ── 5. PNG encoder (no dependencies) ──────────────────────────────────────────── */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buffer: Buffer): number => {
    let c = -1;
    for (let i = 0; i < buffer.length; i++) c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([length, body, crc]);
}

function writePng(path: string, frame: Frame): void {
  const { width, height, rgba } = frame;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ── 6. measure, render and report ─────────────────────────────────────────────── */

function coverage(frame: Frame): { unique: number; nonSky: number } {
  const seen = new Set<number>();
  let nonSky = 0;
  const skyR = toSrgb(SKY[0]), skyG = toSrgb(SKY[1]), skyB = toSrgb(SKY[2]);
  for (let i = 0; i < frame.rgba.length; i += 4) {
    seen.add((frame.rgba[i] << 16) | (frame.rgba[i + 1] << 8) | frame.rgba[i + 2]);
    if (frame.rgba[i] !== skyR || frame.rgba[i + 1] !== skyG || frame.rgba[i + 2] !== skyB) nonSky++;
  }
  return { unique: seen.size, nonSky: nonSky / (frame.rgba.length / 4) };
}

function countScene(scene: THREE.Scene): { meshes: number; triangles: number; instances: number } {
  let meshes = 0, triangles = 0, instances = 0;
  scene.traverse(object => {
    if (!object.visible) return;
    const mesh = object as unknown as { isMesh?: boolean; isInstancedMesh?: boolean; count?: number; geometry?: THREE.BufferGeometry };
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position || !geometry) return;
    const index = geometry.getIndex();
    const perObject = index ? index.count / 3 : position.count / 3;
    const count = mesh.isInstancedMesh ? mesh.count ?? 1 : 1;
    meshes++; instances += count; triangles += perObject * count;
  });
  return { meshes, triangles: Math.round(triangles), instances };
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.verify');
mkdirSync(outDir, { recursive: true });
const checks: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

console.log('\nMORROW REACH — SCENE RENDER AUDIT');
console.log('─'.repeat(79));
console.log(`districts authored ${WORLD_INVENTORY.districts} · built ${WORLD_INVENTORY.builtDistricts} (${BUILT_DISTRICT_IDS.join(', ')})`);
console.log(`buildings ${WORLD_INVENTORY.buildings.toLocaleString('en-GB')} · landmarks ${WORLD_INVENTORY.landmarks} · roads ${WORLD_INVENTORY.totalRoads} (${WORLD_INVENTORY.totalRoadKm} km) · bridges ${WORLD_INVENTORY.bridges}`);
console.log(`district streets ${WORLD_INVENTORY.districtStreets} (${WORLD_INVENTORY.districtStreetKm} km) · regional segments ${WORLD_INVENTORY.regionalRoads} (${WORLD_INVENTORY.regionalRoadKm} km)`);
console.log(`world extent ${(WORLD.maxX - WORLD.minX) / 1000} km × ${(WORLD.maxZ - WORLD.minZ) / 1000} km · renderer frames submitted ${drawCalls}`);

if (latest) {
  console.log(`\nstreamed around downtown: ${latest.loaded}/${latest.wanted} sectors · ${Math.round(latest.triangles).toLocaleString('en-GB')} triangles · ${latest.drawCalls} draw calls`);
  for (const district of latest.districts) {
    console.log(`  ${district.name.padEnd(13)} ${String(district.chunks).padStart(3)} tiles (${String(district.detailed).padStart(2)} detailed) · ${district.triangles.toLocaleString('en-GB').padStart(10)} tri · ${String(district.drawCalls).padStart(4)} calls`);
  }
}

const started = Date.now();
const orbit = rasterise(world.scene, world.camera, 1280, 800);
writePng(resolve(outDir, 'render-orbit.png'), orbit);
const orbitShot = coverage(orbit);

world.toggleMap();
stream(160);
const map = rasterise(world.scene, world.mapCamera, 1280, 800);
writePng(resolve(outDir, 'render-map.png'), map);
const mapShot = coverage(map);
const sceneCounts = countScene(world.scene);

console.log(`\nsoftware-rasterised ${orbit.width}×${orbit.height} from the live scene graph in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
console.log(`  orbit view  ${(orbitShot.nonSky * 100).toFixed(1)}% of pixels covered by geometry · ${orbitShot.unique} distinct colours`);
console.log(`  map view    ${(mapShot.nonSky * 100).toFixed(1)}% of pixels covered by geometry · ${mapShot.unique} distinct colours`);
console.log(`  scene holds ${sceneCounts.meshes} meshes / ${sceneCounts.instances.toLocaleString('en-GB')} instances / ${sceneCounts.triangles.toLocaleString('en-GB')} triangles`);
console.log(`  images: .verify/render-orbit.png · .verify/render-map.png`);

const streamedDistricts = latest?.districts.filter(district => district.chunks > 0) ?? [];
const boundaryLines = DISTRICTS.filter(district =>
  world.scene.getObjectByName(`Built: ${district.name}`) || world.scene.getObjectByName(`Reserved: ${district.name}`),
).length;

record('the scene streams sectors of real terrain', (latest?.loaded ?? 0) > 8, `${latest?.loaded ?? 0} sectors built`);
record('the streaming budget stays bounded', (latest?.wanted ?? 0) <= 125, `${latest?.wanted ?? 0} sectors wanted`);
record('all four built districts stream geometry', streamedDistricts.length === BUILT_DISTRICT_IDS.length, `${streamedDistricts.length}/4`);
record('every authored district has a boundary line', boundaryLines === DISTRICTS.length, `${boundaryLines}/${DISTRICTS.length}`);
record('the orbit view is not a blank frame', orbitShot.nonSky > .25 && orbitShot.unique > 200, `${(orbitShot.nonSky * 100).toFixed(1)}% covered, ${orbitShot.unique} colours`);
record('the map view is not a blank frame', mapShot.nonSky > .25 && mapShot.unique > 200, `${(mapShot.nonSky * 100).toFixed(1)}% covered, ${mapShot.unique} colours`);
record('the scene holds a plausible amount of geometry', sceneCounts.triangles > 250_000, `${sceneCounts.triangles.toLocaleString('en-GB')} triangles`);
record('the renderer received frames', drawCalls > 100, `${drawCalls} frames`);

console.log('\nCHECKS');
for (const check of checks) console.log(`  ${check.ok ? '✓' : '✗'} ${check.name.padEnd(46)} ${check.detail}`);
const failed = checks.filter(check => !check.ok);
console.log(`\n${failed.length ? `${failed.length} FAILED:\n  - ` + failed.map(f => `${f.name}: ${f.detail}`).join('\n  - ') : `PASS — ${checks.length} checks. The generated world reaches the renderer.`}\n`);
if (failed.length) process.exitCode = 1;
