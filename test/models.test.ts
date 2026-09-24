import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import palette from '../art/palette.json';
import { BONES } from '../src/render/character';
import { PART_NAMES, readPlayer, recolor } from '../src/render/models';

function parse(name: string) {
  const file = readFileSync(new URL(`../art/models/${name}.glb`, import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new GLTFLoader().parseAsync(buffer, '');
}

describe('Player model (art/models/player.glb)', () => {
  it('has every rigid part the character animates, each painted from palette regions', async () => {
    const parts = readPlayer(await parse('player'));
    const regions = Object.keys(palette.player).length;
    for (const name of PART_NAMES) {
      const region = parts[name].getAttribute('_region');
      expect(region, name).toBeDefined();
      for (let i = 0; i < region.count; i++) expect(Number.isInteger(region.getX(i)) && region.getX(i) < regions).toBe(true);
    }
  });

  it('limbs are centered on their bones, which run along +y at the lengths the IK uses', async () => {
    const parts = readPlayer(await parse('player'));
    // A limb spans its bone, give or take a hand or a sleeve.
    for (const [name, length] of Object.entries(BONES) as [keyof typeof BONES, number][]) {
      const box = new THREE.Box3().setFromBufferAttribute(parts[name].getAttribute('position') as THREE.BufferAttribute);
      expect(box.max.y - box.min.y, name).toBeGreaterThan(length - 0.05);
      expect(box.max.y - box.min.y, name).toBeLessThan(length + 0.15);
      expect(Math.abs(box.max.x + box.min.x), name).toBeLessThan(0.02);
    }
  });
});

describe('recolor', () => {
  it('paints each vertex with its region color from the given palette, leaving the source alone', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    source.setAttribute('_region', new THREE.Float32BufferAttribute([0, 1, 1], 1));
    source.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));

    const painted = recolor(source, ['skin', 'shirt'], { skin: '#ffffff', shirt: '#ff0000' });

    const color = painted.getAttribute('color');
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 1, 1]);
    expect([color.getX(1), color.getY(1), color.getZ(1)]).toEqual([1, 0, 0]);
    expect(source.getAttribute('color').getX(0)).toBe(0);
  });
});
