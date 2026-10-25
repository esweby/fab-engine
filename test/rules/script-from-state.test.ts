import { describe, expect, it } from "vitest";
import * as rules from "../../src/rules/index.ts";
import type { RulesCard, RulesState, Script } from "../../src/rules/index.ts";

const filler: RulesCard = {
  id: "filler",
  name: "Filler",
  pitch: 3,
  cost: 0,
  type: "action",
  goAgain: false,
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};
const setup = {
  deck: Array.from({ length: 12 }, () => filler),
  seed: 17,
  order: "asGiven" as const,
};
const execute = (state: RulesState, script: Script) => {
  expect(rules.runScriptFromState).toBeTypeOf("function");
  return rules.runScriptFromState(state, script);
};

describe("a script from a declared mid-turn state", () => {
  it("matches the existing setup runner from the same initial state", () => {
    const script = rules.parseScript({
      version: 1,
      steps: [{ do: "play", card: {} }, { do: "endTurn" }],
    });
    expect(execute(rules.setUp(setup), script)).toEqual(
      rules.runScript(setup, script),
    );
  });

  it("does not reset a declared turn, resources, tokens or hand", () => {
    const initial = {
      ...rules.setUp(setup),
      turn: 3,
      resources: 2,
      actionPoints: 0,
      tokens: { gate: 2, runechant: 4 },
    };
    const before = structuredClone(initial);
    const result = execute(
      initial,
      rules.parseScript({ version: 1, steps: [{ do: "play", card: {} }] }),
    );
    expect(result.steps[0]!.outcome).toBe("skipped");
    expect(result.state).toEqual(before);
    expect(initial).toEqual(before);
    expect(result.trace).toEqual(initial.events);
  });
});
