// The top of the deck, hidden from the turn search (docs/turn-search.md, "The top of the deck"):
// a banish from the top of a deck the player hasn't looked at is a blind reveal. In hidden mode
// the search banishes an unknown card there instead, scored by what could have come off, and the
// chooser plans again once the real card is revealed. The rules readings are the maintainer's
// (29 Oct 2026): Opt keeping cards on top makes them known, in order; bottoming them all doesn't,
// so Pull from Beyond's banish after that is blind. The rest is UNVERIFIED.
import { describe, expect, it } from "vitest";
import {
  cardWithRules,
  chooseLine,
  DEFAULT_LINE_SCORE_SETTINGS,
  objectivePolicy,
  parseEffects,
  playByObjectives,
  runBatch,
  runEffects,
  searchTurn,
  BLOOD_DEBT,
  RUNECHANT,
  VISERAI,
  type Choose,
  type RulesState,
  type SessionAction,
} from "../../src/rules/index.ts";
import { draw, shuffleDeck } from "../../src/rules/state.ts";
import {
  BSL,
  DESCENDANCY,
  EMBRACE,
  ENSHRINE,
  MURMURING,
  NEBULA,
  OTHERWORLDLY,
  SHADOW_OF_URSUR,
  start,
  uidOf,
} from "./turn-search-cards.ts";

const keepAll: Choose = () => [];
const bottomAll: Choose = (request) => [request.options[0]!];
const opt2 = parseEffects([{ op: "opt", amount: 2 }]);
const banishTop = parseEffects([{ op: "banish", from: "deckTop", amount: 1 }]);
const reveals = (s: RulesState) =>
  s.events.flatMap((e) => (e.type === "revealed" ? [e] : []));
const plays = (actions: SessionAction[], uid: string) =>
  actions.some((a) => a.type === "play" && a.uid === uid);

/** Otherworldly Sins makes a Runechant, so the Forsaken banishes the top card: Murmuring here. */
const murmuringOnTop = () =>
  start({ hand: [OTHERWORLDLY()], deck: [MURMURING(1)], resources: 3 });
/** The same cards, with Murmuring moved to the bottom of the deck. */
const murmuringAtBottom = () => {
  const s = murmuringOnTop();
  return {
    ...s,
    zones: { ...s.zones, deck: [...s.zones.deck.slice(1), s.zones.deck[0]!] },
  };
};

describe("what the player knows of the top of the deck", () => {
  it("knows the cards Opt keeps on top, but not a top that Opt sent to the bottom", () => {
    const s = start({ hand: [], deck: [MURMURING(1), MURMURING(3)] });
    expect(s.knownTop ?? 0).toBe(0);
    expect(runEffects(s, opt2, keepAll).knownTop).toBe(2);
    expect(runEffects(s, opt2, bottomAll).knownTop ?? 0).toBe(0);
  });

  it("forgets one known card per draw or banish from the top, and all of them on a shuffle", () => {
    const kept = runEffects(
      start({ hand: [], deck: [MURMURING(1), MURMURING(3)] }),
      opt2,
      keepAll,
    );
    expect(draw(kept, 1).knownTop).toBe(1);
    expect(runEffects(kept, banishTop, keepAll).knownTop).toBe(1);
    expect(shuffleDeck(kept).knownTop).toBe(0);
  });

  it("marks a banish from the top as blind unless the card was known", () => {
    const s = start({ hand: [], deck: [MURMURING(1), MURMURING(3)] });
    expect(reveals(runEffects(s, banishTop, keepAll)).at(-1)?.blind).toBe(true);
    const kept = runEffects(s, opt2, keepAll);
    expect(reveals(runEffects(kept, banishTop, keepAll)).at(-1)?.blind).toBe(
      false,
    );
    const bottomed = runEffects(s, opt2, bottomAll);
    expect(
      reveals(runEffects(bottomed, banishTop, keepAll)).at(-1)?.blind,
    ).toBe(true);
  });
});

