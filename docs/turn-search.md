# Turn search

**UNVERIFIED.** Built by Claude on 28 Oct 2026 as task 6 of [turn-objectives.md](https://github.com/esweby/vdb_fe/blob/main/docs/turn-objectives.md). The search's own rules below are Claude's reading, for the maintainer to check. Card rules are only the verified `CARD_RULES`.

`searchTurn(state)` in `src/rules/search.ts` lists every distinct legal line for one turn, from the start of the action phase to the end of the turn. It doesn't choose a line: the line chooser does that ([turn-objectives.md, Scoring settings](https://github.com/esweby/vdb_fe/blob/main/docs/turn-objectives.md#scoring-settings)).

## What it branches on

- Playing a card from hand, the arsenal or banish (where the card allows it), in every order.
- What to pitch, only to pay a cost: cards go one at a time until the cost is paid, so a set is legal when its last card was still needed. Copies of a card count once.
- Gate activations, weapon attacks (the Seven Sin Nebula) and activated abilities that do something in the engine.
- Every choice a card asks for: banish targets (BSL, Embrace Ursur), Opt, Descendancy's life payment, optional triggers.
- The end of the turn at every point, so holding cards is always a line: each hand card or none into an empty arsenal, and the Usurper's optional traverse back.

Explicit conditions about the opponent aren't branched. By default "a hero has lost life this turn" is yes only when Viserai has, and "less life than an opposing hero" is no. Both can be set.

## What each line gives

Its actions (replayable with `applySessionAction`), damage threatened (power + arcane + 2 per usurp, as the play pattern comparison counts it), Runechants and sinchants at the end of the turn, playable cards face up in banish, whether it flipped to the Usurper and came back, cards played (width), hand cards held at the end of the turn (blockers kept back), life lost, and the state after the turn ends.

## Bounds

Lines that reach the same state (up to copies of a card) with the same numbers are merged, and a mid-turn state reached by a second order isn't searched again. Limits on states, lines, depth and choice branches stop the search and say which was hit. The search is pure and deterministic.

On the maintainer's four goldfish hands (28 Oct), each search takes 4 to 13 ms and lists 112 to 216 lines, with no limit hit.

## The goldfish game

`test/rules/turn-search-goldfish.test.ts` builds each turn's start state as the maintainer described it and checks that their line is among the lines found. All four are. Where the engine's numbers differ from the maintainer's, the engine's are used:

| Turn | Maintainer | Engine | Why                                                                                                                   |
| ---- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| 1    | 4          | 4      | Murmuring usurps BSL's Runechant (2 + 2) rather than 1 arcane + 3. BSL banishing Murmuring also makes a Gate          |
| 2    | 5          | 5      | 2 + 2 usurp + 1 arcane                                                                                                |
| 3    | 11         | 10     | Fyendal's Spring Tunic isn't modelled: its resource is given by hand. Greed's "counts as a Runechant" and draw aren't |
| 4    | 16         | 15     | Murmuring makes 1 Runechant as it attacks; its hit is out of scope                                                    |

Turn 3's line is checked with the Tunic's resource in the pool from the start, so Embrace is paid from it and both reds are pitched for Murmuring: the same cards, in a different order.

## Not modelled

- Fyendal's Spring Tunic and the other equipment (task 8).
- Runechant of Greed's "counts as a Runechant" and its draw when usurped.
- Otherworldly Sins' +3 to the next attack, and other combat bonuses.
- Reordering the cards Opt keeps on top.
