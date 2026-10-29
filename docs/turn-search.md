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

## The top of the deck

**UNVERIFIED** apart from the maintainer's rules readings below. Built by Claude on 29 Oct 2026.

By default the search plays on the real deck order. So when something banishes the top card (the Forsaken's trigger whenever Runechants are made, Pull from Beyond, Blood Tribute), it already knows what comes off. The chooser could then pick the line whose banish happens to hit a card it can play, which is a line a real player can't plan.

With `searchTurn(state, { deck: "hidden" })`:

- **What the player knows.** `knownTop` on the state counts the cards on top that the player knows, in order. Opt sets it to the cards it kept on top, and a card put on top adds one. A draw or banish from the top takes one off, and a shuffle clears it. The maintainer's readings (29 Oct 2026): Opt that keeps both cards on top makes them known; Opt that bottoms both doesn't, so Pull from Beyond's banish after that is blind; and a reveal is blind whenever the card now on top isn't known, including when the deck has changed since the player looked.
- **Blind reveals.** Every banish from the top makes a `revealed` event, which is blind when nothing was known on top. Each line counts its blind reveals (`blindReveals`) in both modes.
- **The unknown card.** In hidden mode, a blind reveal banishes an unknown card in place of the real one. It can't be played, and the line is scored on its odds over every card the player hasn't seen. `banishedPlayable` counts the share playable from banish, and `lifeLost` adds the share with blood debt. The search stays the size it is with the deck known: a spike that branched on every card that could come off was 10 to 14 times slower, and half its searches hit a limit.
- **Planning again.** `playByObjectives(state, { turns, search: { deck: "hidden" } })` plays the chosen line on the real state up to its first blind reveal. Then it searches the turn again from there, with the real card known, and counts the whole turn's numbers (`since`). If the real card asks for something the unknown one didn't (Arknight Descendancy banished asks to pay life for Runechants), each answer is tried and the one with the best rest of the turn is taken. The turn's line is what was really played. `objectivePolicy` takes the same option, as `line-scoring-hidden-v1`.

How much the known deck flattered the chooser, on 200 goldfish games over turns 1–4 (seed 20261028, default settings, cards from vdb_fe's local card data). The lists are the maintainer's main 52 and the 57 they played against Marlynn on 29 Oct 2026 (vdb_fe `apps/web/scripts/fixtures/`):

| List | Deck   | Threatened | Without arcane | 9+  | 14+ | Flipped by turn 4 | Blind reveals a turn | Time a game |
| ---- | ------ | ---------- | -------------- | --- | --- | ----------------- | -------------------- | ----------- |
| 52   | known  | 8.94       | 7.73           | 49% | 20% | 84%               | 1.29                 | 348 ms      |
| 52   | hidden | 8.70       | 7.56           | 48% | 17% | 79%               | 1.20                 | 274 ms      |
| 57   | known  | 9.35       | 8.03           | 56% | 23% | 93%               | 1.28                 | 330 ms      |
| 57   | hidden | 9.05       | 7.72           | 53% | 19% | 87%               | 1.32                 | 199 ms      |

So knowing the deck added about 0.25–0.3 damage a turn and 5–6 points of flipping by turn 4. Hidden mode is faster, because an unknown card can't be played, so there are fewer lines. No game failed in either mode. This isn't a calibration.

What the unknown card misses: a banished card's own trigger (Descendancy's Runechants), and Pull from Beyond's Gate when its pitch would match. So hidden mode undervalues lines that a lucky reveal makes better, until the real card is revealed and the turn is planned again.

## Not modelled

- Fyendal's Spring Tunic and the other equipment (task 8).
- Runechant of Greed's "counts as a Runechant" and its draw when usurped.
- Otherworldly Sins' +3 to the next attack, and other combat bonuses.
- Reordering the cards Opt keeps on top.
