/**
 * Prop geometry for the Residential Valley: one small merged mesh per kind, drawn as
 * instances. Street furniture of a lived-in neighbourhood — lamps, bins, benches,
 * fences, playground kit, bus shelters, parked cars. Everything is authored around the
 * origin with its forward along +X and its base on y=0.
 */
import * as THREE from 'three';
import { Buffer } from '../city/meshes';

export type PropKind =
  | 'street-lamp' | 'bin' | 'bench' | 'postbox' | 'sign-post' | 'bollard'
  | 'tree-round' | 'tree-conifer' | 'hedge' | 'flower-bed' | 'planter'
  | 'fence-timber' | 'goal-post' | 'swing-frame' | 'slide' | 'climbing-frame'
  | 'bus-shelter' | 'fuel-pump' | 'park-meter' | 'washing-line' | 'shed'
  | 'car-hatchback' | 'car-saloon' | 'van' | 'pickup' | 'estate-car';

/** Props only worth drawing in the detailed ring. */
export const NEAR_ONLY: ReadonlySet<PropKind> = new Set<PropKind>([
  'bin', 'bench', 'postbox', 'bollard', 'flower-bed', 'planter', 'park-meter',
  'fuel-pump', 'swing-frame', 'slide', 'climbing-frame', 'washing-line', 'shed',
]);

type Colour = [number, number, number];
const C = {
  steel: [.5, .52, .53] as Colour, dark: [.2, .2, .21] as Colour, green: [.25, .4, .27] as Colour,
  leaf: [.27, .45, .29] as Colour, trunk: [.4, .32, .22] as Colour, timber: [.5, .38, .25] as Colour,
  white: [.9, .89, .86] as Colour, red: [.62, .3, .27] as Colour, blue: [.28, .38, .55] as Colour,
  yellow: [.85, .75, .35] as Colour, plastic: [.75, .72, .65] as Colour, glass: [.35, .45, .5] as Colour,
  concrete: [.68, .66, .62] as Colour, tarmac: [.3, .3, .31] as Colour,
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
function cylinder(b: Buffer, radius: number, height: number, x: number, y: number, z: number, rgb: Colour, sides = 7, taper = 1): void {
  const c = colour(rgb);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const r0x = Math.cos(a0) * radius, r0z = Math.sin(a0) * radius;
    const r1x = Math.cos(a1) * radius, r1z = Math.sin(a1) * radius;
    const t0x = r0x * taper, t0z = r0z * taper, t1x = r1x * taper, t1z = r1z * taper;
    b.quad(
      { x: x + r0x, y, z: z + r0z }, { x: x + r1x, y, z: z + r1z },
      { x: x + t1x, y: y + height, z: z + t1z }, { x: x + t0x, y: y + height, z: z + t0z }, c,
    );
  }
  if (taper > 0.02) {
    b.polygon(Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2;
      return { x: x + Math.cos(a) * radius * taper, y: y + height, z: z + Math.sin(a) * radius * taper };
    }), c, undefined, true);
  }
}
function canopy(b: Buffer, radius: number, height: number, x: number, y: number, z: number, rgb: Colour, squash = 1): void {
  const c = colour(rgb);
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    b.triangle(
      { x, y: y + height, z },
      { x: x + Math.cos(a0) * radius, y: y + height * squash * 0.2, z: z + Math.sin(a0) * radius },
      { x: x + Math.cos(a1) * radius, y: y + height * squash * 0.2, z: z + Math.sin(a1) * radius },
      c,
    );
  }
}

