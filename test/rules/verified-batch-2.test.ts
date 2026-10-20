// The second batch of effect drafts the maintainer accepted on the effects page (their verdicts,
// 20 Oct 2026): mostly equipment, potions and amulets whose ability is "Instant – destroy this:
// …", with what that does left out of scope (prevention, combat), and two cards that are banished
// instead of going to the graveyard. Energy Potion was accepted with the note "Gain 2 pitch".
import { describe, expect, it } from "vitest";
import {
  activateCard,
  cardWithRules,
  playCard,
  setUp,
  verifiedRulesFor,
  type Choose,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

/** Every card and pitch accepted in the batch. null: no pitch (equipment). */
const ACCEPTED: [string, number | null][] = [
  ["Amethyst Amulet", 3],
  ["Amulet of Echoes", 3],
  ["Amulet of Ignition", 2],
  ["Amulet of Intervention", 3],
  ["Amulet of Oblation", 3],
  ["Bracers of Belief", null],
  ["Bruised Leather", null],
  ["Captain's Coat", null],
  ["Clarity Potion", 3],
  ["Cracker Jax", null],
  ["Crazy Brew", 3],
  ["Diamond Amulet", 3],
  ["Embraforged Gauntlet", null],
  ["Energy Potion", 3],
  ["Engulfing Shadows", 2],
  ["Exude Confidence", 1],
  ["Fearless Confrontation", 3],
  ["Firebreathing", 1],
  ["Four Finger Gloves", null],
  ["Goliath Gauntlet", null],
  ["Healing Potion", 3],
  ["Helio's Mitre", null],
  ["Helm of Hindsight", null],
  ["Hood of Second Thoughts", null],
  ["Imperial Edict", 1],
  ["Imperial Seal of Command", 1],
  ["Imperial Warhorn", 1],
  ["Mage Master Boots", null],
  ["Myrkhellir Helm", null],
  ["Onyx Amulet", 3],
  ["Opal Amulet", 3],
  ["Ornate Tessen", null],
  ["Pearl Amulet", 3],
  ["Platinum Amulet", 3],
  ["Potion of Déjà Vu", 3],
  ["Potion of Ironhide", 3],
  ["Potion of Luck", 3],
  ["Potion of Seeing", 3],
  ["Potion of Strength", 3],
  ["Pounamu Amulet", 3],
  ["Punching Gloves", null],
  ["Quartermaster's Boots", null],
  ["Quick Clicks", null],
  ["Ragamuffin's Hat", null],
  ["Ripple Away", 3],
  ["Runaways", null],
  ["Sapphire Amulet", 3],
  ["Seeker's Gilet", null],
  ["Seeker's Hood", null],
  ["Seeker's Leggings", null],
  ["Seeker's Mitts", null],
  ["Shelter from the Storm", 1],
  ["Sheltered Cove", null],
  ["Silken Gi", null],
  ["Swiftstrike Bracers", null],
  ["Talismanic Lens", null],
  ["Threadbare Tunic", null],
  ["Time Skippers", null],
  ["Timesnap Potion", 3],
  ["Tip-Off", 1],
  ["Tip-Off", 2],
  ["Tip-Off", 3],
  ["Unflinching Foothold", null],
  ["Vigilant Dodgers", null],
];

/** Rejected in the same sitting, so they stay unmodelled. */
const REJECTED = [
  "Balance of Justice",
  "Blood Drop Brocade",
  "Blossom of Spring",
  "Garland of Spring",
  "Glory Seeker",
  "Heartened Cross Strap",
  "Hope Merchant's Hood",
  "Ruby Amulet",
];

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 3,
    cost: 0,
    goAgain: false,
    type: "action",
    roles: [],
    traits: [],
    amounts: {},
    ...over,
  });
const filler = (i: number) => card(`Filler ${i}`, { effects: [] });

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
    resources: 0,
  };
}
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
const keepAll: Choose = () => [];

describe("the second accepted batch", () => {
  it("has verified rules for every accepted card and pitch", () => {
    const missing = ACCEPTED.filter(([n, p]) => !verifiedRulesFor(n, p));
    expect(missing).toEqual([]);
  });

  it("leaves the rejected cards unmodelled", () => {
    expect(REJECTED.filter((n) => verifiedRulesFor(n, 3))).toEqual([]);
  });

  it("keeps a potion in the arena once played, then destroys it for 2 resources (Energy Potion)", () => {
    const s = game([
      card("Energy Potion", { traits: ["item"], goAgain: true }),
    ]);
    const played = playCard(s, inHand(s, "Energy Potion"), keepAll);
    const potion = played.zones.arena.find(
      (i) => i.card.name === "Energy Potion",
    );
    expect(potion).toBeDefined();
    const used = activateCard(played, potion!.uid, keepAll);
    expect(used.resources).toBe(2);
    expect(used.zones.graveyard.map((i) => i.card.name)).toContain(
      "Energy Potion",
    );
  });

  it("discards a card from hand to activate it (Tip-Off)", () => {
    const s = game([card("Tip-Off", { type: "instant" })]);
    const next = activateCard(s, inHand(s, "Tip-Off"), keepAll);
    expect(next.zones.graveyard.map((i) => i.card.name)).toEqual(["Tip-Off"]);
  });

  it("banishes Engulfing Shadows instead of putting it in the graveyard", () => {
    expect(verifiedRulesFor("Engulfing Shadows", 2)).toMatchObject({
      graveyardToBanish: true,
    });
    expect(verifiedRulesFor("Embraforged Gauntlet", null)).toMatchObject({
      graveyardToBanish: true,
    });
  });
});
