# Rules engine

The rules engine: a small, verified engine that plays a Viserai deck's turns solo, built beside the counting engine and switched in card by card. Planned for phase three, it was built in phase two. This is the repo copy of "Viserai scenario engine brief v2" (19 Oct 2026); the README's "Shared game engine" section points here.

## Status (20 Oct 2026)

All nine steps of the build order are done. Goldfish and scenarios use the engine for every card with verified rules. The rest of the work is cards and features:

- **Cards** are added as the maintainer verifies them, through the effect drafts review ([phase-two.md](https://github.com/esweby/vdb_fe/blob/main/docs/phase-two.md), "Verifying cards"). The first batch (24 cards) and the sinchants are in.
- **Features the engine has gained since the brief:** Opt, with a scripted rule for which cards stay on top; a card banished instead of going to the graveyard; a card that needs damage dealt this turn to be played; a card destroying itself (sinchants); the arena clearing at the end of the turn, while permanents stay.
- **Features still missing,** most cards unlocked first: an activate action, cost reductions, Opt reordering, and "counts as a Runechant".

## Decisions

| #   | Decision                                                                                           | Why                                                                               |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | The engine executes typed, hand-verified card effects and triggers                                 | Counting can't check conditions when they resolve, so the key numbers are guesses |
| 2   | Card facts and effects are stored apart; effects are drafted from facts, then verified by a player | The attributes already record tokens, triggers and conditions                     |
| 3   | Action points, go again, costs and pitching are in the first milestone                             | "By turn N" depends on how many cards a turn can play                             |
| 4   | "An attack was played" is an event; attack resolution, blocking and on-hit effects are out         | Runechants and several cards trigger on playing an attack, not on combat          |
| 5   | Cards without verified effects follow one stated policy, and every report shows coverage           | Most of a real deck will be unmodelled for months                                 |
| 6   | Goldfish keeps its sandbox moves beside engine-resolved play                                       | Unmodelled cards must still be playable by hand                                   |
| 7   | Built beside the counting engine; scenarios switch over card by card                               | The builder, saved scenarios and compare keep working throughout                  |
| 8   | Results record the rules-data version                                                              | A changed card fact must never silently change an old result                      |
| 9   | Hand-checked interaction tests are the oracle; no batch runs of a card until its tests pass        | Game logic needs a player's check (CLAUDE.md)                                     |

## Scope

**In:** card instances with stable ids; zones and slots; turn structure (start, action phase, end phase); action points, go again, costs, pitching and resources; typed verified effects with conditions checked on resolution; events and triggers, including Viserai's hero text and the Runechant token's rule; playing an attack as an event; the banished zone with each card's identity and face; scripted and interactive decisions; seeded batches; event traces.

**Out:** an opponent, attack resolution, blocking, damage to a hero, on-hit effects, choosing the best play, parsing card text, a general scripting language, and any rule no verified card needs yet. Anything out of scope that a number depends on is reported beside it ("on-hit effects not counted").

## Architecture

Four responsibilities stay apart:

1. **Card data**: facts (`attributes`, for scoring, roles, synergy and filters) and effects (what the engine executes), versioned by content hash.
2. **Rules engine** (`src/rules`): state, zone operations, phases, action points, costs, effects, events, triggers and the trace. No UI, no scores, no prompts.
3. **Decision policies**: the engine asks for a choice from the legal options. Scripted (fixed selection rules) and interactive (the user) to start; an evaluator later.
4. **Tools**: the scenario runner and reports, and goldfish.

## Unmodelled cards

In the engine, a card without verified effects can be drawn, held, pitched for its pitch value, put in arsenal, banished and blocked with, but not played. In goldfish the user can still play it by hand. Every result shows coverage, for example "38 of 60 deck cards modelled".

## Invariants

1. Every card instance is in exactly one zone, and only zone operations move it.
2. A card can't leave a zone it isn't in; an illegal move fails loudly.
3. Token counts and card counts are never mixed.
4. Every counter has a stated increment and reset point.
5. Resources and action points never go below zero.

## Build order

Each step is its own pull request, test first.

1. This document and the README.
2. Rules state: zones, phases, action points, costs, pitching, the event trace, the invariants.
3. Effect schema and interpreter: typed operations with contracts, bindings, validation.
4. Events, triggers and the processing budget.
5. Viserai's verified hero text, the Runechant token's rule and 3 or 4 real cards, with interaction tests signed off by a player.
6. One fixed scripted run, replayed to an identical trace.
7. Seeded batches and reports; scenarios use the rules engine for modelled cards and say so.
8. Goldfish on the engine, beside the sandbox; hero prompts removed.
9. Effect drafting from attributes; more cards as players verify them.

## Open questions

Most of the maintainer's questions below have since been answered: Viserai's text and the Runechant token's rule were signed off with steps 5a and 5b. The turn structure and end of turn are in [phase-two.md](https://github.com/esweby/vdb_fe/blob/main/docs/phase-two.md), "Decisions". They're kept here as the brief's record.

For the council (design): whether effects belong in a separate rules package the engine loads; whether action points and costs are needed in the first milestone; the unmodelled-card default; immutable state versus a mutable engine with a trace; whether bounded `repeat` and `if` belong in the step vocabulary; drafting effects from facts versus authoring from scratch.

For the maintainer (game logic): Viserai's exact text on both sides and when traverse happens; the Runechant token's exact rule; the first 3 or 4 cards; turn structure details (arsenal at end of turn, pitched cards, starting life); who else signs off interaction tests.

Until those are answered, every rule the engine implements is marked UNVERIFIED in code and tests.
