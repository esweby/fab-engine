// Line scoring (docs/turn-objectives.md, "Scoring settings"): each line the turn search finds is
// scored on what it threatens and leaves, and the best is chosen. UNVERIFIED: every weight is
// Claude's draft for the maintainer to check; the tests pin what each setting does to the choice.
import { describe, expect, it } from "vitest";
import {
  chooseLine,
  DEFAULT_LINE_SCORE_SETTINGS,
  pickLine,
  playByObjectives,
  runBatch,
  scoreLine,
  searchTurn,
  setUp,
  objectivePolicy,
  BLOOD_DEBT,
  RUNECHANT,
  VISERAI,
  type LineScoreSettings,
  type TurnLine,
} from "../../src/rules/index.ts";
import {
  BSL,
  EMBRACE,
  ENSHRINE,
  MURMURING,
  NEBULA,
  OTHERWORLDLY,
  SHADOW_OF_URSUR,
  start,
} from "./turn-search-cards.ts";

/** Every weight zero, so a test switches on only the settings it's about. */
const NONE: LineScoreSettings = {
  damage: 0,
  burst: { at: 9, bonus: 0 },
  bigBurst: { at: 14, bonus: 0 },
  runechants: 0,
  sinchants: 0,
  banishedPlayable: 0,
  flip: 0,
  back: 0,
  width: 0,
  arsenal: 0,
  lifeLost: 0,
};
const only = (over: Partial<LineScoreSettings>): LineScoreSettings => ({
  ...NONE,
  ...over,
});

/** A line's result without a state, for the arithmetic. */
const line = (over: Partial<TurnLine>): TurnLine =>
  ({
    actions: [{ type: "endTurn" }],
    threatened: 0,
    power: 0,
    arcane: 0,
    usurps: 0,
    runechants: 0,
    sinchants: 0,
    banishedPlayable: 0,
    flipped: false,
    back: false,
    width: 0,
    held: 0,
    lifeLost: 0,
    key: JSON.stringify(over),
    state: { zones: { arsenal: [] } },
    ...over,
  }) as unknown as TurnLine;

// Usurper, 2 Runechants: lines from 0 to 15 threatened, 3 Runechants carried, coming back.
const usurperTurn = () =>
  start({
    hand: [SHADOW_OF_URSUR(), BSL(), MURMURING(1), EMBRACE()],
    weapons: [NEBULA()],
    tokens: { runechant: 2 },
    side: "usurper",
  });

describe("scoreLine", () => {
  it("adds the burst bonus at 9 or more, and the big burst on top at 14 or more", () => {
    const s = only({
      damage: 1,
      burst: { at: 9, bonus: 4 },
      bigBurst: { at: 14, bonus: 5 },
    });
    expect(scoreLine(line({ threatened: 8 }), s)).toBe(8);
    expect(scoreLine(line({ threatened: 9 }), s)).toBe(13);
    expect(scoreLine(line({ threatened: 13 }), s)).toBe(17);
    expect(scoreLine(line({ threatened: 14 }), s)).toBe(23);
  });

  it("weighs what the line leaves: Runechants, sinchants, banish, arsenal", () => {
    const s = only({
      runechants: 1,
      sinchants: 2,
      banishedPlayable: 3,
      arsenal: 4,
    });
    expect(
      scoreLine(
        line({
          runechants: 2,
          sinchants: 1,
          banishedPlayable: 1,
          state: { zones: { arsenal: [{}] } } as never,
        }),
        s,
      ),
    ).toBe(2 + 2 + 3 + 4);
  });

  it("weighs flipping, coming back, width, and takes off life lost", () => {
    const s = only({ flip: 2, back: 3, width: 0.5, lifeLost: 1 });
    expect(
      scoreLine(line({ flipped: true, back: true, width: 4, lifeLost: 2 }), s),
    ).toBe(2 + 3 + 2 - 2);
  });

  it("has defaults, with blockers held back unset", () => {
    expect(DEFAULT_LINE_SCORE_SETTINGS.burst.at).toBe(9);
    expect(DEFAULT_LINE_SCORE_SETTINGS.bigBurst.at).toBe(14);
    expect(DEFAULT_LINE_SCORE_SETTINGS.holdBack).toBeUndefined();
  });
});

describe("pickLine", () => {
  it("takes the first of equal best scores, in the search's order", () => {
    const lines = [
      line({ threatened: 3 }),
      line({ threatened: 5, width: 1 }),
      line({ threatened: 5, width: 2 }),
    ];
    expect(pickLine(lines, only({ damage: 1 }))).toBe(lines[1]);
    expect(pickLine(lines, NONE)).toBe(lines[0]);
  });

  it("holds back at least the set number of hand cards, or as many as any line can", () => {
    const lines = [
      line({ threatened: 9, held: 0 }),
      line({ threatened: 4, held: 1 }),
      line({ threatened: 0, held: 2 }),
    ];
    expect(pickLine(lines, only({ damage: 1 }))).toBe(lines[0]);
    expect(pickLine(lines, only({ damage: 1, holdBack: 1 }))).toBe(lines[1]);
    expect(pickLine(lines, only({ damage: 1, holdBack: 3 }))).toBe(lines[2]);
  });
});

