# CLAUDE.md — Starship Command

Bridge commander sim. TypeScript + Vite + Phaser 3, builds to a single HTML file. **Read DESIGN.md before any feature work.** Design decisions there are locked (WEGO rounds, original crew, permadeath default on, LCARS minimalism) — don't relitigate without asking Jacob.

## Architecture rules (non-negotiable)

1. **Deterministic, input-driven sim.** All game logic lives in `src/sim/` as pure TypeScript: no Phaser, no DOM, no `Date.now()`, no bare `Math.random()` — use the seeded RNG passed through sim calls. Orders in → new state out. Determinism is load-bearing: multiplayer lockstep, replays, and testing all depend on it.
2. **Rendering and UI never mutate sim state.** `src/render/` (Phaser scenes) and `src/ui/` (LCARS DOM panels) read state and emit orders only.
3. **Networking is a transport interface** (`src/net/transport.ts`): `sendOrders / onOrders / joinRoom`. Implementations: local-AI, hotseat, PeerJS (M6), WebSocket (future). The sim never imports a transport implementation.
4. **WEGO rounds.** Collect one order set per captain per station, resolve the round in the sim, emit events the render layer animates from.

## Project structure

- `src/sim/` — engine: encounters, combat, power, diplomacy, crew, galaxy, save. Pure TS, unit-tested.
- `src/render/` — Phaser scenes: sector map, tactical display.
- `src/ui/` — LCARS DOM/CSS panels, dialogue, menus.
- `src/net/` — transport interface + implementations.
- `src/data/` — ships, factions, officers, episodes (typed JSON/TS data).
- `tests/` — Vitest, sim only.

## Commands

- `npm run dev` — hot-reload dev server (Jacob playtests here)
- `npm test` — Vitest; sim tests must stay green before any commit
- `npm run build` — single `dist/index.html` via vite-plugin-singlefile
- `npm run smoke` — Playwright end-to-end against the built file (run build first); `--screens` dumps PNGs. Drives the game via `window.__sc` (view/callbacks/isBusy) — also handy for browser playtesting.

## Conventions

- Saves are versioned JSON with migrations in `src/sim/save.ts`; never break old saves silently.
- Encounter content (episodes, events, dialogue) is data in `src/data/`, not code — the encounter engine interprets it.
- Prefer small sim-level unit tests over end-to-end tests; a deterministic sim makes scenario tests cheap.
- Personal, non-commercial fan project (Paramount IP). Keep names swappable via `src/data/`.

## Status

- **M1 COMPLETE** — LCARS UI shell, 9-system sector map with travel + seeded events, per-round power management, WEGO combat, versioned save/load (autosave, 3 slots, file export/import).
- **M2 COMPLETE (+ extras pulled forward)** — cloaking device (untargetable/shields-down, decloak alpha strikes, tachyon-sweep counter-play, ghost bearings, cooldowns); 3 enemy classes with AI doctrines (BoP knife-fighter, K't'inga brawler, Raptor harasser); wrecked-at-zero subsystems (starbase-only repair) making disable victories real; mission chain as data (`src/data/missions.ts`, at-system + intercept-after triggers) with episode 2 "The Fek'lhr Is Hunting"; difficulty toggle (permadeath / Captain's Mercy); persistent captain's log archive; save v2 with v1 migration. From M5: full synthesized audio (`src/audio/`, zero assets), help overlay, keyboard shortcuts. 99 sim tests + extended Playwright smoke (plays a whole battle) green.
- Combat lessons baked into the sim: phasers resolve at the best sampled point along both ships' movement segments ("fire when guns bear during the pass") — endpoint-only checks made narrow-arc ships useless. Shield regen is a weakest-arc-first budget (healing all arcs at once stalemated every long fight). Scanned targets take +10% accuracy. No Math.sin/cos/atan2 anywhere in the sim (16-heading tables + dot products) for cross-engine lockstep determinism.
- Balance is tuned via `npx tsx scripts/balance.ts` (headless policy-vs-class sweeps) — rerun it after touching constants.ts, ship data, or AI.
- **Next: M2.5** — hot-seat 1v1 skirmish (sim + transport are ready for it; needs a skirmish setup screen, hidden-order handoff UI, and playable-faction selection). Then M3 crew & diplomacy.
- Update this section as milestones complete (see DESIGN.md for M1–M6).
