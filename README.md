# Starship Command

A bridge-commander sim in the browser. You are the captain: split your warp core's power,
give one order per station, and commit the round — then watch it resolve alongside your
opponent's hidden orders (WEGO turns). Talk, disable, destroy, or run; the sector remembers.

Built with TypeScript + Vite + Phaser 3, ships as **one self-contained HTML file** —
`npm run build` and double-click `dist/index.html` to play.

## Play

- **`npm install && npm run dev`** — hot-reload dev server
- **`npm run build`** — single-file build in `dist/index.html`
- Season opener: answer the Veyra Colony distress call. What comes after depends on
  how you answer it.

### Captain's crash course

- Each combat round: set **power** (engines / shields / weapons / sensors — damage
  shrinks the budget), give **helm / tactical / science / comms / engineering** orders,
  hit **EXECUTE ROUND**.
- **Facing matters**: four shield arcs; your phasers cover 270°, torpedoes launch in a
  60° forward window. A faster ship camping your rear arc? Cut throttle and let it
  overshoot into your guns.
- **Scan first**: a sensor lock improves accuracy and unlocks subsystem targeting.
  Wreck weapons *and* engines for a non-lethal win — Starfleet notices restraint.
- **Cloaked raiders** can't be targeted: run **tachyon sweeps** (better with sensor
  power), watch for bearing ghosts, and punish the decloak.
- Systems wrecked to zero stay down until a **starbase** refit. Warp out (range ≥ 15,
  engines online) when a fight is lost — permadeath is on by default.

## Architecture (see CLAUDE.md for the rules)

| Layer | Where | Notes |
|---|---|---|
| Simulation | `src/sim/` | Pure, deterministic TypeScript. Seeded RNG only, no trig (16-heading tables + dot products) — lockstep-multiplayer-safe. |
| Content | `src/data/` | Ships, sectors, missions, dialogue — data the engine interprets. |
| Render | `src/render/` | Phaser 3 scenes; draws state, animates round events, emits map clicks + sound cues. |
| UI | `src/ui/` | LCARS console in pure DOM/CSS; builds order sets, never mutates state. |
| Audio | `src/audio/` | All sound synthesized live via Web Audio — zero assets. |
| Net | `src/net/` | Transport interface (`sendOrders/onOrders/joinRoom`); local AI today, hotseat/WebRTC later. |

## Development

- **`npm test`** — Vitest sim suite (must stay green before any commit)
- **`npx tsc --noEmit`** — strict typecheck
- **`npm run build && npm run smoke`** — Playwright end-to-end against the built file
  (`--screens` dumps PNGs); drives the game through `window.__sc`
- **`npx tsx scripts/balance.ts [seeds]`** — headless balance sweep: policies × enemy
  classes × seeds → outcome tables (the tuning instrument for `src/sim/constants.ts`)

Design doc: `DESIGN.md`. Milestones M1 (playable skeleton) and most of M2 (combat
depth: cloak, 3 enemy classes, disable victories) are complete; M2.5 is hot-seat
multiplayer.

*Personal, non-commercial fan project. Star Trek is Paramount's IP; all names live in
`src/data/` and are swappable for an original setting.*
