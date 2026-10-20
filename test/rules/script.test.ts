// Step 6 (docs/rules-engine.md): one deterministic scripted run from a fixed deck order, replayed
// to an identical trace. Scripts are data, not code: a few step kinds, a bounded repeat and an
// if. The scripted policy chooses from legal options only, by fixed rules.
//
// The fixed run below uses only the signed-off cards from steps 5a and 5b. Its expected outcome
// is worked out from those rules and AWAITS THE MAINTAINER'S SIGN-OFF.
import { describe, expect, it } from "vitest";
import {
  BLOOD_DEBT,
  cardWithRules,
  parseScript,
  RulesError,
  RUNECHANT,
  runScript,
  scriptedOpt,
  VISERAI,
  type RulesCard,
  type Script,
} from "../../src/rules/index.ts";

const fact = (name: string, over: Partial<RulesCard>): RulesCard =>
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
const MURMURING = () =>
  fact("Murmuring Gloomblade", {
    type: "attack_action",
    cost: 2,
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const CULLINGSONG = () =>
  fact("Cullingsong Gloomblade", {
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const MALEFIC = () =>
  fact("Malefic Incantation", {
    goAgain: true,
    traits: ["runeblade", "aura"],
  });
const SPARE = (i: number) => fact(`Deck ${i}`, { pitch: 3 });

/** Hand: Malefic, BSL, Cullingsong, Murmuring; then 20 generic cards, in this order. */
const setup = {
  deck: [
    MALEFIC(),
    BSL(),
    CULLINGSONG(),
    MURMURING(),
    ...Array.from({ length: 20 }, (_, i) => SPARE(i)),
  ],
  seed: 1,
  order: "asGiven" as const,
  triggers: [...VISERAI, RUNECHANT, BLOOD_DEBT],
};

const turnOne: Script = parseScript({
  version: 1,
  choices: { banish: [{ name: "Murmuring Gloomblade" }] },
  steps: [
    { do: "play", card: { name: "Malefic Incantation" } },
    { do: "play", card: { name: "Become the Shadow Lord" } },
    { do: "play", card: { name: "Cullingsong Gloomblade" } },
    { do: "play", card: { name: "Murmuring Gloomblade" } },
    { do: "endTurn" },
  ],
});

describe("a fixed scripted run", () => {
  it("plays out turn 1 as the rules say", () => {
    const run = runScript(setup, turnOne);
    expect(run.failure).toBeUndefined();
    expect(run.steps.map((s) => s.outcome)).toEqual([
      "done",
      "done",
      "done",
      // Cullingsong has no go again, so no action point is left for Murmuring.
      "skipped",
      "done",
    ]);
    expect(run.steps[3]!.reason).toBe("No action point left.");
    const s = run.state;
    // BSL banished Murmuring: a Runechant and a Gate; Viserai banished Deck 0. Cullingsong
    // usurped that Runechant; Malefic made another (2 verse counters left); Viserai banished
    // Deck 1. 2 Runechants made this turn: no traverse.
    expect(s.tokens).toEqual({ runechant: 1, gate: 1 });
    expect(s.zones.banished.map((i) => i.card.name)).toEqual([
      "Murmuring Gloomblade",
      "Deck 0",
      "Deck 1",
    ]);
    expect(s.side).toBe("forsaken");
    // Blood Debt: Murmuring face up in the banished zone at the end phase.
    expect(s.lifeLost).toBe(1);
    expect(s.turn).toBe(2);
    expect(s.zones.hand.map((i) => i.card.name)).toEqual([
      "Deck 2",
      "Deck 3",
      "Deck 4",
      "Deck 5",
    ]);
  });

  it("replays to an identical trace", () => {
    expect(runScript(setup, turnOne)).toEqual(runScript(setup, turnOne));
  });
});

describe("the scripted policy", () => {
  it("pitches the highest pitch first to pay for a play", () => {
    const run = runScript(
      { ...setup, deck: [MURMURING(), BSL(), ...setup.deck.slice(4)] },
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { name: "Murmuring Gloomblade" } }],
      }),
    );
    expect(run.steps[0]!.outcome).toBe("done");
    expect(run.state.zones.pitch.map((i) => i.card.name)).toEqual([
      "Become the Shadow Lord",
    ]);
  });

  it("picks the lowest pitch, then hand order, among cards that fit a step", () => {
    const run = runScript(
      {
        ...setup,
        deck: [
          fact("Blue spell", { pitch: 3, effects: [] }),
          fact("Red spell", { pitch: 1, effects: [] }),
          ...setup.deck.slice(4),
        ],
      },
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { type: "action" } }],
      }),
    );
    expect(run.state.zones.graveyard.map((i) => i.card.name)).toEqual([
      "Red spell",
    ]);
  });

  it("skips a step nothing fits, and says so", () => {
    const run = runScript(
      setup,
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { name: "Nothing like it" } }],
      }),
    );
    expect(run.steps[0]).toMatchObject({
      outcome: "skipped",
      reason: "No card fits the step.",
    });
  });

  it("repeats a bounded number of times, and branches on the state", () => {
    const run = runScript(
      setup,
      parseScript({
        version: 1,
        steps: [
          { do: "repeat", times: 2, steps: [{ do: "endTurn" }] },
          {
            do: "if",
            check: { tokens: "runechant", atLeast: 1 },
            then: [{ do: "stop" }],
            else: [{ do: "endTurn" }],
          },
        ],
      }),
    );
    expect(run.state.turn).toBe(4);
  });

  it("answers optional triggers as the script says (yes by default)", () => {
    const usurper = { ...setup, side: "usurper" as const };
    const steps = [
      { do: "play", card: { name: "Become the Shadow Lord" } },
      { do: "endTurn" },
    ];
    const yes = runScript(
      usurper,
      parseScript({
        version: 1,
        choices: { banish: [{ name: "Murmuring Gloomblade" }] },
        steps,
      }),
    );
    expect(yes.state.side).toBe("forsaken");
    const no = runScript(
      usurper,
      parseScript({
        version: 1,
        choices: {
          banish: [{ name: "Murmuring Gloomblade" }],
          optional: { "viserai-usurper-traverse": false },
        },
        steps,
      }),
    );
    expect(no.state.side).toBe("usurper");
  });

  it("rejects a script that isn't data it understands", () => {
    expect(() => parseScript({ version: 1, steps: [{ do: "dance" }] })).toThrow(
      RulesError,
    );
    expect(() =>
      parseScript({
        version: 1,
        steps: [{ do: "repeat", times: 1000, steps: [] }],
      }),
    ).toThrow(RulesError);
  });

  it("reports a run that hits the processing budget as failed, with its trace", () => {
    const run = runScript(
      {
        ...setup,
        budget: 20,
        triggers: [
          {
            id: "example-loop",
            on: { event: "tokensCreated", token: "runechant" },
            effects: [{ op: "createToken", token: "runechant", amount: 1 }],
          },
        ],
        deck: [
          fact("Maker", {
            effects: [{ op: "createToken", token: "runechant", amount: 1 }],
          }),
          ...setup.deck.slice(4),
        ],
      },
      parseScript({
        version: 1,
        steps: [{ do: "play", card: { name: "Maker" } }],
      }),
    );
    expect(run.failure).toMatch(/More than 20 triggers/);
    expect(run.trace.length).toBeGreaterThan(20);
  });
});

