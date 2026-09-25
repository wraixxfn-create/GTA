/**
 * Prop geometry: one small merged mesh per kind, drawn as instances.
 *
 * Everything is authored around the origin with its length/forward along +X and its
 * base on y=0, so a placement is a rotation, a scale and a translation. Colours are
 * baked per vertex; the streaming layer tints whole instances (container liveries,
 * rust, fleet colours) through instanceColor.
 */
import * as THREE from 'three';
import { Buffer } from '../city/meshes';

export type IndPropKind =
  | 'container20' | 'container40' | 'trailer' | 'truck' | 'van' | 'car'
  | 'pallet' | 'crate' | 'barrel' | 'dumpster' | 'generator' | 'transformer'
  | 'hopper' | 'pipe' | 'aggregate' | 'logs' | 'bale' | 'wreck' | 'excavator'
  | 'barrier' | 'floodlight' | 'pole' | 'crossbuck' | 'barrier-arm' | 'sign-board'
  | 'frame-bundle';

/** Props only worth drawing in the detailed ring. */
export const IND_NEAR_ONLY: ReadonlySet<IndPropKind> = new Set<IndPropKind>([
  'pallet', 'crate', 'barrel', 'dumpster', 'barrier', 'crossbuck', 'barrier-arm',
  'sign-board', 'frame-bundle', 'hopper', 'generator', 'transformer',
]);

type Colour = [number, number, number];
const C = {
  steel: [.55, .56, .57] as Colour, dark: [.22, .23, .24] as Colour, rust: [.48, .33, .23] as Colour,
  white: [.86, .85, .82] as Colour, yellow: [.82, .66, .22] as Colour, red: [.62, .25, .2] as Colour,
  green: [.3, .42, .3] as Colour, timber: [.55, .43, .28] as Colour, concrete: [.6, .59, .56] as Colour,
  black: [.12, .12, .13] as Colour, blue: [.3, .38, .5] as Colour,
};

function colour(buffer: Buffer, rgb: Colour, shade = 1): THREE.Color {
  void buffer;
  const color = new THREE.Color();
  color.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
  return color;
}

