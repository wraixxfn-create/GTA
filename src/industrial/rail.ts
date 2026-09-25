/**
 * Rail infrastructure: the Northreach Industrial Line through the flats.
 *
 * One freight corridor enters over the north limit (prepared for a future connection to
 * the eastern regions), runs down the east flank through the Gantry Reach classification
 * yard, and leaves over the south limit aimed at the reserved port — the rail-to-port
 * link is graded and stubbed now so the future port district only has to continue it.
 * Anchored spurs serve the steel works, the freight hub, the container yard and the
 * scrapyard. Rail is data first: corridors carve the plan, tracks draw the ballast, and
 * every road crossing is declared, never inferred.
 */
import type { Point } from '../world/data';
import { indGround, fromGrid, toGrid } from './frame';
import { distance2d, normalize, pointToSegment } from '../city/geometry2d';

export type RailLine = {
  id: string;
  name: string;
  kind: 'main' | 'yard' | 'spur';
  /** Centre-line in world coordinates, sampled every few metres where it curves. */
  points: Point[];
  /** Single track or a pair. */
  double: boolean;
};

export type RailTrack = {
  line: RailLine;
  /** Lateral offset of this track from the line centre-line, metres. */
  offset: number;
};

export type RailStation = {
  id: string;
  name: string;
  point: Point;
  /** Number of platform tracks. */
  tracks: number;
};

/** Corridor half-widths: what the plan carves out of buildable land. */
export const RAIL_CORRIDOR = { main: 30, yard: 118, spur: 22 } as const;

const g = (u: number, v: number): Point => fromGrid(u, v);

/** Resample a polyline so curves carry points every ~18 m. */
function densify(points: readonly Point[], spacing = 18): Point[] {
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = distance2d(a, b);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let s = 1; s <= steps; s++) {
      out.push({ x: a.x + (b.x - a.x) * (s / steps), z: a.z + (b.z - a.z) * (s / steps) });
    }
  }
  return out;
}

export const RAIL_LINES: readonly RailLine[] = [
  {
    id: 'main', name: 'Northreach Industrial Line', kind: 'main', double: false,
    points: densify([
      g(480, -1195), g(505, -950), g(530, -700), g(552, -350), g(560, 0),
      g(566, 260), g(570, 520), g(570, 760), g(572, 900), g(560, 1100),
      g(540, 1250), g(500, 1330), g(465, 1420),
    ]),
  },
  {
    id: 'port-gate', name: 'Port Reach Branch', kind: 'main', double: false,
    points: densify([g(465, 1420), g(448, 1478)]),
  },
  {
    id: 'kilnside-spur', name: 'Kilnside Works Spur', kind: 'spur', double: false,
    points: densify([g(530, -758), g(300, -800), g(60, -838), g(-120, -858)]),
  },
  {
    id: 'scrap-spur', name: 'Brackewater Spur', kind: 'spur', double: false,
    points: densify([g(561, 60), g(660, 30), g(740, 10), g(770, 25)]),
  },
  {
    id: 'hub-spur', name: 'Meridian Hub Stub', kind: 'spur', double: false,
    points: densify([g(565, 382), g(462, 422), g(392, 452)]),
  },
  {
    id: 'marrow-reach-1', name: 'Marrow Reach Track 1', kind: 'spur', double: false,
    points: densify([g(572, 900), g(450, 892), g(330, 884)]),
  },
  {
    id: 'marrow-reach-2', name: 'Marrow Reach Track 2', kind: 'spur', double: false,
    points: densify([g(562, 1080), g(450, 1072), g(330, 1064)]),
  },
];
export const RAIL_BY_ID = new Map(RAIL_LINES.map(l => [l.id, l]));

/** Gantry Reach classification yard: a fan of standing tracks beside the main line. */
export const RAIL_STATIONS: readonly RailStation[] = [
  { id: 'gantry-reach', name: 'Gantry Reach Yard', point: g(560, 400), tracks: 6 },
];

export const YARD_TRACKS: readonly RailTrack[] = (() => {
  const tracks: RailTrack[] = [];
  const main = RAIL_BY_ID.get('main')!;
  for (let i = 0; i < 6; i++) {
    // Each standing track is a segment of the main line shifted east, with a throat taper.
    const offset = -(38 + i * 12); // the line normal points west; the fan lies east
    tracks.push({ line: main, offset });
  }
  return tracks;
})();

/** World-space polyline of a yard track between two arc positions of its line. */
export function yardTrackPoints(track: RailTrack, fromV: number, toV: number): Point[] {
  const out: Point[] = [];
  const pts = track.line.points;
  for (let i = 0; i < pts.length; i++) {
    const gv = toGrid(pts[i]).v;
    if (gv < fromV || gv > toV) continue;
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const prev = pts[Math.max(0, i - 1)];
    const dir = normalize({ x: next.x - prev.x, z: next.z - prev.z });
    const n = { x: -dir.z, z: dir.x };
    // Taper the offset in at both ends so the fan reads as ladder-connected sidings.
    const taper = Math.min(1, Math.min(gv - fromV, toV - gv) / 90);
    const off = track.offset * Math.max(0, taper);
    out.push({ x: pts[i].x + n.x * off, z: pts[i].z + n.z * off });
  }
  return out.length >= 2 ? out : [];
}

