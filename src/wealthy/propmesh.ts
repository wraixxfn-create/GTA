/**
 * Prop geometry: one small merged mesh per kind, drawn as instances.
 *
 * Everything is authored around the origin with its length/forward along +X and its base
 * on y=0, so a placement is a rotation, a scale and a translation. Colours are baked per
 * vertex; the streaming layer tints whole instances (car liveries, planting shade) through
 * instanceColor.
 *
 * The security and guard props here are static world dressing — a camera housing on a
 * bracket, a sentry box beside a gate. There is no NPC, no line of sight and no AI in this
 * district; those systems are deliberately left for later.
 */
import * as THREE from 'three';
import { Buffer } from '../city/meshes';

export type PropKind =
  | 'lamp-standard' | 'bollard-light' | 'uplighter' | 'wall-lamp'
  | 'topiary' | 'tree-round' | 'tree-cypress' | 'tree-palm' | 'flower-bed' | 'planter'
  | 'camera' | 'guard-stand' | 'gate-pier' | 'gate-leaf' | 'flagpole'
  | 'fountain-jet' | 'sculpture' | 'bench' | 'parasol' | 'lounger' | 'sign-board'
  | 'car-luxury' | 'car-sport' | 'suv-luxury' | 'limousine';

/** Props only worth drawing in the detailed ring. */
export const NEAR_ONLY: ReadonlySet<PropKind> = new Set<PropKind>([
  'bollard-light', 'uplighter', 'wall-lamp', 'flower-bed', 'camera', 'bench',
  'parasol', 'lounger', 'sign-board', 'fountain-jet',
]);

type Colour = [number, number, number];
const C = {
  stone: [.78, .75, .68] as Colour, stoneDark: [.58, .56, .51] as Colour,
  bronze: [.46, .37, .24] as Colour, black: [.13, .13, .14] as Colour,
  white: [.9, .89, .86] as Colour, glass: [.24, .30, .34] as Colour,
  green: [.27, .42, .28] as Colour, greenDark: [.2, .33, .22] as Colour,
  palm: [.31, .46, .3] as Colour, trunk: [.42, .34, .24] as Colour,
  water: [.36, .56, .6] as Colour, lamp: [.98, .93, .74] as Colour,
  timber: [.52, .4, .27] as Colour, cream: [.86, .82, .72] as Colour,
  flower: [.72, .48, .5] as Colour, steel: [.55, .56, .57] as Colour,
};

function colour(rgb: Colour, shade = 1): THREE.Color {
  const c = new THREE.Color();
  c.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
  return c;
}

function box(b: Buffer, w: number, h: number, d: number, x: number, y: number, z: number, rgb: Colour, shade = 1): void {
  const c = colour(rgb, shade);
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y, y1 = y + h, z0 = z - d / 2, z1 = z + d / 2;
  const p = (px: number, py: number, pz: number) => ({ x: px, y: py, z: pz });
  b.quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1), c, undefined, { x: 0, y: 1, z: 0 });
  b.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y0, z0), p(x0, y0, z0), c, undefined, { x: 0, y: -1, z: 0 });
  b.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), c, undefined, { x: 0, y: 0, z: -1 });
  b.quad(p(x1, y0, z1), p(x0, y0, z1), p(x0, y1, z1), p(x1, y1, z1), c, undefined, { x: 0, y: 0, z: 1 });
  b.quad(p(x0, y0, z1), p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), c, undefined, { x: -1, y: 0, z: 0 });
  b.quad(p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0), c, undefined, { x: 1, y: 0, z: 0 });
}

function cylinder(b: Buffer, radius: number, height: number, x: number, y: number, z: number, rgb: Colour, sides = 8, taper = 1): void {
  const c = colour(rgb);
  const top: { x: number; y: number; z: number }[] = [];
  const bottom: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    top.push({ x: x + Math.cos(a) * radius * taper, y: y + height, z: z + Math.sin(a) * radius * taper });
    bottom.push({ x: x + Math.cos(a) * radius, y, z: z + Math.sin(a) * radius });
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    b.quad(bottom[i], bottom[j], top[j], top[i], c);
  }
  b.polygon(top, c, undefined, true);
}

function cone(b: Buffer, radius: number, height: number, x: number, y: number, z: number, rgb: Colour, sides = 8): void {
  const c = colour(rgb);
  const apex = { x, y: y + height, z };
  const ring: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push({ x: x + Math.cos(a) * radius, y, z: z + Math.sin(a) * radius });
  }
  for (let i = 0; i < sides; i++) b.triangle(ring[i], ring[(i + 1) % sides], apex, c);
  b.polygon(ring, c, undefined, false);
}

function sphereish(b: Buffer, radius: number, x: number, y: number, z: number, rgb: Colour, sides = 8): void {
  const c = colour(rgb);
  const ring: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push({ x: x + Math.cos(a) * radius, y: y + radius * 0.86, z: z + Math.sin(a) * radius });
  }
  const apex = { x, y: y + radius * 1.7, z };
  for (let i = 0; i < sides; i++) b.triangle(ring[i], ring[(i + 1) % sides], apex, c);
  const nadir = { x, y, z };
  for (let i = 0; i < sides; i++) b.triangle(ring[(i + 1) % sides], ring[i], nadir, c);
}

