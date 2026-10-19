// The shared game engine's state and actions (README "Shared game engine", phase two step 4).
// It moves cards and counts things; it knows no card rules. End of turn follows the basic turn
// rules (pitched cards to the bottom of the deck, draw up to intellect): UNVERIFIED.
import { describe, expect, it } from "vitest";
import {
  act,
  newGame,
  replay,
  undo,
  type EngineCard,
  type GameState,
} from "../src/index.ts";

const card = (id: string, pitch: number | null = 1): EngineCard => ({
  id,
  name: id,
  pitch,
  roles: [],
  traits: [],
  amounts: {},
});
const deckOf = (n: number) =>
  Array.from({ length: n }, (_, i) => card(`card${i}`, (i % 3) + 1));
const setup = (seed = 7) =>
  newGame({
    deck: deckOf(10),
    weapons: [card("Nebula Blade", null)],
    equipment: [card("Grasp of Darkness", null)],
    seed,
  });
const ids = (s: GameState, zone: keyof GameState["zones"]) =>
  s.zones[zone].map((c) => c.card.id);

describe("newGame", () => {
  it("shuffles the deck with the seed, draws up to intellect, and puts the loadout in play", () => {
    const g = setup().present;
    expect(g.turn).toBe(1);
    expect(g.side).toBe("forsaken");
    expect(g.zones.hand).toHaveLength(4);
    expect(g.zones.deck).toHaveLength(6);
    expect(ids(g, "weapons")).toEqual(["Nebula Blade"]);
    expect(ids(g, "equipment")).toEqual(["Grasp of Darkness"]);
  });

  it("gives every copy its own id", () => {
    const g = newGame({ deck: [card("a"), card("a")], seed: 1 }).present;
    const uids = [...g.zones.hand, ...g.zones.deck].map((c) => c.uid);
    expect(new Set(uids).size).toBe(2);
  });

  it("is the same game for the same seed, and a different one for another", () => {
    expect(ids(setup(7).present, "hand")).toEqual(
      ids(setup(7).present, "hand"),
    );
    expect(ids(setup(7).present, "hand")).not.toEqual(
      ids(setup(8).present, "hand"),
    );
  });
});

describe("actions", () => {
  it("draws from the top of the deck, and only what's left", () => {
    let h = setup();
    const top = h.present.zones.deck[0]!.uid;
    h = act(h, { type: "draw" });
    expect(h.present.zones.hand.at(-1)!.uid).toBe(top);
    h = act(h, { type: "draw", count: 20 });
    expect(h.present.zones.deck).toHaveLength(0);
    expect(h.present.zones.hand).toHaveLength(10);
  });

  it("moves a card from wherever it is to any zone, top or bottom of the deck", () => {
    let h = setup();
    const [a, b] = h.present.zones.hand;
    h = act(h, { type: "move", uid: a!.uid, to: "pitch" });
    h = act(h, { type: "move", uid: b!.uid, to: "deck", position: "bottom" });
    expect(h.present.zones.pitch.map((c) => c.uid)).toEqual([a!.uid]);
    expect(h.present.zones.deck.at(-1)!.uid).toBe(b!.uid);
    h = act(h, { type: "move", uid: a!.uid, to: "deck", position: "top" });
    expect(h.present.zones.deck[0]!.uid).toBe(a!.uid);
    expect(h.present.zones.pitch).toHaveLength(0);
  });

  it("moves weapons and equipment too", () => {
    let h = setup();
    const blade = h.present.zones.weapons[0]!.uid;
    h = act(h, { type: "move", uid: blade, to: "graveyard" });
    expect(ids(h.present, "graveyard")).toEqual(["Nebula Blade"]);
  });

  it("refuses to move a card that isn't in the game", () => {
    expect(() =>
      act(setup(), { type: "move", uid: "nope", to: "hand" }),
    ).toThrow("No card nope");
  });

  it("counts tokens, never below zero", () => {
    let h = setup();
    h = act(h, { type: "token", token: "runechant", delta: 3 });
    h = act(h, { type: "token", token: "runechant", delta: -5 });
    h = act(h, { type: "token", token: "gate", delta: 1 });
    expect(h.present.tokens).toEqual({ runechant: 0, gate: 1 });
  });

  it("traverses between Forsaken and Usurper", () => {
    let h = act(setup(), { type: "traverse" });
    expect(h.present.side).toBe("usurper");
    h = act(h, { type: "traverse" });
    expect(h.present.side).toBe("forsaken");
  });

  it("ends the turn: pitched cards to the bottom of the deck, then draw up to intellect", () => {
    let h = setup();
    const [a, b] = h.present.zones.hand;
    h = act(h, { type: "move", uid: a!.uid, to: "pitch" });
    h = act(h, { type: "move", uid: b!.uid, to: "graveyard" });
    h = act(h, { type: "endTurn" });
    const g = h.present;
    expect(g.turn).toBe(2);
    expect(g.zones.pitch).toHaveLength(0);
    expect(g.zones.deck.at(-1)!.uid).toBe(a!.uid);
    expect(g.zones.hand).toHaveLength(4);
  });

  it("shuffles the deck the same way every time for the same game", () => {
    const shuffled = (seed: number) =>
      ids(act(setup(seed), { type: "shuffle" }).present, "deck");
    expect(shuffled(7)).toEqual(shuffled(7));
    expect(shuffled(7)).not.toEqual(ids(setup(7).present, "deck"));
  });

  it("keeps a log of every action", () => {
    const h = act(act(setup(), { type: "draw" }), { type: "traverse" });
    expect(h.present.log.map((a) => a.type)).toEqual(["draw", "traverse"]);
  });
});

describe("undo and replay", () => {
  it("undoes the last action exactly, and does nothing at the start", () => {
    const start = setup();
    const after = act(act(start, { type: "draw" }), { type: "traverse" });
    expect(undo(undo(after)).present).toEqual(start.present);
    expect(undo(start).present).toEqual(start.present);
  });

  it("replays a game's log from its seed to the same state", () => {
    let h = setup(42);
    const [a] = h.present.zones.hand;
    h = act(h, { type: "move", uid: a!.uid, to: "pitch" });
    h = act(h, { type: "token", token: "runechant", delta: 2 });
    h = act(h, { type: "shuffle" });
    h = act(h, { type: "endTurn" });
    expect(
      replay(
        {
          deck: deckOf(10),
          weapons: [card("Nebula Blade", null)],
          equipment: [card("Grasp of Darkness", null)],
          seed: 42,
        },
        h.present.log,
      ).present,
    ).toEqual(h.present);
  });
});
