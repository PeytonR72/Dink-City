// Renders the Park Venue from art/models/, reading Sim states and interpolating between the last two.
import * as THREE from 'three';
import {
  BALL_RADIUS,
  TICK,
  endOf,
  other,
  predictContact,
  predictLanding,
  worldToLocal,
  type End,
  type ShotVariant,
  type SideIndex,
  type SimEvent,
  type SimState,
  type SimTuning,
  type Vec3,
} from '../sim';
import type { ViewTuning } from '../tuning';
import { Character } from './character';
import { DEFAULT_PLAYER_COLORS, type Models, type PlayerColors } from './models';

const COLORS = {
  line: 0xffffff,
  ball: 0xf4e04d,
  shadow: 0x000000,
  aim: 0xffd23f,
  landing: 0xffd23f,
};

/** Each Side's look: the model's default colors, with these regions changed. */
const LOOKS: Partial<PlayerColors>[] = [
  { shirt: '#ff7a3d' },
  { shirt: '#8a5cf6', hair: '#e0a13a', skin: '#c68a5e', paddle: '#3aa0e8' },
];

/** The Park's lighting: one sun plus a hemisphere light, by day and at sunset. */
const LIGHTING = {
  day: { sky: 0x8fd3ff, hemiSky: 0xffffff, hemiGround: 0x5a7a4a, hemiIntensity: 1.6, sun: 0xfff1d6, sunIntensity: 2.2, sunPos: [-6, 12, 4] },
  sunset: { sky: 0xf4a26b, hemiSky: 0xffd9bf, hemiGround: 0x6b4f63, hemiIntensity: 1.75, sun: 0xffa866, sunIntensity: 2.5, sunPos: [-10, 6, -6] },
} as const;

/** The Side this screen belongs to. */
const LOCAL_SIDE = 0;
const TRAIL_MAX = 16;

interface PlayerView {
  character: Character;
  shadow: THREE.Mesh;
  /** Faint when committed, bright once the move input switches to aim. */
  ring: THREE.Mesh;
  /** Where the last hit was met, in character space. */
  lastHit: { tick: number; pos: THREE.Vector3; variant: ShotVariant } | null;
}

/** Draws extra things each frame (debug overlays). */
export type FrameHook = (prev: SimState, curr: SimState, alpha: number) => void;

