import { describe, expect, it } from "vitest";
import { parseScript, runBatch, runScript } from "../../src/rules/index.ts";

describe("opt-in batch execution", () => {
  const setup = { deck: [] };
  const script = parseScript({ version: 1, steps: [{ do: "endTurn" }] });
  const options = { runs: 3, seed: 17 };

  it("uses the same seeds and records policy inputs and each run's matches", () => {
    const seeds: number[] = [];
    const baseline = runBatch(setup, script, options);
    const report = runBatch(setup, script, {
      ...options,
      policy: {
        id: "fixture-v1",
        assumptions: { mode: "both", reserveBsl: true },
        run: (input, steps) => {
          seeds.push(input.seed);
          return { ...runScript(input, steps), policyMatches: { fixture: 1 } };
        },
      },
    });
    expect(seeds).toEqual(baseline.perRun.map((run) => run.seed));
    expect(report.inputs.policy).toEqual({
      id: "fixture-v1",
      assumptions: { mode: "both", reserveBsl: true },
    });
    expect(report.perRun.map((run) => run.policyMatches)).toEqual([
      { fixture: 1 },
      { fixture: 1 },
      { fixture: 1 },
    ]);
    expect(report.byTurn).toEqual(baseline.byTurn);
    expect(baseline.inputs).not.toHaveProperty("policy");
    expect(baseline.perRun[0]).not.toHaveProperty("policyMatches");
  });

  it("keeps matches on failed runs separate from completed results", () => {
    const report = runBatch(setup, script, {
      ...options,
      policy: {
        id: "failed-fixture-v1",
        assumptions: {},
        run: (input, steps) => ({
          ...runScript(input, steps),
          failure: "fixture budget",
          policyMatches: { fixture: 1 },
        }),
      },
    });
    expect(report.failed).toBe(3);
    expect(report.completed).toBe(0);
    expect(report.byTurn).toEqual([]);
    expect(
      report.perRun.every(
        (run) => !run.completed && run.policyMatches?.fixture === 1,
      ),
    ).toBe(true);
  });

  it("snapshots counts even when a policy reuses its counter object", () => {
    const matches = { fixture: 0 };
    const report = runBatch(setup, script, {
      ...options,
      policy: {
        id: "shared-counter-fixture-v1",
        assumptions: {},
        run: (input, steps) => {
          matches.fixture++;
          return { ...runScript(input, steps), policyMatches: matches };
        },
      },
    });
    expect(report.perRun.map((run) => run.policyMatches?.fixture)).toEqual([
      1, 2, 3,
    ]);
  });
});
