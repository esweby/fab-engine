# fab-engine

A Flesh and Blood rules engine for one side of the table: it plays a deck's own turns (goldfish, no opponent) by the card rules, lists every legal line for a turn, and scores those lines to play a whole game. Split from [vdb_fe](https://github.com/esweby/vdb_fe) on 28 Oct 2026, with its history.

Plain TypeScript, no React, no network. Built for Viserai first.

## What's in it

- `@esweby/fab-engine`: the counting engine (`src/game.ts`).
- `@esweby/fab-engine/rules`: the rules engine. Zones, costs, pitch, go again, triggers, Runechants, banish, Gates and traverses ([docs/rules-engine.md](docs/rules-engine.md)); scripted and seeded batch runs; the turn search ([docs/turn-search.md](docs/turn-search.md)); and the line chooser (`src/rules/objectives.ts`).
- `@esweby/fab-engine/rulesets/viseraiTraverse`: Viserai's traverse ruleset for the counting engine.

## Scope

The engine models what changes the cards a player can play or the damage they threaten on their own turn. Anything that depends on the opponent, such as blocks, on-hit effects or the opponent's life, is a setting or an explicit yes/no condition, not a simulation.

## Card rules

Only `CARD_RULES` in `src/rules/viserai.ts` is verified, card by card, by the maintainer or an experienced player. Anything else (search choices, policies, scoring weights) is marked UNVERIFIED.

## Using it

```json
"dependencies": { "@esweby/fab-engine": "github:esweby/fab-engine#v0.1.0" }
```

npm builds `dist/` on install (the `prepare` script). Take changes by moving the tag.

## Working on it

- `npm test`: Vitest
- `npm run typecheck`
- `npm run build`: emits `dist/`

Write a failing test before the code that makes it pass. Work on a branch and merge through a pull request once CI passes.
