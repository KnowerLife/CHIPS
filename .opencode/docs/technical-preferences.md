# Technical Preferences

<!-- Populated for the CHIPS web project. All agents reference this file. -->

## Engine & Language

- **Platform**: Web (browser, static hosting)
- **Stack**: Phaser 3 + TypeScript + Vite
- **Language**: TypeScript (strict)
- **Rendering**: Phaser 3 (Canvas/WebGL auto)
- **Physics**: none — deterministic custom simulation
- **Build**: Vite (`base: './'`), `tsc --noEmit` for typecheck
- **Tests**: Vitest

## Naming Conventions

- **Classes**: PascalCase (e.g. `MatchEngine`, `ChipView`)
- **Variables/Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE in `src/game/Constants.ts`
- **Files**: PascalCase for classes, camelCase for utils
- **Scenes**: `*Scene.ts`

## Performance Budgets

- **Target Framerate**: 60 FPS
- **Memory Ceiling**: ~128 MB
- **Stack render**: cluster visual chips; up to ~100 logical chips supported

## Testing

- **Framework**: Vitest
- **Required Tests**: balance formulas, match engine, economy, progression, RNG
- **Approach**: pure logic first; systems never import Phaser

## Forbidden Patterns

- Phaser imports inside `src/game/systems/`
- Hardcoded gameplay numbers (use `Constants.ts` / `data/`)
- Non-seeded randomness in systems (use `Rng`)
