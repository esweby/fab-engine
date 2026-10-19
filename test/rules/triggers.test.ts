// Events and triggers (docs/rules-engine.md, step 4): after each action, the events it emitted
// are matched against triggers, and pending triggers resolve in a loop until none are left, so a
// trigger's own events can set off more. A processing budget fails a runaway run with its trace.
// The triggers here are made up; Viserai's real text and the Runechant token's rule come in
// step 5, verified by the maintainer.
import { describe, expect, it } from "vitest";
import {
  endTurn,
  pitchCard,
  playCard,
  parseTriggers,
  RulesBudgetExceeded,
  RulesError,
  setUp,
  type RulesCard,
  type RulesState,
  type Trigger,
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
const maker = (n: number) =>
  card(`Makes ${n}`, {
    effects: [{ op: "createToken", token: "runechant", amount: n }],
  });
const game = (triggers: Trigger[], hand: RulesCard[], over = {}) =>
  setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 20 }, (_, i) =>
        card(`Filler ${i}`, { traits: i % 2 ? ["shadow"] : [] }),
      ),
    ],
    seed: 1,
    order: "asGiven",
    triggers,
    ...over,
  });
const uidOf = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
const types = (s: RulesState) => s.events.map((e) => e.type);

// Illustrative, in the shape of the README's example; not Viserai's verified text.
const banishOnRunechant: Trigger = {
  id: "example-hero",
  on: { event: "tokensCreated", token: "runechant" },
  condition: { side: "forsaken" },
  effects: [{ op: "banish", from: "deckTop", amount: 1, storeAs: "top" }],
};

describe("triggers", () => {
  it("resolve after the action that set them off, once its own effects are done", () => {
    const s = game([banishOnRunechant], [maker(1)]);
    const top = s.zones.deck[0]!.uid;
    const next = playCard(s, uidOf(s, "Makes 1"));
    expect(next.zones.banished.map((i) => i.uid)).toEqual([top]);
    const t = types(next);
    expect(t.indexOf("tokensCreated")).toBeLessThan(t.indexOf("triggered"));
    expect(next.events.find((e) => e.type === "triggered")).toMatchObject({
      trigger: "example-hero",
    });
  });

  it("check their condition when they would trigger", () => {
    const s = game([banishOnRunechant], [maker(1)], { side: "usurper" });
    expect(playCard(s, uidOf(s, "Makes 1")).zones.banished).toHaveLength(0);
  });

  it("fire once per event, so one effect making several tokens triggers once", () => {
    const s = game([banishOnRunechant], [maker(3)]);
    const next = playCard(s, uidOf(s, "Makes 3"));
    expect(next.tokens.runechant).toBe(3);
    expect(next.createdThisTurn.runechant).toBe(3);
    expect(next.zones.banished).toHaveLength(1);
  });

  it("can see what set them off", () => {
    const gateOnShadowBanish: Trigger = {
      id: "example-gate",
      on: { event: "moved", to: "banished" },
      condition: { has: "shadow", target: "event" },
      effects: [{ op: "createToken", token: "gate", amount: 1 }],
    };
    // The hand draws Banish top and Fillers 0 to 2; the deck's top two are Filler 3 (Shadow)
    // and Filler 4 (no trait).
    const banishTop = card("Banish top", {
      effects: [{ op: "banish", from: "deckTop", amount: 2 }],
    });
    const s = game([gateOnShadowBanish], [banishTop]);
    expect(playCard(s, uidOf(s, "Banish top")).tokens.gate).toBe(1);
  });

  it("cascade: a trigger's events set off further triggers", () => {
    const second: Trigger = {
      id: "example-second",
      on: { event: "moved", to: "banished" },
      effects: [{ op: "createToken", token: "gate", amount: 1 }],
    };
    const s = game([banishOnRunechant, second], [maker(1)]);
    const next = playCard(s, uidOf(s, "Makes 1"));
    expect(next.tokens.gate).toBe(1);
    expect(
      next.events.filter((e) => e.type === "triggered").map((e) => e.trigger),
    ).toEqual(["example-hero", "example-second"]);
  });

  it("ask before an optional trigger, and do nothing when declined", () => {
    const optional = { ...banishOnRunechant, optional: true };
    const s = game([optional], [maker(1)]);
    const asked: string[] = [];
    const declined = playCard(s, uidOf(s, "Makes 1"), (request) => {
      asked.push(request.prompt);
      return [];
    });
    expect(asked).toEqual(["Use example-hero?"]);
    expect(declined.zones.banished).toHaveLength(0);
    const accepted = playCard(s, uidOf(s, "Makes 1"), () => ["yes"]);
    expect(accepted.zones.banished).toHaveLength(1);
  });

  it("also follow pitching and the end of the turn", () => {
    const onPitch: Trigger = {
      id: "example-pitch",
      on: { event: "pitched" },
      effects: [{ op: "gainResources", amount: 1 }],
    };
    const onEnd: Trigger = {
      id: "example-end",
      on: { event: "turnEnded" },
      effects: [{ op: "createToken", token: "gate", amount: 1 }],
    };
    const s = game([onPitch, onEnd], [card("A")]);
    expect(pitchCard(s, uidOf(s, "A")).resources).toBe(2);
    expect(endTurn(s).tokens.gate).toBe(1);
  });

  it("fail a runaway run, keeping its trace, and leave the state as it was", () => {
    const loop: Trigger = {
      id: "example-loop",
      on: { event: "tokensCreated", token: "runechant" },
      effects: [{ op: "createToken", token: "runechant", amount: 1 }],
    };
    const s = game([loop], [maker(1)], { budget: 50 });
    const before = JSON.stringify(s);
    let failure: unknown;
    try {
      playCard(s, uidOf(s, "Makes 1"));
    } catch (e) {
      failure = e;
    }
    expect(failure).toBeInstanceOf(RulesBudgetExceeded);
    const trace = (failure as RulesBudgetExceeded).events;
    expect(trace.filter((e) => e.type === "triggered")).toHaveLength(50);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("are checked before any run, like effects", () => {
    expect(() => parseTriggers([banishOnRunechant])).not.toThrow();
    expect(() =>
      parseTriggers([{ ...banishOnRunechant, on: { event: "exploded" } }]),
    ).toThrow(RulesError);
    expect(() =>
      parseTriggers([
        {
          id: "bad",
          on: { event: "pitched" },
          condition: { has: "shadow", target: "nothing" },
          effects: [],
        },
      ]),
    ).toThrow('Binding "nothing" is used before it is set.');
  });
});
