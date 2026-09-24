/**
 * Geometry for street furniture, planting, vehicles and public-space structures.
 *
 * Every prop is a small, low-polygon solid with vertex colours, built once and drawn as an
 * instanced mesh. They are authored facing +Z so a placement angle is a single rotation.
 */
import * as THREE from 'three';
import { Buffer } from './meshes';
import type { PropKind } from './props';

type Colour = [number, number, number];

const PALETTE = {
  darkMetal: [.20, .21, .22] as Colour,
  metal: [.44, .45, .45] as Colour,
  paleMetal: [.62, .63, .62] as Colour,
  wood: [.42, .31, .22] as Colour,
  painted: [.28, .34, .36] as Colour,
  green: [.29, .41, .30] as Colour,
  brightGreen: [.35, .48, .31] as Colour,
  glass: [.55, .62, .64] as Colour,
  stone: [.63, .61, .56] as Colour,
  warmStone: [.70, .65, .56] as Colour,
  red: [.58, .22, .20] as Colour,
  amber: [.78, .64, .34] as Colour,
  black: [.12, .13, .13] as Colour,
  white: [.86, .86, .83] as Colour,
  blue: [.27, .40, .50] as Colour,
};

function colour(buffer: Buffer, rgb: Colour, shade = 1): THREE.Color {
  const c = new THREE.Color();
  c.setRGB(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade, THREE.SRGBColorSpace);
  return c;
}

function box(buffer: Buffer, w: number, h: number, d: number, x: number, y: number, z: number, rgb: Colour, shade = 1): void {
  const c = colour(buffer, rgb, shade);
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const p = (sx: number, sy: number, sz: number) => ({ x: x + sx * hw, y: y + sy * hh, z: z + sz * hd });
  const a = p(-1, -1, -1), b = p(1, -1, -1), c1 = p(1, 1, -1), d1 = p(-1, 1, -1);
  const e = p(-1, -1, 1), f = p(1, -1, 1), g = p(1, 1, 1), h1 = p(-1, 1, 1);
  buffer.quad(e, f, g, h1, c);          // +z (the side a prop "faces")
  buffer.quad(b, a, d1, c1, c);         // -z
  buffer.quad(f, b, c1, g, c);          // +x
  buffer.quad(a, e, h1, d1, c);         // -x
  buffer.quad(d1, h1, g, c1, c);        // +y
  buffer.quad(a, b, f, e, c);           // -y
}

function cylinder(buffer: Buffer, radius: number, height: number, segments: number,
  x: number, y: number, z: number, rgb: Colour, shade = 1, capTop = true): void {
  const c = colour(buffer, rgb, shade);
  const bottom = y, top = y + height;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = { x: x + Math.cos(a0) * radius, z: z + Math.sin(a0) * radius };
    const p1 = { x: x + Math.cos(a1) * radius, z: z + Math.sin(a1) * radius };
    buffer.quad(
      { x: p0.x, y: bottom, z: p0.z }, { x: p1.x, y: bottom, z: p1.z },
      { x: p1.x, y: top, z: p1.z }, { x: p0.x, y: top, z: p0.z }, c,
    );
    if (capTop) {
      buffer.triangle(
        { x: x, y: top, z: z }, { x: p1.x, y: top, z: p1.z }, { x: p0.x, y: top, z: p0.z }, c,
      );
    }
  }
}

function cone(buffer: Buffer, radius: number, height: number, segments: number,
  x: number, y: number, z: number, rgb: Colour, shade = 1): void {
  const c = colour(buffer, rgb, shade);
  const apex = { x, y: y + height, z };
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = { x: x + Math.cos(a0) * radius, z: z + Math.sin(a0) * radius };
    const p1 = { x: x + Math.cos(a1) * radius, z: z + Math.sin(a1) * radius };
    buffer.triangle({ x: p0.x, y, z: p0.z }, { x: p1.x, y, z: p1.z }, apex, c);
    buffer.triangle(apex, { x: p1.x, y, z: p1.z }, { x: p0.x, y, z: p0.z }, c);
  }
}

const cache = new Map<PropKind, THREE.BufferGeometry>();

