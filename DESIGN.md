# STARSHIP COMMAND — Game Design Document (v0.1)

A bridge commander sim. You are the captain. The game is about giving orders and making decisions under pressure — never about twitch reflexes.

## Why most Star Trek games aren't fun (and how we fix it)

Most Trek games make you the pilot or the gunner. The actual fantasy is being the **captain**: weighing bad options, trusting your officers, talking your way out when you can and fighting smart when you can't. Every system below serves that fantasy.

## Design pillars

1. **You give orders, you don't push buttons.** Decisions route through bridge stations and officers. Tension comes from limited information and limited power, not reaction time.
2. **Every station matters.** Tactical, Helm, Engineering, Science, and Comms each open different options in every encounter. A scan can turn a battle into a rescue.
3. **Choices with teeth.** Diplomacy is a real system with real stakes. Faction reputation persists. Officers can die and stay dead.
4. **Episodes, not grind.** A play session is structured like a TV episode: cold open, escalation, climax, resolution — 20 to 40 minutes.

## Core loop

Receive mission → plot course on sector map → travel (random events, distress calls) → encounter (combat / diplomacy / anomaly / away mission) → resolve via bridge orders → rewards (crew XP, ship upgrades, reputation, story progress) → next episode.

## Core systems

### 1. Encounter engine (the heart)
Encounters are turn-based state machines. Each round you issue one order per station, then the round resolves. All encounter types (combat, hail, anomaly) run on the same engine so they can flow into each other — a battle can become a negotiation mid-fight if you disable their weapons instead of destroying them.

### 2. Power management
Each round the warp core produces a power budget you split across engines, shields, weapons, and sensors. Damage shrinks the budget. This is the constant, simple tension underlying every encounter.

### 3. Tactical combat
Turn-based on a 2D plane. Facing matters: four shield arcs, phaser firing arcs, torpedoes that can be outmaneuvered. Subsystem targeting (weapons, engines, life support) enables non-lethal victories — which diplomacy-focused factions remember.

### 4. Diplomacy & hailing
Dialogue trees gated by skill checks: your Comms officer's stats + faction reputation + facts your Science officer scanned. Failed diplomacy degrades gracefully into combat with modifiers rather than a game over.

### 5. Crew
Five senior officers with stats, traits, and loyalty. They level up, get injured, advise you during encounters (their suggestions reflect their personality), and can be sent on risky away missions. Losing one hurts mechanically and narratively.

### 6. Ship
Hull, subsystems with damage states, upgrade slots earned at starbases. Engineering can hot-fix one system per round during crises.

### 7. Galaxy & factions
A sector map: authored story systems + procedurally seeded filler (anomalies, distress calls, patrols). Three to four factions with persistent reputation tracks that gate endings.

### 8. Campaign
Seven authored episodes forming a season arc, interleaved with procedural side content. Multiple endings driven by reputation and key episode choices.

### 9. Meta
Save/load (multiple slots + export-to-file), difficulty settings, captain's log that records your choices, codex.

## Tech stack (recommendation)

**Web app: TypeScript + Vite + Phaser 3, built to a single HTML file.**

- **Phaser 3** (canvas) renders the sector map and tactical combat scenes.
- **DOM/CSS overlay** renders the LCARS-style console UI, dialogue, and menus — HTML beats canvas for text-heavy panel UI, and LCARS is *made* of CSS-shaped panels.
- **Web Audio / Howler.js** for sound; **localStorage + JSON file export** for saves.
- **vite-plugin-singlefile** builds the whole game into one `index.html` — double-click to play, trivially shareable, no installs.

Why not Godot or Unity: both are fine engines, but I can't run their editors in this environment, so every iteration would need you as the hands. With the web stack I can build, run, unit-test the simulation, and even playtest in a browser myself — a much faster loop for a multi-week project. A bridge sim is UI + 2D tactical, exactly what the web does well. If we later want 3D viewscreens, we can port to Godot with the simulation logic (plain TypeScript) largely reusable.

