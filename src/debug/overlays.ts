// `?debug` overlays: predicted landing, contact zone, Shot quality, Bot intent. Dev builds only.
import * as THREE from 'three';
import type { Bot } from '../bot/bot';
import { endOf, predictLanding, type SideIndex, type SimEvent, type SimState, type SimTuning } from '../sim';
import type { Renderer } from '../render/renderer';

type Hit = Extract<SimEvent, { kind: 'hit' }>;

export function createOverlays(renderer: Renderer, sim: SimTuning, getBot: () => Bot) {
  const world = renderer.world;
  const line = (color: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });

  // Predicted landing of any ball in flight.
  const landing = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.13, 20), new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthWrite: false }));
  landing.rotation.x = -Math.PI / 2;
  world.add(landing);

  // Contact zone per Player: the reach oval, and the full-quality area around the sweet spot.
  const zones = [0, 1].map(() => {
    const g = new THREE.Group();
    const oval: THREE.Vector3[] = [];
    const sweet: THREE.Vector3[] = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const forward = Math.sin(a) >= 0 ? sim.reachForward : sim.reachBack;
      oval.push(new THREE.Vector3(Math.cos(a) * sim.reachSide, 0.01, -Math.sin(a) * forward));
      sweet.push(
        new THREE.Vector3(
          sim.sweetSpotSide + Math.cos(a) * sim.sweetRadius * sim.reachSide,
          0.01,
          -(sim.sweetSpotForward + Math.sin(a) * sim.sweetRadius * (Math.sin(a) >= 0 ? sim.reachForward - sim.sweetSpotForward : sim.sweetSpotForward + sim.reachBack)),
        ),
      );
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(oval), line(0xffffff)));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(sweet), line(0x7cff6b)));
    world.add(g);
    return g;
  });

  // Bot plan: a line to where it's heading, and a dot where it plans to meet the ball.
  const botPath = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), line(0xff4fd8));
  const botContact = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff4fd8 }));
  world.add(botPath, botContact);

  const panel = document.createElement('pre');
  panel.style.cssText =
    'position:fixed;left:12px;bottom:12px;margin:0;padding:8px 10px;background:rgba(10,15,25,.7);color:#e8f0ff;font:12px/1.4 ui-monospace,monospace;border-radius:8px;pointer-events:none;white-space:pre';
  document.body.append(panel);
  const lastHits: (Hit | null)[] = [null, null];

  renderer.hooks.push((_prev: SimState, curr: SimState) => {
    for (const e of curr.events) if (e.kind === 'hit') lastHits[e.side] = e;

    const at = curr.phase === 'rally' ? predictLanding(curr.ball, sim) : null;
    landing.visible = at !== null;
    if (at) landing.position.set(at.x, 0.012, at.z);

    for (const i of [0, 1] as const) {
      const p = curr.sides[i].players[0].pos;
      zones[i].position.set(p.x, 0, p.z);
      zones[i].rotation.y = endOf(curr, i) === 0 ? 0 : Math.PI;
    }

    const bot = getBot().plan;
    const me = curr.sides[1].players[0].pos;
    botPath.visible = bot.spot !== null;
    if (bot.spot) botPath.geometry.setFromPoints([new THREE.Vector3(me.x, 0.02, me.z), new THREE.Vector3(bot.spot.x, 0.02, bot.spot.z)]);
    botContact.visible = bot.contact !== null;
    if (bot.contact) botContact.position.set(bot.contact.x, bot.contact.y, bot.contact.z);

    const names = ['You', 'Bot'];
    panel.textContent = [
      ...([0, 1] as SideIndex[]).map((i) => `${names[i]}: ${describe(lastHits[i])}`),
      `Bot plan: ${bot.leave ? 'leave it (reads out)' : (bot.shot ?? '—')}`,
    ].join('\n');
  });
}

function describe(h: Hit | null): string {
  if (!h) return '—';
  const f = h.factors;
  const n = (v: number) => v.toFixed(2);
  return `${h.variant}${h.volley ? ' volley' : ''}  q ${n(h.quality)}  (set ${n(f.set)} timing ${n(f.timing)} height ${n(f.height)} pace ${n(f.pace)})  ${h.speed.toFixed(1)} m/s`;
}
