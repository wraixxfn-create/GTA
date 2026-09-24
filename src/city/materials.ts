/**
 * The district's material library. Materials are shared by every tile, so streaming a
 * block costs geometry only — no shader compiles, no texture uploads after the first frame.
 */
import * as THREE from 'three';
import { FACADE_STYLES, type FacadeFamily, type FacadeStyleId } from './identity';
import { facadeStyle } from './identity';
import { cityTextures } from './textures';

export type CityMaterials = {
  facade: Map<FacadeFamily, THREE.Material>;
  roof: THREE.Material;
  hard: THREE.Material;
  green: THREE.Material;
  paint: THREE.Material;
  signage: THREE.Material;
  glass: THREE.Material;
  trim: THREE.Material;
  massing: THREE.Material;
  prop: THREE.Material;
  debug: Record<'road' | 'footway' | 'crossing' | 'parking' | 'transit', THREE.Material>;
  dispose(): void;
};

let cache: CityMaterials | null = null;

export function cityMaterials(): CityMaterials {
  if (cache) return cache;
  const textures = cityTextures();
  const facade = new Map<FacadeFamily, THREE.Material>();
  for (const family of new Set(FACADE_STYLES.map(style => style.family))) {
    const style = FACADE_STYLES.find(s => s.family === family)!;
    const map = textures.facades.get(family) ?? null;
    // Curtain-wall towers get a specular highlight; masonry stays matte. Lambert has no
    // specular, so those families use Phong and everything else stays on the cheap path.
    facade.set(family, style.detail === 'curtain' || style.detail === 'balcony'
      ? new THREE.MeshPhongMaterial({
        map, vertexColors: true, specular: new THREE.Color(0x7d97a4), shininess: 42,
      })
      : new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  }
  const materials: CityMaterials = {
    facade,
    roof: new THREE.MeshLambertMaterial({ map: textures.roof, vertexColors: true }),
    hard: new THREE.MeshLambertMaterial({ map: textures.asphalt, vertexColors: true }),
    green: new THREE.MeshLambertMaterial({ vertexColors: true }),
    paint: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }),
    signage: new THREE.MeshLambertMaterial({
      map: textures.signage ?? null, vertexColors: true,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: textures.signage ? .22 : 0,
      emissiveMap: textures.signage ?? null,
    }),
    glass: new THREE.MeshPhongMaterial({
      color: 0x1b262c, specular: 0x9fb6c2, shininess: 74, vertexColors: true,
    }),
    trim: new THREE.MeshLambertMaterial({ vertexColors: true }),
    massing: new THREE.MeshLambertMaterial({ vertexColors: true }),
    prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
    debug: {
      road: new THREE.MeshBasicMaterial({ color: 0x2f6fb0, transparent: true, opacity: .55, depthWrite: false }),
      footway: new THREE.MeshBasicMaterial({ color: 0x3fa06a, transparent: true, opacity: .55, depthWrite: false }),
      crossing: new THREE.MeshBasicMaterial({ color: 0xe8c55a, transparent: true, opacity: .7, depthWrite: false }),
      parking: new THREE.MeshBasicMaterial({ color: 0xb45bc0, transparent: true, opacity: .5, depthWrite: false }),
      transit: new THREE.MeshBasicMaterial({ color: 0xd8613c, transparent: true, opacity: .6, depthWrite: false }),
    },
    dispose() {
      for (const material of facade.values()) material.dispose();
      for (const material of [this.roof, this.hard, this.green, this.paint, this.signage,
        this.glass, this.trim, this.massing, this.prop, ...Object.values(this.debug)]) material.dispose();
      cache = null;
    },
  };
  cache = materials;
  return materials;
}

const FAMILIES = new Set<string>(FACADE_STYLES.map(style => style.family));
export function materialFor(key: string): THREE.Material | null {
  const materials = cityMaterials();
  if (key.startsWith('facade:')) {
    const id = key.slice(7);
    const family = (FAMILIES.has(id) ? id : facadeStyle(id as FacadeStyleId).family) as FacadeFamily;
    return materials.facade.get(family) ?? null;
  }
  switch (key) {
    case 'roof': return materials.roof;
    case 'asphalt': case 'stone': return materials.hard;
    case 'green': return materials.green;
    case 'paint': return materials.paint;
    case 'signage': return materials.signage;
    case 'glass': return materials.glass;
    case 'metal': case 'trim': return materials.trim;
    case 'concrete': case 'wood': return materials.massing;
    default: return null;
  }
}
