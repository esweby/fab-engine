// UNVERIFIED drafts for Descendancy and Shard; neither card gains verified rules here.
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
  setUp,
  VISERAI,
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
const descendant: RulesCard = {
  ...filler,
  id: "descendant",
  name: "Draft Descendancy",
  type: "attack_action",
  cost: 5,
  traits: ["blood_debt", "shadow", "runeblade"],
  costReductions: [{ amount: "perRunechant" }],
  triggers: [
    {
      id: "draft-descendancy-banished",
      on: { event: "moved", to: "banished", self: true },
      effects: [payment],
    },
  ],
};
const shard: RulesCard = {
  ...filler,
  id: "shard",
  name: "Draft Shard",
  triggers: [
    {
      id: "draft-shard-pitched",
      on: { event: "pitched", self: true },
      effects: [{ op: "createToken", token: "runechant", amount: 1 }],
    },
  ],
};
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