/** Build (once) and cache the geometry for a prop type. */
export function propGeometry(kind: PropKind): THREE.BufferGeometry {
  const cached = cache.get(kind);
  if (cached) return cached;
  const buffer = new Buffer();
  switch (kind) {
    case 'lamp':
      // Four-sided mast and a single lantern box: 20 triangles at 4000 instances.
      cylinder(buffer, 0.14, 7.6, 4, 0, 0, 0, PALETTE.darkMetal, 1, false);
      box(buffer, 0.7, 0.24, 0.5, 0, 7.3, 1.05, PALETTE.paleMetal);
      box(buffer, 0.58, 0.06, 0.38, 0, 7.16, 1.05, PALETTE.amber, 1.5);
      break;
    case 'tree':
      cylinder(buffer, 0.3, 4.4, 4, 0, 0, 0, PALETTE.wood, 1, false);
      cone(buffer, 2.5, 3.8, 6, 0, 3.2, 0, PALETTE.green);
      cone(buffer, 1.8, 2.9, 6, 0, 5.2, 0, PALETTE.brightGreen);
      break;
    case 'bench':
      box(buffer, 1.8, 0.09, 0.52, 0, 0.46, 0, PALETTE.wood);
      box(buffer, 1.8, 0.46, 0.09, 0, 0.7, -0.22, PALETTE.wood);
      break;
    case 'bin':
      cylinder(buffer, 0.34, 1.02, 6, 0, 0, 0, PALETTE.painted);
      break;
    case 'bollard':
      cylinder(buffer, 0.13, 1.0, 5, 0, 0, 0, PALETTE.metal);
      break;
    case 'planter':
      box(buffer, 1.8, 0.6, 0.9, 0, 0.3, 0, PALETTE.stone);
      box(buffer, 1.5, 0.7, 0.7, 0, 0.9, 0, PALETTE.green, 1.1);
      break;
    case 'shelter':
      for (const [sx, sz] of [[-1.7, -0.75], [1.7, -0.75], [-1.7, 0.75], [1.7, 0.75]] as const) {
        cylinder(buffer, 0.09, 2.65, 4, sx, 0, sz, PALETTE.darkMetal, 1, false);
      }
      box(buffer, 3.9, 0.14, 1.9, 0, 2.7, 0, PALETTE.painted);
      box(buffer, 3.7, 1.7, 0.06, 0, 1.3, -0.78, PALETTE.glass, 1.2);
      box(buffer, 1.7, 0.08, 0.42, 0, 0.46, -0.42, PALETTE.wood);
      break;
    case 'signal':
      cylinder(buffer, 0.15, 6.2, 5, 0, 0, 0, PALETTE.darkMetal, 1, false);
      box(buffer, 0.18, 0.18, 4.6, 0, 6.0, 2.0, PALETTE.darkMetal);
      box(buffer, 0.46, 1.35, 0.4, 0, 5.35, 3.55, PALETTE.black);
      box(buffer, 0.3, 0.9, 0.06, 0, 5.35, 3.77, PALETTE.amber, 1.6);
      break;
    case 'ped-signal':
      cylinder(buffer, 0.09, 2.5, 6, 0, 0, 0, PALETTE.darkMetal);
      box(buffer, 0.3, 0.66, 0.24, 0, 2.1, 0.05, PALETTE.black);
      box(buffer, 0.2, 0.2, 0.04, 0, 2.28, 0.18, PALETTE.red, 1.6);
      box(buffer, 0.2, 0.2, 0.04, 0, 1.9, 0.18, PALETTE.brightGreen, 1.6);
      break;
    case 'car':
      // Two boxes: a parked car is scenery, not a vehicle model.
      box(buffer, 1.82, 0.62, 4.3, 0, 0.52, 0, PALETTE.white);
      box(buffer, 1.68, 0.56, 2.1, 0, 1.06, -0.2, PALETTE.glass, 0.7);
      break;
    case 'cafe':
      cylinder(buffer, 0.05, 0.74, 4, 0, 0, 0, PALETTE.darkMetal, 1, false);
      cylinder(buffer, 0.44, 0.06, 6, 0, 0.72, 0, PALETTE.warmStone);
      cylinder(buffer, 0.04, 1.5, 4, 0, 0.76, 0, PALETTE.darkMetal, 1, false);
      cone(buffer, 1.25, 0.5, 6, 0, 2.0, 0, PALETTE.red, 1.1);
      box(buffer, 0.44, 0.06, 0.44, 0.9, 0.44, 0.3, PALETTE.wood);
      break;
    case 'rack':
      box(buffer, 0.08, 0.9, 0.08, -0.5, 0.45, 0, PALETTE.metal);
      box(buffer, 0.08, 0.9, 0.08, 0.5, 0.45, 0, PALETTE.metal);
      box(buffer, 1.1, 0.08, 0.08, 0, 0.9, 0, PALETTE.metal);
      break;
    case 'fountain':
      cylinder(buffer, 5.2, 0.85, 12, 0, 0, 0, PALETTE.stone);
      cylinder(buffer, 4.6, 0.16, 12, 0, 0.6, 0, PALETTE.blue, 1.3);
      cylinder(buffer, 0.45, 2.6, 6, 0, 0.7, 0, PALETTE.stone, 1.05);
      cone(buffer, 1.5, 1.1, 8, 0, 3.3, 0, PALETTE.blue, 1.4);
      break;
    case 'flag':
      cylinder(buffer, 0.16, 9.2, 5, 0, 0, 0, PALETTE.paleMetal, 1, false);
      box(buffer, 2.2, 1.4, 0.05, 1.1, 7.4, 0, PALETTE.blue, 1.2);
      break;
    case 'kiosk':
      box(buffer, 2.6, 2.5, 1.9, 0, 1.25, 0, PALETTE.warmStone);
      box(buffer, 2.9, 0.16, 2.2, 0, 2.6, 0, PALETTE.red, 1.1);
      box(buffer, 1.8, 1.0, 0.1, 0, 1.5, 0.95, PALETTE.glass, .8);
      break;
    case 'meter':
      cylinder(buffer, 0.07, 1.1, 4, 0, 0, 0, PALETTE.darkMetal, 1, false);
      box(buffer, 0.28, 0.44, 0.18, 0, 1.28, 0, PALETTE.painted);
      break;
    case 'sculpture':
      box(buffer, 0.9, 3.4, 0.9, 0, 1.7, 0, PALETTE.paleMetal, 1.1);
      box(buffer, 2.6, 0.7, 0.7, 0.6, 3.0, 0, PALETTE.paleMetal, .95);
      box(buffer, 0.7, 1.8, 0.7, -0.5, 0.9, 0.7, PALETTE.paleMetal, 1.2);
      break;
    case 'pavilion':
      for (const [sx, sz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]] as const) {
        cylinder(buffer, 0.16, 3.4, 6, sx, 0, sz, PALETTE.warmStone);
      }
      cone(buffer, 3.4, 1.8, 4, 0, 3.4, 0, PALETTE.painted);
      box(buffer, 4.6, 0.12, 4.6, 0, 0.06, 0, PALETTE.stone);
      break;
    case 'play':
      box(buffer, 0.16, 2.4, 0.16, -1.4, 1.2, 0, PALETTE.metal);
      box(buffer, 0.16, 2.4, 0.16, 1.4, 1.2, 0, PALETTE.metal);
      box(buffer, 3.0, 0.16, 0.16, 0, 2.4, 0, PALETTE.metal);
      box(buffer, 1.2, 0.2, 3.0, -1.0, 1.1, 0.6, PALETTE.red, 1.2);
      box(buffer, 0.5, 1.6, 0.5, 1.0, 0.8, 0, PALETTE.blue, 1.2);
      break;
    case 'totem':
      box(buffer, 0.42, 2.5, 0.3, 0, 1.25, 0, PALETTE.darkMetal);
      box(buffer, 0.34, 1.0, 0.04, 0, 1.7, 0.16, PALETTE.blue, 1.5);
      break;
    case 'hydrant':
      cylinder(buffer, 0.18, 0.8, 6, 0, 0, 0, PALETTE.red);
      break;
    default:
      box(buffer, 0.6, 0.6, 0.6, 0, 0.3, 0, PALETTE.metal);
  }
  const geometry = buffer.geometry() ?? new THREE.BufferGeometry();
  cache.set(kind, geometry);
  return geometry;
}

/** Prop types that are only worth drawing in the closest ring. */
export const NEAR_ONLY: ReadonlySet<PropKind> = new Set<PropKind>([
  'cafe', 'bench', 'bin', 'meter', 'rack', 'planter', 'sculpture', 'play', 'hydrant', 'flag',
]);
export function propTriangles(kind: PropKind): number {
  const geometry = propGeometry(kind);
  const index = geometry.getIndex();
  return index ? index.count / 3 : 0;
}
export function disposePropGeometry(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