describe("chooseLine: each setting's effect on the choice", () => {
  it("damage: the most threatened", () => {
    const chosen = chooseLine(usurperTurn(), only({ damage: 1 }));
    expect(chosen.threatened).toBe(15);
  });

  it("burst: a line of 9 or more over carrying Runechants", () => {
    const s = usurperTurn();
    expect(chooseLine(s, only({ runechants: 1 })).threatened).toBeLessThan(9);
    const burst = chooseLine(
      s,
      only({ runechants: 1, burst: { at: 9, bonus: 10 } }),
    );
    expect(burst.threatened).toBeGreaterThanOrEqual(9);
    expect(burst.threatened).toBeLessThan(14);
  });

  it("big burst: 14 or more over a smaller burst that carries a Runechant", () => {
    const s = only({
      runechants: 1,
      burst: { at: 9, bonus: 10 },
      bigBurst: { at: 14, bonus: 10 },
    });
    expect(chooseLine(usurperTurn(), s).threatened).toBeGreaterThanOrEqual(14);
  });

  it("Runechants carried: holding 3 for next turn's usurps over a 15", () => {
    const s = usurperTurn();
    expect(chooseLine(s, only({ damage: 1 })).runechants).toBe(0);
    expect(chooseLine(s, only({ damage: 1, runechants: 10 })).runechants).toBe(
      3,
    );
  });

  it("cards in banish to play out: BSL banishing Murmuring over attacking with it", () => {
    const s = start({ hand: [BSL(), MURMURING(1)] });
    expect(chooseLine(s, only({ damage: 1 })).banishedPlayable).toBe(0);
    expect(
      chooseLine(s, only({ damage: 1, banishedPlayable: 5 })).banishedPlayable,
    ).toBe(1);
  });

  it("coming back to the Forsaken: the Usurper takes the Gate's traverse", () => {
    const s = start({ hand: [BSL(), MURMURING(1)], side: "usurper" });
    expect(chooseLine(s, only({ damage: 1 })).back).toBe(false);
    expect(chooseLine(s, only({ damage: 1, back: 10 })).back).toBe(true);
  });

  it("flipping to the Usurper", () => {
    const s = start({
      hand: [OTHERWORLDLY(), EMBRACE(), MURMURING(1), MURMURING(1)],
      resources: 3,
    });
    expect(chooseLine(s, only({ banishedPlayable: 1 })).flipped).toBe(false);
    expect(chooseLine(s, only({ banishedPlayable: 1, flip: 5 })).flipped).toBe(
      true,
    );
  });

  it("width: three cards for 14 over two for 15", () => {
    const s = usurperTurn();
    expect(chooseLine(s, only({ damage: 1 })).width).toBe(2);
    const wide = chooseLine(s, only({ damage: 1, width: 5 }));
    expect(wide).toMatchObject({ width: 3, threatened: 14 });
  });

  it("blockers held back: keeps at least that many hand cards", () => {
    const s = usurperTurn();
    expect(chooseLine(s, only({ damage: 1 })).held).toBe(0);
    const held = chooseLine(s, only({ damage: 1, holdBack: 2 }));
    expect(held.held).toBeGreaterThanOrEqual(2);
    expect(held.threatened).toBeGreaterThan(0);
  });

  it("life lost: a card left in banish costs a life in blood debt", () => {
    const s = start({ hand: [BSL(), MURMURING(3), ENSHRINE()] });
    const choose = (lifeLost: number) =>
      chooseLine(s, only({ runechants: 1, banishedPlayable: 1, lifeLost }));
    expect(choose(0).lifeLost).toBe(1);
    expect(choose(5).lifeLost).toBe(0);
  });

  it("is deterministic", () => {
    const s = usurperTurn();
    expect(chooseLine(s).actions).toEqual(chooseLine(s).actions);
  });
});

describe("playByObjectives", () => {
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
  const setup = {
    deck: deck(),
    weapons: [NEBULA()],
    triggers: [...VISERAI, RUNECHANT, BLOOD_DEBT],
  };

  it("plays each turn with the chosen line, turn after turn", () => {
    const initial = setUp({ ...setup, seed: 7 });
    const run = playByObjectives(initial, { turns: 3 });
    expect(run.failure).toBeUndefined();
    expect(run.lines).toHaveLength(3);
    expect(run.trace.filter((e) => e.type === "turnEnded")).toHaveLength(3);
    // Turn 1's line is the chooser's line from the opening state.
    expect(run.lines[0]!.actions).toEqual(chooseLine(initial).actions);
    expect(run.state).toBe(run.lines[2]!.state);
  });

  it("runs as a batch policy on the same seeds as a script", () => {
    const report = runBatch(
      setup,
      { version: 1, steps: [] },
      { runs: 3, seed: 1, policy: objectivePolicy({ turns: 2 }) },
    );
    expect(report.completed).toBe(3);
    expect(report.byTurn).toHaveLength(2);
    expect(report.inputs.policy?.id).toBe("line-scoring-v1");
  });
});
