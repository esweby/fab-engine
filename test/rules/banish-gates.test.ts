// Step 5b (docs/rules-engine.md): playing from the banished zone, Gate to i'Arathael, Seven Sin
// Nebula's attack and Malefic Incantation, from their printed text (maintainer, Fabrary and the
// local card data, 19 Oct 2026).
//
// Each test's expected outcome is read from that text and AWAITS THE MAINTAINER'S SIGN-OFF.
// Readings that are ours, flagged where used:
// - A face-down card in the banished zone can't be played from there.
// - {t} on a weapon means it attacks once a turn.
// - Malefic's Runechant survives the attack that made it: it didn't exist when the attack was
//   played, so it has no trigger to destroy itself.
import { describe, expect, it } from "vitest";
import {
  activateGate,
  attackWithWeapon,
  BLOOD_DEBT,
  cardWithRules,
  endTurn,
  playCard,
  RUNECHANT,
  RulesError,
  setUp,
  VISERAI,
  type RulesCard,
  type RulesState,
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
const CULLINGSONG = () =>
  fact("Cullingsong Gloomblade", {
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const MALEFIC = (pitch: 1 | 2 | 3) =>
  fact("Malefic Incantation", {
    pitch,
    goAgain: true,
    traits: ["runeblade", "aura"],
  });
/** Made up: a blood debt action with no permission of its own, for the Gate to target. */
const SHADOW_SPELL = () =>
  fact("Shadow spell", {
    traits: ["shadow", "blood_debt"],
    effects: [],
  });
const PLAIN_SPELL = () => fact("Plain spell", { effects: [] });
const SEVEN_SIN = () =>
  fact("Seven Sin Nebula", {
    type: "weapon",
    pitch: null,
    cost: null,
    traits: ["runeblade"],
  });
const SPARE = (i: number) => fact(`Spare ${i}`, { pitch: 3 });

const RULES = [...VISERAI, RUNECHANT, BLOOD_DEBT];
/** Hand, banished zone and arsenal set directly; the deck is spares. */
function game(
  options: {
    hand?: RulesCard[];
    banished?: RulesCard[];
    faceDown?: boolean;
    side?: "forsaken" | "usurper";
    weapons?: RulesCard[];
  } = {},
) {
  const hand = options.hand ?? [];
  const banished = options.banished ?? [];
  const s = setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 4 - hand.length }, (_, i) => SPARE(i)),
      ...banished,
      ...Array.from({ length: 20 }, (_, i) => SPARE(10 + i)),
    ],
    weapons: options.weapons,
    seed: 1,
    order: "asGiven",
    triggers: RULES,
    side: options.side,
  });
  const out = s.zones.deck.slice(0, banished.length);
  return {
    ...s,
    resources: 5,
    zones: {
      ...s.zones,
      deck: s.zones.deck.slice(banished.length),
      banished: out,
    },
    faceDown: options.faceDown ? out.map((i) => i.uid) : [],
  } satisfies RulesState;
}
const find = (s: RulesState, name: string) =>
  [
    ...s.zones.hand,
    ...s.zones.banished,
    ...s.zones.arena,
    ...s.zones.weapons,
  ].find((i) => i.card.name === name)!.uid;
const names = (s: RulesState, zone: keyof RulesState["zones"]) =>
  s.zones[zone].map((i) => i.card.name);

describe("playing from the banished zone", () => {
  it("Cullingsong can be played from the banished zone by its own text", () => {
    const s = game({ banished: [CULLINGSONG()] });
    const next = playCard(s, find(s, "Cullingsong Gloomblade"));
    expect(names(next, "arena")).toEqual(["Cullingsong Gloomblade"]);
    expect(next.events).toContainEqual({
      type: "playedFromBanish",
      uid: find(s, "Cullingsong Gloomblade"),
    });
  });

  it("but not while it's face down (our reading)", () => {
    const s = game({ banished: [CULLINGSONG()], faceDown: true });
    expect(() => playCard(s, find(s, "Cullingsong Gloomblade"))).toThrow(
      RulesError,
    );
  });

  it("a card without its own permission can't be played from there", () => {
    const s = game({ banished: [SHADOW_SPELL()] });
    expect(() => playCard(s, find(s, "Shadow spell"))).toThrow(
      "Shadow spell can't be played from the banished zone.",
    );
  });
});

