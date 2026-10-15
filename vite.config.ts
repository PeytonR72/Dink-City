import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: { manifest: true, rollupOptions: { input: { game: resolve('index.html'), controller: resolve('controller.html') } } },
  plugins: [{ name: 'phone-bundle-boundary', generateBundle(_options, bundle) {
    const entry = Object.values(bundle).find(chunk => chunk.type === 'chunk' && chunk.isEntry && chunk.facadeModuleId?.endsWith('/controller.html'));
    if (!entry || entry.type !== 'chunk') this.error('Phone entry missing');
    const visited = new Set<string>();
    const visit = (name: string) => {
      if (visited.has(name)) return; visited.add(name);
      const chunk = bundle[name]; if (!chunk || chunk.type !== 'chunk') return;
      for (const module of Object.keys(chunk.modules)) if (/node_modules[\/](three|tweakpane)|src[\/](main|tuning)\.ts|src[\/]render[\/]/.test(module)) this.error('Phone imported game code: ' + module);
      [...chunk.imports, ...chunk.dynamicImports].forEach(visit);
    };
    visit(entry.fileName);
  } }],
});
