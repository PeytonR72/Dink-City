// Browser checks of the real game: reference screenshots and the performance budget. Run: npm run e2e
// (-- --update-snapshots to accept a deliberate visual change).
import { defineConfig } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.e2e\.ts/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
  },
});
