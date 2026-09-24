# Dink City

A browser-based 3D pickleball game. Singles against **Bots** in v1, with the model shaped for doubles and online multiplayer later.

## Glossary

### Match structure

- **Match**: one or more **Games** between two **Sides**. v1 default is a single Game.
- **Game**: played to 11, win by 2. Default scoring is **Side-out scoring**; **Rally scoring** is a rule flag.
- **Side-out scoring**: only the serving Side can win a point. If the server loses the rally, the serve passes to the other Side (a **Side-out**).
- **Rally**: from the Serve until the ball is dead.
- **Side**: one end's team, stored as `sides[].players[]`. Always one Player per Side in v1; doubles is a later addition.
- **End**: the physical half of the court a Side occupies. Ends switch between Games. The renderer mirrors the court so the local Player always appears at the bottom of the screen.

### Court

- **Kitchen**: the non-volley zone, 2.13 m deep on each side of the net. Avoid "NVZ" in code and UI.
- **Kitchen line**: the kitchen's far edge.
- **Service court**: left or right half of the area behind the Kitchen. Serves go diagonally.

### Rules (core set, see ADR-0001)

- **Two-bounce rule**: the Serve must bounce, and so must the return of serve, before either Side may volley.
- **Kitchen fault**: volleying while standing in the Kitchen.
- **Fault**: any rule break that ends the Rally. Every Fault shows a **Fault banner** with a short **Replay**.

### Shots and input

- **Intent**: one tick of player input: `{ move, shot, aim }`. Humans, Bots and future network clients all produce Intents. Nothing else enters the **Sim**.
- **Shot type**: one of **Soft**, **Drive**, **Lob**. These are the only three shot buttons.
  - **Soft**: lands in or near the Kitchen. From the Kitchen line it is a **Dink**; from deep it is a **Drop**; against a very fast incoming ball it becomes a **Block**.
  - **Drive**: flat and fast. Against a high ball it becomes a **Smash**.
  - **Lob**: high and deep.
- **Serve**: uses the same buttons (Soft is short and safe, Drive is deep and hard).
- **Volley**: any contact before the ball bounces. Not a separate button.
- **Aim**: left/right sets the angle; forward/back adjusts depth within the Shot type's range.
- **Commit**: pressing a shot button while the ball is on its way. The swing happens automatically at **Contact**. An earlier Commit gives a better shot (see ADR-0002).
- **Shot quality**: 0–1 score from Commit timing, how well the Player is set, contact height, movement, and incoming pace. It scales power and **Aim error**.
- **Shot solver**: computes launch velocity from Shot type, target and apex height, before Aim error is added.

### Simulation

- **Sim**: the pure, deterministic `step(state, intents) → state` in `src/sim/`. Never imports three.js.
- **Tick**: one fixed 1/60 s Sim step.
- **Tuning**: all feel constants, kept in `tuning.ts` and adjustable live under `?debug`.
- **Game speed**: global time factor in Tuning. Starts at 1.0.

### Bots

- **Bot**: an AI Player that produces Intents from observed state. It has no special access to the Sim (see ADR-0003).
- **Difficulty**: reaction delay, move speed, prediction error, aim width and noise, late and off-center hits, **Unforced errors**, shot-choice accuracy, and kitchen discipline. Bots are only ever handicapped through their Intents; the Sim treats them like humans.
- **Unforced error**: a Bot going for too much on a ball it could have played safely: aimed at the lines, met off-center and committed at the last moment, so poor Shot quality sprays it.
- **Personality**: weighting over Shot types, e.g. **Banger**, **Dinker**, **Lobber**.

### Meta

- **Dink City**: the themed map menu.
- **Venue**: a location on the map (e.g. Park, Rooftop, Beach). Each Venue has its own surroundings, ambience and Bot Personality. Venues unlock in order.
- **Practice mode**: a ball machine that feeds shots through the same Intent interface.
