// Conditional banish permission, accepted for Usurp the Shadow Throne on 24 Oct 2026.
import { describe, expect, it } from "vitest";
import {
  activateGate,
  playCard,
  setUp,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

const attack: RulesCard = {
  id: "conditional-attack",
  name: "Conditional attack",
  pitch: 3,
  cost: 0,
  goAgain: true,
  type: "attack_action",
  roles: [],
  traits: ["blood_debt"],
  amounts: {},
  effects: [],
  usurp: true,
  playableFromBanishWhen: "usurpedThisTurn",
};

function game() {
  const state = setUp({
    deck: Array.from({ length: 24 }, () => attack),
    order: "asGiven",
    seed: 1,
  });
  const [target, ...hand] = state.zones.hand;
  return {
    ...state,
    resources: 1,
    tokens: { runechant: 1, gate: 1 },
    zones: { ...state.zones, hand, banished: [target!] },
  };
}

const target = (state: RulesState) => state.zones.banished[0]!.uid;

describe("conditional play from banish", () => {
  it("allows the card after another card usurps this turn", () => {
    const state = game();
    const earlier = playCard(state, state.zones.hand[0]!.uid);
    expect(earlier.events).toContainEqual({
      type: "usurped",
      uid: state.zones.hand[0]!.uid,
    });
    expect(() => playCard(earlier, target(earlier))).not.toThrow();
    expect(playCard(earlier, target(earlier)).zones.banished).toEqual([]);
  });

  it("does not let the card's own potential usurp satisfy its permission", () => {
    const state = game();
    expect(() => playCard(state, target(state))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("does not count a usurp from an earlier turn", () => {
    const state = game();
    const previous: RulesState = {
      ...state,
      events: [{ type: "usurped", uid: "earlier" }, ...state.events],
    };
    expect(() => playCard(previous, target(previous))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("does not count playing a Usurp card when no Runechant was destroyed", () => {
    const state = { ...game(), tokens: { runechant: 0, gate: 1 } };
    const earlier = playCard(state, state.zones.hand[0]!.uid);
    expect(() => playCard(earlier, target(earlier))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("accepts independent permission from a Gate", () => {
    const state = game();
    const activated = activateGate(state, target(state));
    expect(playCard(activated, target(activated)).zones.banished).toEqual([]);
  });

  it("still refuses face-down cards after a usurp", () => {
    const state = game();
    const earlier = playCard(state, state.zones.hand[0]!.uid);
    const faceDown = { ...earlier, faceDown: [target(earlier)] };
    expect(() => playCard(faceDown, target(faceDown))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("does not restrict playing the card from hand", () => {
    const state = game();
    expect(() => playCard(state, state.zones.hand[0]!.uid)).not.toThrow();
  });
});
