// `?debug` Tweakpane panel over the live tuning objects. Only loaded in dev builds.
import { Pane } from 'tweakpane';
import type { SimTuning } from '../sim';
import type { ViewTuning } from '../tuning';

export function createDebugPanel(sim: SimTuning, view: ViewTuning) {
  const pane = new Pane({ title: 'Tuning' });

  const v = pane.addFolder({ title: 'View' });
  v.addBinding(view, 'gameSpeed', { min: 0.3, max: 1.5, step: 0.05 });
  v.addBinding(view, 'fov', { min: 20, max: 70, step: 1 });
  v.addBinding(view, 'cameraHeight', { min: 3, max: 25, step: 0.1 });
  v.addBinding(view, 'cameraDistance', { min: 5, max: 30, step: 0.1 });
  v.addBinding(view, 'lookAtZ', { min: -8, max: 4, step: 0.1 });
  v.addBinding(view, 'cameraFollowX', { min: 0, max: 1, step: 0.05 });
  v.addBinding(view, 'ballScale', { min: 1, max: 3, step: 0.1 });
  v.addBinding(view, 'trailLength', { min: 0, max: 16, step: 1 });
  v.addBinding(view, 'hitStopMs', { min: 0, max: 150, step: 5 });
  v.addBinding(view, 'hitStopSpeed', { min: 5, max: 30, step: 0.5 });
  v.addBinding(view, 'volume', { min: 0, max: 1, step: 0.05 });

  const p = pane.addFolder({ title: 'Physics', expanded: false });
  p.addBinding(sim, 'gravity', { min: 5, max: 15 });
  p.addBinding(sim, 'drag', { min: 0, max: 0.08, step: 0.001 });
  p.addBinding(sim, 'magnus', { min: 0, max: 1 });
  p.addBinding(sim, 'restitution', { min: 0.3, max: 0.9 });
  p.addBinding(sim, 'bounceFriction', { min: 0.4, max: 1 });
  p.addBinding(sim, 'spinKick', { min: 0, max: 0.4 });

  const pl = pane.addFolder({ title: 'Player', expanded: false });
  pl.addBinding(sim, 'playerSpeed', { min: 2, max: 10 });
  pl.addBinding(sim, 'playerAccel', { min: 5, max: 80 });
  pl.addBinding(sim, 'reachForward', { min: 0.3, max: 2 });
  pl.addBinding(sim, 'reachSide', { min: 0.3, max: 2 });
  pl.addBinding(sim, 'reachBack', { min: 0, max: 1.5 });
  pl.addBinding(sim, 'reachHeight', { min: 1.5, max: 3 });
  pl.addBinding(sim, 'sweetSpotSide', { min: -0.8, max: 0.8 });
  pl.addBinding(sim, 'sweetSpotForward', { min: 0, max: 1.2 });
  pl.addBinding(sim, 'sweetRadius', { min: 0, max: 1 });
  pl.addBinding(sim, 'edgeQuality', { min: 0, max: 1 });
  pl.addBinding(sim, 'assistRange', { min: 0, max: 2 });
  pl.addBinding(sim, 'assistSpeed', { min: 0, max: 6 });
  pl.addBinding(sim, 'footRadius', { min: 0, max: 0.4 });
  pl.addBinding(sim, 'moveAimError', { min: 0, max: 3 });
  pl.addBinding(sim, 'softOverhit', { min: 0, max: 2 });
  pl.addBinding(sim, 'softPerfectRadius', { min: 0, max: 0.45 });
  pl.addBinding(sim, 'smashHeight', { min: 1, max: 2.5 });
  pl.addBinding(sim, 'smashSpeed', { min: 10, max: 35 });

  const q = pane.addFolder({ title: 'Shot quality', expanded: false });
  q.addBinding(sim, 'commitFullFraction', { min: 0, max: 1, step: 0.05 });
  q.addBinding(sim, 'commitRushedFraction', { min: 0, max: 1, step: 0.05 });
  q.addBinding(sim, 'rushedQuality', { min: 0, max: 1, step: 0.05 });
  q.addBinding(sim, 'lowContactHeight', { min: 0.05, max: 1, step: 0.05 });
  q.addBinding(sim, 'lowContactQuality', { min: 0, max: 1, step: 0.05 });
  q.addBinding(sim, 'paceStart', { min: 0, max: 25, step: 0.5 });
  q.addBinding(sim, 'paceFull', { min: 0, max: 30, step: 0.5 });
  q.addBinding(sim, 'paceQuality', { min: 0, max: 1, step: 0.05 });
  q.addBinding(sim, 'qualityAimError', { min: 0, max: 3, step: 0.05 });
  q.addBinding(sim, 'dinkZone', { min: 0, max: 4.6, step: 0.1 });
  q.addBinding(sim, 'blockSpeed', { min: 5, max: 25, step: 0.5 });

  const shots = pane.addFolder({ title: 'Shots', expanded: false });
  for (const [name, s] of [...Object.entries(sim.shots), ...Object.entries(sim.serves).map(([k, v]) => [`serve ${k}`, v] as const)]) {
    const f = shots.addFolder({ title: name, expanded: false });
    f.addBinding(s, 'depth', { min: 0.3, max: 6.7 });
    f.addBinding(s, 'depthRange', { min: 0, max: 3 });
    f.addBinding(s, 'apex', { min: 0.9, max: 8 });
    f.addBinding(s, 'apexPerMeter', { min: 0, max: 0.5 });
    f.addBinding(s, 'spin', { min: -1, max: 1 });
    f.addBinding(s, 'width', { min: 0, max: 3 });
    f.addBinding(s, 'weakApex', { min: 0, max: 2 });
    f.addBinding(s, 'weakDepth', { min: 0, max: 3 });
  }

  pane.addButton({ title: 'Export to console + clipboard' }).on('click', () => {
    const text = `export const simTuning: SimTuning = ${JSON.stringify(sim, null, 2)};\n\nexport const viewTuning = ${JSON.stringify(view, null, 2)};\n`;
    console.log(text);
    navigator.clipboard?.writeText(text).catch(() => {});
  });

  return pane;
}
