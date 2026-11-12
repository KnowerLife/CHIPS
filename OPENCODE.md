# CHIPS — Game Project

This project builds **CHIPS**, a web game based on the 1990s street game
"Сотки/Фишки" (pogs/caps). It uses the game-studio scaffolding in `.opencode/`
(agents, skills, rules, hooks) from the *Chips* template.

## Quick facts

- **Stack:** Phaser 3 + TypeScript + Vite (see `docs/architecture/ADR-0001-web-stack.md`)
- **Game:** smash a stack of chips with a bita; flipped chips are yours
- **Modes:** vs AI, local hot-seat
- **Persistence:** `localStorage` (`chips.profile.v1`)

## Commands

```bash
npm install      # install deps
npm run dev      # dev server at http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # preview the build
npm test         # run Vitest
npm run test:watch
```

## Layout

- `src/game/systems/` — pure, engine-agnostic logic (unit-tested)
- `src/game/scenes/` — Phaser scenes (render + input)
- `src/game/data/` — data-driven catalogs (chips, bitas, achievements)
- `src/game/ui/` — reusable UI helpers
- `design/gdd/` — design docs · `docs/architecture/` — ADRs · `tests/` — tests

## Principles

- Gameplay values are data-driven, never hardcoded.
- The core simulation must not import Phaser.
- Uses a seedable RNG so balance simulations are reproducible.
- Write tests for gameplay systems before/with the implementation.
