/**
 * A small free-exploration camera for the map checkpoint.
 *
 * Deliberately dependency-free (no OrbitControls, no pointer lock) so it works with a
 * plain drag on a touchpad, a mouse or a finger. It is a *debug* camera: it flies through
 * the generated districts at walking-to-jet speed and never touches the world data, so
 * it can be turned off again and the orbit camera takes over exactly where it left off.
 *
 *   drag / right-drag ........... look around
 *   W A S D / arrows ............ fly forward / left / back / right
 *   Space, Shift+Space .......... rise          C / Ctrl ............ descend
 *   Shift ....................... sprint (x4)
 *   wheel ....................... change fly speed
 */
import * as THREE from 'three';
import { WORLD, type Point } from '../world/data';
import { clamp } from '../world/geometry';

export type FreeFlyOptions = {
  /** Metres per second at "1x". The wheel scales this between a walk and a jet. */
  speed?: number;
  /** Radians per pixel of pointer drag. */
  sensitivity?: number;
};

export class FreeFlyControls {
  enabled = false;
  /** Current travel speed in m/s at 1x; wheel adjusts it. */
  speed: number;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly sensitivity: number;
  private readonly keys = new Set<string>();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();
  private dragging = false;
  private pointerId = -1;
  private readonly detach: (() => void)[] = [];

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, options: FreeFlyOptions = {}) {
    this.camera = camera;
    this.dom = dom;
    this.speed = options.speed ?? 260;
    this.sensitivity = options.sensitivity ?? 0.0028;

    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
      dom.addEventListener(type, handler as EventListener);
      this.detach.push(() => dom.removeEventListener(type, handler as EventListener));
    };

    on('pointerdown', event => {
      if (!this.enabled) return;
      this.dragging = true;
      this.pointerId = event.pointerId;
      try { dom.setPointerCapture(event.pointerId); } catch { /* not all pointers are capturable */ }
      this.keys.clear();
    });
    on('pointermove', event => {
      if (!this.enabled || !this.dragging) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= event.movementX * this.sensitivity;
      this.euler.x = clamp(this.euler.x - event.movementY * this.sensitivity, -Math.PI / 2 + .02, Math.PI / 2 - .02);
      this.camera.quaternion.setFromEuler(this.euler);
    });
    const stop = (event: PointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = -1;
      try { dom.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    };
    on('pointerup', stop);
    on('pointercancel', stop);
    on('wheel', event => {
      if (!this.enabled) return;
      event.preventDefault();
      const step = event.deltaY > 0 ? 1 / 1.22 : 1.22;
      this.speed = clamp(this.speed * step, 12, 9000);
    });

    const down = (event: KeyboardEvent) => {
      if (!this.enabled) return;
      if (event.target instanceof HTMLInputElement || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if ([' ', 'spacebar'].includes(key)) event.preventDefault();
      this.keys.add(key);
    };
    const up = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
    this.detach.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
    );
  }

  /** Adopt the camera's current heading so a mode switch never snaps the view. */
  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.keys.clear();
  }

  reset(): void {
    this.keys.clear();
    this.dragging = false;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }

  private held(...keys: string[]): boolean {
    return keys.some(key => this.keys.has(key));
  }

  update(dt: number): void {
    if (!this.enabled || dt <= 0) return;
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.camera.up).normalize();

    const strafe = Number(this.held('d', 'arrowright')) - Number(this.held('a', 'arrowleft'));
    const thrust = Number(this.held('w', 'arrowup')) - Number(this.held('s', 'arrowdown'));
    const lift = Number(this.held(' ', 'spacebar', 'r')) - Number(this.held('c', 'control'));
    const sprint = this.held('shift') ? 4 : 1;

    this.move.set(0, 0, 0)
      .addScaledVector(this.forward, thrust)
      .addScaledVector(this.right, strafe);
    if (this.move.lengthSq() > 0) this.move.normalize();
    // Strafe/forward stay on the ground plane so flying does not drift into the sky.
    this.move.y = 0;
    if (this.move.lengthSq() > 0) this.move.normalize();
    this.move.y = lift;

    const travelled = this.speed * sprint * dt;
    this.camera.position.addScaledVector(this.move, travelled);

    // Stay inside the authored envelope, and never below sea level.
    this.camera.position.x = clamp(this.camera.position.x, WORLD.minX - 2500, WORLD.maxX + 2500);
    this.camera.position.z = clamp(this.camera.position.z, WORLD.minZ - 2500, WORLD.maxZ + 2500);
    this.camera.position.y = Math.max(4, this.camera.position.y);
  }

  /** Where the camera is looking, flattened — used as the streaming focus while flying. */
  focus(maxDistance = 2400): Point {
    this.camera.getWorldDirection(this.forward);
    const flat = Math.hypot(this.forward.x, this.forward.z) || 1;
    const reach = Math.min(Math.max(120, -this.camera.position.y / (this.forward.y || -1e-4)), maxDistance);
    const scale = this.forward.y < -0.02 ? reach / flat : Math.min(600, maxDistance) / flat;
    return {
      x: clamp(this.camera.position.x + this.forward.x * scale, WORLD.minX, WORLD.maxX),
      z: clamp(this.camera.position.z + this.forward.z * scale, WORLD.minZ, WORLD.maxZ),
    };
  }

  getSpeed(): number { return this.speed; }
}
