/**
 * Procedural textures for the district. Everything is drawn at runtime from the same
 * palette as the terrain: facade modules per architectural family, a signage atlas for
 * shopfronts, and small tiling detail maps for asphalt and roofs.
 *
 * Facade textures are authored as seamless modules (two bays by four floors) and repeated
 * per building by its UV scale, so a 6 m shop and a 290 m tower share one material.
 */
import * as THREE from 'three';
import { FACADE_STYLES, TENANTS, type FacadeFamily, type FacadeStyle } from './identity';

const BAY_PX = 20;   // pixels per metre across the facade
const FLOOR_PX = 20;

function canvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  return { canvas: element, ctx: element.getContext('2d')! };
}
function css(rgb: readonly [number, number, number], factor = 1): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, n * factor)) * 255);
  return `rgb(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])})`;
}

function makeFacade(style: FacadeStyle): THREE.Texture {
  const bays = 2, floors = 4;
  const width = Math.round(bays * style.bay * BAY_PX);
  const height = Math.round(floors * style.floor * FLOOR_PX);
  const { canvas: element, ctx } = canvas(width, height);
  ctx.fillStyle = css(style.tint);
  ctx.fillRect(0, 0, width, height);

  const bayW = width / bays, floorH = height / floors;
  const glass = css(style.glass);
  const trim = css(style.trim);
  const shade = (n: number) => css(style.tint, .82 + n * .18);

  for (let f = 0; f < floors; f++) {
    const top = f * floorH;
    for (let b = 0; b < bays; b++) {
      const left = b * bayW;
      const inset = style.detail === 'punched' ? bayW * .16 : bayW * .05;
      const sill = style.detail === 'punched' ? floorH * .2 : floorH * .16;
      const w = bayW - inset * 2;
      const h = floorH - sill - (style.detail === 'ribbon' ? floorH * .28 : floorH * .2);
      const x = left + inset, y = top + (style.detail === 'ribbon' ? floorH * .16 : floorH * .14);

      // Glass: a vertical gradient reads as reflection without a cube map.
      const gradient = ctx.createLinearGradient(x, y, x + w * .7, y + h);
      gradient.addColorStop(0, glass);
      gradient.addColorStop(.55, css(style.glass, 1.28));
      gradient.addColorStop(1, css(style.glass, .74));
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, w, h);

      switch (style.detail) {
        case 'curtain': {
          ctx.strokeStyle = css(style.trim, .95);
          ctx.lineWidth = Math.max(1, BAY_PX * .1);
          ctx.strokeRect(x, y, w, h);
          ctx.beginPath();
          ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h);
          ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2);
          ctx.strokeStyle = css(style.trim, .8);
          ctx.lineWidth = Math.max(1, BAY_PX * .07);
          ctx.stroke();
          break;
        }
        case 'ribbon': {
          // Continuous horizontal glazing with a spandrel band below.
          ctx.fillStyle = shade(f % 2 ? 1 : .95);
          ctx.fillRect(left, top + floorH - floorH * .17, bayW, floorH * .17);
          ctx.fillStyle = css(style.trim, 1.05);
          ctx.fillRect(left, top, bayW, Math.max(1, floorH * .05));
          break;
        }
        case 'punched': {
          ctx.strokeStyle = shade(1.05);
          ctx.lineWidth = Math.max(1, BAY_PX * .12);
          ctx.strokeRect(x - inset * .5, y - inset * .5, w + inset, h + inset);
          ctx.fillStyle = css(style.trim, 1.02);
          ctx.fillRect(x - inset * .6, y + h + inset * .2, w + inset * 1.2, Math.max(1, floorH * .05));
          break;
        }
        case 'balcony': {
          ctx.fillStyle = css(style.trim, 1.04);
          ctx.fillRect(x - inset * .4, y + h, w + inset * .8, Math.max(2, floorH * .07));
          ctx.fillStyle = 'rgba(0,0,0,.22)';
          ctx.fillRect(x, y + h, w, Math.max(1, floorH * .03));
          ctx.strokeStyle = 'rgba(0,0,0,.18)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
          break;
        }
        case 'slat': {
          // Open parking deck: dark void behind a horizontal screen.
          ctx.fillStyle = 'rgba(12,14,15,.92)';
          ctx.fillRect(x, y, w, h);
          ctx.fillStyle = css(style.trim, 1.02);
          for (let s = 0; s < 3; s++) {
            ctx.fillRect(x, y + h * (s + 1) / 3.4, w, Math.max(1, h * .06));
          }
          break;
        }
        default: {
          ctx.strokeStyle = 'rgba(0,0,0,.10)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
        }
      }
    }
    // Floor line and a little soot at the base of each floor.
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    ctx.fillRect(0, top, width, Math.max(1, floorH * .035));
  }
  // Vertical panel joints between bays keep large walls from looking flat.
  ctx.fillStyle = 'rgba(0,0,0,.055)';
  for (let b = 1; b < bays; b++) ctx.fillRect(b * bayW - 1, 0, 2, height);

  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Shop signs: an atlas of invented names, each tile mapped to one sign board. */
