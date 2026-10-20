// The rules engine's state (docs/rules-engine.md, step 2): zones, phases, action points, costs,
// pitching, tokens and the event trace, with the invariants enforced.
// UNVERIFIED: the turn structure here (one action point a turn, go again giving it back on
// play, end phase pitch-to-bottom then draw up to intellect) is a first pass for the
// maintainer to check against the comprehensive rules.
import { describe, expect, it } from "vitest";
import { newGame } from "../../src/game.ts";
import {
  checkInvariants,
  createTokens,
  endTurn,
  moveCard,
  pitchCard,
  playCard,
  removeTokens,
  RulesError,
  setUp,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard => ({
  id: name,
  name,
  pitch: 1,
  cost: 0,
  goAgain: false,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  // A card with no effects, verified as such: the engine may play it.
  effects: [],
  ...over,
});
const deckOf = (...cards: [RulesCard, number][]) =>
  cards.flatMap(([c, n]) => Array.from({ length: n }, () => c));
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
/** A state whose hand holds exactly these cards, for focused tests. */
const withHand = (...cards: RulesCard[]) =>
  setUp({
    deck: [...cards, ...deckOf([card("Filler"), 20])],
    seed: 1,
    order: "asGiven",
  });

describe("setting up", () => {
  it("shuffles, draws up to intellect and starts turn 1 in the action phase with one action point", () => {
    const s = setUp({ deck: deckOf([card("A"), 10]), seed: 7 });
    expect(s.zones.hand).toHaveLength(4);
    expect(s.zones.deck).toHaveLength(6);
    expect(s).toMatchObject({
      turn: 1,
      phase: "action",
      actionPoints: 1,
      resources: 0,
      side: "forsaken",
    });
    expect(() => checkInvariants(s)).not.toThrow();
  });

  it("deals the same game as the counting engine for the same seed, so failed hands still open", () => {
    const deck = deckOf([card("A"), 5], [card("B"), 5], [card("C"), 5]);
    const rules = setUp({ deck, seed: 42 });
    const counting = newGame({ deck, seed: 42 }).present;
    expect(rules.zones.hand.map((i) => i.uid)).toEqual(
      counting.zones.hand.map((i) => i.uid),
    );
    expect(rules.zones.deck.map((i) => i.uid)).toEqual(
      counting.zones.deck.map((i) => i.uid),
    );
  });

  it("puts weapons and equipment in their slots", () => {
    const s = setUp({
      deck: deckOf([card("A"), 6]),
      weapons: [card("Blade", { type: "weapon", pitch: null, cost: null })],
      seed: 1,
    });
    expect(s.zones.weapons.map((i) => i.card.name)).toEqual(["Blade"]);
  });
});

describe("moving cards", () => {
  it("moves through one operation, and records it", () => {
    const s = withHand(card("A"));
    const next = moveCard(s, inHand(s, "A"), "banished", { faceDown: true });
    expect(next.zones.banished.map((i) => i.card.name)).toEqual(["A"]);
    expect(next.faceDown).toContain(inHand(s, "A"));
    expect(next.events.at(-1)).toMatchObject({
      type: "moved",
      from: "hand",
      to: "banished",
    });
  });

  it("refuses to move a card that isn't there", () => {
    const s = withHand(card("A"));
    expect(() => moveCard(s, "nope", "graveyard")).toThrow(RulesError);
  });

  it("never changes the state it was given", () => {
    const s = withHand(card("A"));
    const before = JSON.stringify(s);
    moveCard(s, inHand(s, "A"), "graveyard");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("pitching", () => {
  it("moves a hand card to the pitch zone and adds its pitch to resources", () => {
    const s = withHand(card("Blue", { pitch: 3 }));
    const next = pitchCard(s, inHand(s, "Blue"));
    expect(next.resources).toBe(3);
    expect(next.zones.pitch.map((i) => i.card.name)).toEqual(["Blue"]);
    expect(next.events.at(-1)).toMatchObject({ type: "pitched", amount: 3 });
  });

  it("refuses a card with no pitch, or one not in hand", () => {
    const s = setUp({
      deck: deckOf([card("A"), 6]),
      weapons: [card("Blade", { type: "weapon", pitch: null, cost: null })],
      seed: 1,
    });
    expect(() => pitchCard(s, s.zones.weapons[0]!.uid)).toThrow(
      "Blade can't be pitched",
    );
    expect(() => pitchCard(s, s.zones.deck[0]!.uid)).toThrow(RulesError);
  });
});

describe("playing cards", () => {
  it("spends the cost and an action point", () => {
    const s = withHand(card("Two", { cost: 2 }), card("Blue", { pitch: 3 }));
    const next = playCard(pitchCard(s, inHand(s, "Blue")), inHand(s, "Two"));
    expect(next.resources).toBe(1);
    expect(next.actionPoints).toBe(0);
    expect(next.events.at(-1)).toMatchObject({
      type: "played",
      uid: inHand(s, "Two"),
    });
  });

  it("refuses without the resources, saying how many it needs", () => {
    const s = withHand(card("Two", { cost: 2 }));
    expect(() => playCard(s, inHand(s, "Two"))).toThrow(
      "Two costs 2; 0 available.",
    );
  });

  it("refuses an action without an action point, and go again gives it back", () => {
    const s = withHand(
      card("First"),
      card("Second"),
      card("Quick", { goAgain: true }),
    );
    const once = playCard(s, inHand(s, "First"));
    expect(() => playCard(once, inHand(s, "Second"))).toThrow(
      "No action point left.",
    );
    const quick = playCard(s, inHand(s, "Quick"));
    expect(quick.actionPoints).toBe(1);
    expect(() => playCard(quick, inHand(s, "Second"))).not.toThrow();
  });

  it("plays an instant without an action point", () => {
    const s = withHand(card("First"), card("Now", { type: "instant" }));
    const spent = playCard(s, inHand(s, "First"));
    expect(() => playCard(spent, inHand(s, "Now"))).not.toThrow();
  });

  it("puts an attack in the arena and records that an attack was played", () => {
    const s = withHand(card("Hit", { type: "attack_action" }));
    const next = playCard(s, inHand(s, "Hit"));
    expect(next.zones.arena.map((i) => i.card.name)).toEqual(["Hit"]);
    expect(next.events.map((e) => e.type)).toContain("attackPlayed");
  });

  it("puts a non-attack action in the graveyard", () => {
    const s = withHand(card("Spell"));
    expect(
      playCard(s, inHand(s, "Spell")).zones.graveyard.map((i) => i.card.name),
    ).toEqual(["Spell"]);
  });

  it("refuses reactions in the action phase", () => {
    const s = withHand(card("Block", { type: "defense_reaction" }));
    expect(() => playCard(s, inHand(s, "Block"))).toThrow(RulesError);
  });
});

describe("tokens", () => {
  it("counts tokens in play apart from those created this turn", () => {
    let s = createTokens(withHand(card("A")), "runechant", 2);
    s = removeTokens(s, "runechant", 1);
    expect(s.tokens.runechant).toBe(1);
    expect(s.createdThisTurn.runechant).toBe(2);
    expect(s.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["tokensCreated", "tokensRemoved"]),
    );
  });

  it("refuses to remove more than are in play", () => {
    expect(() => removeTokens(withHand(card("A")), "gate", 1)).toThrow(
      RulesError,
    );
  });
});

describe("ending the turn", () => {
  it("puts pitched cards on the bottom, resets the turn's counters, draws up and starts the next turn", () => {
    let s = withHand(card("Blue", { pitch: 3 }), card("A"));
    const blue = inHand(s, "Blue");
    s = createTokens(pitchCard(s, blue), "runechant", 1);
    const next = endTurn(s);
    expect(next.zones.pitch).toHaveLength(0);
    expect(next.zones.deck.at(-1)!.uid).toBe(blue);
    expect(next).toMatchObject({
      turn: 2,
      phase: "action",
      actionPoints: 1,
      resources: 0,
    });
    expect(next.createdThisTurn).toEqual({});
    expect(next.tokens.runechant).toBe(1);
    expect(next.zones.hand).toHaveLength(4);
    expect(() => checkInvariants(next)).not.toThrow();
  });

  // The maintainer, 20 Oct 2026: "End turn should move cards from play to graveyard (unless the
  // card specifies otherwise)". Auras, items, allies and landmarks stay: signed off by the
  // maintainer, 20 Oct 2026.
  it("clears the arena to the graveyard, leaving permanents in play", () => {
    let s = withHand(
      card("Hit", { type: "attack_action" }),
      card("Aura", { traits: ["aura"] }),
    );
    s = playCard(s, inHand(s, "Hit"));
    s = moveCard(s, inHand(s, "Aura"), "arena");
    const next = endTurn(s);
    expect(next.zones.arena.map((i) => i.card.name)).toEqual(["Aura"]);
    expect(next.zones.graveyard.map((i) => i.card.name)).toEqual(["Hit"]);
    expect(() => checkInvariants(next)).not.toThrow();
  });

  it("can put a card from hand in an empty arsenal first", () => {
    const s = withHand(card("Keep"));
    const next = endTurn(s, { arsenal: inHand(s, "Keep") });
    expect(next.zones.arsenal.map((i) => i.card.name)).toEqual(["Keep"]);
    expect(() => endTurn(next, { arsenal: next.zones.hand[0]!.uid })).toThrow(
      "The arsenal is full.",
    );
  });
});

describe("invariants", () => {
  it("catch a card in two zones, and negative counts", () => {
    const s = withHand(card("A"));
    const twice = {
      ...s,
      zones: { ...s.zones, graveyard: [s.zones.hand[0]!] },
    };
    expect(() => checkInvariants(twice)).toThrow("in two zones");
    expect(() => checkInvariants({ ...s, resources: -1 })).toThrow(RulesError);
    expect(() => checkInvariants({ ...s, tokens: { gate: -1 } })).toThrow(
      RulesError,
    );
  });
});

// Engulfing Shadows, Embraforged Gauntlet: "If this would be put into your graveyard from
// anywhere, instead banish it." (Their facts; drafted 20 Oct 2026 for the maintainer to check.)
describe("banished instead of the graveyard", () => {
  const shade = () =>
    card("Shade", { graveyardToBanish: true, traits: ["blood_debt"] });

  it("goes to the banished zone, face up, whenever it would go to the graveyard", () => {
    const s = withHand(shade());
    const next = moveCard(s, inHand(s, "Shade"), "graveyard");
    expect(next.zones.graveyard).toHaveLength(0);
    expect(next.zones.banished.map((i) => i.card.name)).toEqual(["Shade"]);
    expect(next.faceDown).toHaveLength(0);
  });

  it("is banished when played and resolved, and when the arena clears", () => {
    const played = withHand(shade());
    expect(
      playCard(played, inHand(played, "Shade")).zones.banished.map(
        (i) => i.card.name,
      ),
    ).toEqual(["Shade"]);
    const attack = withHand(
      card("Shade attack", {
        type: "attack_action",
        graveyardToBanish: true,
      }),
    );
    const ended = endTurn(playCard(attack, inHand(attack, "Shade attack")));
    expect(ended.zones.banished.map((i) => i.card.name)).toEqual([
      "Shade attack",
    ]);
  });
});
