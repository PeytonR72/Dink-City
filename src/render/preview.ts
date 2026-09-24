// The locker's live 3D preview: the local Player, idle and slowly turning, on its own small canvas.
import * as THREE from 'three';
import { Character } from './character';
import type { PlayerColors, PlayerParts } from './models';

const IDLE = { velocity: { x: 0, z: 0 }, committed: false, contact: null, swing: null };

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private character: Character;
  private running = false;
  private last = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    parts: PlayerParts,
    colors: PlayerColors,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.character = new Character(parts, colors, material);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-3, 5, 4);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6), sun, this.character.root);
    this.camera.position.set(0, 1.25, 4.4);
    this.camera.lookAt(0, 0.85, 0);
  }

  setColors(colors: PlayerColors) {
    this.character.setColors(colors);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.draw(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
  }

  private draw(dt: number) {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.character.root.rotation.y += dt * 0.8;
    this.character.update(IDLE, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
