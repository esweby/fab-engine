// Card effects (docs/rules-engine.md, step 3): typed data, checked before any run, executed in
// order with bindings, conditions read from the state when they resolve, and choices asked of
// the caller from the legal options. The cards here are made up; real cards come in step 5,
// verified by a player.
import { describe, expect, it } from "vitest";
import {
  parseEffects,
  playCard,
  pitchCard,
  RulesError,
  runEffects,
  setUp,
  type Choose,
  type Effect,
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
  effects: [],
  ...over,
});
const game = (...hand: RulesCard[]) =>
  setUp({
    deck: [...hand, ...Array.from({ length: 20 }, () => card("Filler"))],
    seed: 1,
    order: "asGiven",
  });
const uidOf = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
/** Picks the named card when asked, and records what it was offered. */
const picking = (s: RulesState, name: string) => {
  const asked: string[][] = [];
  const choose: Choose = (request) => {
    asked.push(request.options);
    return [uidOf(s, name)];
  };
  return { choose, asked };
};

// Made up, in the shape of a "banish a card from hand; if it's Shadow, create a Gate" effect.
const banishThenGate: Effect[] = [
  { op: "banish", from: "hand", amount: 1, storeAs: "banished" },
  {
    op: "if",
    check: { has: "shadow", target: "banished" },
    then: [{ op: "createToken", token: "gate", amount: 1 }],
    else: [{ op: "createToken", token: "runechant", amount: 1 }],
  },
];

describe("the effect schema", () => {
  it("accepts typed effects and rejects anything else", () => {
    expect(() => parseEffects(banishThenGate)).not.toThrow();
    expect(() => parseEffects([{ op: "teleport" }])).toThrow(RulesError);
    expect(() =>
      parseEffects([{ op: "createToken", token: "gate", amount: 0 }]),
    ).toThrow(RulesError);
  });

  it("rejects a binding used before anything sets it", () => {
    expect(() =>
      parseEffects([
        {
          op: "if",
          check: { has: "shadow", target: "banished" },
          then: [{ op: "createToken", token: "gate", amount: 1 }],
        },
      ]),
    ).toThrow('Binding "banished" is used before it is set.');
  });
});

describe("running effects", () => {
  it("binds what an operation did, and checks it when the condition resolves", () => {
    const s = game(card("Shade", { traits: ["shadow"] }), card("Plain"));
    const shadow = runEffects(s, banishThenGate, picking(s, "Shade").choose);
    expect(shadow.tokens).toEqual({ gate: 1 });
    expect(shadow.zones.banished.map((i) => i.card.name)).toEqual(["Shade"]);
    const plain = runEffects(s, banishThenGate, picking(s, "Plain").choose);
    expect(plain.tokens).toEqual({ runechant: 1 });
  });

  it("offers only the legal options, and refuses a choice outside them", () => {
    const s = game(card("Shade"), card("Plain"));
    const { choose, asked } = picking(s, "Shade");
    runEffects(s, banishThenGate, choose);
    expect(asked[0]).toEqual(s.zones.hand.map((i) => i.uid));
    expect(() =>
      runEffects(s, banishThenGate, () => [s.zones.deck[0]!.uid]),
    ).toThrow(RulesError);
  });

  it("lets an optional choice be declined, leaving the binding empty", () => {
    const s = game(card("Shade", { traits: ["shadow"] }));
    const optional: Effect[] = [
      { op: "banish", from: "hand", amount: 1, optional: true, storeAs: "b" },
      {
        op: "if",
        check: { has: "shadow", target: "b" },
        then: [{ op: "createToken", token: "gate", amount: 1 }],
      },
    ];
    const next = runEffects(s, optional, () => []);
    expect(next.zones.banished).toHaveLength(0);
    expect(next.tokens).toEqual({});
    expect(() => runEffects(s, banishThenGate, () => [])).toThrow(RulesError);
  });

  it("takes the top of the deck without asking, face down when it says so", () => {
    const s = game(card("A"));
    const top = s.zones.deck[0]!.uid;
    const next = runEffects(
      s,
      [{ op: "banish", from: "deckTop", amount: 1, faceDown: true }],
      () => {
        throw new Error("no choice should be asked");
      },
    );
    expect(next.zones.banished.map((i) => i.uid)).toEqual([top]);
    expect(next.faceDown).toContain(top);
  });

  it("reads the state as it stands when a check resolves", () => {
    const s = game(card("A"));
    const next = runEffects(
      s,
      [
        { op: "createToken", token: "runechant", amount: 3 },
        {
          op: "if",
          check: { createdThisTurn: "runechant", atLeast: 3 },
          then: [{ op: "gainActionPoint" }],
        },
      ],
      () => [],
    );
    expect(next.actionPoints).toBe(2);
  });
});