## MCP servers & tooling

- **Connector registry:** no game-engine MCPs exist there (checked) — it's all business tools.
- **Claude in Chrome extension:** the most useful add-on for this project. Lets me open the built game, click through it, and read console errors — i.e., actually playtest.
- **Community MCPs if we ever switch engines:** godot-mcp (drive the Godot editor), unity-mcp, and blender-mcp (3D asset generation). Not needed for the web stack.
- **STAPI (stapi.co):** free Star Trek REST API — we can pull canon ship classes, species, and character data during development to seed the game database. No MCP needed; fetched at build time, not runtime.

## Multiplayer

**Yes — designed in from day one, implemented in tiers.** The rule that makes it cheap: the simulation is deterministic and input-driven (orders in → state out). Single-player AI, a local human, and a remote human are all just different sources of orders feeding the same engine.

- **Model:** WEGO — both captains issue orders in secret each round, then the round resolves simultaneously. Perfect for turn-based, immune to lag, and only small order packets cross the wire (deterministic lockstep).
- **Mode:** 1v1 skirmish duel (pick faction + ship, fight or negotiate). Campaign remains single-player.
- **Faction asymmetry:** Federation — superior sensors (cloak detection), stronger shields, mid-battle diplomacy options. Klingon Bird-of-Prey — cloak, high agility, heavy forward disruptors, weak shields. Romulan Warbird — cloak, devastating plasma torpedoes, slow power recharge.

**Tiers:**

1. **Hot-seat** (M2.5): same machine, orders hidden between turns. Nearly free once the sim exists.
2. **Online P2P** (M6): WebRTC data channels via PeerJS — share a room code, no server to host, still ships as one HTML file. The sweet spot.
3. **Dedicated server** (only if needed): WebSockets/Colyseus for matchmaking or 3+ player fleet battles; requires real hosting, deferred indefinitely.

**Migration path P2P → server:** the transport layer is an interface (send orders / receive orders / join room), so swapping PeerJS for a WebSocket relay is a drop-in change. Server-authoritative play (anti-cheat, ranked) is also cheap later because the deterministic sim is pure TypeScript with no browser dependencies — the same engine runs unchanged in Node.

Consequence for open question #1: strictly turn-based (WEGO) wins — real-time-with-pause doesn't multiplayer well.

## Milestones

- **M1 — Playable skeleton:** LCARS UI shell, sector map, travel, power management, one combat encounter, save/load. *Proves the core loop is fun.*
- **M2 — Combat complete:** shield arcs, subsystem targeting, damage/repair, 3 enemy types.
- **M2.5 — Hot-seat multiplayer:** 1v1 skirmish duel, hidden-order WEGO rounds, playable factions.
- **M3 — Crew & diplomacy:** officers, hailing system, reputation, encounters that flow between combat and talk.
- **M4 — Campaign:** 7 authored episodes, procedural event pool, factions, endings.
- **M5 — Polish:** sound, music, balancing, difficulty modes, captain's log, codex.
- **M6 — Online multiplayer:** P2P duels over WebRTC with room codes.

Each milestone ends in a build you can play, so we can course-correct on fun before adding more.

## Note on IP

Star Trek is Paramount's IP — this stays a personal, non-commercial fan project. If you ever want to distribute it, we swap names/likenesses for an original setting (the mechanics don't care).

## Design decisions (locked)

1. **Rounds:** turn-based WEGO (required for multiplayer).
2. **Crew:** original characters — our own officers with personalities, not canon figures. (Bonus: eases any future IP-scrubbed release.)
3. **Permadeath:** on by default; "Captain's difficulty" toggle at campaign start to disable. Officer death is what gives away missions and desperate battles their weight.
4. **Art:** CSS/vector LCARS minimalism — clean panels, glowing vectors on the tactical display, no sprite art.