describe("the turn search with the deck hidden", () => {
  it("knows what came off when the deck is known, as before", () => {
    const s = murmuringOnTop();
    const murmuring = uidOf(s, "Murmuring Gloomblade", 1);
    const { lines } = searchTurn(s);
    expect(lines.some((l) => plays(l.actions, murmuring))).toBe(true);
    const otherworldlyOnly = lines.find(
      (l) => l.width === 1 && l.blindReveals === 1,
    )!;
    expect(otherworldlyOnly.banishedPlayable).toBe(1);
  });

  it("can't play the card a blind reveal banished: it isn't known until it's revealed", () => {
    const s = murmuringOnTop();
    const murmuring = uidOf(s, "Murmuring Gloomblade", 1);
    const { lines } = searchTurn(s, { deck: "hidden" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => plays(l.actions, murmuring))).toBe(false);
  });

  it("scores the unknown card by the share of the deck it could be", () => {
    // 21 cards could come off: Murmuring (playable from banish, blood debt) and 20 fillers.
    const { lines } = searchTurn(murmuringOnTop(), { deck: "hidden" });
    const otherworldlyOnly = lines.find(
      (l) => l.width === 1 && l.blindReveals === 1,
    )!;
    expect(otherworldlyOnly.banishedPlayable).toBeCloseTo(1 / 21);
    expect(otherworldlyOnly.lifeLost).toBeCloseTo(1 / 21);
  });

  it("chooses the same line whatever order the unknown cards are in", () => {
    const hidden = { deck: "hidden" } as const;
    const settings = DEFAULT_LINE_SCORE_SETTINGS;
    expect(chooseLine(murmuringOnTop(), settings, hidden).actions).toEqual(
      chooseLine(murmuringAtBottom(), settings, hidden).actions,
    );
    // With the deck known, the order changes the choice.
    expect(chooseLine(murmuringOnTop()).actions).not.toEqual(
      chooseLine(murmuringAtBottom()).actions,
    );
  });
});

describe("playing with the deck hidden", () => {
  it("plans again once a blind reveal shows the real card, and uses it", () => {
    const top = murmuringOnTop();
    const murmuring = uidOf(top, "Murmuring Gloomblade", 1);
    const hidden = { turns: 1, search: { deck: "hidden" as const } };
    const run = playByObjectives(top, hidden);
    expect(run.failure).toBeUndefined();
    expect(plays(run.lines[0]!.actions, murmuring)).toBe(true);
    // The turn's line is what really happened: Murmuring was really banished, then played.
    expect(run.lines[0]!.blindReveals).toBeGreaterThanOrEqual(1);
    expect(
      run.state.zones.banished.every((i) => !i.uid.startsWith("unknown")),
    ).toBe(true);

    const bottom = murmuringAtBottom();
    const other = playByObjectives(bottom, hidden);
    expect(plays(other.lines[0]!.actions, murmuring)).toBe(false);
  });

  it("answers a choice the real card asks for, which the plan couldn't see", () => {
    // Descendancy banished from the top asks to pay life for Runechants; an unknown card doesn't.
    const s = start({
      hand: [OTHERWORLDLY()],
      deck: [DESCENDANCY()],
      resources: 3,
    });
    const run = playByObjectives(s, {
      turns: 1,
      search: { deck: "hidden" },
    });
    expect(run.failure).toBeUndefined();
    expect(run.lines).toHaveLength(1);
    expect(
      run.state.zones.banished.some(
        (i) => i.card.name === "Arknight Descendancy",
      ),
    ).toBe(true);
  });

  it("answers the real card's choice when it comes before one the plan answered", () => {
    // Malefic makes a Runechant as Embrace is played, so Descendancy comes off and asks to pay
    // life before Embrace asks which hand card to banish: the plan's answer no longer fits.
    const malefic = cardWithRules({
      id: "Malefic Incantation-1",
      name: "Malefic Incantation",
      pitch: 1,
      cost: 0,
      goAgain: true,
      type: "action",
      roles: [],
      traits: ["runeblade", "aura"],
      amounts: {},
    });
    const s = start({
      hand: [malefic, EMBRACE(), BSL()],
      deck: [DESCENDANCY()],
      resources: 1,
    });
    const run = playByObjectives(s, {
      turns: 1,
      search: { deck: "hidden" },
    });
    expect(run.failure).toBeUndefined();
    expect(run.lines).toHaveLength(1);
  });

  it("runs as a batch policy", () => {
    const deck = () => [
      BSL(),
      MURMURING(1),
      MURMURING(3),
      EMBRACE(),
      ENSHRINE(),
      SHADOW_OF_URSUR(),
      OTHERWORLDLY(),
      BSL(),
      MURMURING(2),
      EMBRACE(),
      ENSHRINE(),
      SHADOW_OF_URSUR(),
    ];
    const report = runBatch(
      {
        deck: deck(),
        weapons: [NEBULA()],
        triggers: [...VISERAI, RUNECHANT, BLOOD_DEBT],
      },
      { version: 1, steps: [] },
      {
        runs: 3,
        seed: 1,
        policy: objectivePolicy({ turns: 2, search: { deck: "hidden" } }),
      },
    );
    expect(report.completed).toBe(3);
    expect(report.inputs.policy?.id).toBe("line-scoring-hidden-v1");
  });
});
