import { describe, expect, it } from "vitest";
import {
  moveCard,
  parseScript,
  runScriptFromState,
  setUp,
  type RulesCard,
} from "../../src/rules/index.ts";

const card: RulesCard = {
  id: "same",
  name: "Same card",
  type: "action",
  pitch: 3,
  cost: 0,
  goAgain: false,
  traits: [],
  roles: [],
  amounts: {},
  effects: [],
  playableFromBanish: true,
};
const initial = () =>
  moveCard(
    setUp({
      deck: Array.from({ length: 8 }, () => card),
      seed: 1,
      order: "asGiven",
    }),
    "d4",
    "banished",
  );

describe("a script play restricted to its source zone", () => {
  it("chooses a face-up Gate target rather than a face-down matching copy", () => {
    const deck = Array.from({ length: 8 }, () => ({
      ...card,
      traits: ["blood_debt"],
    }));
    const initial = setUp({ deck, seed: 1, order: "asGiven" });
    const banished = moveCard(
      moveCard(initial, "d4", "banished", { faceDown: true }),
      "d5",
      "banished",
    );
    const state = { ...banished, resources: 1, tokens: { gate: 1 } };
    const result = runScriptFromState(
      state,
      parseScript({
        version: 1,
        steps: [{ do: "activateGate", target: { name: "Same card" } }],
      }),
    );
    expect(result.trace).toContainEqual({
      type: "gateActivated",
      target: "d5",
    });
  });
  it("plays the banished copy, not an identical card in hand", () => {
    let script;
    expect(() => {
      script = parseScript({
        version: 1,
        steps: [
          {
            do: "play",
            from: "banished",
            card: { name: "Same card", pitch: 3 },
          },
        ],
      });
    }).not.toThrow();
    const state = initial();
    const result = runScriptFromState(state, script!);
    expect(result.trace).toContainEqual({
      type: "playedFromBanish",
      uid: "d4",
    });
    expect(result.state.zones.hand).toEqual(state.zones.hand);
  });

  it("does not fall back to a hand copy when the chosen zone has none", () => {
    let script;
    expect(() => {
      script = parseScript({
        version: 1,
        steps: [{ do: "play", from: "arsenal", card: { name: "Same card" } }],
      });
    }).not.toThrow();
    const state = initial();
    const result = runScriptFromState(state, script!);
    expect(result.steps[0]!.outcome).toBe("skipped");
    expect(result.state).toEqual(state);
  });

  it("retains the existing hand-first behaviour without a source zone", () => {
    const result = runScriptFromState(
      initial(),
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { name: "Same card" } }],
      }),
    );
    expect(result.trace).toContainEqual({ type: "played", uid: "d0", cost: 0 });
  });
});
