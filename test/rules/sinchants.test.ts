// Sinchants (Runechant of Envy, Gluttony, Greed, Lust, Pride, Sloth and Wrath). The maintainer,
// 20 Oct 2026: "Sinchants should be destroyed in goldfish mode when you play an attack action
// card." From the printed text: "When this is destroyed, create a Runechant token. At the
// beginning of your action phase or when you play an attack action card, destroy this."
// Not modelled: "This counts as a Runechant", and what happens when an attack usurps one.
import { describe, expect, it } from "vitest";
import {
  cardWithRules,
  endTurn,
  playCard,
  setUp,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard =>
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
const SLOTH = () =>
  card("Runechant of Sloth", { type: "instant", traits: ["aura"] });
const ATTACK = () => card("An attack", { type: "attack_action", effects: [] });
const filler = (i: number) => card(`Filler ${i}`, { pitch: 3, effects: [] });

function game(hand: RulesCard[]): RulesState {
  return {
    ...setUp({
      deck: [
        ...hand,
        ...Array.from({ length: 4 - hand.length }, (_, i) => filler(i)),
        ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
      ],
      seed: 1,
      order: "asGiven",
    }),
    resources: 5,
  };
}
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
const names = (s: RulesState, zone: "arena" | "graveyard") =>
  s.zones[zone].map((i) => i.card.name);

describe("sinchants", () => {
  it("stay in the arena when played", () => {
    const s = game([SLOTH()]);
    const next = playCard(s, inHand(s, "Runechant of Sloth"));
    expect(names(next, "arena")).toEqual(["Runechant of Sloth"]);
  });

  it("are destroyed when you play an attack action card, making a Runechant", () => {
    let s = game([SLOTH(), ATTACK()]);
    s = playCard(s, inHand(s, "Runechant of Sloth"));
    s = playCard(s, inHand(s, "An attack"));
    expect(names(s, "arena")).not.toContain("Runechant of Sloth");
    expect(names(s, "graveyard")).toContain("Runechant of Sloth");
    expect(s.tokens.runechant).toBe(1);
  });

  it("are destroyed at the start of your next turn, making a Runechant", () => {
    let s = game([SLOTH()]);
    s = playCard(s, inHand(s, "Runechant of Sloth"));
    s = endTurn(s);
    expect(names(s, "graveyard")).toContain("Runechant of Sloth");
    expect(s.tokens.runechant).toBe(1);
  });

  it("covers every sinchant", () => {
    for (const sin of [
      "Envy",
      "Gluttony",
      "Greed",
      "Lust",
      "Pride",
      "Sloth",
      "Wrath",
    ])
      expect(
        card(`Runechant of ${sin}`, { type: "instant", traits: ["aura"] })
          .triggers,
      ).toHaveLength(2);
  });
});