/** A car body: two boxes, four wheels and a glazing band. Forward is +X. */
function carBody(b: Buffer, length: number, width: number, bodyHeight: number, roofHeight: number,
  rgb: Colour, roofSetback: number, roofShorten: number): void {
  box(b, length, bodyHeight, width, 0, 0.42, 0, rgb, 1);
  box(b, length - roofShorten, roofHeight, width * 0.92, -roofSetback, 0.42 + bodyHeight, 0, rgb, 0.94);
  box(b, length - roofShorten - 0.5, roofHeight * 0.62, width * 0.95, -roofSetback, 0.42 + bodyHeight + roofHeight * 0.2, 0, C.glass, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(b, 0.72, 0.62, 0.26, sx * (length * 0.32), 0.06, sz * (width / 2 - 0.06), C.black, 1);
  }
  box(b, 0.16, 0.2, width * 0.8, length / 2 - 0.02, 0.72, 0, C.lamp, 1);
}

function build(kind: PropKind): Buffer {
  const b = new Buffer();
  switch (kind) {
    case 'lamp-standard':
      cylinder(b, 0.13, 5.6, 0, 0, 0, C.black, 6);
      box(b, 0.16, 0.16, 0.16, 0, 5.5, 0, C.bronze, 1);
      box(b, 1.5, 0.14, 0.14, 0.6, 5.4, 0, C.black, 1);
      box(b, 0.72, 0.3, 0.34, 1.24, 5.14, 0, C.lamp, 1);
      box(b, 0.34, 0.2, 0.34, 0, 0, 0, C.stoneDark, 1);
      break;
    case 'bollard-light':
      cylinder(b, 0.11, 0.85, 0, 0, 0, C.black, 6);
      cylinder(b, 0.14, 0.22, 0, 0.85, 0, C.lamp, 6);
      break;
    case 'uplighter':
      cylinder(b, 0.17, 0.14, 0, 0, 0, C.black, 6);
      box(b, 0.2, 0.3, 0.2, 0.05, 0.14, 0, C.lamp, 1);
      break;
    case 'wall-lamp':
      box(b, 0.16, 0.5, 0.16, 0, 0, 0, C.bronze, 1);
      box(b, 0.3, 0.34, 0.3, 0.12, 0.4, 0, C.lamp, 1);
      break;
    case 'topiary':
      box(b, 0.7, 0.34, 0.7, 0, 0, 0, C.stone, 1);
      cylinder(b, 0.09, 0.5, 0, 0.34, 0, C.trunk, 5);
      sphereish(b, 0.78, 0, 0.72, 0, C.greenDark, 8);
      break;
    case 'tree-round':
      cylinder(b, 0.24, 2.6, 0, 0, 0, C.trunk, 6);
      sphereish(b, 2.5, 0, 2.1, 0, C.green, 9);
      sphereish(b, 1.7, 0.9, 3.3, 0.5, C.green, 8);
      break;
    case 'tree-cypress':
      cylinder(b, 0.18, 1.1, 0, 0, 0, C.trunk, 6);
      cone(b, 1.15, 8.4, 0, 0.8, 0, C.greenDark, 9);
      break;
    case 'tree-palm':
      cylinder(b, 0.26, 7.4, 0, 0, 0, C.trunk, 7, 0.62);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        box(b, 3.4, 0.12, 0.62, Math.cos(a) * 1.5, 7.2 - Math.abs(Math.sin(a)) * 0.3, Math.sin(a) * 1.5, C.palm, 1);
      }
      break;
    case 'flower-bed':
      box(b, 2.6, 0.34, 1.5, 0, 0, 0, C.stone, 1);
      box(b, 2.3, 0.3, 1.2, 0, 0.34, 0, C.green, 1);
      for (const sx of [-0.7, 0, 0.7]) box(b, 0.5, 0.34, 0.5, sx, 0.6, 0.2, C.flower, 1);
      break;
    case 'planter':
      box(b, 1.5, 0.72, 1.5, 0, 0, 0, C.stone, 1);
      box(b, 1.2, 0.4, 1.2, 0, 0.72, 0, C.green, 1);
      sphereish(b, 0.62, 0, 1.05, 0, C.greenDark, 7);
      break;
    case 'camera':
      cylinder(b, 0.1, 3.1, 0, 0, 0, C.steel, 6);
      box(b, 0.5, 0.12, 0.12, 0.2, 3.0, 0, C.steel, 1);
      box(b, 0.44, 0.26, 0.24, 0.42, 2.78, 0, C.white, 1);
      box(b, 0.12, 0.12, 0.16, 0.66, 2.83, 0, C.black, 1);
      break;
    case 'guard-stand':
      // A sentry box beside a gate: static dressing, no occupant and no AI.
      box(b, 2.1, 2.5, 1.9, 0, 0, 0, C.stone, 1);
      box(b, 2.3, 0.24, 2.1, 0, 2.5, 0, C.stoneDark, 1);
      box(b, 1.5, 0.95, 0.08, 0.1, 1.3, 0.95, C.glass, 1);
      box(b, 0.08, 0.95, 1.3, 1.05, 1.3, 0, C.glass, 1);
      box(b, 0.4, 0.1, 0.4, 0, 2.74, 0, C.lamp, 1);
      break;
    case 'gate-pier':
      box(b, 1.5, 3.2, 1.5, 0, 0, 0, C.stone, 1);
      box(b, 1.72, 0.22, 1.72, 0, 3.2, 0, C.stoneDark, 1);
      sphereish(b, 0.3, 0, 3.42, 0, C.stone, 7);
      box(b, 0.28, 0.34, 0.28, 0.6, 1.5, 0, C.lamp, 1);
      break;
    case 'gate-leaf':
      box(b, 0.16, 2.1, 3.6, 0, 0.12, 0, C.black, 1);
      for (let i = 0; i < 5; i++) box(b, 0.1, 1.9, 0.1, 0, 0.2, -1.5 + i * 0.75, C.bronze, 1);
      box(b, 0.2, 0.14, 3.6, 0, 2.0, 0, C.bronze, 1);
      box(b, 0.2, 0.14, 3.6, 0, 0.4, 0, C.bronze, 1);
      break;
    case 'flagpole':
      cylinder(b, 0.1, 8.5, 0, 0, 0, C.white, 6, 0.5);
      box(b, 0.24, 0.24, 0.24, 0, 0, 0, C.stone, 1);
      box(b, 1.9, 1.1, 0.04, 0.95, 6.9, 0, C.cream, 1);
      break;
    case 'fountain-jet':
      cylinder(b, 0.34, 0.5, 0, 0, 0, C.stone, 8);
      cylinder(b, 0.14, 2.2, 0, 0.5, 0, C.water, 6, 0.4);
      sphereish(b, 0.42, 0, 2.4, 0, C.water, 7);
      break;
    case 'sculpture':
      box(b, 1.5, 0.9, 1.5, 0, 0, 0, C.stone, 1);
      box(b, 0.42, 2.3, 0.42, 0, 0.9, 0, C.bronze, 1);
      box(b, 1.5, 0.3, 0.3, 0, 2.6, 0, C.bronze, 1);
      sphereish(b, 0.46, 0, 3.0, 0, C.bronze, 7);
      break;
    case 'bench':
      box(b, 2.0, 0.12, 0.6, 0, 0.44, 0, C.timber, 1);
      box(b, 2.0, 0.5, 0.1, -0.1, 0.56, -0.26, C.timber, 1);
      for (const sx of [-0.8, 0.8]) box(b, 0.12, 0.44, 0.5, sx, 0, 0, C.black, 1);
      break;
    case 'parasol':
      cylinder(b, 0.07, 2.5, 0, 0, 0, C.timber, 5);
      cone(b, 1.9, 0.72, 0, 2.1, 0, C.cream, 9);
      break;
    case 'lounger':
      box(b, 1.9, 0.12, 0.7, 0, 0.34, 0, C.white, 1);
      box(b, 0.62, 0.5, 0.66, 0.72, 0.44, 0, C.white, 1);
      for (const sx of [-0.7, 0.7]) box(b, 0.1, 0.34, 0.6, sx, 0, 0, C.steel, 1);
      break;
    case 'sign-board':
      box(b, 0.14, 1.9, 0.14, -1.0, 0, 0, C.black, 1);
      box(b, 0.14, 1.9, 0.14, 1.0, 0, 0, C.black, 1);
      box(b, 2.5, 0.72, 0.1, 0, 1.5, 0, C.cream, 1);
      box(b, 2.2, 0.42, 0.06, 0, 1.62, 0.06, C.black, 1);
      break;
    case 'car-luxury':
      carBody(b, 5.0, 1.92, 0.72, 0.62, C.black, 0.35, 1.5);
      break;
    case 'car-sport':
      carBody(b, 4.5, 1.98, 0.56, 0.5, C.cream, 0.5, 1.9);
      break;
    case 'suv-luxury':
      carBody(b, 5.1, 2.04, 0.96, 0.74, C.stoneDark, 0.2, 1.1);
      break;
    case 'limousine':
      carBody(b, 6.6, 1.98, 0.78, 0.66, C.black, 0.1, 1.2);
      break;
  }
  return b;
}

const cache = new Map<PropKind, THREE.BufferGeometry>();

export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  let geometry = cache.get(kind);
  if (!geometry) {
    geometry = build(kind).geometry()!;
    geometry.computeBoundingSphere();
    cache.set(kind, geometry);
  }
  return geometry;
}

export function propTriangles(kind: PropKind): number {
  const index = propGeometry(kind).getIndex();
  return index ? index.count / 3 : 0;
}

export function disposePropGeometry(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
