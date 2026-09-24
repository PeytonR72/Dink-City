// Graybox renderer. Reads Sim states and interpolates between the last two.
import * as THREE from 'three';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  KITCHEN_DEPTH,
  NET_POST_X,
  TICK,
  endOf,
  netHeight,
  type Player,
  type SimState,
  type Vec3,
} from '../sim';
import type { ViewTuning } from '../tuning';

const COLORS = {
  sky: 0x8fd3ff,
  ground: 0x7cc05a,
  apron: 0x3f8f5a,
  court: 0x2f6fb8,
  kitchen: 0x4a8fd6,
  line: 0xffffff,
  net: 0x1d2433,
  post: 0x2b2b2b,
  ball: 0xf4e04d,
  shadow: 0x000000,
  aim: 0xffd23f,
  sides: [0xff7a3d, 0x8a5cf6],
};

const SWING_SECONDS = 0.3;
/** The Side this screen belongs to. */
const LOCAL_SIDE = 0;

interface PlayerView {
  root: THREE.Group;
  arm: THREE.Group;
  shadow: THREE.Mesh;
  /** Faint when committed, bright once the move input switches to aim. */
  ring: THREE.Mesh;
}

export class Renderer {
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  /** Everything on the court. Turned 180° when the local Player is at End 1, so they always appear at the bottom. */
  private world = new THREE.Group();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private players: PlayerView[];
  private cameraX = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private view: ViewTuning,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(COLORS.sky);

    this.camera = new THREE.PerspectiveCamera(view.fov, 1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-6, 12, 4);
    this.scene.add(sun);

