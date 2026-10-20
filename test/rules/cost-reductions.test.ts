// Cost reductions (docs/phase-two.md, engine features, 2): "costs {r} less for each Runechant you
// control" (Rune Flash's shape), "costs {r}{r} less if played from your banished zone" (Grim
// Feast's), and "costs 6 less if you've usurped this turn" (Usurp the Shadow Throne's). The cards
// here are made up in those shapes. UNVERIFIED readings: a cost never goes below 0; Runechants are
// counted as the card is played, before Usurp destroys one; and only a usurp earlier in the turn
// counts, not the card's own.
import { describe, expect, it } from "vitest";
import {
  playCard,
  RulesError,
  setUp,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";
import { effectiveCost } from "../../src/rules/play.ts";

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard => ({
  id: name,
  name,
  pitch: 1,
  cost: 3,
  goAgain: false,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
  ...over,
});
const filler = (i: number) => card(`Filler ${i}`, { pitch: 3, cost: 0 });

function game(hand: RulesCard[], over: Partial<RulesState> = {}): RulesState {
  const s = setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 4 - hand.length }, (_, i) => filler(i)),
      ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
    ],
    seed: 1,
    order: "asGiven",
  });
  return { ...s, resources: 0, ...over };
}
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;

const FLASH = () =>
  card("Flash", {
    type: "attack_action",
    costReductions: [{ amount: "perRunechant" }],
  });
const FEAST = () =>
  card("Feast", {
    playableFromBanish: true,
    costReductions: [{ amount: 2, when: "playedFromBanish" }],
  });
const THRONE = () =>
  card("Throne", {
    cost: 13,
    type: "attack_action",
    costReductions: [{ amount: 6, when: "usurpedThisTurn" }],
  });

describe("cost reductions", () => {
  it("costs 1 less for each Runechant, and never less than 0", () => {
    const s = game([FLASH()], { tokens: { runechant: 2 } });
    const uid = inHand(s, "Flash");
    expect(effectiveCost(s, uid)).toBe(1);
    expect(effectiveCost({ ...s, tokens: { runechant: 5 } }, uid)).toBe(0);
  });

  it("pays the reduced cost when played", () => {
    const s = game([FLASH()], { tokens: { runechant: 2 }, resources: 1 });
    const next = playCard(s, inHand(s, "Flash"));
    expect(next.resources).toBe(0);
    expect(next.events).toContainEqual(
      expect.objectContaining({ type: "played", cost: 1 }),
    );
  });

  it("refuses with the reduced cost in its message", () => {
    const s = game([FLASH()], { tokens: { runechant: 1 } });
    expect(() => playCard(s, inHand(s, "Flash"))).toThrow(
      new RulesError("Flash costs 2; 0 available."),
    );
  });

  it("costs 2 less played from the banished zone, full price from hand", () => {
    const s = game([FEAST()], { resources: 1 });
    const uid = inHand(s, "Feast");
    expect(effectiveCost(s, uid)).toBe(3);
    const banished = {
      ...s,
      zones: {
        ...s.zones,
        hand: s.zones.hand.filter((i) => i.uid !== uid),
        banished: [s.zones.hand.find((i) => i.uid === uid)!],
      },
    };
    expect(effectiveCost(banished, uid)).toBe(1);
    expect(playCard(banished, uid).resources).toBe(0);
  });

  it("costs 6 less once you've usurped this turn", () => {
    const s = game([THRONE()]);
    const uid = inHand(s, "Throne");
    expect(effectiveCost(s, uid)).toBe(13);
    const usurped = {
      ...s,
      events: [...s.events, { type: "usurped" as const, uid: "earlier" }],
    };
    expect(effectiveCost(usurped, uid)).toBe(7);
  });

  it("forgets a usurp from an earlier turn", () => {
    const s = game([THRONE()]);
    const old = {
      ...s,
      events: [{ type: "usurped" as const, uid: "earlier" }, ...s.events],
    };
    expect(effectiveCost(old, inHand(s, "Throne"))).toBe(13);
  });
});
