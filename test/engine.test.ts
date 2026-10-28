import { describe, expect, it } from "vitest";
import {
  buildDeck,
  newGame,
  runScenario,
  ScenarioCannotRun,
  scenarioSchema,
  shuffle,
  type EngineCard,
  type ScenarioDefinition,
} from "../src/index.ts";

const card = (name: string, over: Partial<EngineCard> = {}): EngineCard => ({
  id: name,
  name,
  pitch: 1,
  roles: [],
  traits: [],
  amounts: {},
  ...over,
});
const scenario = (
  over: Partial<ScenarioDefinition> = {},
): ScenarioDefinition => ({
  version: 1,
  name: "Test",
  horizon: 0,
  turnModel: "fresh",
  access: ["hand"],
  condition: {
    all: [{ label: "an A", filter: { name: "A" }, min: 1 }],
  },
  ...over,
});

describe("shuffle", () => {
  it("is the same for the same seed, and a permutation", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(xs, 7)).toEqual(shuffle(xs, 7));
    expect(shuffle(xs, 7)).not.toEqual(shuffle(xs, 8));
    expect([...shuffle(xs, 7)].sort((a, b) => a - b)).toEqual(xs);
  });
});

describe("buildDeck", () => {
  it("adds each copy and pads with blanks to the deck size, saying so", () => {
    const deck = buildDeck(
      [
        { card: card("A"), copies: 3 },
        { card: card("B"), copies: 2 },
      ],
      10,
    );
    expect(deck.cards).toHaveLength(10);
    expect(deck.cards.filter((c) => c?.name === "A")).toHaveLength(3);
    expect(deck.blanks).toBe(5);
    expect(deck.coreCards).toBe(5);
  });

  it("never pads a core that's already the deck size or bigger", () => {
    expect(buildDeck([{ card: card("A"), copies: 12 }], 10).blanks).toBe(0);
  });
});

describe("scenarioSchema (README: the scenario contract)", () => {
  it("accepts a valid definition", () => {
    expect(scenarioSchema.safeParse(scenario()).success).toBe(true);
  });

  it("rejects definitions that aren't data it understands", () => {
    expect(
      scenarioSchema.safeParse({ ...scenario(), version: 2 }).success,
    ).toBe(false);
    expect(
      scenarioSchema.safeParse({
        ...scenario(),
        condition: { all: [{ label: "x", filter: { magic: true }, min: 1 }] },
      }).success,
    ).toBe(false);
  });
});

