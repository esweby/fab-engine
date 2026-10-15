import { describe, expect, it } from "vitest";
import {
  buildDeck,
  runScenario,
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
