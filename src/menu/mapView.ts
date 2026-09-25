// The Dink City map's live 3D view: the tabletop diorama (art/models/map.glb, built by art/scripts/map.py) on its
// own canvas. Drawn only while the menu shows; each frame it keeps the Venues' pins over their spots. The trees
// sway and the sea ripples by moving vertices in the shader, so the idle motion costs no extra draw calls.
import * as THREE from 'three';
import mapUrl from '../../art/models/map.glb?url';
import { loadSurroundings } from '../render/models';
import { VENUE_IDS, type VenueId } from '../venue/venues';
import { REST, easePose, focusPose, type Pose, type Vec3 } from './mapCamera';

// Offsets in the vertex shader, in the model's units (the board is 14 x 8; the ground is at y = 0).
/** Trees and palms bend from the ground up, each at its own phase. */
const SWAY = `
  float bend = position.y * position.y;
  float phase = position.x * 1.9 + position.z * 1.3;
  transformed.x += sin(time * 1.7 + phase) * 0.12 * bend;
  transformed.z += sin(time * 1.3 + phase * 0.7) * 0.07 * bend;
`;
/** Two slow crossing swells, up to 0.008 either way: the sea sits high enough (art/scripts/map.py, SEA_Y). */
const RIPPLE = `
  transformed.y += (sin(position.x * 4.0 + time * 1.4) + sin(position.z * 3.1 - time * 1.1)) * 0.004;
`;

/** Pixels between a pin and the spot it points at: its tail (see .pin in style.css). */
const PIN_GAP = 10;

export class MapView {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 60);
  private pose: Pose = REST;
  private goal: Pose = REST;
  /** Where each Venue's pin points, once the model has loaded. */
  private anchors: Partial<Record<VenueId, THREE.Vector3>> = {};
  private loaded = false;
  /** Seconds of idle motion so far, shared with the shaders. Stays at 0 for players who prefer reduced motion. */
  private time = { value: 0 };
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-6, 12, 5);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6), sun);
    void loadSurroundings(mapUrl).then((model) => this.show(model));
  }

  private show(model: THREE.Object3D) {
    const materials: Record<string, THREE.Material> = { sway: this.moving(SWAY), water: this.moving(RIPPLE) };
    const plain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = materials[o.name] ?? plain;
    });
    for (const id of VENUE_IDS) {
      const pin = model.getObjectByName(`pin_${id}`);
      if (pin) this.anchors[id] = pin.getWorldPosition(new THREE.Vector3());
    }
    this.scene.add(model);
    this.loaded = true;
  }

  /** The map's material with `offset` (GLSL that moves `transformed`) added to its vertex shader. */
  private moving(offset: string): THREE.Material {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.time;
      shader.vertexShader = `uniform float time;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\n${offset}`);
    };
    material.customProgramCacheKey = () => offset;
    return material;
  }

  /** Eases the camera toward a Venue, or back to the whole board. */
  focus(id: VenueId | null) {
    const anchor = id && this.anchors[id];
    this.goal = anchor ? focusPose(anchor.toArray() as unknown as Vec3) : REST;
  }

  /** Draws a frame and moves `pins` over their Venues. */
  draw(dt: number, pins: ReadonlyMap<VenueId, HTMLElement>) {
    if (!this.loaded) return;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.still) this.pose = this.goal;
    else {
      this.time.value += dt;
      this.pose = easePose(this.pose, this.goal, dt);
    }
    this.camera.position.set(...this.pose.position);
    this.camera.lookAt(...this.pose.target);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    // A pin stands above its spot (see .pin in style.css), kept inside the map even when its spot is near an edge.
    // All sizes are read before any position is written, so the layout is worked out once a frame.
    const placed = [...pins].flatMap(([id, el]) => {
      const anchor = this.anchors[id];
      return anchor ? [{ el, spot: anchor.clone().project(this.camera), pw: el.offsetWidth, ph: el.offsetHeight }] : [];
    });
    for (const { el, spot, pw, ph } of placed) {
      const x = ((spot.x + 1) / 2) * w;
      const y = ((1 - spot.y) / 2) * h;
      el.style.left = `${Math.min(Math.max(x, pw / 2), w - pw / 2)}px`;
      el.style.top = `${Math.min(Math.max(y, ph + PIN_GAP), h)}px`;
    }
  }

  /** Draw calls and triangles of the last frame. */
  get stats() {
    const { calls, triangles } = this.renderer.info.render;
    return { calls, triangles };
  }
}