describe("runScenario", () => {
  it("succeeds every time when every card is wanted", () => {
    const deck = buildDeck([{ card: card("A"), copies: 4 }], 4);
    expect(
      runScenario(scenario(), deck, { runs: 200, seed: 1 }).successRate,
    ).toBe(1);
  });

  it("matches the maths for one copy-limited card in a 60-card deck", () => {
    // P(at least one of 3 copies in 4 cards from 60) = 1 − C(57,4)/C(60,4) ≈ 0.193
    const deck = buildDeck([{ card: card("A"), copies: 3 }], 60);
    const r = runScenario(scenario(), deck, { runs: 20000, seed: 3 });
    expect(r.successRate).toBeGreaterThan(0.18);
    expect(r.successRate).toBeLessThan(0.21);
  });

  it("reports each run's outcome when asked, so two decks can be paired run by run", () => {
    const deck = buildDeck([{ card: card("A"), copies: 3 }], 60);
    const outcomes: boolean[] = [];
    const r = runScenario(scenario(), deck, {
      runs: 500,
      seed: 9,
      onRun: (success) => outcomes.push(success),
    });
    expect(outcomes).toHaveLength(500);
    expect(outcomes.filter(Boolean).length / 500).toBe(r.successRate);
  });

  it("is reproducible from its seed", () => {
    const deck = buildDeck([{ card: card("A"), copies: 3 }], 60);
    expect(runScenario(scenario(), deck, { runs: 500, seed: 9 })).toEqual(
      runScenario(scenario(), deck, { runs: 500, seed: 9 }),
    );
  });

  it("totals an amount across matching cards", () => {
    const maker = card("Maker", { amounts: { runechants: 2 } });
    const deck = buildDeck([{ card: maker, copies: 4 }], 4);
    const total = (min: number) =>
      runScenario(
        scenario({
          condition: {
            all: [
              {
                label: "Runechants",
                filter: {},
                total: "runechants",
                min,
              },
            ],
          },
        }),
        deck,
        { runs: 50, seed: 1 },
      ).successRate;
    expect(total(8)).toBe(1);
    expect(total(9)).toBe(0);
  });

  it("combines blocks with AND and OR, nested", () => {
    const deck = buildDeck(
      [
        { card: card("A", { roles: ["gate_generator"] }), copies: 2 },
        { card: card("B", { pitch: 3 }), copies: 2 },
      ],
      4,
    );
    const rate = (condition: ScenarioDefinition["condition"]) =>
      runScenario(scenario({ condition }), deck, { runs: 50, seed: 1 })
        .successRate;
    expect(
      rate({
        all: [
          { label: "Gate maker", filter: { role: "gate_generator" }, min: 1 },
          { any: [{ label: "blue", filter: { pitch: 3 }, min: 2 }] },
        ],
      }),
    ).toBe(1);
    expect(
      rate({
        any: [
          { label: "red", filter: { pitch: 1, role: "nothing" }, min: 1 },
          { label: "three blue", filter: { pitch: 3 }, min: 3 },
        ],
      }),
    ).toBe(0);
  });

  it("matches traits such as blood debt or Shadow", () => {
    const deck = buildDeck(
      [{ card: card("A", { traits: ["blood_debt", "shadow"] }), copies: 4 }],
      4,
    );
    expect(
      runScenario(
        scenario({
          condition: {
            all: [{ label: "Shadow", filter: { trait: "shadow" }, min: 4 }],
          },
        }),
        deck,
        { runs: 20, seed: 1 },
      ).successRate,
    ).toBe(1);
  });

  it("checks once at the horizon, and breaks the result down by turn", () => {
    const deck = buildDeck([{ card: card("A"), copies: 3 }], 60);
    const r = runScenario(scenario({ horizon: 3 }), deck, {
      runs: 5000,
      seed: 4,
    });
    expect(r.byTurn).toHaveLength(3);
    // Fresh hands each turn: every turn's check is like the opening hand's.
    for (const p of r.byTurn) {
      expect(p).toBeGreaterThan(0.15);
      expect(p).toBeLessThan(0.24);
    }
    expect(r.successRate).toBe(r.byTurn[2]);
  });

  it("groups failures by the block that was false", () => {
    const deck = buildDeck(
      [
        { card: card("A"), copies: 4 },
        { card: card("B", { pitch: 3 }), copies: 0 },
      ],
      4,
    );
    const r = runScenario(
      scenario({
        condition: {
          all: [
            { label: "an A", filter: { name: "A" }, min: 1 },
            { label: "a blue card", filter: { pitch: 3 }, min: 1 },
          ],
        },
      }),
      deck,
      { runs: 100, seed: 1 },
    );
    expect(r.successRate).toBe(0);
    expect(r.failures).toEqual([{ label: "a blue card", share: 1 }]);
  });

  it("records what it ran: deck size, blanks, runs and seed", () => {
    const deck = buildDeck([{ card: card("A"), copies: 3 }], 60);
    const r = runScenario(scenario(), deck, { runs: 100, seed: 5 });
    expect(r.inputs).toMatchObject({
      runs: 100,
      seed: 5,
      deckSize: 60,
      coreCards: 3,
      blanks: 57,
      engineVersion: expect.any(String),
    });
  });
});

