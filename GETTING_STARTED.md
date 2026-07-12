# Getting started

**Prereqs:** Node 20+ and Claude Code (`npm install -g @anthropic-ai/claude-code`).

1. Create the project folder and drop in the two files:

   ```
   mkdir starship-command && cd starship-command
   # copy DESIGN.md and CLAUDE.md into this folder
   git init
   ```

2. Start Claude Code:

   ```
   claude
   ```

3. Paste this kickoff prompt:

   > Read CLAUDE.md and DESIGN.md. Scaffold the project: Vite + TypeScript + Phaser 3 + Vitest + vite-plugin-singlefile, using the directory structure in CLAUDE.md. Then build milestone M1: LCARS UI shell, sector map with travel, per-round power management, one turn-based WEGO combat encounter vs. an AI Klingon Bird-of-Prey, and save/load. Follow the architecture rules strictly — deterministic sim, seeded RNG, sim/render/net separation. Write sim unit tests as you go. Commit after each working step.

4. Playtest with `npm run dev` (hot reload) while iterating; `npm run build` produces a shareable single `dist/index.html`.

Tip: at the end of each session, ask Claude Code to update the Status section of CLAUDE.md so the next session picks up cleanly.
