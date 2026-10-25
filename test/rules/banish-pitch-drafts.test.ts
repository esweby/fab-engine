// Descendancy and Shard, approved by the maintainer on 24 Oct 2026.
import { describe, expect, it } from "vitest";
import {
  applySessionAction,
  activateGate,
  attackWithWeapon,
  cardWithRules,
  describeEffects,
  effectiveCost,
  NeedsChoice,
  parseEffects,
  parseScript,
  pitchCard,
  playCard,
  replaySession,
  RUNECHANT,
  resolveTriggers,
  runEffects,
  runScript,
  runScriptFromState,
  setUp,
  VISERAI,
  verifiedRulesFor,
  type Choose,
  type Effect,
  type RulesCard,
  type RulesState,
  type Script,
} from "../../src/rules/index.ts";

const payment: Effect = {
  op: "payLifeForToken",
  token: "runechant",
  maximum: 3,
};
const filler: RulesCard = {
  id: "filler",
  name: "Filler",
  pitch: 3,
  cost: 0,
  goAgain: false,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};
const descendant: RulesCard = cardWithRules({
  ...filler,
  id: "descendant",
  name: "Arknight Descendancy",
  type: "attack_action",
  cost: 5,
  traits: ["blood_debt", "shadow", "runeblade"],
  effects: undefined,
});
const shard: RulesCard = cardWithRules({
  ...filler,
  id: "shard",
  name: "Arknight Shard",
  type: "resource",
  effects: undefined,
});
const banisher: RulesCard = {
  ...filler,
  id: "banisher",
  name: "Banisher",
  effects: [{ op: "banish", from: "hand", amount: 1 }],
};
const game = (hand: RulesCard[] = []) =>
  setUp({
    deck: [...hand, ...Array.from({ length: 24 }, () => filler)],
    order: "asGiven",
    seed: 1,
  });
const uid = (state: RulesState, name: string) =>
  Object.values(state.zones)
    .flat()
    .find((instance) => instance.card.name === name)!.uid;
const chooseLife =
  (amount: number): Choose =>
  () => [String(amount)];

