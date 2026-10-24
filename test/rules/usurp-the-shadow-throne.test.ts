import { describe, expect, it } from "vitest";
import {
  activateGate,
  cardWithRules,
  effectiveCost,
  playCard,
  RUNECHANT,
  setUp,
  verifiedRulesFor,
  VISERAI,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

const filler: RulesCard = {
  id: "filler",
  name: "Filler",
  pitch: 3,
  cost: 0,
  goAgain: false,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};

function game(banished = false, resources = 8, runechants = 2): RulesState {
  expect(verifiedRulesFor("Usurp the Shadow Throne", 3)).toBeDefined();
  const throne = cardWithRules({
    ...filler,
    id: "throne",
    name: "Usurp the Shadow Throne",
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
    cost: 13,
    power: 13,
    effects: undefined,
  });
  const bloodfrenzy = cardWithRules({
    ...filler,
    id: "bloodfrenzy",
    name: "Bloodfrenzy Gloomblade",
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
    pitch: 1,
    cost: 1,
    power: 3,
    effects: undefined,
  });
  const state = setUp({
    deck: [bloodfrenzy, throne, ...Array.from({ length: 22 }, () => filler)],
    order: "asGiven",
    seed: 1,
    triggers: [...VISERAI, RUNECHANT],
  });
  const target = state.zones.hand[1]!;
  return {
    ...state,
    resources,
    tokens: { runechant: runechants, gate: 1 },
    zones: banished
      ? {
          ...state.zones,
          hand: state.zones.hand.filter(
            (instance) => instance.uid !== target.uid,
          ),
          banished: [target],
        }
      : state.zones,
  };
}

const throneUid = (state: RulesState) =>
  [...state.zones.hand, ...state.zones.banished].find(
    (instance) => instance.card.name === "Usurp the Shadow Throne",
  )!.uid;
const playStarter = (state: RulesState) =>
  playCard(state, state.zones.hand[0]!.uid);

describe("verified Usurp the Shadow Throne", () => {
  it("verifies blue only", () => {
    expect(verifiedRulesFor("Usurp the Shadow Throne", 3)).toBeDefined();
    expect(verifiedRulesFor("Usurp the Shadow Throne", 1)).toBeUndefined();
    expect(verifiedRulesFor("Usurp the Shadow Throne", 2)).toBeUndefined();
  });

  it("costs 13 from hand before any usurp, and does not usurp itself", () => {
    const state = game(false, 13);
    expect(effectiveCost(state, throneUid(state))).toBe(13);
    const played = playCard(state, throneUid(state));
    expect(played.resources).toBe(0);
    expect(played.events.filter((event) => event.type === "usurped")).toEqual(
      [],
    );
    expect(played.events).toContainEqual({ type: "arcaneDamage", amount: 2 });
    expect(played.actionPoints).toBe(0);
  });

  it.each([false, true])(
    "costs 7 after Bloodfrenzy usurps, banished=%s",
    (banished) => {
      const state = playStarter(game(banished));
      expect(state.actionPoints).toBe(1);
      expect(effectiveCost(state, throneUid(state))).toBe(7);
      const played = playCard(state, throneUid(state));
      expect(played.resources).toBe(0);
      expect(
        played.zones.arena.map((instance) => instance.card.name),
      ).toContain("Usurp the Shadow Throne");
    },
  );

  it("refuses play from banish before an earlier usurp", () => {
    const state = game(true, 13);
    expect(() => playCard(state, throneUid(state))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("does not count Bloodfrenzy when no Runechant was usurped", () => {
    const state = playStarter(game(true, 14, 0));
    expect(effectiveCost(state, throneUid(state))).toBe(13);
    expect(() =>
      playCard({ ...state, actionPoints: 1 }, throneUid(state)),
    ).toThrow("can't be played from the banished zone");
  });

  it("forgets the previous turn's permission and discount", () => {
    const state = game(true, 13);
    const previous: RulesState = {
      ...state,
      events: [{ type: "usurped", uid: "earlier" }, ...state.events],
    };
    expect(effectiveCost(previous, throneUid(previous))).toBe(13);
    expect(() => playCard(previous, throneUid(previous))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("allows Gate permission at full cost without an earlier usurp", () => {
    const state = game(true, 14);
    const activated = activateGate(state, throneUid(state));
    expect(effectiveCost(activated, throneUid(activated))).toBe(13);
    expect(playCard(activated, throneUid(activated)).resources).toBe(0);
  });

  it("still refuses face-down cards after an earlier usurp", () => {
    const state = playStarter(game(true));
    const faceDown = { ...state, faceDown: [throneUid(state)] };
    expect(() => playCard(faceDown, throneUid(faceDown))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("still needs enough resources for the reduced cost", () => {
    const state = playStarter(game(true, 7));
    expect(() => playCard(state, throneUid(state))).toThrow(
      "Usurp the Shadow Throne costs 7; 6 available",
    );
  });
});
