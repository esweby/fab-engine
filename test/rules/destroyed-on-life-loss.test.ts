// An aura destroyed when you lose life on your turn (Dimenxxional Crossroads' shape, the
// maintainer, 20 Oct 2026): blood debt costs life at the beginning of your end phase, so an aura
// like this is gone by the end of a turn with a face-up blood debt card in your banished zone.
import { describe, expect, it } from "vitest";
import {
  endTurn,
  parseTriggers,
  playCard,
  setUp,
  type RulesCard,
} from "../../src/rules/index.ts";
import { BLOOD_DEBT } from "../../src/rules/viserai.ts";

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard => ({
  id: name,
  name,
  pitch: 2,
  cost: 0,
  goAgain: true,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
  ...over,
});
const CROSSROADS = () =>
  card("Crossroads", {
    traits: ["aura"],
    triggers: parseTriggers([
      {
        id: "crossroads-life-lost",
        on: { event: "lifeLost" },
        effects: [{ op: "destroySelf" }],
      },
    ]),
  });
const DEBT = () => card("Debt", { traits: ["blood_debt"] });
const filler = (i: number) => card(`Filler ${i}`);

function game(withDebt: boolean) {
  const s = setUp({
    deck: [
      CROSSROADS(),
      ...Array.from({ length: 3 }, (_, i) => filler(i)),
      ...(withDebt ? [DEBT()] : []),
      ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
    ],
    seed: 1,
    order: "asGiven",
    triggers: [BLOOD_DEBT],
  });
  const debt = s.zones.deck.find((i) => i.card.name === "Debt");
  return debt
    ? {
        ...s,
        zones: {
          ...s.zones,
          deck: s.zones.deck.filter((i) => i !== debt),
          banished: [debt],
        },
      }
    : s;
}
const arena = (s: ReturnType<typeof game>) =>
  s.zones.arena.map((i) => i.card.name);

describe("an aura destroyed when you lose life", () => {
  it("stays in the arena through a turn with no life lost", () => {
    const s = game(false);
    const played = playCard(s, s.zones.hand[0]!.uid);
    expect(arena(played)).toEqual(["Crossroads"]);
    expect(arena(endTurn(played))).toEqual(["Crossroads"]);
  });

  it("is destroyed by blood debt at the beginning of your end phase", () => {
    const s = game(true);
    const played = playCard(s, s.zones.hand[0]!.uid);
    const ended = endTurn(played);
    expect(ended.lifeLost).toBe(1);
    expect(arena(ended)).toEqual([]);
    expect(ended.zones.graveyard.map((i) => i.card.name)).toContain(
      "Crossroads",
    );
  });
});