describe("paying life for tokens", () => {
  it("protects newly drawn kept cards from a turn-start hand-banish choice", () => {
    const initial = game([
      { ...filler, name: "Keep me" },
      { ...filler, name: "Other" },
    ]);
    const state: RulesState = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: [],
        deck: [...initial.zones.hand, ...initial.zones.deck],
      },
      triggers: [
        {
          id: "start-banish",
          on: { event: "turnStarted" },
          effects: [{ op: "banish", from: "hand", amount: 1 }],
        },
      ],
    };
    const result = runScriptFromState(state, {
      version: 1,
      choices: { keep: [{ name: "Keep me" }] },
      steps: [{ do: "endTurn" }],
    });
    expect(
      result.state.zones.hand.some(
        (instance) => instance.card.name === "Keep me",
      ),
    ).toBe(true);
    expect(
      result.state.zones.banished.map((instance) => instance.card.name),
    ).toEqual(["Other"]);
  });

  it.each([
    [21, 3],
    [20, 2],
    [18, 0],
  ])(
    "rechecks actual resolving life for repeated payments from %i life",
    (startingLife, expected) => {
      const state = game([
        {
          ...banisher,
          effects: [payment, payment],
        },
      ]);
      const script: Script = {
        version: 1,
        choices: {
          lifePayment: {
            card: { name: "Banisher" },
            startingLife,
            minimumRemainingLife: 18,
          },
        },
        steps: [{ do: "play", card: { name: "Banisher" } }],
      };
      const run = runScriptFromState(state, script);
      expect(run.steps[0]!.outcome).toBe("done");
      expect(run.state.lifeLost).toBe(expected);
    },
  );

  it("protects explicitly kept cards from playing, pitching and banishing", () => {
    const state = game([banisher, descendant, shard]);
    const run = runScriptFromState(state, {
      version: 1,
      choices: { keep: [{ name: descendant.name }, { name: shard.name }] },
      steps: [
        { do: "play", card: { name: descendant.name } },
        { do: "pitch", card: { name: shard.name } },
        { do: "play", card: { name: banisher.name } },
      ],
    });
    expect(run.steps.map((step) => step.outcome)).toEqual([
      "skipped",
      "skipped",
      "done",
    ]);
    expect(run.state.zones.hand.map((instance) => instance.card.name)).toEqual([
      descendant.name,
      shard.name,
    ]);
    expect(
      run.state.zones.banished.map((instance) => instance.card.name),
    ).toEqual(["Filler"]);
  });

  it("does not auto-pitch a kept card to fund another play", () => {
    const expensive = { ...filler, name: "Expensive", cost: 3 };
    const state = game([expensive, shard]);
    const result = runScriptFromState(state, {
      version: 1,
      choices: { keep: [{ name: shard.name }] },
      steps: [{ do: "play", card: { name: expensive.name } }],
    });
    expect(result.steps[0]!.outcome).toBe("done");
    expect(
      result.state.zones.hand.some(
        (instance) => instance.card.name === shard.name,
      ),
    ).toBe(true);
    expect(
      result.trace
        .filter((event) => event.type === "pitched")
        .map((event) => event.uid),
    ).not.toContain(uid(state, shard.name));
  });

  it("parses bounded payment and kept-card settings without changing their data", () => {
    const script: Script = {
      version: 1,
      choices: {
        keep: [{ name: shard.name }],
        lifePayment: {
          card: { name: descendant.name, pitch: 3 },
          startingLife: 21,
          minimumRemainingLife: 18,
        },
      },
      steps: [],
    };
    expect(parseScript(script)).toEqual(script);
    for (const startingLife of [0, -1, 1.5, Infinity]) {
      expect(() =>
        parseScript({
          ...script,
          choices: {
            lifePayment: {
              ...(script.choices!.lifePayment as object),
              startingLife,
            },
          },
        }),
      ).toThrow();
    }
  });

  it("scopes bounded payments to the named source and subtracts earlier self-loss", () => {
    const state = {
      ...game([{ ...banisher, effects: [payment] }]),
      lifeLost: 2,
    };
    for (const [name, expected] of [
      ["Banisher", 3],
      ["Other card", 2],
    ] as const) {
      const result = runScriptFromState(state, {
        version: 1,
        choices: {
          lifePayment: {
            card: { name },
            startingLife: 21,
            minimumRemainingLife: 18,
          },
        },
        steps: [{ do: "play", card: { name: banisher.name } }],
      });
      expect(result.state.lifeLost).toBe(expected);
    }
  });

  it("validates and describes the bounded choice", () => {
    expect(() => parseEffects([payment])).not.toThrow();
    expect(describeEffects([payment])).toEqual([
      "Pay up to 3 life to create that many Runechants (the player chooses).",
    ]);
  });

  it.each([0, 1, 2, 3])(
    "pays exactly %i life for the same number of tokens",
    (amount) => {
      const state = runEffects(game(), [payment], chooseLife(amount));
      expect(state.lifeLost).toBe(amount);
      expect(state.tokens.runechant ?? 0).toBe(amount);
      expect(state.events.filter((event) => event.type === "lifeLost")).toEqual(
        amount ? [{ type: "lifeLost", amount }] : [],
      );
    },
  );

  it.each([["4"], ["-1"], ["1.5"], [], ["1", "2"]])(
    "rejects an invalid answer %j",
    (...answer) => {
      const state = game();
      expect(() => runEffects(state, [payment], () => answer)).toThrow();
      expect(state.lifeLost).toBe(0);
      expect(state.tokens).toEqual({});
    },
  );
});

