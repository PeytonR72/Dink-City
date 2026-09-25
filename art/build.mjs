// Rebuilds every model, preview and sound from art/scripts/ with headless Blender.
// Usage: npm run art [-- player court ...]. Set BLENDER to the Blender executable if it isn't the default.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const blender = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
// The Venues render their previews with the court and net, so they go after them; the map reuses the Venues' helpers.
const all = ['player', 'machine', 'equipment', 'court', 'park', 'rooftop', 'beach', 'map', 'ambience'];
const scripts = process.argv.length > 2 ? process.argv.slice(2) : all;

if (!existsSync(blender)) {
  console.error(`Blender not found at ${blender}. Set BLENDER to its path.`);
  process.exit(1);
}
for (const name of scripts) {
  const script = join(root, 'scripts', `${name}.py`);
  const run = spawnSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script], { encoding: 'utf8' });
  const lines = `${run.stdout}${run.stderr}`.split('\n');
  for (const line of lines) if (line.startsWith('[art]') || /Error|Traceback/.test(line)) console.log(line);
  if (run.status !== 0) {
    console.error(`${name}.py failed (exit ${run.status})`);
    process.exit(1);
  }
}
