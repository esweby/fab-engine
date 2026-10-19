// Step 7a (docs/rules-engine.md): seeded batches of scripted runs and their reports. Rates are
// successful completed runs over completed runs; failed runs are counted apart. Every report
// says what it measured and records its inputs, including a hash of the rules data.
import { describe, expect, it } from "vitest";
import {
  BLOOD_DEBT,
  cardWithRules,
  compareBatches,
  coverage,
  parseScript,
  rulesDataVersion,
  runBatch,
  RUNECHANT,
  VISERAI,
  type RulesCard,
} from "../../src/rules/index.ts";

const fact = (name: string, over: Partial<RulesCard> = {}): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 1,
    cost: 0,
    goAgain: false,
    type: "action",
    roles: [],
    traits: [],
    amounts: {},
    ...over,
  });
const BSL = () =>
  fact("Become the Shadow Lord", {
    pitch: 3,
    goAgain: true,
    traits: ["runeblade", "shadow"],
  });
const CULLINGSONG = () =>
  fact("Cullingsong Gloomblade", {
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const MAKER = () =>
  fact("Maker", {
    effects: [{ op: "createToken", token: "runechant", amount: 1 }],
  });
const GENERIC = (i: number) => fact(`Generic ${i}`, { pitch: 3 });
const RULES = [...VISERAI, RUNECHANT, BLOOD_DEBT];
const copies = (make: () => RulesCard, n: number) =>
  Array.from({ length: n }, make);

const bslScript = parseScript({
  version: 1,
  choices: { banish: [{ name: "Cullingsong Gloomblade" }] },
  steps: [
    {
      do: "repeat",
      times: 3,
      steps: [
        { do: "play", card: { name: "Become the Shadow Lord" } },
        { do: "play", card: { name: "Cullingsong Gloomblade" } },
        { do: "endTurn" },
      ],
    },
  ],
});
const bslDeck = [
  ...copies(BSL, 10),
  ...copies(CULLINGSONG, 10),
  ...Array.from({ length: 40 }, (_, i) => GENERIC(i)),
];

describe("seeded batches", () => {
  it("are reproducible from their seed", () => {
    const run = () =>
      runBatch({ deck: bslDeck, triggers: RULES }, bslScript, {
        runs: 50,
        seed: 3,
      });
    expect(run()).toEqual(run());
  });

  it("report per turn, as the share of completed runs", () => {
    const report = runBatch({ deck: bslDeck, triggers: RULES }, bslScript, {
      runs: 200,
      seed: 3,
    });
    expect(report).toMatchObject({ runs: 200, completed: 200, failed: 0 });
    expect(report.byTurn).toHaveLength(3);
    const gate = report.byTurn.map((t) => t.gateBy);
    // "A Gate by turn N" only grows.
    expect(gate[0]!).toBeGreaterThan(0);
    expect(gate[0]!).toBeLessThanOrEqual(gate[1]!);
    expect(gate[1]!).toBeLessThanOrEqual(gate[2]!);
    // The rate is exactly the runs' own flags over completed runs.
    const flags = report.perRun.filter((r) => r.completed);
    expect(gate[0]).toBe(
      flags.filter((r) => r.gateByTurn[0]).length / flags.length,
    );
  });

  it("averages Runechants made per turn", () => {
    const report = runBatch(
      { deck: copies(MAKER, 30), triggers: RULES },
      parseScript({
        version: 1,
        steps: [
          { do: "play", card: { name: "Maker" } },
          { do: "endTurn" },
          { do: "play", card: { name: "Maker" } },
          { do: "endTurn" },
        ],
      }),
      { runs: 20, seed: 1 },
    );
    expect(report.byTurn.map((t) => t.runechantsMade)).toEqual([1, 1]);
  });

  it('keep "entered the banished zone" apart from "still there"', () => {
    const script = parseScript({
      version: 1,
      choices: { banish: [{ name: "Cullingsong Gloomblade" }] },
      steps: [
        { do: "play", card: { name: "Become the Shadow Lord" } },
        { do: "play", card: { name: "Cullingsong Gloomblade" } },
        { do: "endTurn" },
      ],
    });
    // A fixed order: BSL banishes Cullingsong, which is then played from there.
    const report = runBatch(
      {
        deck: [
          BSL(),
          CULLINGSONG(),
          GENERIC(1),
          GENERIC(2),
          ...Array.from({ length: 20 }, (_, i) => GENERIC(10 + i)),
        ],
        order: "asGiven",
        triggers: RULES,
      },
      script,
      {
        runs: 5,
        seed: 1,
        queries: [
          {
            id: "cull-entered",
            kind: "entered",
            card: { name: "Cullingsong Gloomblade" },
          },
          {
            id: "cull-there",
            kind: "remains",
            card: { name: "Cullingsong Gloomblade" },
          },
        ],
      },
    );
    expect(report.byTurn[0]!.queries).toEqual({
      "cull-entered": 1,
      "cull-there": 0,
    });
  });

  it("count failed runs apart, never as successes", () => {
    const report = runBatch(
      {
        deck: copies(MAKER, 30),
        budget: 10,
        triggers: [
          {
            id: "example-loop",
            on: { event: "tokensCreated", token: "runechant" },
            effects: [{ op: "createToken", token: "runechant", amount: 1 }],
          },
        ],
      },
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { name: "Maker" } }, { do: "endTurn" }],
      }),
      { runs: 10, seed: 1 },
    );
    expect(report).toMatchObject({ completed: 0, failed: 10 });
    expect(report.failures[0]).toMatchObject({ count: 10 });
    expect(report.byTurn).toEqual([]);
  });

  it("record their inputs, with a hash of the rules data", () => {
    const report = runBatch({ deck: bslDeck, triggers: RULES }, bslScript, {
      runs: 5,
      seed: 9,
    });
    expect(report.inputs).toMatchObject({
      runs: 5,
      seed: 9,
      engineVersion: expect.any(String),
      rulesDataVersion: rulesDataVersion(bslDeck, RULES),
    });
    const changed = bslDeck.map((c) =>
      c.name === "Cullingsong Gloomblade" ? { ...c, usurp: false } : c,
    );
    expect(rulesDataVersion(changed, RULES)).not.toBe(
      rulesDataVersion(bslDeck, RULES),
    );
  });
});

describe("comparing two scripts", () => {
  it("runs both on the same seeds and reports the difference per turn", () => {
    const quiet = parseScript({
      version: 1,
      steps: [{ do: "endTurn" }, { do: "endTurn" }, { do: "endTurn" }],
    });
    const diff = compareBatches(
      { deck: bslDeck, triggers: RULES },
      [quiet, bslScript],
      { runs: 100, seed: 4 },
    );
    expect(diff.a.inputs.seed).toBe(diff.b.inputs.seed);
    expect(diff.byTurn[0]!.gateBy).toBeCloseTo(
      diff.b.byTurn[0]!.gateBy - diff.a.byTurn[0]!.gateBy,
    );
    expect(diff.byTurn[0]!.gateBy).toBeGreaterThan(0);
  });
});

describe("coverage", () => {
  it("counts deck cards with verified effects, and names the rest", () => {
    expect(coverage([BSL(), BSL(), GENERIC(1), CULLINGSONG()])).toEqual({
      modelled: 3,
      total: 4,
      unmodelled: ["Generic 1"],
    });
  });
});