describe("own triggers outside the arena", () => {
  it("registers the accepted blue rules only", () => {
    for (const name of [descendant.name, shard.name]) {
      expect(verifiedRulesFor(name, 3)).toBeDefined();
      expect(verifiedRulesFor(name, 1)).toBeUndefined();
      expect(verifiedRulesFor(name, 2)).toBeUndefined();
    }
  });
  it("supports BSL into Descendancy and then a legal Nebula swing", () => {
    const bsl = cardWithRules({
      ...filler,
      name: "Become the Shadow Lord",
      goAgain: true,
      effects: undefined,
    });
    const weapon = cardWithRules({
      ...filler,
      name: "Seven Sin Nebula",
      pitch: null,
      cost: null,
      type: "weapon",
      effects: undefined,
    });
    const state = setUp({
      deck: [bsl, descendant, ...Array.from({ length: 24 }, () => filler)],
      weapons: [weapon],
      order: "asGiven",
      seed: 1,
      triggers: [...VISERAI, RUNECHANT],
    });
    const pitched = pitchCard(state, state.zones.hand[2]!.uid);
    const made = playCard(pitched, uid(pitched, bsl.name), (request) =>
      request.kind === "number" ? ["3"] : [uid(pitched, descendant.name)],
    );
    expect(made.lifeLost).toBe(3);
    expect(made.tokens.runechant).toBe(4);
    expect(made.side).toBe("usurper");
    expect(made.zones.banished).toHaveLength(3);
    expect(
      made.events.filter((event) => event.type === "traversed"),
    ).toHaveLength(1);
    const gated = activateGate(made, uid(made, descendant.name));
    expect(effectiveCost(gated, uid(gated, descendant.name))).toBe(1);
    const attacked = playCard(gated, uid(gated, descendant.name));
    expect(attacked.resources).toBe(1);
    expect(attacked.actionPoints).toBe(1);
    const swung = attackWithWeapon(attacked, attacked.zones.weapons[0]!.uid);
    expect(swung.resources).toBe(0);
    expect(
      swung.events.filter((event) => event.type === "attackPlayed"),
    ).toHaveLength(2);
  });

  it("Shard creates a Runechant when pitched, without entering the arena", () => {
    const state = game([shard]);
    const pitched = pitchCard(state, uid(state, shard.name));
    expect(pitched.tokens.runechant).toBe(1);
    expect(pitched.resources).toBe(3);
    expect(pitched.zones.arena).toEqual([]);
  });

  it("Shard triggers Viserai and can cause a traverse", () => {
    const state = {
      ...game([shard]),
      triggers: VISERAI,
      createdThisTurn: { runechant: 2 },
    };
    const pitched = pitchCard(state, uid(state, shard.name));
    expect(pitched.side).toBe("usurper");
    expect(pitched.zones.banished).toHaveLength(1);
  });

  it.each(["hand", "deck", "graveyard"] as const)(
    "Descendancy triggers when banished from %s",
    (from) => {
      const initial = game([descendant]);
      const target = initial.zones.hand[0]!;
      const state: RulesState = {
        ...initial,
        zones: {
          ...initial.zones,
          hand: initial.zones.hand.slice(1),
          [from]: [
            target,
            ...(from === "hand"
              ? initial.zones.hand.slice(1)
              : initial.zones[from]),
          ],
        },
      };
      const banished = runEffects(
        state,
        [{ op: "banish", from: from === "deck" ? "deckTop" : from, amount: 1 }],
        () => [target.uid],
      );
      const resolved = resolveTriggers(
        banished,
        state.events.length,
        chooseLife(3),
      );
      expect(resolved.lifeLost).toBe(3);
      expect(resolved.tokens.runechant).toBe(3);
      expect(effectiveCost(resolved, target.uid)).toBe(2);
    },
  );

  it("does not trigger another banished copy or reveal a face-down copy", () => {
    const initial = game([descendant, descendant]);
    const [first, second] = initial.zones.hand;
    const state: RulesState = {
      ...initial,
      zones: {
        ...initial.zones,
        hand: initial.zones.hand.slice(1),
        banished: [first!],
      },
    };
    const banished = runEffects(
      state,
      [{ op: "banish", from: "hand", amount: 1 }],
      () => [second!.uid],
    );
    const resolved = resolveTriggers(
      banished,
      state.events.length,
      chooseLife(2),
    );
    expect(resolved.lifeLost).toBe(2);
    const faceDown = runEffects(
      state,
      [{ op: "banish", from: "hand", amount: 1, faceDown: true }],
      () => [second!.uid],
    );
    expect(
      resolveTriggers(faceDown, state.events.length, () => {
        throw new Error("No choice expected");
      }).lifeLost,
    ).toBe(0);
  });

  it("suspends a session for the life choice and replays the answer", () => {
    const setup = {
      deck: [banisher, descendant, ...Array.from({ length: 24 }, () => filler)],
      order: "asGiven" as const,
      seed: 1,
    };
    const state = setUp(setup);
    const action = {
      type: "play" as const,
      uid: uid(state, banisher.name),
      answers: [[uid(state, descendant.name)]],
    };
    expect(() => applySessionAction(state, action)).toThrow(NeedsChoice);
    const answered = { ...action, answers: [...action.answers, ["2"]] };
    const played = applySessionAction(state, answered);
    expect(played.lifeLost).toBe(2);
    expect(replaySession(setup, [answered])).toEqual(played);
  });

  it("scripts decline payment by default and only pay an explicitly selected amount", () => {
    const setup = {
      deck: [banisher, descendant, ...Array.from({ length: 24 }, () => filler)],
      order: "asGiven" as const,
      seed: 1,
    };
    const script: Script = parseScript({
      version: 1,
      choices: { banish: [{ name: descendant.name }] },
      steps: [{ do: "play", card: { name: banisher.name } }],
    });
    expect(runScript(setup, script).state.lifeLost).toBe(0);
    const selected = runScript(
      setup,
      parseScript({
        ...script,
        choices: { ...script.choices, lifePayment: 3 },
      }),
    );
    expect(selected.state.lifeLost).toBe(3);
    expect(selected.state.tokens.runechant).toBe(3);
  });
});