// Phase two step 6 (README "The scenario contract" and "Building a rule").
describe("the scenario contract", () => {
  const a = (min: number, filter: Record<string, unknown> = { name: "A" }) => ({
    all: [{ label: "x", filter, min }],
  });
  const rate = (
    over: Partial<ScenarioDefinition>,
    deck: ReturnType<typeof buildDeck>,
    runs = 200,
  ) => runScenario(scenario(over), deck, { runs, seed: 2 }).successRate;

  describe("fixed cards", () => {
    it("takes one copy out of the deck per entry, and puts it where the scenario says", () => {
      // One A in 60: fixed in hand, it's always there, and no copy is left to draw.
      const deck = buildDeck([{ card: card("A"), copies: 1 }], 60);
      expect(
        rate({ fixed: [{ name: "A", zone: "hand" }], condition: a(1) }, deck),
      ).toBe(1);
      expect(
        rate({ fixed: [{ name: "A", zone: "hand" }], condition: a(2) }, deck),
      ).toBe(0);
    });

    it("draws the rest of the hand up to intellect around fixed hand cards", () => {
      const deck = buildDeck(
        [
          { card: card("A"), copies: 1 },
          { card: card("B"), copies: 10 },
        ],
        11,
      );
      // A fixed in hand, then 3 more drawn: never 4 Bs.
      expect(
        rate(
          {
            fixed: [{ name: "A", zone: "hand" }],
            condition: a(4, { name: "B" }),
          },
          deck,
        ),
      ).toBe(0);
      expect(
        rate(
          {
            fixed: [{ name: "A", zone: "hand" }],
            condition: a(3, { name: "B" }),
          },
          deck,
        ),
      ).toBe(1);
    });

    it("can match a pitch, so a fixed red copy leaves the blue ones", () => {
      const deck = buildDeck(
        [
          { card: card("A", { pitch: 1 }), copies: 1 },
          { card: card("A", { id: "A3", pitch: 3 }), copies: 1 },
        ],
        2,
      );
      expect(() =>
        runScenario(
          scenario({ fixed: [{ name: "A", pitch: 3, zone: "hand" }] }),
          deck,
          { runs: 5, seed: 1 },
        ),
      ).not.toThrow();
      expect(() =>
        runScenario(
          scenario({
            fixed: [
              { name: "A", pitch: 3, zone: "hand" },
              { name: "A", pitch: 3, zone: "arsenal" },
            ],
          }),
          deck,
          { runs: 5, seed: 1 },
        ),
      ).toThrow(ScenarioCannotRun);
    });

    it("can't run, and says so, when the deck lacks the copies", () => {
      const deck = buildDeck([{ card: card("A"), copies: 1 }], 60);
      expect(() =>
        runScenario(
          scenario({
            fixed: [
              { name: "A", zone: "hand" },
              { name: "A", zone: "hand" },
            ],
          }),
          deck,
          { runs: 5, seed: 1 },
        ),
      ).toThrow("Needs 2 copies of A; the deck has 1.");
    });

    it("holds one card in the arsenal", () => {
      expect(
        scenarioSchema.safeParse(
          scenario({
            fixed: [
              { name: "A", zone: "arsenal" },
              { name: "B", zone: "arsenal" },
            ],
          }),
        ).success,
      ).toBe(false);
    });
  });

  describe("what conditions can see", () => {
    const deck = () => buildDeck([{ card: card("A"), copies: 1 }], 60);

    it("sees the arsenal only when access includes it", () => {
      const fixed = [{ name: "A", zone: "arsenal" as const }];
      expect(rate({ fixed, access: ["hand"], condition: a(1) }, deck())).toBe(
        0,
      );
      expect(
        rate({ fixed, access: ["hand", "arsenal"], condition: a(1) }, deck()),
      ).toBe(1);
    });

    it("can see the top card of the deck", () => {
      // 4 in hand and the top card: 5 of 60.
      const r = rate(
        { access: ["hand", "topOfDeck"], condition: a(1) },
        deck(),
        20000,
      );
      expect(r).toBeGreaterThan(0.075);
      expect(r).toBeLessThan(0.092);
    });

    it("always sees the weapon and equipment slots", () => {
      const withGear = buildDeck([{ card: card("B"), copies: 4 }], 4, [
        card("Blade", { type: "weapon" }),
      ]);
      expect(rate({ condition: a(1, { type: "weapon" }) }, withGear)).toBe(1);
    });
  });

  describe("blocks", () => {
    it("can count distinct cards instead of copies", () => {
      const deck = buildDeck([{ card: card("A"), copies: 4 }], 4);
      const block = (distinct: boolean) => ({
        all: [{ label: "x", filter: {}, min: 2, distinct }],
      });
      expect(rate({ condition: block(false) }, deck)).toBe(1);
      expect(rate({ condition: block(true) }, deck)).toBe(0);
    });

    it("compares with at most and exactly, as well as at least", () => {
      const deck = buildDeck([{ card: card("A"), copies: 4 }], 4);
      const block = (min: number, max?: number) => ({
        all: [{ label: "x", filter: {}, min, max }],
      });
      expect(rate({ condition: block(0, 3) }, deck)).toBe(0);
      expect(rate({ condition: block(4, 4) }, deck)).toBe(1);
      expect(rate({ condition: block(0, 4) }, deck)).toBe(1);
    });

    it("filters by card type", () => {
      const deck = buildDeck(
        [{ card: card("A", { type: "attack_action" }), copies: 4 }],
        4,
      );
      expect(rate({ condition: a(4, { type: "attack_action" }) }, deck)).toBe(
        1,
      );
      expect(rate({ condition: a(1, { type: "instant" }) }, deck)).toBe(0);
    });
  });

  it("keeps cards between turns when the turn model draws up, and keeps the arsenal", () => {
    const deck = buildDeck(
      [
        { card: card("A"), copies: 1 },
        { card: card("B"), copies: 59 },
      ],
      60,
    );
    const fixed = [{ name: "A", zone: "hand" as const }];
    expect(
      rate({ horizon: 3, turnModel: "drawUp", fixed, condition: a(1) }, deck),
    ).toBe(1);
    expect(
      rate({ horizon: 3, turnModel: "fresh", fixed, condition: a(1) }, deck),
    ).toBe(0);
    expect(
      rate(
        {
          horizon: 3,
          turnModel: "fresh",
          access: ["hand", "arsenal"],
          fixed: [{ name: "A", zone: "arsenal" }],
          condition: a(1),
        },
        deck,
      ),
    ).toBe(1);
  });
});