export class Renderer {
  readonly camera: THREE.PerspectiveCamera;
  /** Everything on the court. Turned 180° when the local Player is at End 1, so they always appear at the bottom. */
  readonly world = new THREE.Group();
  readonly hooks: FrameHook[] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private landing: THREE.Group;
  private landingTick = -1;
  private trail: THREE.InstancedMesh;
  /** Ball positions of recent Ticks, newest first. */
  private trailPoints: Vec3[] = [];
  private trailTick = -1;
  private players: PlayerView[];
  private cameraX = 0;
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  /** The lighting last applied: sunset or day (null before the first). */
  private appliedSunset: boolean | null = null;
  /** Every model shares one flat-shaded, vertex-colored material (the net gets a see-through copy). */
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  constructor(
    canvas: HTMLCanvasElement,
    private view: ViewTuning,
    private sim: SimTuning,
    models: Models,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color();

    this.camera = new THREE.PerspectiveCamera(view.fov, 1, 0.1, 200);

    this.scene.add(this.hemi, this.sun);
    this.applyLighting();

    this.scene.add(this.world);
    this.buildVenue(models);

    this.ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_RADIUS, 1),
      new THREE.MeshLambertMaterial({ color: COLORS.ball, flatShading: true }),
    );
    this.world.add(this.ball);
    this.ballShadow = blobShadow(BALL_RADIUS * 1.6);
    this.world.add(this.ballShadow);

    this.trail = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(BALL_RADIUS, 0),
      new THREE.MeshBasicMaterial({ color: COLORS.ball, transparent: true, opacity: 0.35, depthWrite: false }),
      TRAIL_MAX,
    );
    this.trail.frustumCulled = false;
    this.world.add(this.trail);

    this.landing = landingMarker();
    this.world.add(this.landing);

    this.players = [0, 1].map((i) => this.buildPlayer(models, { ...DEFAULT_PLAYER_COLORS, ...LOOKS[i] }));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Draw calls and triangles of the last frame, for the performance budget. */
  get stats() {
    const { calls, triangles } = this.renderer.info.render;
    return { calls, triangles };
  }

  /** Records where each hit was met, so the swing's forward stroke goes through the ball. */
  onEvents(s: SimState, events: readonly SimEvent[]) {
    for (const e of events) {
      if (e.kind !== 'hit') continue;
      const player = s.sides[e.side].players[0];
      this.players[e.side].lastHit = { tick: s.tick, pos: toCharacter(endOf(s, e.side), player.pos, e.pos), variant: e.variant };
    }
  }

  render(prev: SimState, curr: SimState, alpha: number, dt: number) {
    const v = this.view;
    this.applyLighting();
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

    this.updateTrail(curr, ballPos);
    this.updateLanding(curr, dt);

    for (const i of [0, 1] as const) {
      const prevPlayer = prev.sides[i].players[0];
      const player = curr.sides[i].players[0];
      const p = lerpVec(prevPlayer.pos, player.pos, alpha);
      const pv = this.players[i];
      const end = endOf(curr, i);
      pv.character.root.position.set(p.x, 0, p.z);
      pv.character.root.rotation.y = end === 0 ? 0 : Math.PI;
      pv.shadow.position.set(p.x, 0.003, p.z);
      pv.character.update(this.pose(prev, curr, i, alpha), dt);

      pv.ring.position.set(p.x, 0.006, p.z);
      pv.ring.visible = i === LOCAL_SIDE && player.commit !== null;
      const ringMat = pv.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(player.aiming ? COLORS.aim : COLORS.line);
      ringMat.opacity = player.aiming ? 0.95 : 0.4;
    }

    for (const hook of this.hooks) hook(prev, curr, alpha);

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

  /** Animation inputs for one Player, from the Sim and its predicted Contact. */
  private pose(prev: SimState, curr: SimState, i: SideIndex, alpha: number) {
    const end = endOf(curr, i);
    const player = curr.sides[i].players[0];
    const prevPos = prev.sides[i].players[0].pos;
    const moved = curr.tick > prev.tick ? { x: (player.pos.x - prevPos.x) / TICK, z: (player.pos.z - prevPos.z) / TICK } : { x: 0, z: 0 };
    // Teleports between points aren't walking.
    const vel = Math.hypot(moved.x, moved.z) > 20 ? { x: 0, z: 0 } : moved;
    const lv = toCharacter(end, { x: 0, y: 0, z: 0 }, { x: vel.x, y: 0, z: vel.z });

    const predicted = player.commit ? predictContact(curr, i, this.sim) : null;
    const hit = this.players[i].lastHit;
    const swingSeconds = hit ? (curr.tick + alpha - hit.tick) * TICK : Infinity;
    return {
      velocity: { x: lv.x, z: lv.z },
      committed: player.commit !== null,
      contact: predicted && {
        seconds: Math.max(0, (predicted.ticks - alpha) * TICK),
        pos: toCharacter(end, player.pos, predicted.pos),
        variant: predicted.variant,
      },
      swing: hit && swingSeconds >= 0 ? { seconds: swingSeconds, pos: hit.pos, variant: hit.variant } : null,
    };
  }

  /** A short trail of the ball's last few Ticks, shrinking with age. */
  private updateTrail(curr: SimState, ballPos: Vec3) {
    const inPlay = curr.phase === 'rally' || curr.phase === 'dead';
    if (!inPlay) this.trailPoints = [];
    else if (curr.tick !== this.trailTick) {
      this.trailPoints.unshift({ ...curr.ball.pos });
      this.trailPoints.length = Math.min(this.trailPoints.length, this.view.trailLength);
    }
    this.trailTick = curr.tick;
    const m = new THREE.Matrix4();
    let n = 0;
    const speed = Math.hypot(curr.ball.vel.x, curr.ball.vel.y, curr.ball.vel.z);
    // Only a moving ball leaves a trail; skip the newest point, which the ball itself covers.
    if (speed > 3) {
      for (let j = 1; j < this.trailPoints.length && n < TRAIL_MAX; j++) {
        const p = this.trailPoints[j];
        if (Math.hypot(p.x - ballPos.x, p.y - ballPos.y, p.z - ballPos.z) > 3) break;
        const scale = this.view.ballScale * (1 - j / (this.view.trailLength + 1)) * 0.9;
        m.makeScale(scale, scale, scale).setPosition(p.x, p.y, p.z);
        this.trail.setMatrixAt(n++, m);
      }
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
  }

  /** Marks where the opponent's shot (or Serve) will land. */
  private updateLanding(curr: SimState, dt: number) {
    const { ball } = curr;
    const incoming = curr.phase === 'rally' && ball.lastHitBy === other(LOCAL_SIDE) && ball.bouncesSinceHit === 0;
    if (!incoming) {
      this.landing.visible = false;
      return;
    }
    if (curr.tick !== this.landingTick) {
      this.landingTick = curr.tick;
      const at = predictLanding(ball, this.sim);
      this.landing.visible = at !== null;
      if (at) this.landing.position.set(at.x, 0.008, at.z);
    }
    this.landing.rotation.y += dt * 2;
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 90);
    this.landing.scale.setScalar(pulse);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Day or sunset lighting, following `view.sunset`. */
  private applyLighting() {
    if (this.appliedSunset === this.view.sunset) return;
    this.appliedSunset = this.view.sunset;
    const l = this.appliedSunset ? LIGHTING.sunset : LIGHTING.day;
    (this.scene.background as THREE.Color).setHex(l.sky);
    this.hemi.color.setHex(l.hemiSky);
    this.hemi.groundColor.setHex(l.hemiGround);
    this.hemi.intensity = l.hemiIntensity;
    this.sun.color.setHex(l.sun);
    this.sun.intensity = l.sunIntensity;
    this.sun.position.set(l.sunPos[0], l.sunPos[1], l.sunPos[2]);
  }

  /** The Park, court, net and posts, all from art/models/. */
  private buildVenue(models: Models) {
    for (const model of [models.park, models.court, models.netFrame]) {
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = this.material;
      });
      this.world.add(model);
    }
    models.net.material = Object.assign(this.material.clone(), { transparent: true, opacity: 0.72 });
    this.world.add(models.net);
  }

  private buildPlayer(models: Models, colors: PlayerColors): PlayerView {
    const character = new Character(models.player, colors, this.material);
    const shadow = blobShadow(0.38);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.66, 32),
      new THREE.MeshBasicMaterial({ color: COLORS.line, transparent: true, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.world.add(character.root, shadow, ring);
    return { character, shadow, ring, lastHit: null };
  }
}

/** A world point relative to a Player's feet, in character space (right = +x, forward = -z). */
function toCharacter(end: End, feet: Vec3, p: Vec3): THREE.Vector3 {
  const l = worldToLocal(end, p.x - feet.x, p.z - feet.z);
  return new THREE.Vector3(l.x, p.y, -l.y);
}

function landingMarker(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: COLORS.landing, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), m);
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  for (const r of [0, Math.PI / 2]) {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.035), m);
    tick.rotation.set(-Math.PI / 2, 0, r);
    g.add(tick);
  }
  g.visible = false;
  return g;
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
