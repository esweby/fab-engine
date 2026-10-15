// Viserai's traverse rule set (unverified): a separate rule set, switched on explicitly.
import { describe, expect, it } from "vitest";
import { buildDeck, type EngineCard } from "../src/index.ts";
import { runTraverse } from "../src/rulesets/viseraiTraverse.ts";

const card = (name: string, over: Partial<EngineCard> = {}): EngineCard => ({
  id: name,
  name,
  pitch: 1,
  roles: [],
  traits: [],
  amounts: {},
  ...over,
});

describe("runTraverse", () => {
  it("flips to Usurper in a turn that creates 3 or more Runechants", () => {
    const burst = card("Burst", { amounts: { runechants: 3 } });
    const r = runTraverse(buildDeck([{ card: burst, copies: 8 }], 8), {
      turns: 2,
      runs: 50,
      seed: 1,
    });
    expect(r.reachedUsurper).toEqual([1, 1]);
  });

  it("never flips without Runechants", () => {
    const r = runTraverse(buildDeck([], 60), { turns: 3, runs: 50, seed: 1 });
    expect(r.reachedUsurper).toEqual([0, 0, 0]);
    expect(r.neverReached).toBe(1);
  });

  it("flips back to Forsaken on a turn on Usurper that creates a Gate", () => {
    const both = card("Both", { amounts: { runechants: 3, gates: 1 } });
    const r = runTraverse(buildDeck([{ card: both, copies: 12 }], 12), {
      turns: 2,
      runs: 20,
      seed: 1,
    });
    // Turn 1: Forsaken → Usurper. Turn 2: Usurper creates a Gate → Forsaken.
    expect(r.reachedUsurper).toEqual([1, 1]);
    expect(r.flippedBack).toEqual([0, 1]);
    expect(r.onUsurper).toEqual([1, 0]);
  });

  it("counts conditional Runechants only when asked to assume conditions are met", () => {
    const cond = card("Cond", {
      amounts: { runechants: 3, runechantsUnconditional: 0 },
    });
    const deck = buildDeck([{ card: cond, copies: 8 }], 8);
    expect(
      runTraverse(deck, { turns: 1, runs: 10, seed: 1, conditions: "met" })
        .reachedUsurper,
    ).toEqual([1]);
    expect(
      runTraverse(deck, { turns: 1, runs: 10, seed: 1, conditions: "unmet" })
        .reachedUsurper,
    ).toEqual([0]);
  });
});