// Phase two step 8 (README "Failed hands"): each failed run's seed loads that exact shuffle in
// goldfish, fixed cards and all.
describe("failed hands", () => {
  const deck = buildDeck(
    [
      { card: card("A"), copies: 1 },
      { card: card("B"), copies: 19 },
    ],
    20,
  );

  it("keeps the seeds of a few failed runs", () => {
    const r = runScenario(scenario(), deck, { runs: 200, seed: 3 });
    expect(r.failedSeeds.length).toBeGreaterThan(0);
    expect(r.failedSeeds.length).toBeLessThanOrEqual(5);
  });

  it("deals a failed run's hand in a new game from its seed", () => {
    const r = runScenario(scenario(), deck, { runs: 200, seed: 3 });
    for (const seed of r.failedSeeds) {
      const hand = newGame({ deck: deck.cards as EngineCard[], seed }).present
        .zones.hand;
      expect(hand).toHaveLength(4);
      expect(hand.map((c) => c.card.name)).not.toContain("A");
    }
  });

  it("does the same with fixed cards, taking the same copy out of the deck", () => {
    const fixed = [{ name: "B", zone: "hand" as const }];
    const r = runScenario(scenario({ fixed }), deck, { runs: 200, seed: 3 });
    for (const seed of r.failedSeeds) {
      const game = newGame({
        deck: deck.cards as EngineCard[],
        seed,
        fixed,
      }).present;
      expect(game.zones.hand).toHaveLength(4);
      expect(game.zones.hand.map((c) => c.card.name)).not.toContain("A");
      expect(game.zones.deck).toHaveLength(16);
    }
  });
});