describe("Gate to i'Arathael", () => {
  it("for {r}, destroying the Gate, lets a blood debt action be played from the banished zone this turn", () => {
    const s = { ...game({ banished: [SHADOW_SPELL()] }), tokens: { gate: 1 } };
    const opened = activateGate(s, find(s, "Shadow spell"));
    expect(opened.tokens.gate).toBe(0);
    expect(opened.resources).toBe(4);
    expect(opened.activatedThisTurn.gate).toBe(1);
    const played = playCard(opened, find(s, "Shadow spell"));
    expect(names(played, "graveyard")).toEqual(["Shadow spell"]);
  });

  it("only targets an action card with blood debt in the banished zone, and needs a Gate and {r}", () => {
    const s = {
      ...game({ banished: [PLAIN_SPELL(), SHADOW_SPELL()] }),
      tokens: { gate: 1 },
    };
    expect(() => activateGate(s, find(s, "Plain spell"))).toThrow(RulesError);
    expect(() =>
      activateGate({ ...s, tokens: {} }, find(s, "Shadow spell")),
    ).toThrow("No Gate to i'Arathael to activate.");
    expect(() =>
      activateGate({ ...s, resources: 0 }, find(s, "Shadow spell")),
    ).toThrow(RulesError);
  });

  it("lasts this turn only", () => {
    let s: RulesState = {
      ...game({ banished: [SHADOW_SPELL()] }),
      tokens: { gate: 1 },
    };
    s = activateGate(s, find(s, "Shadow spell"));
    const next = { ...endTurn(s), resources: 5 };
    expect(() => playCard(next, find(s, "Shadow spell"))).toThrow(RulesError);
  });

  it("activating one lets the Usurper traverse at the end phase", () => {
    let s: RulesState = {
      ...game({ banished: [SHADOW_SPELL()], side: "usurper" }),
      tokens: { gate: 1 },
    };
    s = activateGate(s, find(s, "Shadow spell"));
    expect(endTurn(s, {}, () => ["yes"]).side).toBe("forsaken");
  });
});

describe("Seven Sin Nebula", () => {
  it("attacks only after a card was played from a banished zone this turn, for {r} and an action point", () => {
    const s = {
      ...game({ banished: [CULLINGSONG()], weapons: [SEVEN_SIN()] }),
      actionPoints: 2,
    };
    expect(() => attackWithWeapon(s, find(s, "Seven Sin Nebula"))).toThrow(
      "Seven Sin Nebula needs a card played from a banished zone this turn.",
    );
    const after = playCard(s, find(s, "Cullingsong Gloomblade"));
    const attacked = attackWithWeapon(after, find(s, "Seven Sin Nebula"));
    expect(attacked.resources).toBe(after.resources - 1);
    expect(attacked.actionPoints).toBe(after.actionPoints - 1);
    expect(attacked.events.at(-1)).toMatchObject({ type: "attacking" });
  });

  it("destroys Runechants like any attack, and attacks once a turn (our reading of {t})", () => {
    let s: RulesState = {
      ...game({ banished: [CULLINGSONG()], weapons: [SEVEN_SIN()] }),
      actionPoints: 3,
    };
    s = playCard(s, find(s, "Cullingsong Gloomblade"));
    s = { ...s, tokens: { runechant: 2 } };
    const attacked = attackWithWeapon(s, find(s, "Seven Sin Nebula"));
    expect(attacked.tokens.runechant).toBe(0);
    expect(attacked.events).toContainEqual({ type: "arcaneDamage", amount: 2 });
    expect(() =>
      attackWithWeapon(attacked, find(s, "Seven Sin Nebula")),
    ).toThrow("Seven Sin Nebula has already attacked this turn.");
  });
});

describe("Malefic Incantation", () => {
  it("red enters the arena with 3 verse counters, with go again", () => {
    const s = game({ hand: [MALEFIC(1)] });
    const next = playCard(s, find(s, "Malefic Incantation"));
    expect(names(next, "arena")).toEqual(["Malefic Incantation"]);
    expect(next.counters[find(s, "Malefic Incantation")]).toBe(3);
    expect(next.actionPoints).toBe(1);
  });

  it("once per turn, an attack action card removes a counter and makes a Runechant, which survives (our reading)", () => {
    let s: RulesState = {
      ...game({ hand: [MALEFIC(1), CULLINGSONG(), CULLINGSONG()] }),
      actionPoints: 3,
    };
    const malefic = find(s, "Malefic Incantation");
    s = playCard(s, malefic);
    const [first, second] = s.zones.hand
      .filter((i) => i.card.name === "Cullingsong Gloomblade")
      .map((i) => i.uid);
    s = playCard(s, first!);
    expect(s.counters[malefic]).toBe(2);
    expect(s.tokens.runechant).toBe(1);
    // Viserai banishes the top card for the Runechant.
    expect(names(s, "banished")).toHaveLength(1);
    s = playCard(s, second!);
    // The second attack usurps that Runechant; Malefic doesn't trigger again this turn.
    expect(s.counters[malefic]).toBe(2);
    expect(s.tokens.runechant).toBe(0);
  });

  it("blue, with 1 counter, is destroyed once it has none", () => {
    let s: RulesState = {
      ...game({ hand: [MALEFIC(3), CULLINGSONG()] }),
      actionPoints: 2,
    };
    const malefic = find(s, "Malefic Incantation");
    s = playCard(s, malefic);
    s = playCard(s, find(s, "Cullingsong Gloomblade"));
    expect(names(s, "graveyard")).toContain("Malefic Incantation");
    expect(names(s, "arena")).not.toContain("Malefic Incantation");
    expect(s.tokens.runechant).toBe(1);
  });

  it("triggers again on the next turn", () => {
    let s: RulesState = {
      ...game({ hand: [MALEFIC(1), CULLINGSONG()] }),
      actionPoints: 2,
    };
    const malefic = find(s, "Malefic Incantation");
    s = playCard(s, malefic);
    s = playCard(s, find(s, "Cullingsong Gloomblade"));
    s = endTurn(s);
    s = {
      ...s,
      zones: {
        ...s.zones,
        hand: [...s.zones.hand, { uid: "extra", card: CULLINGSONG() }],
      },
    };
    s = playCard(s, "extra");
    expect(s.counters[malefic]).toBe(1);
  });
});
