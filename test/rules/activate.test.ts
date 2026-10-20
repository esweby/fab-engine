// Activated abilities (the maintainer asked for an activate action, 20 Oct 2026): "Instant - {r},
// destroy this: Create a Runechant token", "Instant - Banish this from your hand: …". The card pays
// as its text says, then the ability resolves. The cards here are made up in those shapes.
import { describe, expect, it } from "vitest";
import {
  activateCard,
  applySessionAction,
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
  effects: [],
  ...over,
});
const filler = (i: number) => card(`Filler ${i}`, { pitch: 3 });

// "Instant - {r}, destroy this: Create a Runechant token" (Grimoire of Fellingsong's shape).
const GRIMOIRE = () =>
  card("Grimoire", {
    type: "equipment",
    pitch: null,
    cost: null,
    activate: {
      speed: "instant",
      cost: 1,
      pay: "destroy",
      effects: [{ op: "createToken", token: "runechant", amount: 1 }],
    },
  });
// "Instant - Banish this from your hand: …" (Fallen Herald's shape; the rest is out of scope).
const HERALD = () =>
  card("Herald", {
    type: "attack_action",
    traits: ["blood_debt"],
    activate: {
      speed: "instant",
      cost: 0,
      pay: "banish_from_hand",
      effects: [],
    },
  });
// "Action - {r}{r}: Create a Runechant token" (Grasp of the Arknight's shape).
const GRASP = () =>
  card("Grasp", {
    type: "equipment",
    pitch: null,
    cost: null,
    activate: {
      speed: "action",
      cost: 2,
      pay: "none",
      effects: [{ op: "createToken", token: "runechant", amount: 1 }],
    },
  });

function game(hand: RulesCard[], equipment: RulesCard[] = []): RulesState {
  return {
    ...setUp({
      deck: [
        ...hand,
        ...Array.from({ length: 4 - hand.length }, (_, i) => filler(i)),
        ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
      ],
      equipment,
      seed: 1,
      order: "asGiven",
    }),
    resources: 3,
  };
}
const uidOf = (s: RulesState, name: string) =>
  [...s.zones.hand, ...s.zones.equipment].find((i) => i.card.name === name)!
    .uid;
const names = (s: RulesState, zone: "graveyard" | "banished" | "equipment") =>
  s.zones[zone].map((i) => i.card.name);

describe("activating a card", () => {
  it("pays its cost, destroys it, then resolves", () => {
    const s = game([], [GRIMOIRE()]);
    const next = activateCard(s, uidOf(s, "Grimoire"));
    expect(next.resources).toBe(2);
    expect(names(next, "equipment")).toEqual([]);
    expect(names(next, "graveyard")).toEqual(["Grimoire"]);
    expect(next.tokens.runechant).toBe(1);
  });

  it("banishes a card from hand when that's its cost, face up", () => {
    const s = game([HERALD()]);
    const next = activateCard(s, uidOf(s, "Herald"));
    expect(names(next, "banished")).toEqual(["Herald"]);
    expect(next.faceDown).toEqual([]);
    expect(next.actionPoints).toBe(1);
  });

  it("uses an action point at action speed, and stays when its cost is only resources", () => {
    const s = game([], [GRASP()]);
    const next = activateCard(s, uidOf(s, "Grasp"));
    expect(next.actionPoints).toBe(0);
    expect(next.resources).toBe(1);
    expect(names(next, "equipment")).toEqual(["Grasp"]);
    expect(() => activateCard(next, uidOf(s, "Grasp"))).toThrow(
      "No action point left.",
    );
  });

  it("refuses without the resources, or from the wrong place", () => {
    const poor = { ...game([], [GRIMOIRE()]), resources: 0 };
    expect(() => activateCard(poor, uidOf(poor, "Grimoire"))).toThrow(
      "Activating Grimoire costs 1; 0 available.",
    );
    const s = game([HERALD()]);
    const banished = activateCard(s, uidOf(s, "Herald"));
    expect(() => activateCard(banished, uidOf(s, "Herald"))).toThrow(
      RulesError,
    );
    const plain = game([card("Plain")]);
    expect(() => activateCard(plain, uidOf(plain, "Plain"))).toThrow(
      "Plain has no ability to activate.",
    );
  });

  it("is a session action, as goldfish uses it", () => {
    const s = game([], [GRIMOIRE()]);
    const next = applySessionAction(s, {
      type: "activate",
      uid: uidOf(s, "Grimoire"),
    });
    expect(next.tokens.runechant).toBe(1);
  });
});
