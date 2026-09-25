// The Dink City map's live 3D view: the tabletop diorama (art/models/map.glb, built by art/scripts/map.py) on its
// own canvas. Drawn only while the menu shows; each frame it keeps the Venues' pins over their spots.
import * as THREE from 'three';
import mapUrl from '../../art/models/map.glb?url';
import { loadSurroundings } from '../render/models';
import { VENUE_IDS, type VenueId } from '../venue/venues';
import { REST, easePose, focusPose, type Pose, type Vec3 } from './mapCamera';

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

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-6, 12, 5);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6), sun);
    void loadSurroundings(mapUrl).then((model) => this.show(model));
  }

  private show(model: THREE.Object3D) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = material;
    });
    for (const id of VENUE_IDS) {
      const pin = model.getObjectByName(`pin_${id}`);
      if (pin) this.anchors[id] = pin.getWorldPosition(new THREE.Vector3());
    }
    this.scene.add(model);
    this.loaded = true;
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
    this.pose = easePose(this.pose, this.goal, dt);
    this.camera.position.set(...this.pose.position);
    this.camera.lookAt(...this.pose.target);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);

    const p = new THREE.Vector3();
    for (const [id, el] of pins) {
      const anchor = this.anchors[id];
      if (!anchor) continue;
      p.copy(anchor).project(this.camera);
      el.style.left = `${((p.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - p.y) / 2) * 100}%`;
    }
  }

  /** Draw calls and triangles of the last frame. */
  get stats() {
    const { calls, triangles } = this.renderer.info.render;
    return { calls, triangles };
  }
}
