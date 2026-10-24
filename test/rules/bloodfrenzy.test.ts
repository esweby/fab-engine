import { describe, expect, it } from "vitest";
import {
  applySessionAction,
  cardWithRules,
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
  type: "attack_action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};

function game(
  pitch: number,
  runechants = 0,
  side: RulesState["side"] = "forsaken",
) {
  expect(verifiedRulesFor("Bloodfrenzy Gloomblade", pitch)).toBeDefined();
  const bloodfrenzy = cardWithRules({
    ...filler,
    id: `bloodfrenzy-${pitch}`,
    name: "Bloodfrenzy Gloomblade",
    pitch,
    cost: 1,
    traits: ["runeblade", "shadow", "blood_debt"],
    effects: undefined,
  });
  const state = setUp({
    deck: [bloodfrenzy, ...Array.from({ length: 24 }, () => filler)],
    order: "asGiven",
    seed: 1,
    side,
    triggers: [...VISERAI, RUNECHANT],
  });
  return { ...state, resources: 1, tokens: { runechant: runechants } };
}

const uid = (state: RulesState) => state.zones.hand[0]!.uid;
const noteDamage = (state: RulesState, amount: number) =>
  applySessionAction(state, { type: "damage", delta: amount });

describe.each([1, 2, 3])("verified Bloodfrenzy, pitch %i", (pitch) => {
  it("usurps one Runechant and gains go again from the remaining damage", () => {
    const state = game(pitch, 2);
    const played = playCard(state, uid(state));
    expect(played.events).toContainEqual({ type: "usurped", uid: uid(state) });
    expect(played.events).toContainEqual({ type: "arcaneDamage", amount: 1 });
    expect(played.tokens.runechant).toBe(0);
    expect(played.actionPoints).toBe(1);
  });

  it("does not gain go again when its only Runechant is usurped", () => {
    const state = game(pitch, 1);
    expect(playCard(state, uid(state)).actionPoints).toBe(0);
  });

  it("gains go again from its own hit only once", () => {
    const state = game(pitch);
    const played = playCard(state, uid(state));
    expect(played.actionPoints).toBe(0);
    const hit = noteDamage(played, 3);
    expect(hit.actionPoints).toBe(1);
    expect(noteDamage(hit, 1).actionPoints).toBe(1);
  });

  it("counts damage already dealt this turn", () => {
    const state = noteDamage(game(pitch), 1);
    expect(playCard(state, uid(state)).actionPoints).toBe(1);
  });

  it("ignores damage from earlier turns and zero damage", () => {
    const state = game(pitch);
    const previous: RulesState = {
      ...state,
      events: [{ type: "damageNoted", amount: 3 }, ...state.events],
    };
    expect(playCard(previous, uid(previous)).actionPoints).toBe(0);
    const zero = noteDamage(state, 0);
    expect(playCard(zero, uid(zero)).actionPoints).toBe(0);
  });

  it("returns one action point when Viserai also grants go again", () => {
    const state = game(pitch, 2, "usurper");
    const played = playCard(state, uid(state));
    expect(played.actionPoints).toBe(1);
    expect(noteDamage(played, 3).actionPoints).toBe(1);
  });

  it("does not gain another action point when Viserai traverses", () => {
    const state = game(pitch, 2);
    const played = playCard(state, uid(state));
    expect(applySessionAction(played, { type: "traverse" }).actionPoints).toBe(
      1,
    );
  });

  it("does not gain go again from a later attack's hit", () => {
    const state = game(pitch);
    const played = playCard(state, uid(state));
    const next = playCard({ ...played, actionPoints: 1 }, uid(played));
    expect(noteDamage(next, 3).actionPoints).toBe(0);
  });

  it("can be played face up from banish without a Gate", () => {
    const state = game(pitch, 2);
    const [attack, ...hand] = state.zones.hand;
    const banished: RulesState = {
      ...state,
      zones: { ...state.zones, hand, banished: [attack!] },
    };
    const played = playCard(banished, attack!.uid);
    expect(played.zones.banished).toEqual([]);
    expect(
      played.zones.arena.some((instance) => instance.uid === attack!.uid),
    ).toBe(true);
    expect(played.actionPoints).toBe(1);
  });
});