// Phase two step 9, scenarios stage 2 (README "Steps (the flow)"): scripted, deterministic
// steps run each turn after the draw and before the check. A step that chooses a card takes
// the lowest pitch, then the first in hand (no scores in the engine yet).
describe("scripted steps", () => {
  const rate = (
    over: Partial<ScenarioDefinition>,
    deck: ReturnType<typeof buildDeck>,
    runs = 100,
  ) => runScenario(scenario(over), deck, { runs, seed: 4 }).successRate;
  const count = (
    min: number,
    filter: Record<string, unknown> = { name: "A" },
  ) => ({
    all: [{ label: "x", filter, min }],
  });

  it("are checked against the contract", () => {
    expect(
      scenarioSchema.safeParse(
        scenario({
          steps: [{ turn: "each", do: "arsenal", filter: { name: "A" } }],
        }),
      ).success,
    ).toBe(true);
    expect(
      scenarioSchema.safeParse(
        scenario({ steps: [{ turn: "each", do: "teleport" }] as never }),
      ).success,
    ).toBe(false);
    expect(
      scenarioSchema.safeParse(
        scenario({ steps: [{ turn: 1, do: "draw", count: 0 }] }),
      ).success,
    ).toBe(false);
  });

  it("draws extra cards", () => {
    const deck = buildDeck([{ card: card("A"), copies: 10 }], 10);
    const steps = [{ turn: 1 as const, do: "draw" as const, count: 2 }];
    expect(rate({ horizon: 1, steps, condition: count(6) }, deck)).toBe(1);
    expect(rate({ horizon: 1, steps, condition: count(7) }, deck)).toBe(0);
  });

  it("don't run for the opening hand", () => {
    const deck = buildDeck([{ card: card("A"), copies: 10 }], 10);
    const steps = [{ turn: 1 as const, do: "draw" as const, count: 2 }];
    expect(rate({ horizon: 0, steps, condition: count(5) }, deck)).toBe(0);
  });

  it("pitch a matching card out of the hand", () => {
    const deck = buildDeck([{ card: card("A"), copies: 10 }], 10);
    const steps = [
      { turn: 1 as const, do: "pitch" as const, filter: { name: "A" } },
    ];
    expect(rate({ horizon: 1, steps, condition: count(4) }, deck)).toBe(0);
    expect(rate({ horizon: 1, steps, condition: count(3) }, deck)).toBe(1);
  });

  it("put the lowest-pitch matching card in arsenal, kept between turns", () => {
    const deck = buildDeck(
      [
        { card: card("A", { pitch: 3 }), copies: 2 },
        { card: card("A", { id: "A1", pitch: 1 }), copies: 2 },
      ],
      4,
    );
    const steps = [
      { turn: 1 as const, do: "arsenal" as const, filter: { name: "A" } },
    ];
    expect(
      rate(
        {
          horizon: 1,
          access: ["arsenal"],
          steps,
          condition: count(1, { pitch: 1 }),
        },
        deck,
      ),
    ).toBe(1);
  });

  it("only fill an empty arsenal", () => {
    const deck = buildDeck([{ card: card("A"), copies: 10 }], 10);
    const steps = [
      { turn: "each" as const, do: "arsenal" as const, filter: {} },
    ];
    // Fresh hands each turn, the arsenal kept: still one card in it by turn 3.
    expect(
      rate(
        { horizon: 3, access: ["arsenal"], steps, condition: count(2) },
        deck,
      ),
    ).toBe(0);
    expect(
      rate(
        { horizon: 3, access: ["arsenal"], steps, condition: count(1) },
        deck,
      ),
    ).toBe(1);
  });

  it("banish from hand, where the banished zone can see it", () => {
    const deck = buildDeck([{ card: card("A"), copies: 10 }], 10);
    const steps = [
      { turn: "each" as const, do: "banish" as const, filter: {} },
    ];
    expect(
      rate(
        { horizon: 2, access: ["banished"], steps, condition: count(2) },
        deck,
      ),
    ).toBe(1);
  });

  it("block with cards, and draw back up next turn when cards stay", () => {
    const deck = buildDeck([{ card: card("A"), copies: 20 }], 20);
    const steps = [{ turn: 1 as const, do: "block" as const, count: 3 }];
    expect(rate({ horizon: 1, steps, condition: count(1) }, deck)).toBe(1);
    expect(rate({ horizon: 1, steps, condition: count(2) }, deck)).toBe(0);
    expect(
      rate(
        { horizon: 2, turnModel: "drawUp", steps, condition: count(4) },
        deck,
      ),
    ).toBe(1);
  });
});