// The maintainer, 20 Oct 2026: scripted runs can't ask, so Opt keeps on top the card the next
// step can use best, putting the cards above it on the bottom one at a time. Best first: a card
// of the pitch the card wants (Pull from Beyond blue wants a blue card, for its Gate), then
// anything playable from banish, then Rune Gate and Usurp cards, then Runeblade and Shadow.
describe("the scripted Opt rule", () => {
  const c = (uid: string, traits: string[], pitch = 1) => ({
    uid,
    card: { traits, pitch },
  });

  it("brings the best card to the top by putting the ones above it on the bottom", () => {
    const top = [
      c("plain", ["generic"]),
      c("rb", ["runeblade"]),
      c("gate", ["rune_gate"]),
      c("banish", ["playable_from_banish"]),
    ];
    expect(scriptedOpt(top)).toEqual(["plain"]);
    expect(scriptedOpt(top.slice(1))).toEqual(["rb"]);
    expect(scriptedOpt(top.slice(3))).toEqual([]);
  });

  it("ranks Usurp with Rune Gate, above Runeblade and Shadow", () => {
    expect(scriptedOpt([c("sh", ["shadow"]), c("usurp", ["usurp"])])).toEqual([
      "sh",
    ]);
    expect(
      scriptedOpt([c("gate", ["rune_gate"]), c("usurp", ["usurp"])]),
    ).toEqual([]);
  });

  it("puts the pitch the card wants first, playable from banish before the rest of that pitch", () => {
    const top = [
      c("red banish", ["playable_from_banish"], 1),
      c("blue", ["generic"], 3),
      c("blue banish", ["playable_from_banish"], 3),
    ];
    expect(scriptedOpt(top, { pitch: 3 })).toEqual(["red banish"]);
    expect(scriptedOpt(top.slice(1), { pitch: 3 })).toEqual(["blue"]);
    expect(scriptedOpt(top.slice(2), { pitch: 3 })).toEqual([]);
  });

  it("keeps the order when nothing is better than the top card", () => {
    expect(scriptedOpt([c("a", ["generic"]), c("b", ["generic"])])).toEqual([]);
  });
});
