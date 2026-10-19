// Step 8a (docs/rules-engine.md): goldfish on the rules engine. Rules actions resolve their
// effects and triggers; sandbox actions are applied by hand, marked manual, and set nothing off.
// When the engine needs a choice, the action stops and says what it needs; the answer is then
// recorded on the action, so undo, replay and share links stay exact.
import { describe, expect, it } from "vitest";
import {
  applySessionAction,
  BLOOD_DEBT,
  cardWithRules,
  NeedsChoice,
  replaySession,
  RulesError,
  RUNECHANT,
  setUp,
  VISERAI,
  type RulesCard,
  type RulesSetup,
  type SessionAction,
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
const MURMURING = () =>
  fact("Murmuring Gloomblade", {
    type: "attack_action",
    cost: 2,
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const setup: RulesSetup = {
  deck: [
    BSL(),
    MURMURING(),
    fact("Generic A", { pitch: 3 }),
    fact("Generic B", { pitch: 3 }),
    ...Array.from({ length: 20 }, (_, i) => fact(`Deck ${i}`, { pitch: 3 })),
  ],
  seed: 5,
  order: "asGiven",
  triggers: [...VISERAI, RUNECHANT, BLOOD_DEBT],
};
const start = () => setUp(setup);
const uid = (name: string) =>
  start().zones.hand.find((i) => i.card.name === name)!.uid;

describe("rules actions", () => {
  it("stop and say what choice they need, then run with the recorded answer", () => {
    const s = start();
    let needed: NeedsChoice | undefined;
    try {
      applySessionAction(s, {
        type: "play",
        uid: uid("Become the Shadow Lord"),
      });
    } catch (e) {
      if (e instanceof NeedsChoice) needed = e;
    }
    expect(needed?.request).toMatchObject({
      prompt: "Banish a card from hand",
      count: 1,
    });
    expect(needed?.request.options).toContain(uid("Murmuring Gloomblade"));
    const next = applySessionAction(s, {
      type: "play",
      uid: uid("Become the Shadow Lord"),
      answers: [[uid("Murmuring Gloomblade")]],
    });
    expect(next.tokens).toEqual({ runechant: 1, gate: 1 });
    expect(next.zones.banished.map((i) => i.card.name)).toEqual([
      "Murmuring Gloomblade",
      "Deck 0",
    ]);
  });

  it("refuse what the rules don't allow, with the reason", () => {
    expect(() =>
      applySessionAction(start(), { type: "play", uid: uid("Generic A") }),
    ).toThrow(
      "Generic A has no verified effects yet, so the engine can't play it.",
    );
  });
});

describe("sandbox actions", () => {
  it("move any card anywhere, marked manual, setting nothing off", () => {
    const s = start();
    const top = s.zones.deck[0]!.uid;
    const next = applySessionAction(s, {
      type: "move",
      uid: top,
      to: "banished",
      faceDown: true,
    });
    expect(next.zones.banished.map((i) => i.uid)).toEqual([top]);
    expect(next.faceDown).toContain(top);
    expect(next.events.at(-1)).toEqual({ type: "manual", action: "move" });
  });

  it("add tokens by hand without Viserai triggering, counting them as made this turn", () => {
    const next = applySessionAction(start(), {
      type: "token",
      token: "runechant",
      delta: 2,
    });
    expect(next.tokens.runechant).toBe(2);
    expect(next.createdThisTurn.runechant).toBe(2);
    expect(next.zones.banished).toHaveLength(0);
  });

  it("change resources, counters, life and damage, traverse, draw and shuffle", () => {
    let s = start();
    s = applySessionAction(s, { type: "resources", delta: 2 });
    s = applySessionAction(s, { type: "life", delta: -3 });
    s = applySessionAction(s, { type: "damage", delta: 4 });
    s = applySessionAction(s, { type: "traverse" });
    s = applySessionAction(s, { type: "draw" });
    expect(s.resources).toBe(2);
    expect(s.lifeLost).toBe(3);
    expect(s.events).toContainEqual({ type: "damageNoted", amount: 4 });
    expect(s.side).toBe("usurper");
    expect(s.zones.hand).toHaveLength(5);
    const shuffled = applySessionAction(s, { type: "shuffle" });
    expect(shuffled.zones.deck.map((i) => i.uid).sort()).toEqual(
      s.zones.deck.map((i) => i.uid).sort(),
    );
    expect(applySessionAction(s, { type: "shuffle" })).toEqual(shuffled);
  });
});

describe("replay", () => {
  it("rebuilds a session exactly from its setup and log", () => {
    const log: SessionAction[] = [
      {
        type: "play",
        uid: uid("Become the Shadow Lord"),
        answers: [[uid("Murmuring Gloomblade")]],
      },
      { type: "token", token: "runechant", delta: 1 },
      { type: "endTurn" },
      { type: "shuffle" },
    ];
    const stepByStep = log.reduce(applySessionAction, start());
    expect(replaySession(setup, log)).toEqual(stepByStep);
  });

  it("fails loudly when a log no longer fits the deck", () => {
    expect(() => replaySession(setup, [{ type: "play", uid: "d99" }])).toThrow(
      RulesError,
    );
  });
});