export const SIGN_ATLAS = { columns: 4, rows: 8, tileWidth: 256, tileHeight: 128 } as const;

function makeSignage(): { texture: THREE.Texture; names: string[] } {
  const { columns, rows, tileWidth, tileHeight } = SIGN_ATLAS;
  const { canvas: element, ctx } = canvas(columns * tileWidth, rows * tileHeight);
  const palette: [string, string][] = [
    ['#1d3b47', '#f3e6c8'], ['#7c2f2f', '#f7e7cf'], ['#20402c', '#eef3e2'],
    ['#2b2b33', '#f6d68a'], ['#8a5a1f', '#fff2d6'], ['#16323c', '#9fd8c8'],
    ['#3d2a44', '#f0d9c0'], ['#5a2020', '#ffe9b8'], ['#243a2c', '#d9ecc8'],
    ['#333a45', '#ffd9a1'], ['#6b3f1d', '#ffeccd'], ['#1b2c3a', '#bfe0ef'],
  ];
  const names: string[] = [];
  const pool = [
    ...TENANTS.bank, ...TENANTS.cafe, ...TENANTS.restaurant, ...TENANTS.retail,
    ...TENANTS.market, ...TENANTS.service, ...TENANTS.office, ...TENANTS.civic,
    ...TENANTS.hotel, ...TENANTS.culture,
  ];
  for (let index = 0; index < columns * rows; index++) {
    const column = index % columns, row = Math.floor(index / columns);
    const x = column * tileWidth, y = row * tileHeight;
    const [background, ink] = palette[index % palette.length];
    ctx.fillStyle = background;
    ctx.fillRect(x, y, tileWidth, tileHeight);
    // Fascia detail: a rule, a border and, for some tiles, a mark instead of a name.
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 6, y + 6, tileWidth - 12, tileHeight - 12);
    const name = pool[index % pool.length];
    names.push(name);
    if (index % 7 === 3) {
      // Purely graphic sign: concentric marks instead of lettering.
      ctx.fillStyle = ink;
      const cx = x + tileWidth / 2, cy = y + tileHeight / 2;
      for (let r = 3; r >= 1; r--) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 11, 0, Math.PI * 2);
        ctx.fillStyle = r % 2 ? ink : background;
        ctx.fill();
      }
      continue;
    }
    ctx.fillStyle = ink;
    const text = name.toUpperCase();
    let size = 40;
    ctx.font = `700 ${size}px "DM Sans", sans-serif`;
    while (ctx.measureText(text).width > tileWidth - 40 && size > 12) {
      size -= 2;
      ctx.font = `700 ${size}px "DM Sans", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + tileWidth / 2, y + tileHeight / 2 - 6);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(x + tileWidth / 2 - 26, y + tileHeight / 2 + 20, 52, 3);
  }
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, names };
}

/** Tiling grain used by every hard surface, so asphalt is not a flat colour. */
function makeGrain(base: string, speck: string, density: number): THREE.Texture {
  const size = 128;
  const { canvas: element, ctx } = canvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * density; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const shade = Math.random();
    ctx.fillStyle = shade > .5 ? speck : 'rgba(255,255,255,.05)';
    ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeRoof(): THREE.Texture {
  const size = 128;
  const { canvas: element, ctx } = canvas(size, size);
  ctx.fillStyle = '#4a4d4a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const value = 90 + Math.random() * 70;
    ctx.fillStyle = `rgba(${value},${value},${value - 6},.5)`;
    ctx.fillRect(x, y, 2, 2);
  }
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export type CityTextures = {
  /** Keyed by facade family, not by style. */
  facades: Map<string, THREE.Texture>;
  signage: THREE.Texture | null;
  signNames: readonly string[];
  signAtlas: typeof SIGN_ATLAS;
  asphalt: THREE.Texture | null;
  concrete: THREE.Texture | null;
  paving: THREE.Texture | null;
  roof: THREE.Texture | null;
  dispose(): void;
};

let cache: CityTextures | null = null;

export /**
 * One texture per family, drawn with a neutral base: the building's own tint is applied
 * per vertex, so a blue and a bronze curtain wall share a material.
 */
function familyTexture(family: FacadeFamily): THREE.Texture {
  const representative = FACADE_STYLES.find(style => style.family === family) ?? FACADE_STYLES[0];
  return makeFacade({
    ...representative,
    tint: [.78, .78, .77],
    glass: [.52, .57, .60],
    trim: [.86, .86, .84],
  });
}

export function cityTextures(): CityTextures {
  if (cache) return cache;
  if (typeof document === 'undefined') {
    // Headless generation (tests, audits) needs geometry, not pixels.
    cache = {
      facades: new Map(), signage: null, signNames: [], signAtlas: SIGN_ATLAS,
      asphalt: null, concrete: null, paving: null, roof: null, dispose() { /* nothing */ },
    };
    return cache;
  }
  const facades = new Map<string, THREE.Texture>();
  for (const family of new Set(FACADE_STYLES.map(style => style.family))) {
    facades.set(family, familyTexture(family));
  }
  const signage = makeSignage();
  const textures: CityTextures = {
    facades,
    signage: signage.texture,
    signNames: signage.names,
    signAtlas: SIGN_ATLAS,
    asphalt: makeGrain('#43474a', 'rgba(255,255,255,.10)', .06),
    concrete: makeGrain('#8d8c85', 'rgba(0,0,0,.10)', .05),
    paving: makeGrain('#9a9084', 'rgba(0,0,0,.12)', .05),
    roof: makeRoof(),
    dispose() {
      for (const texture of facades.values()) texture.dispose();
      signage.texture.dispose();
      for (const texture of [this.asphalt, this.concrete, this.paving, this.roof]) texture?.dispose();
    },
  };
  cache = textures;
  return textures;
}

/** UV scale for a facade panel of a given size, in the module grid of its style. */
export function facadeUVScale(style: FacadeStyle, width: number, height: number): [number, number] {
  return [Math.max(1, Math.round(width / (style.bay * 2))), Math.max(1, Math.round(height / (style.floor * 4)))];
}
export function signTileUV(index: number, atlas: typeof SIGN_ATLAS): { u0: number; v0: number; u1: number; v1: number } {
  const column = index % atlas.columns, row = Math.floor(index / atlas.columns);
  return {
    u0: column / atlas.columns,
    u1: (column + 1) / atlas.columns,
    v0: 1 - (row + 1) / atlas.rows,
    v1: 1 - row / atlas.rows,
  };
}
