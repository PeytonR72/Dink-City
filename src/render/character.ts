// Rigid-part placeholder character with procedural walk, ready stance and
// swing. Arms and legs use 2-bone IK. The swing is driven by the Sim's
// predicted Contact tick (ADR-0002): the backswing winds up as Contact nears,
// and the forward swing fires on the actual hit.
//
// Character space: feet at y = 0, forward is -z, right is +x.
import * as THREE from 'three';
import type { ShotVariant } from '../sim';
import { solveTwoBone } from './ik';

const SKIN = 0xf2c29b;
const SHORTS = 0x2b3240;
const PADDLE = 0x222831;
const HAIR = 0x4a2f1f;

const THIGH = 0.42;
const SHIN = 0.42;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const HIP_Y = 0.86;
const HIP_X = 0.12;
const SHOULDER_X = 0.25;
const SHOULDER_Y = 0.52; // above the pelvis
const STRIDE = 0.9;

/** How the swing plays out, per variant: backswing size, and follow-through direction. */
interface SwingShape {
  /** Backswing hand position (forehand side), character space. */
  back: THREE.Vector3;
  /** Follow-through hand position (forehand side), character space. */
  through: THREE.Vector3;
  /** Seconds of wind-up before Contact. */
  windup: number;
}

const SHAPES: Record<ShotVariant, SwingShape> = {
  drive: { back: new THREE.Vector3(0.6, 1.0, 0.35), through: new THREE.Vector3(-0.35, 1.25, -0.35), windup: 0.35 },
  smash: { back: new THREE.Vector3(0.35, 2.0, 0.25), through: new THREE.Vector3(-0.3, 0.75, -0.35), windup: 0.4 },
  lob: { back: new THREE.Vector3(0.5, 0.55, 0.3), through: new THREE.Vector3(0.05, 1.8, -0.35), windup: 0.35 },
  dink: { back: new THREE.Vector3(0.35, 0.6, -0.05), through: new THREE.Vector3(0.1, 0.9, -0.55), windup: 0.25 },
  drop: { back: new THREE.Vector3(0.45, 0.6, 0.15), through: new THREE.Vector3(0.1, 1.1, -0.5), windup: 0.3 },
  block: { back: new THREE.Vector3(0.3, 1.0, -0.2), through: new THREE.Vector3(0.2, 1.05, -0.45), windup: 0.15 },
  serve: { back: new THREE.Vector3(0.45, 0.45, 0.4), through: new THREE.Vector3(0.05, 1.5, -0.5), windup: 0.3 },
};
const READY_HAND = new THREE.Vector3(0.22, 1.0, -0.38);
const READY_OFF_HAND = new THREE.Vector3(-0.08, 0.98, -0.36);
const FORWARD_SECONDS = 0.07;
const FOLLOW_SECONDS = 0.22;
const RECOVER_SECONDS = 0.25;

export interface CharacterPose {
  /** Ground velocity in character space (m/s). */
  velocity: { x: number; z: number };
  committed: boolean;
  /** Seconds until the predicted Contact, and where (character space), when committed. */
  contact: { seconds: number; pos: THREE.Vector3; variant: ShotVariant } | null;
  /** Seconds since the last hit, and where it was met (character space). */
  swing: { seconds: number; pos: THREE.Vector3; variant: ShotVariant } | null;
}

export class Character {
  readonly root = new THREE.Group();
  private pelvis = new THREE.Group();
  private torso = new THREE.Group();
  /** [upper, lower] bone boxes per limb; right first. */
  private legs: [THREE.Mesh, THREE.Mesh][];
  private arms: [THREE.Mesh, THREE.Mesh][];
  private paddle = new THREE.Group();
  private walkPhase = 0;
  private walkBlend = 0;
  /** Smoothed hand targets, so pose changes never snap. */
  private hand = READY_HAND.clone();
  private offHand = READY_OFF_HAND.clone();
  private twist = 0;
  private crouch = 0;