    this.scene.add(this.world);
    this.buildCourt();

    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_RADIUS, 1),
      new THREE.MeshLambertMaterial({ color: COLORS.ball, flatShading: true }),
    );
    this.world.add(this.ball);
    this.ballShadow = blobShadow(BALL_RADIUS * 1.6);
    this.world.add(this.ballShadow);

    this.players = [0, 1].map((i) => this.buildPlayer(COLORS.sides[i]));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  render(prev: SimState, curr: SimState, alpha: number, dt: number) {
    const v = this.view;
    const mirrored = endOf(curr, LOCAL_SIDE) === 1;
    this.world.rotation.y = mirrored ? Math.PI : 0;
    const ballPos = lerpVec(prev.ball.pos, curr.ball.pos, alpha);
    this.ball.position.set(ballPos.x, ballPos.y, ballPos.z);
    this.ball.scale.setScalar(v.ballScale);

    const h = Math.max(0, ballPos.y - BALL_RADIUS);
    const k = Math.min(h / v.shadowMaxHeight, 1);
    this.ballShadow.position.set(ballPos.x, 0.004, ballPos.z);
    this.ballShadow.scale.setScalar(v.ballScale * (1 + k * 1.2));
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k * 0.75);

    for (const i of [0, 1] as const) {
      const p = lerpVec(prev.sides[i].players[0].pos, curr.sides[i].players[0].pos, alpha);
      const pv = this.players[i];
      pv.root.position.set(p.x, 0, p.z);
      pv.root.rotation.y = endOf(curr, i) === 0 ? 0 : Math.PI;
      pv.shadow.position.set(p.x, 0.003, p.z);
      const player = curr.sides[i].players[0];
      pv.arm.rotation.y = swingAngle(player, curr.tick + alpha);
      pv.ring.position.set(p.x, 0.006, p.z);
      pv.ring.visible = i === LOCAL_SIDE && player.commit !== null;
      const ringMat = pv.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(player.aiming ? COLORS.aim : COLORS.line);
      ringMat.opacity = player.aiming ? 0.95 : 0.4;
    }

    const local = curr.sides[LOCAL_SIDE].players[0].pos;
    const screenX = mirrored ? -local.x : local.x;
    const followK = 1 - Math.exp(-v.cameraDamping * dt);
    this.cameraX += (screenX * v.cameraFollowX - this.cameraX) * followK;
    if (this.camera.fov !== v.fov) {
      this.camera.fov = v.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(this.cameraX, v.cameraHeight, v.cameraDistance);
    this.camera.lookAt(this.cameraX, 0, v.lookAtZ);

    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildCourt() {
    const flat = (w: number, d: number, color: number, y: number, x = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      this.world.add(m);
    };
    flat(80, 80, COLORS.ground, -0.01);
    flat(COURT_WIDTH + 6, COURT_LENGTH + 8, COLORS.apron, 0);
    flat(COURT_WIDTH, COURT_LENGTH, COLORS.court, 0.001);
    flat(COURT_WIDTH, KITCHEN_DEPTH * 2, COLORS.kitchen, 0.0015);

    const LINE = 0.05;
    const line = (w: number, d: number, x: number, z: number) => flat(w, d, COLORS.line, 0.002, x, z);
    for (const s of [-1, 1]) {
      line(LINE, COURT_LENGTH, s * (HALF_WIDTH - LINE / 2), 0); // sidelines
      line(COURT_WIDTH, LINE, 0, s * (HALF_LENGTH - LINE / 2)); // baselines
      line(COURT_WIDTH, LINE, 0, s * KITCHEN_DEPTH); // kitchen lines
      line(LINE, HALF_LENGTH - KITCHEN_DEPTH, 0, s * (KITCHEN_DEPTH + HALF_LENGTH) / 2); // centerlines
    }

    // Net: a segmented plane whose top edge follows the regulation sag.
    const netGeo = new THREE.PlaneGeometry(NET_POST_X * 2, 1, 24, 1);
    const pos = netGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setY(i, pos.getY(i) > 0 ? netHeight(x) : 0);
    }
    netGeo.computeVertexNormals();
    const net = new THREE.Mesh(
      netGeo,
      new THREE.MeshLambertMaterial({ color: COLORS.net, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.world.add(net);

    const tape = new THREE.MeshLambertMaterial({ color: COLORS.line });
    const SEGMENTS = 12;
    for (let i = 0; i < SEGMENTS; i++) {
      const x0 = -NET_POST_X + (i * 2 * NET_POST_X) / SEGMENTS;
      const x1 = x0 + (2 * NET_POST_X) / SEGMENTS;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.03), tape);
      seg.position.set((x0 + x1) / 2, netHeight((x0 + x1) / 2) - 0.02, 0);
      this.world.add(seg);
    }

    const postMat = new THREE.MeshLambertMaterial({ color: COLORS.post });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), postMat);
      post.position.set(s * NET_POST_X, 0.475, 0);
      this.world.add(post);
    }
  }

  private buildPlayer(color: number): PlayerView {
    const root = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color, flatShading: true });
    const skin = new THREE.MeshLambertMaterial({ color: 0xf2c29b, flatShading: true });

    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };
    root.add(box(0.45, 0.8, 0.28, body, 0, 0.45 + 0.4, 0)); // legs + torso block
    root.add(box(0.5, 0.55, 0.3, body, 0, 1.12, 0));
    root.add(box(0.36, 0.36, 0.36, skin, 0, 1.6, 0));

    // Right arm pivots at the shoulder; the paddle hangs off the hand.
    const arm = new THREE.Group();
    arm.position.set(0.3, 1.3, 0);
    arm.add(box(0.12, 0.12, 0.55, skin, 0.05, -0.25, -0.15));
    arm.add(box(0.2, 0.26, 0.03, new THREE.MeshLambertMaterial({ color: 0x222831 }), 0.1, -0.35, -0.5));
    root.add(arm);

    const shadow = blobShadow(0.38);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.66, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.line, transparent: true, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.world.add(root, shadow, ring);
    return { root, arm, shadow, ring };
  }
}

function swingAngle(player: Player, tick: number): number {
  const READY = 0.6;
  if (!player.swing) return READY;
  const t = ((tick - player.swing.tick) * TICK) / SWING_SECONDS;
  if (t < 0 || t > 1) return READY;
  // Fast forward swing, slower return.
  return t < 0.35 ? READY - (t / 0.35) * 1.8 : READY - 1.8 * (1 - (t - 0.35) / 0.65);
}

function blobShadow(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  // Snap on teleports (resets between points) instead of sliding across the court.
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 2) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