function box(buffer: Buffer, w: number, h: number, d: number, x: number, y: number, z: number, rgb: Colour, shade = 1): void {
  const c = colour(buffer, rgb, shade);
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y, y1 = y + h, z0 = z - d / 2, z1 = z + d / 2;
  buffer.quad({ x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, c); // top
  buffer.quad({ x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, c); // +z
  buffer.quad({ x: x1, y: y0, z: z0 }, { x: x0, y: y0, z: z0 }, { x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, c); // -z
  buffer.quad({ x: x1, y: y0, z: z1 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, c); // +x
  buffer.quad({ x: x0, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, { x: x0, y: y1, z: z1 }, { x: x0, y: y1, z: z0 }, c); // -x
}

function cylinder(buffer: Buffer, radius: number, height: number, segments: number,
  x: number, y: number, z: number, rgb: Colour, horizontal = false, axisAngle = 0): void {
  const c = colour(buffer, rgb);
  void axisAngle;
  const ring = (yy: number, r: number): { x: number; y: number; z: number }[] => {
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(horizontal
        ? { x: x + yy, y: y + Math.cos(a) * r, z: z + Math.sin(a) * r }
        : { x: x + Math.cos(a) * r, y: y + yy, z: z + Math.sin(a) * r });
    }
    return pts;
  };
  const bottom = ring(0, radius), top = ring(height, radius);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    buffer.quad(bottom[i], bottom[j], top[j], top[i], c);
  }
  buffer.polygon(top.map(p => ({ x: p.x, y: p.y, z: p.z })), c, undefined, !horizontal);
  buffer.polygon(bottom.map(p => ({ x: p.x, y: p.y, z: p.z })), c, undefined, horizontal);
}

function cone(buffer: Buffer, radius: number, height: number, segments: number, x: number, y: number, z: number, rgb: Colour): void {
  const c = colour(buffer, rgb);
  const apex = { x, y: y + height, z };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    buffer.triangle(
      { x: x + Math.cos(a0) * radius, y, z: z + Math.sin(a0) * radius },
      { x: x + Math.cos(a1) * radius, y, z: z + Math.sin(a1) * radius },
      apex, c,
    );
  }
}

const cache = new Map<IndPropKind, THREE.BufferGeometry>();

function build(kind: IndPropKind): Buffer {
  const b = new Buffer();
  switch (kind) {
    case 'container20':
      box(b, 6.1, 2.6, 2.44, 0, 0, 0, C.white, .92);
      box(b, 6.1, .12, 2.5, 0, 2.54, 0, C.steel, .8);
      break;
    case 'container40':
      box(b, 12.2, 2.6, 2.44, 0, 0, 0, C.white, .92);
      box(b, 12.2, .12, 2.5, 0, 2.54, 0, C.steel, .8);
      break;
    case 'trailer':
      box(b, 13.6, .4, 2.5, 0, 1.1, 0, C.dark);            // chassis
      box(b, 12.4, 2.7, 2.55, -.4, 1.5, 0, C.white, .95);  // box
      box(b, 2.2, .9, 1.9, 5.4, .35, 0, C.dark);           // landing gear / wheels
      box(b, 1.6, .8, 2.4, -5.6, .3, 0, C.black);
      break;
    case 'truck':
      box(b, 4.6, 2.9, 2.4, -2.2, .5, 0, C.white, .9);   // cargo box
      box(b, 2.4, 2.2, 2.35, 1.6, .5, 0, C.blue);        // cab
      box(b, 2.4, .8, 2.2, 1.6, 2.0, 0, C.dark, .6);     // windscreen band
      box(b, 5.6, .5, 2.1, -.4, .25, 0, C.dark);         // chassis
      box(b, 1.1, .9, 2.5, 1.4, .1, 0, C.black);
      box(b, 1.1, .9, 2.5, -2.8, .1, 0, C.black);
      break;
    case 'van':
      box(b, 4.4, 2.1, 1.95, -.3, .35, 0, C.white, .95);
      box(b, 1.6, 1.5, 1.9, 1.7, .35, 0, C.white, .9);
      box(b, 5.2, .3, 1.8, 0, .15, 0, C.dark);
      box(b, .9, .7, 2, 1.5, .1, 0, C.black);
      box(b, .9, .7, 2, -1.5, .1, 0, C.black);
      break;
    case 'car':
      box(b, 4.2, .9, 1.8, 0, .35, 0, C.white, .9);
      box(b, 2.2, .75, 1.7, -.1, 1.2, 0, C.dark, .8);
      box(b, .8, .65, 1.85, 1.3, .12, 0, C.black);
      box(b, .8, .65, 1.85, -1.3, .12, 0, C.black);
      break;
    case 'pallet':
      box(b, 1.2, .16, 1.0, 0, 0, 0, C.timber);
      box(b, 1.15, .5, .95, 0, .16, 0, C.timber, .85);
      box(b, 1.15, .12, .95, 0, .66, 0, C.timber, .9);
      break;
    case 'crate':
      box(b, 1.4, 1.2, 1.3, 0, 0, 0, C.timber, .9);
      box(b, 1.44, .1, 1.34, 0, 1.14, 0, C.timber, .7);
      break;
    case 'barrel':
      cylinder(b, .42, 1.05, 7, 0, 0, 0, C.rust);
      break;
    case 'dumpster':
      box(b, 2.6, 1.4, 1.7, 0, .18, 0, C.green, .9);
      box(b, 2.7, .12, 1.8, 0, 1.52, 0, C.dark);
      box(b, .3, .2, 1.7, 1.1, 0, 0, C.dark);
      break;
    case 'generator':
      box(b, 3.4, 1.7, 1.6, 0, .2, 0, C.yellow, .85);
      box(b, 3.2, .12, 1.5, 0, 1.86, 0, C.dark);
      cylinder(b, .12, .8, 6, 1.1, 1.9, .4, C.dark);
      break;
    case 'transformer':
      box(b, 2.6, 2.2, 1.8, 0, .3, 0, C.steel, .85);
      cylinder(b, .14, .7, 6, -.7, 2.5, 0, C.dark);
      cylinder(b, .14, .7, 6, .7, 2.5, 0, C.dark);
      box(b, 2.8, .16, 2, 0, 2.44, 0, C.dark, .8);
      break;
    case 'hopper':
      cone(b, 2.2, 2.6, 8, 0, 2.4, 0, C.steel, );
      cylinder(b, 2.2, 2.4, 8, 0, 0, 0, C.steel);
      break;
    case 'pipe':
      cylinder(b, .55, 8.5, 6, 0, .55, 0, C.steel, true);
      cylinder(b, .4, 7.2, 6, .4, 1.4, 0, C.rust, true);
      break;
    case 'aggregate':
      cone(b, 5.5, 3.6, 9, 0, 0, 0, C.concrete, );
      break;
    case 'logs':
      cylinder(b, .38, 6.4, 6, 0, .38, -.7, C.timber, true);
      cylinder(b, .38, 6.0, 6, .2, .38, 0, C.timber, true);
      cylinder(b, .34, 5.6, 6, 0, 1.05, -.35, C.timber, true);
      break;
    case 'bale':
      box(b, 2.2, 1.5, 1.5, 0, 0, 0, C.rust, .9);
      box(b, 2.24, .08, 1.54, 0, .7, 0, C.dark, .7);
      break;
    case 'wreck':
      box(b, 4.0, .8, 1.8, 0, .25, 0, C.rust, .85);
      box(b, 1.8, .5, 1.6, -.2, 1.0, 0, C.rust, .7);
      box(b, .7, .55, 1.85, 1.2, .1, 0, C.black, .8);
      break;
    case 'excavator':
      box(b, 3.4, .8, 2.6, 0, .5, 0, C.dark);              // tracks
      box(b, 2.6, 1.1, 2.2, -.2, 1.3, 0, C.yellow, .9);    // body
      box(b, 1.5, .9, 1.4, .9, 1.6, 0, C.dark, .7);        // cab
      box(b, 3.4, .5, .5, 2.6, 2.4, 0, C.yellow, .8);      // boom
      box(b, 2.0, .4, .4, 4.6, 1.2, 0, C.yellow, .8);      // arm
      box(b, .9, .7, 1.2, 5.5, .3, 0, C.dark);             // bucket
      break;
    case 'barrier':
      box(b, 2.2, .9, .6, 0, 0, 0, C.concrete);
      box(b, 2.24, .18, .64, 0, .55, 0, C.red, .9);
      break;
    case 'floodlight':
      box(b, .28, 11, .28, 0, 0, 0, C.steel, .8);
      box(b, 1.5, .5, .4, 0, 10.8, 0, C.dark);
      box(b, 1.3, .18, .3, 0, 10.6, 0, C.white);
      break;
    case 'pole':
      box(b, .24, 9.4, .24, 0, 0, 0, C.concrete, .85);
      box(b, .18, 2.2, .18, 1.1, 8.6, 0, C.concrete, .8); // crossarm along X
      box(b, .3, .4, .3, 1.9, 8.2, 0, C.dark);
      box(b, .3, .4, .3, .3, 8.2, 0, C.dark);
      break;
    case 'crossbuck':
      box(b, .2, 2.6, .2, 0, 0, 0, C.white, .9);
      box(b, 2.3, .34, .1, 0, 2.2, 0, C.white);
      box(b, .34, 2.3, .1, 0, 2.2, 0, C.white);
      break;
    case 'barrier-arm':
      box(b, .5, .8, .5, 0, 0, 0, C.dark);
      box(b, 5.4, .18, .16, 2.7, .8, 0, C.red, .95);
      box(b, 1.2, .22, .2, 1.4, .78, 0, C.white);
      box(b, 1.2, .22, .2, 3.8, .78, 0, C.white);
      break;
    case 'sign-board':
      box(b, .16, 2.4, .16, -1.3, 0, 0, C.steel, .8);
      box(b, .16, 2.4, .16, 1.3, 0, 0, C.steel, .8);
      box(b, 3.2, 1.1, .12, 0, 2.2, 0, C.yellow, .9);
      box(b, 2.9, .5, .14, 0, 2.45, 0, C.dark, .55);
      break;
    case 'frame-bundle':
      box(b, 7.5, .3, 1.4, 0, .1, 0, C.rust, .8);
      box(b, 7.2, .3, 1.2, .2, .4, 0, C.steel, .75);
      box(b, 6.8, .3, 1.0, -.1, .7, 0, C.rust, .7);
      break;
  }
  return b;
}

export function propGeometry(kind: IndPropKind): THREE.BufferGeometry {
  let geometry = cache.get(kind);
  if (!geometry) {
    geometry = build(kind).geometry()!;
    geometry.computeBoundingSphere();
    cache.set(kind, geometry);
  }
  return geometry;
}

export function propTriangles(kind: IndPropKind): number {
  const index = propGeometry(kind).getIndex();
  return index ? index.count / 3 : 0;
}

export function disposePropGeometry(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