  constructor(color: number) {
    const shirt = mat(color);
    const skin = mat(SKIN);
    const shorts = mat(SHORTS);

    this.root.add(this.pelvis);
    this.pelvis.add(box(0.36, 0.2, 0.22, shorts, 0, 0, 0));
    this.pelvis.add(this.torso);
    this.torso.position.y = 0.08;
    this.torso.add(box(0.44, 0.5, 0.26, shirt, 0, 0.3, 0));
    // A big head: roughly 1:3 head to body.
    const head = new THREE.Group();
    head.position.y = 0.78;
    head.add(box(0.4, 0.4, 0.38, skin, 0, 0.1, 0));
    head.add(box(0.42, 0.14, 0.4, mat(HAIR), 0, 0.28, 0.02));
    this.torso.add(head);

    const limb = (w: number, len: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), m);
      this.root.add(mesh);
      return mesh;
    };
    this.legs = [0, 1].map(() => [limb(0.15, THIGH, shorts), limb(0.13, SHIN, skin)] as [THREE.Mesh, THREE.Mesh]);
    this.arms = [0, 1].map(() => [limb(0.11, UPPER_ARM, shirt), limb(0.1, FOREARM, skin)] as [THREE.Mesh, THREE.Mesh]);

    // The paddle points along +y from the hand (handle in the hand).
    this.paddle.add(box(0.05, 0.14, 0.05, mat(PADDLE), 0, 0.07, 0));
    this.paddle.add(box(0.2, 0.24, 0.03, mat(PADDLE), 0, 0.26, 0));
    this.root.add(this.paddle);
  }

  update(pose: CharacterPose, dt: number) {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);

    // Walk: the feet cycle with distance travelled; blended in by speed.
    const speed = Math.hypot(pose.velocity.x, pose.velocity.z);
    this.walkPhase += (speed * dt * Math.PI * 2) / STRIDE;
    this.walkBlend += (Math.min(1, speed / 2.5) - this.walkBlend) * ease(10);
    const moveDir = speed > 0.05 ? new THREE.Vector3(pose.velocity.x / speed, 0, pose.velocity.z / speed) : new THREE.Vector3();

    // Ready stance: lower when committed.
    this.crouch += ((pose.committed ? 0.12 : 0.06) - this.crouch) * ease(8);
    const bob = this.walkBlend * 0.035 * Math.abs(Math.sin(this.walkPhase));
    const hipY = HIP_Y - this.crouch - bob;
    this.pelvis.position.set(0, hipY, 0);
    // Lean into the run.
    this.pelvis.rotation.set(moveDir.z * 0.18 * this.walkBlend, 0, -moveDir.x * 0.12 * this.walkBlend);

    for (const i of [0, 1] as const) {
      const sideSign = i === 0 ? 1 : -1;
      const phase = this.walkPhase + i * Math.PI;
      const stance = new THREE.Vector3(sideSign * 0.17, 0, i === 0 ? 0.05 : -0.08);
      const step = moveDir.clone().multiplyScalar(Math.sin(phase) * STRIDE * 0.35 * this.walkBlend);
      const lift = Math.max(0, Math.cos(phase)) * 0.14 * this.walkBlend;
      const foot = stance.add(step).setY(0.06 + lift);
      const hip = new THREE.Vector3(sideSign * HIP_X, hipY, 0);
      const { mid, end } = solveTwoBone(hip, foot, THIGH, SHIN, new THREE.Vector3(0, 0, -1));
      placeBone(this.legs[i][0], hip, mid);
      placeBone(this.legs[i][1], mid, end);
    }

    // Swing: pick the hand target from the swing phase.
    const target = READY_HAND.clone();
    const offTarget = READY_OFF_HAND.clone();
    let twist = 0;
    let rate = 12;
    if (pose.swing && pose.swing.seconds < FORWARD_SECONDS + FOLLOW_SECONDS + RECOVER_SECONDS) {
      const { seconds, pos, variant } = pose.swing;
      const shape = mirrored(SHAPES[variant], pos.x);
      const contactHand = handAt(pos);
      if (seconds < FORWARD_SECONDS) {
        target.copy(contactHand);
        rate = 60;
      } else if (seconds < FORWARD_SECONDS + FOLLOW_SECONDS) {
        target.copy(shape.through);
        twist = -0.5 * Math.sign(shape.back.x);
        rate = 22;
      } else {
        rate = 8;
      }
      offTarget.set(-Math.sign(shape.back.x) * 0.35, 1.0, -0.1);
    } else if (pose.contact) {
      const { seconds, pos, variant } = pose.contact;
      const shape = mirrored(SHAPES[variant], pos.x);
      const k = smoothstep(1 - seconds / shape.windup);
      target.lerpVectors(READY_HAND, shape.back, k);
      // Aim the backswing at the ball's height a little, so the swing plane meets it.
      target.y += (handAt(pos).y - target.y) * 0.25 * k;
      twist = 0.55 * Math.sign(shape.back.x) * k;
      offTarget.lerp(new THREE.Vector3(Math.sign(shape.back.x) * -0.25, 1.05, -0.45), k);
      rate = 18;
    }
    this.hand.lerp(target, ease(rate));
    this.offHand.lerp(offTarget, ease(10));
    this.twist += (twist - this.twist) * ease(rate);
    this.torso.rotation.y = this.twist;

    // Arms, from the twisted shoulders.
    const hands = [this.hand, this.offHand];
    for (const i of [0, 1] as const) {
      const sideSign = i === 0 ? 1 : -1;
      const shoulder = new THREE.Vector3(sideSign * SHOULDER_X, 0.08 + SHOULDER_Y, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.twist)
        .add(new THREE.Vector3(0, hipY, 0));
      const pole = new THREE.Vector3(sideSign * 0.6, -1, 0.5);
      const { mid, end } = solveTwoBone(shoulder, hands[i], UPPER_ARM, FOREARM, pole);
      placeBone(this.arms[i][0], shoulder, mid);
      placeBone(this.arms[i][1], mid, end);
      if (i === 0) {
        // The paddle continues the forearm, tipped up a little.
        this.paddle.position.copy(end);
        const along = end.clone().sub(mid).normalize().add(new THREE.Vector3(0, 0.6, 0)).normalize();
        this.paddle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
      }
    }
  }
}

/** Where the hand goes so the paddle face meets a ball at `pos`: a little in from it, toward the body. */
function handAt(pos: THREE.Vector3): THREE.Vector3 {
  const h = pos.clone();
  const inward = new THREE.Vector3(-h.x, 0, -h.z * 0.3);
  if (inward.lengthSq() > 1e-6) h.add(inward.normalize().multiplyScalar(0.25));
  h.y = Math.max(0.35, h.y - 0.15);
  return h;
}

/** Backhand swings are the forehand shape mirrored across the body. */
function mirrored(shape: SwingShape, contactX: number): SwingShape {
  if (contactX >= -0.05) return shape;
  const flip = (v: THREE.Vector3) => new THREE.Vector3(-v.x, v.y, v.z);
  return { ...shape, back: flip(shape.back), through: flip(shape.through) };
}

function smoothstep(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

const UP = new THREE.Vector3(0, 1, 0);

/** Centers a bone box between two joints, its long axis along them. */
function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  const dir = to.clone().sub(from);
  if (dir.lengthSq() > 1e-9) mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

function mat(color: number): THREE.Material {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
