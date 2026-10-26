import { describe, expect, it } from "vitest";
import * as rules from "../../src/rules/index.ts";
import { type RulesCard, type RulesEvent } from "../../src/rules/index.ts";

const card = (name: string, traits: string[] = [], pitch = 3): RulesCard => ({
  id: name,
  name,
  pitch,
  cost: 0,
  type: "action",
  goAgain: true,
  roles: [],
  traits,
  amounts: {},
  effects: [],
});
const cards = new Map([
  ["bsl", card("Become the Shadow Lord")],
  ["red-bsl", card("Become the Shadow Lord", [], 1)],
  ["payoff", card("Blood debt", ["blood_debt"])],
  ["other", card("Other")],
]);
const start = (turn: number): RulesEvent => ({ type: "turnStarted", turn });
const play = (uid: string): RulesEvent => ({ type: "played", uid, cost: 0 });
const gate = (): RulesEvent => ({ type: "gateActivated", target: "other" });

describe("opt-in chain summaries", () => {
  it("records one match per completed run, omits failed traces and preserves other report fields", () => {
    const setup = { deck: [...cards.values()], order: "asGiven" as const };
    const script: rules.Script = { version: 1, steps: [] };
    const options = {
      runs: 2,
      seed: 17,
      policy: {
        id: "fixture",
        assumptions: {},
        run: (input: rules.RulesSetup) => ({
          ...rules.runScript(input, script),
          trace: [start(1), play("d0"), gate(), play("d2")],
        }),
      },
    };
    const baseline = rules.runBatch(setup, script, options);
    const measured = rules.runBatch(setup, script, {
      ...options,
      measureBslGateBloodDebt: true,
    });
    expect(measured.inputs).toHaveProperty("measureBslGateBloodDebt", true);
    expect(measured.perRun[0]).toHaveProperty("bslGateBloodDebt.reached", 3);
    expect(baseline.perRun[0]).not.toHaveProperty("bslGateBloodDebt");
    expect(
      measured.perRun.map(({ bslGateBloodDebt, ...rest }) => rest),
    ).toEqual(baseline.perRun);
    expect(rules.chainSpeedDistribution(measured)).toEqual({
      chain: "bsl-gate-blood-debt",
      population: 2,
      reached: [0, 0, 0, 2],
      by_delay: [2, 0, 0],
    });
    const failed = rules.runBatch(setup, script, {
      ...options,
      measureBslGateBloodDebt: true,
      policy: {
        ...options.policy,
        run: (input: rules.RulesSetup) => ({
          ...options.policy.run(input),
          failure: "budget",
        }),
      },
    });
    expect(rules.chainSpeedDistribution(failed)).toEqual({
      chain: "bsl-gate-blood-debt",
      population: 0,
      reached: [0, 0, 0, 0],
      by_delay: [0, 0, 0],
    });
    expect(failed.perRun[0]).not.toHaveProperty("bslGateBloodDebt");
  });

  it("rejects reports without the requested measurement rather than counting missing results as failures", () => {
    const report = rules.runBatch(
      { deck: [] },
      { version: 1, steps: [] },
      { runs: 1, seed: 17 },
    );
    expect(() => rules.chainSpeedDistribution(report)).toThrow(/measurement/i);
  });
});

