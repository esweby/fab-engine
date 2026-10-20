// The third batch of effect drafts the maintainer accepted on the effects page (their verdicts,
// 20 Oct 2026): the cost reductions per Runechant, and Dimenxxional Crossroads, destroyed when you
// lose life (its arcane damage isn't modelled, the maintainer's call).
import { describe, expect, it } from "vitest";
import {
  BLOOD_DEBT,
  cardWithRules,
  effectiveCost,
  endTurn,
  playCard,
  setUp,
  verifiedRulesFor,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

/** Every card and pitch accepted in the batch. */
const ACCEPTED: [string, number][] = [
  ["Amplify the Arknight", 1],
  ["Amplify the Arknight", 2],
  ["Amplify the Arknight", 3],
  ["Ninth Blade of the Blood Oath", 2],
  ["Reduce to Runechant", 1],
  ["Reduce to Runechant", 2],
  ["Reduce to Runechant", 3],
  ["Rune Flash", 1],
  ["Rune Flash", 2],
  ["Rune Flash", 3],
  ["Dimenxxional Crossroads", 2],
];

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 2,
    cost: 0,
    goAgain: false,
    type: "action",
    roles: [],
    traits: [],
    amounts: {},
    ...over,
  });
const filler = (i: number) => card(`Filler ${i}`, { effects: [] });

function game(hand: RulesCard[], over: Partial<RulesState> = {}): RulesState {
  const s = setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 4 - hand.length }, (_, i) => filler(i)),
      ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
    ],
    seed: 1,
    order: "asGiven",
    triggers: [BLOOD_DEBT],
  });
  return { ...s, ...over };
}
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;

describe("the third accepted batch", () => {
  it("has verified rules for every accepted card and pitch", () => {
    expect(ACCEPTED.filter(([n, p]) => !verifiedRulesFor(n, p))).toEqual([]);
  });

  it("Rune Flash costs 1 less for each Runechant", () => {
    const s = game(
      [card("Rune Flash", { type: "attack_action", cost: 3, pitch: 1 })],
      { tokens: { runechant: 2 } },
    );
    expect(effectiveCost(s, inHand(s, "Rune Flash"))).toBe(1);
  });

  it("Reduce to Runechant makes a Runechant and costs less for each one", () => {
    expect(verifiedRulesFor("Reduce to Runechant", 3)).toMatchObject({
      effects: [{ op: "createToken", token: "runechant", amount: 1 }],
      costReductions: [{ amount: "perRunechant" }],
    });
  });

  it("Dimenxxional Crossroads stays in the arena until blood debt costs life", () => {
    const crossroads = card("Dimenxxional Crossroads", {
      goAgain: true,
      traits: ["aura"],
    });
    let s = game([crossroads]);
    s = playCard(s, inHand(s, "Dimenxxional Crossroads"));
    expect(s.zones.arena.map((i) => i.card.name)).toEqual([
      "Dimenxxional Crossroads",
    ]);
    const debt = card("Debt", { traits: ["blood_debt"] });
    s = {
      ...s,
      zones: { ...s.zones, banished: [{ uid: "debt", card: debt }] },
    };
    s = endTurn(s);
    expect(s.zones.arena).toEqual([]);
    expect(s.zones.graveyard.map((i) => i.card.name)).toContain(
      "Dimenxxional Crossroads",
    );
  });
});