function build(kind: PropKind): Buffer {
  const b = new Buffer();
  switch (kind) {
    case 'street-lamp':
      cylinder(b, 0.09, 6, 0, 0, 0, C.steel, 6);
      box(b, 0.5, 0.16, 0.3, 0.2, 5.9, 0, C.dark);
      box(b, 0.35, 0.1, 0.25, 0.35, 5.75, 0, C.white);
      break;
    case 'bin':
      cylinder(b, 0.3, 0.85, 0, 0, 0, C.green, 8);
      break;
    case 'bench':
      box(b, 1.8, 0.08, 0.5, 0, 0.42, 0, C.timber);
      box(b, 1.8, 0.5, 0.07, 0, 0.5, -0.25, C.timber);
      box(b, 0.08, 0.42, 0.45, -0.8, 0, 0, C.dark);
      box(b, 0.08, 0.42, 0.45, 0.8, 0, 0, C.dark);
      break;
    case 'postbox':
      cylinder(b, 0.28, 1.1, 0, 0, 0, C.red, 8, 0.9);
      break;
    case 'sign-post':
      cylinder(b, 0.05, 2.4, 0, 0, 0, C.dark, 5);
      box(b, 0.7, 0.5, 0.05, 0, 1.9, 0, C.white);
      break;
    case 'bollard':
      cylinder(b, 0.09, 0.8, 0, 0, 0, C.dark, 6);
      break;
    case 'tree-round':
      cylinder(b, 0.22, 2.6, 0, 0, 0, C.trunk, 6);
      canopy(b, 2.4, 4.4, 0, 2.4, 0, C.leaf, 0.55);
      break;
    case 'tree-conifer':
      cylinder(b, 0.18, 1.8, 0, 0, 0, C.trunk, 6);
      canopy(b, 1.5, 6.2, 0, 1.6, 0, C.green, 0.1);
      break;
    case 'hedge':
      box(b, 3, 1.1, 1, 0, 0, 0, C.green, 0.9);
      break;
    case 'flower-bed':
      box(b, 2.2, 0.35, 1.1, 0, 0, 0, C.leaf);
      box(b, 1.8, 0.15, 0.7, 0, 0.35, 0, [.75, .45, .5]);
      break;
    case 'planter':
      box(b, 0.9, 0.55, 0.9, 0, 0, 0, C.concrete);
      box(b, 0.7, 0.15, 0.7, 0, 0.55, 0, C.green);
      break;
    case 'fence-timber':
      for (let i = -2; i <= 2; i++) box(b, 0.06, 1, 0.06, i * 0.55, 0, 0, C.timber);
      box(b, 2.6, 0.08, 0.05, 0, 0.3, 0, C.timber);
      box(b, 2.6, 0.08, 0.05, 0, 0.75, 0, C.timber);
      break;
    case 'goal-post':
      box(b, 0.1, 2.4, 0.1, -2.5, 0, 0, C.white);
      box(b, 0.1, 2.4, 0.1, 2.5, 0, 0, C.white);
      box(b, 5.1, 0.1, 0.1, 0, 2.35, 0, C.white);
      break;
    case 'swing-frame':
      box(b, 0.1, 2.4, 0.1, -1.2, 0, 0, C.red);
      box(b, 0.1, 2.4, 0.1, 1.2, 0, 0, C.red);
      box(b, 2.6, 0.1, 0.1, 0, 2.35, 0, C.red);
      box(b, 0.4, 0.05, 0.3, -0.5, 1.1, 0, C.dark);
      box(b, 0.4, 0.05, 0.3, 0.5, 1.1, 0, C.dark);
      break;
    case 'slide':
      box(b, 1, 0.1, 2.2, 0, 1.4, 1.2, C.yellow, 1);
      box(b, 0.1, 1.5, 0.1, -0.45, 0, 0, C.blue);
      box(b, 0.1, 1.5, 0.1, 0.45, 0, 0, C.blue);
      box(b, 1, 0.08, 1, 0, 1.45, -0.3, C.red);
      break;
    case 'climbing-frame':
      box(b, 1.8, 1.8, 1.8, 0, 0, 0, C.blue, 0.85);
      break;
    case 'bus-shelter':
      box(b, 3.4, 0.1, 1.3, 0, 2.35, 0, C.dark);
      box(b, 0.08, 2.3, 1.3, -1.65, 0, 0, C.glass);
      box(b, 0.08, 2.3, 1.3, 1.65, 0, 0, C.glass);
      box(b, 3.2, 0.08, 0.4, 0, 0.45, -0.4, C.timber);
      break;
    case 'fuel-pump':
      box(b, 0.6, 1.6, 0.4, 0, 0, 0, C.white);
      box(b, 0.5, 0.4, 0.35, 0, 1.0, 0, C.blue);
      break;
    case 'park-meter':
      cylinder(b, 0.07, 1, 0, 0, 0, C.dark, 6);
      box(b, 0.18, 0.3, 0.12, 0, 1, 0, C.steel);
      break;
    case 'washing-line':
      box(b, 0.07, 1.8, 0.07, -1.5, 0, 0, C.steel);
      box(b, 0.07, 1.8, 0.07, 1.5, 0, 0, C.steel);
      box(b, 3, 0.03, 0.03, 0, 1.75, 0, C.white);
      break;
    case 'shed':
      box(b, 2, 1.8, 1.6, 0, 0, 0, C.timber, 0.85);
      break;
    case 'car-hatchback': case 'car-saloon': case 'van': case 'pickup': case 'estate-car': {
      const long = kind === 'van' ? 4.9 : kind === 'pickup' ? 5 : kind === 'car-saloon' ? 4.5 : 4;
      const high = kind === 'van' ? 2 : kind === 'pickup' ? 1.6 : 1.35;
      const body = kind === 'van' ? C.white : kind === 'pickup' ? C.steel : C.blue;
      box(b, long, 0.7, 1.75, 0, 0.35, 0, body);
      if (kind !== 'pickup') box(b, long * 0.5, high - 0.9, 1.6, kind === 'van' ? 0.3 : -0.1, 1.0, 0, kind === 'van' ? body : C.glass, 0.9);
      else box(b, 1.6, 0.55, 1.6, 1.2, 1.0, 0, body);
      // Wheels.
      for (const wx of [-long * 0.32, long * 0.32]) for (const wz of [-0.8, 0.8]) {
        cylinder(b, 0.3, 0.2, wx, 0, wz, C.dark, 6);
      }
      break;
    }
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