describe("T5 chain-speed comparison", () => {
  const distribution = (
    by_delay: [number, number, number],
    population = 1000,
  ): rules.ChainSpeedDistribution => ({
    chain: "bsl-gate-blood-debt",
    population,
    reached: [
      population - by_delay.reduce((total, count) => total + count, 0),
      0,
      0,
      by_delay.reduce((total, count) => total + count, 0),
    ],
    by_delay,
  });
  const approved = { activatesGates: true, review: "approved" as const };

  it("exposes a separate T5 comparison without changing the default checks", () => {
    expect(rules).toHaveProperty("compareChainSpeed");
  });

  it("compares conditional shares of completions, not shares of the whole population", () => {
    const result = rules.compareChainSpeed(
      distribution([400, 350, 250], 10000),
      distribution([400, 350, 250]),
      approved,
    );
    expect(result.status).toBe("compared");
    expect(result.checks.map((check) => check.verdict)).toEqual([
      "within",
      "within",
      "within",
    ]);
    expect(result.checks[0]).toMatchObject({
      threshold: "T5",
      delay: 0,
      observed: 0.4,
      simulated: 0.4,
      gap: 0,
    });
  });

  it("investigates only gaps strictly greater than ten points, including floating-point boundaries", () => {
    const observed = distribution([400, 350, 250]);
    expect(
      rules.compareChainSpeed(observed, distribution([300, 450, 250]), approved)
        .checks[0]!.gap,
    ).toBe(0.1);
    expect(
      rules
        .compareChainSpeed(observed, distribution([300, 450, 250]), approved)
        .checks.map((check) => check.verdict),
    ).toEqual(["within", "within", "within"]);
    expect(
      rules
        .compareChainSpeed(observed, distribution([299, 451, 250]), approved)
        .checks.map((check) => check.verdict),
    ).toEqual(["investigate", "investigate", "within"]);
  });

  it("does not turn zero completions or small populations into zero-share verdicts", () => {
    for (const [observed, simulated] of [
      [distribution([0, 0, 0]), distribution([400, 350, 250])],
      [distribution([40, 35, 25], 199), distribution([400, 350, 250])],
      [distribution([400, 350, 250]), distribution([40, 35, 25], 999)],
    ]) {
      expect(
        rules
          .compareChainSpeed(observed!, simulated!, approved)
          .checks.map((check) => check.verdict),
      ).toEqual(["not enough data", "not enough data", "not enough data"]);
    }
  });

  it("does not run T5 for a baseline or an unapproved draft script", () => {
    for (const script of [
      { activatesGates: false, review: "approved" as const },
      { activatesGates: true, review: "unverified" as const },
    ]) {
      expect(
        rules.compareChainSpeed(
          distribution([400, 350, 250]),
          distribution([400, 350, 250]),
          script,
        ),
      ).toMatchObject({ status: "not run", checks: [] });
    }
  });

  it("rejects malformed counts rather than changing their denominator", () => {
    const valid = distribution([400, 350, 250]);
    for (const invalid of [
      { ...valid, population: 999 },
      { ...valid, by_delay: [-1, 751, 250] },
      { ...valid, by_delay: [399, 350, 250] },
    ]) {
      expect(() =>
        rules.compareChainSpeed(
          invalid as rules.ChainSpeedDistribution,
          valid,
          approved,
        ),
      ).toThrow(/counts|population/);
    }
  });
});

describe("BSL → Gate → blood debt trace measurement", () => {
  it("exposes the trace measurement without changing the default batch", () => {
    expect(rules).toHaveProperty("measureBslGateBloodDebt");
  });

  it.each([0, 1, 2])("measures a %i-turn completion", (delay) => {
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("bsl"), start(1 + delay), gate(), play("payoff")],
        cards,
      ),
    ).toEqual({
      reached: 3,
      setupTurn: 1,
      gateTurn: 1 + delay,
      payoffTurn: 1 + delay,
      delay,
    });
  });

  it("requires playing blue BSL, an activation and a later blood debt play", () => {
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("red-bsl"), gate(), play("payoff")],
        cards,
      ).reached,
    ).toBe(0);
    expect(
      rules.measureBslGateBloodDebt(
        [
          start(1),
          { type: "pitched", uid: "bsl", amount: 3 },
          gate(),
          play("payoff"),
        ],
        cards,
      ).reached,
    ).toBe(0);
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("bsl"), play("payoff"), gate()],
        cards,
      ).reached,
    ).toBe(2);
    expect(
      rules.measureBslGateBloodDebt(
        [
          start(1),
          play("bsl"),
          { type: "tokensCreated", token: "gate", amount: 1 },
          play("payoff"),
        ],
        cards,
      ).reached,
    ).toBe(1);
  });

  it("enforces the two-turn Gate window and same-turn payoff", () => {
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("bsl"), start(4), gate(), play("payoff")],
        cards,
      ).reached,
    ).toBe(1);
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("bsl"), gate(), start(2), play("payoff")],
        cards,
      ).reached,
    ).toBe(2);
  });

  it("takes the furthest attempt, breaking ties by earliest setup, not shortest delay", () => {
    const result = rules.measureBslGateBloodDebt(
      [
        start(1),
        play("bsl"),
        start(5),
        play("bsl"),
        start(6),
        play("bsl"),
        gate(),
        play("payoff"),
      ],
      cards,
    );
    expect(result).toEqual({
      reached: 3,
      setupTurn: 5,
      gateTurn: 6,
      payoffTurn: 6,
      delay: 1,
    });
  });

  it("uses the first eligible Gate per attempt, like the observed matcher", () => {
    const result = rules.measureBslGateBloodDebt(
      [start(1), play("bsl"), gate(), start(2), gate(), play("payoff")],
      cards,
    );
    expect(result.reached).toBe(2);
    expect(result.gateTurn).toBe(1);
  });

  it("measures the logged proxy, without inventing target or banished-zone attribution", () => {
    expect(
      rules.measureBslGateBloodDebt(
        [start(1), play("bsl"), gate(), play("payoff")],
        cards,
      ).reached,
    ).toBe(3);
  });
});