export const YARD_TRACK_SPAN = { fromV: 20, toV: 760 } as const;

/* ── corridor geometry ─────────────────────────────────────────────────────────── */

export function lineHalfWidth(line: RailLine): number {
  return line.kind === 'main' ? RAIL_CORRIDOR.main : RAIL_CORRIDOR.spur;
}

/** Signed metres from a point to the nearest rail corridor edge; positive inside. */
export function railCorridorDistance(p: Point): number {
  let best = -Infinity;
  for (const line of RAIL_LINES) {
    const half = lineHalfWidth(line);
    let nearest = Infinity;
    for (let i = 0; i + 1 < line.points.length; i++) {
      nearest = Math.min(nearest, pointToSegment(p, line.points[i], line.points[i + 1]).distance);
    }
    best = Math.max(best, half - nearest);
  }
  // The classification yard keeps its own wide rectangle of land.
  const yard = RAIL_STATIONS[0];
  const gy = toGrid(p);
  const yc = toGrid(yard.point);
  const du = Math.abs(gy.u - yc.u), dv = Math.abs(gy.v - yc.v);
  const inside = Math.min(RAIL_CORRIDOR.yard - du, 330 - dv);
  return Math.max(best, inside);
}

export function nearRail(p: Point, margin = 0): boolean {
  return railCorridorDistance(p) > -margin;
}

/* ── level crossings ───────────────────────────────────────────────────────────── */

export type LevelCrossing = {
  id: string;
  point: Point;
  /** Direction along the rail at the crossing. */
  railDir: Point;
  /** Direction along the road at the crossing. */
  roadDir: Point;
  lineId: string;
  streetId: string;
  /** Barriers and lights on haulways; crossbucks elsewhere. */
  barriers: boolean;
};

/**
 * Crossings are computed once the street plan exists; the plan calls this with its
 * centre-lines so rail and road can never cross without a declared crossing.
 */
export function buildLevelCrossings(
  streets: readonly { id: string; kind: string; width: number; samples: { x: number; z: number; span: number }[]; spans: { min: number; max: number }[] }[],
): LevelCrossing[] {
  const out: LevelCrossing[] = [];
  for (const line of RAIL_LINES) {
    for (let i = 0; i + 1 < line.points.length; i++) {
      const r0 = line.points[i], r1 = line.points[i + 1];
      const rdir = normalize({ x: r1.x - r0.x, z: r1.z - r0.z });
      for (const street of streets) {
        for (let j = 0; j + 1 < street.samples.length; j++) {
          const s0 = street.samples[j], s1 = street.samples[j + 1];
          if (s0.span !== s1.span) continue;
          if (Math.max(r0.x, r1.x) < Math.min(s0.x, s1.x) - 4 || Math.min(r0.x, r1.x) > Math.max(s0.x, s1.x) + 4) continue;
          if (Math.max(r0.z, r1.z) < Math.min(s0.z, s1.z) - 4 || Math.min(r0.z, r1.z) > Math.max(s0.z, s1.z) + 4) continue;
          const sdir = normalize({ x: s1.x - s0.x, z: s1.z - s0.z });
          const den = rdir.x * sdir.z - rdir.z * sdir.x;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((s0.x - r0.x) * sdir.z - (s0.z - r0.z) * sdir.x) / den;
          const s = ((s0.x - r0.x) * rdir.z - (s0.z - r0.z) * rdir.x) / den;
          if (t < -2 || t > distance2d(r0, r1) + 2) continue;
          if (s < -2 || s > distance2d(s0, s1) + 2) continue;
          const point = { x: r0.x + rdir.x * t, z: r0.z + rdir.z * t };
          if (out.some(c => distance2d(c.point, point) < 26)) continue;
          out.push({
            id: `lx-${line.id}-${street.id}-${out.length}`,
            point, railDir: rdir, roadDir: sdir,
            lineId: line.id, streetId: street.id,
            barriers: street.kind === 'haulway' || street.kind === 'collector' || street.kind === 'boulevard' || street.kind === 'arterial',
          });
        }
      }
    }
  }
  return out;
}

/** Rail height follows the graded ground; sleepers sit just proud of it. */
export function railHeight(p: Point): number {
  return indGround(p.x, p.z);
}

/** Total laid track kilometres, for the audit. */
export function railLength(): { corridorKm: number; trackKm: number } {
  let corridorKm = 0;
  for (const line of RAIL_LINES) {
    let len = 0;
    for (let i = 0; i + 1 < line.points.length; i++) len += distance2d(line.points[i], line.points[i + 1]);
    corridorKm += len / 1000;
  }
  let trackKm = corridorKm;
  for (const track of YARD_TRACKS) {
    const pts = yardTrackPoints(track, YARD_TRACK_SPAN.fromV, YARD_TRACK_SPAN.toV);
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += distance2d(pts[i], pts[i + 1]);
    trackKm += len / 1000;
  }
  return { corridorKm, trackKm };
}