describe("playing a card runs its effects", () => {
  it("after paying for it", () => {
    const maker = card("Maker", {
      effects: [{ op: "createToken", token: "runechant", amount: 2 }],
    });
    const s = game(maker);
    const next = playCard(s, uidOf(s, "Maker"));
    expect(next.tokens.runechant).toBe(2);
    const types = next.events.map((e) => e.type);
    expect(types.indexOf("played")).toBeLessThan(
      types.indexOf("tokensCreated"),
    );
  });

  it("with the choices it needs", () => {
    const banisher = card("Banisher", { effects: banishThenGate });
    const s = game(banisher, card("Shade", { traits: ["shadow"] }));
    const next = playCard(s, uidOf(s, "Banisher"), picking(s, "Shade").choose);
    expect(next.tokens.gate).toBe(1);
  });

  it("but not a card with no verified effects, which can still be pitched", () => {
    const unknown = card("Unknown", { effects: undefined });
    const s = game(unknown);
    expect(() => playCard(s, uidOf(s, "Unknown"))).toThrow(
      "Unknown has no verified effects yet, so the engine can't play it.",
    );
    expect(() => pitchCard(s, uidOf(s, "Unknown"))).not.toThrow();
  });
});

// Opt (the maintainer, 20 Oct 2026: "very important" for Blood Tribute and the like): look at the
// top cards of the deck and put any of them on the bottom; the rest stay on top. The player is
// asked one card at a time, and choosing none keeps the rest. UNVERIFIED: reordering the cards
// kept on top isn't modelled yet.
describe("opt", () => {
  const named = (s: RulesState, name: string) =>
    s.zones.deck.find((i) => i.card.name === name)!.uid;
  const withTop = () =>
    setUp({
      deck: [
        ...["H1", "H2", "H3", "H4", "A", "B", "C", "D"].map((n) => card(n)),
        ...Array.from({ length: 10 }, () => card("Filler")),
      ],
      seed: 1,
      order: "asGiven",
    });

  it("is a valid effect", () => {
    expect(() => parseEffects([{ op: "opt", amount: 3 }])).not.toThrow();
  });

  it("puts the chosen cards on the bottom, one at a time, the rest staying on top in order", () => {
    const s = withTop();
    const asked: string[][] = [];
    const picks = [[named(s, "B")], []];
    const next = runEffects(s, [{ op: "opt", amount: 3 }], (request) => {
      asked.push(request.options);
      return picks[asked.length - 1]!;
    });
    expect(asked[0]).toEqual(["A", "B", "C"].map((n) => named(s, n)));
    expect(asked[1]).toEqual(["A", "C"].map((n) => named(s, n)));
    expect(next.zones.deck.slice(0, 3).map((i) => i.card.name)).toEqual([
      "A",
      "C",
      "D",
    ]);
    expect(next.zones.deck.at(-1)!.card.name).toBe("B");
  });

  it("then banishes the card it left on top, as Blood Tribute does", () => {
    const s = withTop();
    const picks = [[named(s, "A")], [named(s, "B")], []];
    let n = 0;
    const next = runEffects(
      s,
      [
        { op: "opt", amount: 3 },
        { op: "banish", from: "deckTop", amount: 1 },
      ],
      () => picks[n++]!,
    );
    expect(next.zones.banished.map((i) => i.card.name)).toEqual(["C"]);
  });

  it("looks at no more cards than the deck has", () => {
    let s = withTop();
    s = { ...s, zones: { ...s.zones, deck: s.zones.deck.slice(0, 2) } };
    const asked: string[][] = [];
    runEffects(s, [{ op: "opt", amount: 3 }], (request) => {
      asked.push(request.options);
      return [];
    });
    expect(asked[0]).toHaveLength(2);
  });
});
