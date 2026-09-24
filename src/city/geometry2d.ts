/**
 * Planar polygon utilities for the built districts.
 *
 * Every block, parcel, road corridor and plaza in the constructed city is a convex
 * polygon in the horizontal plane. Convex pieces keep clipping exact (no slivers, no
 * self-intersections) which is what lets parcels, road corridors, building footprints
 * and navigation surfaces be derived from one another without manual cleanup.
 */
import type { Point } from '../world/data';

export const dot = (a: Point, b: Point): number => a.x * b.x + a.z * b.z;
export const cross = (a: Point, b: Point): number => a.x * b.z - a.z * b.x;
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, z: a.z * s });
export const length = (a: Point): number => Math.hypot(a.x, a.z);
export const distance2d = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
export function normalize(a: Point): Point {
  const l = length(a) || 1;
  return { x: a.x / l, z: a.z / l };
}
/** Rotate 90° counter-clockwise in the x/z plane: the inward normal of a CCW edge. */
export const leftNormal = (a: Point): Point => ({ x: -a.z, z: a.x });
export function lerp2(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function signedArea(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}
export function ensureCCW(polygon: readonly Point[]): Point[] {
  return signedArea(polygon) < 0 ? [...polygon].reverse() : [...polygon];
}
export function polygonArea(polygon: readonly Point[]): number {
  return Math.abs(signedArea(polygon));
}
export function polygonCentroid(polygon: readonly Point[]): Point {
  let x = 0, z = 0, area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const w = a.x * b.z - b.x * a.z;
    area += w;
    x += (a.x + b.x) * w;
    z += (a.z + b.z) * w;
  }
  if (Math.abs(area) < 1e-9) {
    const n = polygon.length || 1;
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      z: polygon.reduce((s, p) => s + p.z, 0) / n,
    };
  }
  return { x: x / (3 * area), z: z / (3 * area) };
}
export function polygonPerimeter(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) sum += distance2d(polygon[i], polygon[(i + 1) % polygon.length]);
  return sum;
}
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export function polygonBounds(polygon: readonly Point[]): Bounds {
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of polygon) {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }
  return bounds;
}

/**
 * Sutherland–Hodgman clip against the left side of the directed line a→b.
 * Used for convex clipping (blocks against corridors/district limits) and for
 * half-plane insets, which produce exact mitred corners for free.
 */
export function clipLeft(polygon: readonly Point[], a: Point, b: Point): Point[] {
  const out: Point[] = [];
  const d = sub(b, a);
  const side = (p: Point) => cross(d, sub(p, a));
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push(lerp2(p, q, t));
    }
  }
  return out;
}
export function clipRight(polygon: readonly Point[], a: Point, b: Point): Point[] {
  return clipLeft(polygon, b, a);
}

/** Inward offset of a CCW convex polygon; one distance per edge. */
export function insetConvex(polygon: readonly Point[], distance: number | readonly number[]): Point[] {
  let result = ensureCCW(polygon);
  for (let i = 0; i < result.length && result.length >= 3; i++) {
    const a = result[i], b = result[(i + 1) % result.length];
    const d = typeof distance === 'number' ? distance : distance[i] ?? distance[0];
    if (d <= 0) continue;
    const n = normalize(leftNormal(sub(b, a)));
    result = clipLeft(result, add(a, scale(n, d)), add(b, scale(n, d)));
  }
  return result;
}

export function convexContains(polygon: readonly Point[], p: Point, margin = 0): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (cross(sub(b, a), sub(p, a)) < -margin) return false;
  }
  return true;
}

/** Split a convex polygon by a line into the left and right halves (either may be empty). */
export function splitConvex(polygon: readonly Point[], a: Point, b: Point): [Point[], Point[]] {
  return [clipLeft(polygon, a, b), clipRight(polygon, a, b)];
}

export function lineIntersection(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, scale(d1, t));
}

/**
 * Parameter interval of the ray p + t·d (d unit length) that lies inside a convex
 * polygon. This is how straight grid lines are trimmed to the district footprint:
 * the result is always a single interval because the footprint is convex.
 */
export function convexSpan(polygon: readonly Point[], p: Point, d: Point): { min: number; max: number } | null {
  let min = -Infinity, max = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const n = leftNormal(sub(b, a));
    const den = dot(n, d);
    const num = dot(n, sub(a, p));
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    // dot(n, p + t·d − a) ≥ 0  ⇔  t·den ≥ num, with num = dot(n, a − p)
    const t = num / den;
    if (den > 0) min = Math.max(min, t); else max = Math.min(max, t);
  }
  return max - min > 1e-6 ? { min, max } : null;
}

export function pointToSegment(p: Point, a: Point, b: Point): { distance: number; t: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const den = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / den));
  return { distance: Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz), t };
}

export function distanceToPolygon(polygon: readonly Point[], p: Point): number {
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    nearest = Math.min(nearest, pointToSegment(p, a, b).distance);
  }
  return nearest;
}
export function pointInPolygon(polygon: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
/** Signed distance to a convex polygon boundary: positive inside, metres. */
export function convexSignedDistance(polygon: readonly Point[], p: Point): number {
  const inside = convexContains(polygon, p);
  const d = distanceToPolygon(polygon, p);
  return inside ? d : -d;
}

/** Rotate/scale a local rectangle into world space: the workhorse for building footprints. */
export function rectAt(center: Point, dir: Point, width: number, depth: number): Point[] {
  const u = normalize(dir), v = { x: -u.z, z: u.x };
  const hw = width / 2, hd = depth / 2;
  return [
    { x: center.x - u.x * hw - v.x * hd, z: center.z - u.z * hw - v.z * hd },
    { x: center.x + u.x * hw - v.x * hd, z: center.z + u.z * hw - v.z * hd },
    { x: center.x + u.x * hw + v.x * hd, z: center.z + u.z * hw + v.z * hd },
    { x: center.x - u.x * hw + v.x * hd, z: center.z - u.z * hw + v.z * hd },
  ];
}

/** Regular polygon (used for landmark crowns and plaza features). */
export function regularPolygon(center: Point, radius: number, sides: number, rotation = 0): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius });
  }
  return out;
}

/** Longest edge of a polygon, used to orient footprints and street furniture. */
export function longestEdge(polygon: readonly Point[]): { a: Point; b: Point; length: number; index: number } {
  let best = { a: polygon[0], b: polygon[1] ?? polygon[0], length: -1, index: 0 };
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const l = distance2d(a, b);
    if (l > best.length) best = { a, b, length: l, index: i };
  }
  return best;
}

/** Axis-aligned extent of a polygon along an arbitrary direction (for footprint sizing). */
export function extentAlong(polygon: readonly Point[], center: Point, dir: Point): { min: number; max: number } {
  const u = normalize(dir);
  let min = Infinity, max = -Infinity;
  for (const p of polygon) {
    const t = dot(sub(p, center), u);
    min = Math.min(min, t); max = Math.max(max, t);
  }
  return { min, max };
}
