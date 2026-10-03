// Browser checks of the real game: reference screenshots, the performance budget, and online play against a local
// `wrangler dev`. Run: npm run e2e (-- --update-snapshots to accept a deliberate visual change).
import { defineConfig } from '@playwright/test';

const PORT = 5174;
/** The party server for the online tests, apart from `npm run party`'s 8787 so a dev server already up can't clash. */
const PARTY_PORT = 8797;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  timeout: 60_000,
  // One at a time: SwiftShader draws on the CPU, so pages in parallel workers starve each other. Screenshots then time
  // out, and an online Match took nearly twice as long. In parallel the whole run took no less time.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: true,
      env: { VITE_PARTY_HOST: `localhost:${PARTY_PORT}` },
    },
    {
      command: `npm --prefix party run dev -- --port ${PARTY_PORT}`,
      port: PARTY_PORT,
      reuseExistingServer: true,
    },
  ],
});
