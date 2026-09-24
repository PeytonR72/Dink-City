// The Venue and Player models, exported from Blender by art/scripts/ (see art/README.md). Models carry
// vertex colors; the Player's also carry a `_region` per vertex (a key of palette.json "player"), so each
// Player can be recolored.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import palette from '../../art/palette.json';
import courtUrl from '../../art/models/court.glb?url';
import equipmentUrl from '../../art/models/equipment.glb?url';
import machineUrl from '../../art/models/machine.glb?url';
import playerUrl from '../../art/models/player.glb?url';

/** The Player's rigid parts, as art/scripts/player.py names them. */
export const PART_NAMES = ['pelvis', 'torso', 'head', 'thigh', 'shin', 'shoe', 'upperArm', 'forearm', 'paddle'] as const;
export type PartName = (typeof PART_NAMES)[number];
export type PlayerParts = Record<PartName, THREE.BufferGeometry>;

/** Recolorable Player regions, in `_region` order. */
export type PlayerColors = typeof palette.player;
export const PLAYER_REGIONS = Object.keys(palette.player) as (keyof PlayerColors)[];
export const DEFAULT_PLAYER_COLORS: PlayerColors = palette.player;

export interface Models {
  player: PlayerParts;
  court: THREE.Object3D;
  /** The see-through net panel. */
  net: THREE.Mesh;
  /** Net tape, cord and posts. */
  netFrame: THREE.Object3D;
  /** Practice mode's ball machine, drawn in place of Side 1's Player. */
  machine: THREE.Object3D;
}

export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const [player, court, equipment, machine] = await Promise.all([playerUrl, courtUrl, equipmentUrl, machineUrl].map((url) => loader.loadAsync(url)));
  return {
    player: readPlayer(player),
    court: court.scene,
    net: equipment.scene.getObjectByName('net') as THREE.Mesh,
    netFrame: equipment.scene.getObjectByName('netFrame')!,
    machine: machine.scene,
  };
}

const surroundings = new Map<string, Promise<THREE.Object3D>>();

/** A Venue's surroundings (one mesh; see art/README.md), loaded once and kept. */
export function loadSurroundings(url: string): Promise<THREE.Object3D> {
  let model = surroundings.get(url);
  if (!model) {
    model = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    // A failed load can be retried.
    model.catch(() => surroundings.delete(url));
    surroundings.set(url, model);
  }
  return model;
}

export function readPlayer(gltf: GLTF): PlayerParts {
  const parts = {} as PlayerParts;
  for (const name of PART_NAMES) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!(mesh instanceof THREE.Mesh)) throw new Error(`player.glb has no mesh named ${name}`);
    parts[name] = mesh.geometry;
  }
  return parts;
}

/** A copy of `source` whose vertex colors come from `colors`, looked up by each vertex's `_region`. */
export function recolor(source: THREE.BufferGeometry, regions: readonly string[], colors: Record<string, string>): THREE.BufferGeometry {
  const geometry = source.clone();
  const region = geometry.getAttribute('_region');
  const color = geometry.getAttribute('color').clone();
  const linear = regions.map((name) => new THREE.Color(colors[name]));
  for (let i = 0; i < region.count; i++) {
    const c = linear[region.getX(i)];
    color.setXYZ(i, c.r, c.g, c.b);
  }
  geometry.setAttribute('color', color);
  return geometry;
}
