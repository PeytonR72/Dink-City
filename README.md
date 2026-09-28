# Dink City

A 3D browser pickleball singles game against rule-bound bots. Play the live game at [https://dink-city.vercel.app](https://dink-city.vercel.app).

## Features & Modes

- **Match Mode:** Play singles pickleball against Bots with varying difficulties and personalities (Dinker, Banger, Lobber).
- **Practice Mode:** Train against a ball machine with step-by-step prompts (return of serve, third shot, volley, dink, free play) and no scoring.
- **Venues & Progression:** Win matches to unlock new venues (The Park, The Rooftop, The Beach), each featuring unique environments and Bot playstyles.
- **Rules:** The game follows core pickleball rules: side-out scoring (rally scoring optional), two-bounce rule, kitchen faults, and faults on out-of-bounds shots.
- **Replays:** Every fault shows a slowed-down replay banner of the moments leading up to the end of the rally.

## Architecture

- **Tech Stack:** TypeScript, Vite, and Three.js.
- **Simulation:** A pure, deterministic fixed-step simulation (`src/sim/`) runs completely separate from rendering. It uses custom physics and is tested headlessly.
- **Bots:** Bots interact with the simulation strictly through the same input intents as a human player—they do not have special access to game state.
- **Art Pipeline:** The project includes a custom Python/Blender pipeline (`art/`) to build and export all 3D models and synthesize audio ambience directly into the game assets.

## Setup & Development

To run the game locally, you will need Node.js and npm installed.

1. Install dependencies:
   ```sh
   npm install
   ```

2. Start the development server:
   ```sh
   npm run dev
   ```

3. Build for production:
   ```sh
   npm run build
   ```

### Testing

The simulation logic and gameplay features are heavily tested.

- Run unit/headless tests (Vitest):
  ```sh
  npm run test
  ```
- Run End-to-End tests (Playwright):
  ```sh
  npx playwright install --with-deps
  npm run e2e
  ```

### Art Pipeline

To rebuild the models and audio, you must have Blender installed and available in your environment (defaults to Blender 5.2).

```sh
# Rebuild all art assets
npm run art

# Rebuild specific assets
npm run art -- player park
```
