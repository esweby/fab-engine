// Registered rules approved by the maintainer on 24 Oct 2026.
import { describe, expect, it } from "vitest";
import {
  activateGate,
  applySessionAction,
  cardWithRules,
  checkInvariants,
  endTurn,
  moveCard,
  parseEffects,
  parseScript,
  parseTriggers,
  playCard,
  replaySession,
  RUNECHANT,
  runEffects,
  runScript,
  setUp,
  verifiedRulesFor,
  type Choose,
  type Effect,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

const permission: Effect = { op: "allowRunechantAuraPlay" };
const search: Effect = { op: "searchRunechantAura" };
const filler: RulesCard = {
  id: "filler",
  name: "Filler",
  pitch: 3,
  cost: 0,
  goAgain: true,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};
const aura = (name = "Runechant of Envy", cost = 0) =>
  cardWithRules({ ...filler, id: name, name, cost, traits: ["aura"] });
const source: RulesCard = cardWithRules({
  ...filler,
  id: "source",
  name: "Sinspeaker Gloomblade",
  pitch: 1,
  type: "attack_action",
  goAgain: false,
  effects: undefined,
});

function game(hand: RulesCard[] = [], deck: RulesCard[] = []): RulesState {
  expect(verifiedRulesFor("Sinspeaker Gloomblade", 1)).toBeDefined();
  expect(verifiedRulesFor("Embrace Sin", 2)).toBeDefined();
  expect(() => parseEffects([permission, search])).not.toThrow();
  expect(() => parseTriggers(source.triggers)).not.toThrow();
  return setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 4 - hand.length }, () => filler),
      ...deck,
      ...Array.from({ length: 12 }, () => filler),
    ],
    order: "asGiven",
    seed: 17,
    triggers: [RUNECHANT],
  });
}
const inZone = (
  state: RulesState,
  name: string,
  zone: "hand" | "deck" | "banished" = "hand",
) => state.zones[zone].find((instance) => instance.card.name === name)!.uid;
const banish = (state: RulesState, name: string) =>
  moveCard(state, inZone(state, name), "banished");
const permit = (state: RulesState) =>
  runEffects(state, verifiedRulesFor("Embrace Sin", 2)!.effects, () => []);

describe("Embrace Sin's verified permission", () => {
  it("plays the registered yellow card for one resource, with go again", () => {
    const embrace = cardWithRules({
      ...filler,
      id: "embrace",
      name: "Embrace Sin",
      pitch: 2,
      cost: 1,
      effects: undefined,
    });
    const initial = banish(game([embrace, aura()]), "Runechant of Envy");
    const played = playCard(
      { ...initial, resources: 1 },
      inZone(initial, embrace.name),
    );
    expect(played.resources).toBe(0);
    expect(played.actionPoints).toBe(1);
    expect(played.runechantAuraPlaysThisTurn).toBe(1);
    const next = playCard(
      played,
      inZone(played, "Runechant of Envy", "banished"),
    );
    expect(next.runechantAuraPlaysThisTurn).toBe(0);
  });

  it("allows one matching aura this turn, paying its normal cost", () => {
    let state = game([
      aura("Runechant of Envy", 1),
      aura("Runechant of Wrath", 1),
    ]);
    state = permit(
      banish(banish(state, "Runechant of Envy"), "Runechant of Wrath"),
    );
    const target = inZone(state, "Runechant of Envy", "banished");
    expect(() => playCard({ ...state, resources: 1 }, target)).not.toThrow();
    const played = playCard({ ...state, resources: 1 }, target);
    expect(played.resources).toBe(0);
    expect(() =>
      playCard(
        { ...played, resources: 1 },
        inZone(played, "Runechant of Wrath", "banished"),
      ),
    ).toThrow("can't be played from the banished zone");
  });

  it("also allows an aura banished after the permission was granted", () => {
    const state = banish(permit(game([aura()])), "Runechant of Envy");
    expect(() =>
      playCard(state, inZone(state, "Runechant of Envy", "banished")),
    ).not.toThrow();
  });

  it("stacks two permissions and clears them at the end of the turn", () => {
    const state = permit(permit(banish(game([aura()]), "Runechant of Envy")));
    expect(state.runechantAuraPlaysThisTurn).toBe(2);
    const next = endTurn(state);
    expect(next.runechantAuraPlaysThisTurn).toBe(0);
    expect(() =>
      playCard(next, inZone(next, "Runechant of Envy", "banished")),
    ).toThrow("can't be played from the banished zone");
  });

  it.each([
    { ...filler, name: "Other aura", traits: ["aura"] },
    { ...filler, name: "Runechant attack", type: "attack_action" },
  ])("does not allow $name", (card) => {
    const state = permit(banish(game([card]), card.name));
    expect(() => playCard(state, inZone(state, card.name, "banished"))).toThrow(
      "can't be played from the banished zone",
    );
  });

  it("does not spend the permission on a failed play or a face-down aura", () => {
    const state = permit(
      banish(game([aura("Runechant of Envy", 1)]), "Runechant of Envy"),
    );
    const target = inZone(state, "Runechant of Envy", "banished");
    expect(() => playCard(state, target)).toThrow("costs 1");
    expect(state.runechantAuraPlaysThisTurn).toBe(1);
    expect(() =>
      playCard({ ...state, resources: 1, faceDown: [target] }, target),
    ).toThrow("can't be played from the banished zone");
    expect(state.runechantAuraPlaysThisTurn).toBe(1);
  });

  it("preserves the permission when a Gate already allows the aura", () => {
    const debtAura = { ...aura(), traits: ["aura", "blood_debt"] };
    const state = permit(banish(game([debtAura]), debtAura.name));
    const target = inZone(state, debtAura.name, "banished");
    const gated = activateGate(
      { ...state, resources: 1, tokens: { gate: 1 } },
      target,
    );
    expect(playCard(gated, target).runechantAuraPlaysThisTurn).toBe(1);
  });
});

const prepareSearch = (targets: RulesCard[] = [aura()]) =>
  banish(game([source], targets), source.name);
const selecting =
  (target: string | undefined): Choose =>
  (request) =>
    request.kind === "confirm" ? ["yes"] : target ? [target] : [];

describe("Sinspeaker's verified search", () => {
  it("puts the selected aura into the arena without playing it, then shuffles", () => {
    const state = prepareSearch();
    const target = inZone(state, "Runechant of Envy", "deck");
    const played = playCard(
      state,
      inZone(state, source.name, "banished"),
      selecting(target),
    );
    expect(played.zones.arena.some((instance) => instance.uid === target)).toBe(
      true,
    );
    expect(
      played.events.filter(
        (event) => event.type === "played" && event.uid === target,
      ),
    ).toEqual([]);
    expect(
      played.events.filter((event) => event.type === "shuffled"),
    ).toHaveLength(1);
    expect(played.tokens.runechant ?? 0).toBe(0);
    checkInvariants(played);
    const next = playCard(
      { ...played, actionPoints: 1 },
      played.zones.hand[0]!.uid,
    );
    expect(next.zones.arena.some((instance) => instance.uid === target)).toBe(
      true,
    );
  });

  it("the fetched aura survives Sinspeaker and reacts to the next attack", () => {
    const state = prepareSearch();
    const target = inZone(state, "Runechant of Envy", "deck");
    const played = playCard(
      state,
      inZone(state, source.name, "banished"),
      selecting(target),
    );
    const attack = {
      ...played.zones.hand[0]!,
      card: { ...filler, type: "attack_action" },
    };
    const next = playCard(
      {
        ...played,
        actionPoints: 1,
        zones: {
          ...played.zones,
          hand: [attack, ...played.zones.hand.slice(1)],
        },
      },
      attack.uid,
    );
    expect(
      next.zones.graveyard.some((instance) => instance.uid === target),
    ).toBe(true);
    expect(next.events).toContainEqual({
      type: "tokensCreated",
      token: "runechant",
      amount: 1,
    });
  });

  it("does not search when played from hand", () => {
    const state = game([source], [aura()]);
    const played = playCard(state, inZone(state, source.name), () => {
      throw new Error("No search expected");
    });
    expect(played.events.filter((event) => event.type === "shuffled")).toEqual(
      [],
    );
  });

  it("does not reuse permission from an earlier play of the same card", () => {
    const state = prepareSearch();
    const played = playCard(
      state,
      inZone(state, source.name, "banished"),
      () => [],
    );
    const returned = moveCard(played, played.zones.arena[0]!.uid, "hand");
    expect(() =>
      playCard(
        { ...returned, actionPoints: 1 },
        inZone(returned, source.name),
        () => {
          throw new Error("No search expected");
        },
      ),
    ).not.toThrow();
  });

  it("does not count another card played from banish", () => {
    const other = { ...filler, name: "Other card", playableFromBanish: true };
    const state = banish(game([source, other], [aura()]), other.name);
    const earlier = playCard(state, inZone(state, other.name, "banished"));
    expect(() =>
      playCard(earlier, inZone(earlier, source.name), () => {
        throw new Error("No search expected");
      }),
    ).not.toThrow();
  });

  it("can decline the ability without shuffling, or search and fail to find", () => {
    const state = prepareSearch();
    const declined = playCard(
      state,
      inZone(state, source.name, "banished"),
      () => [],
    );
    expect(
      declined.events.filter((event) => event.type === "shuffled"),
    ).toEqual([]);
    const failed = playCard(
      state,
      inZone(state, source.name, "banished"),
      selecting(undefined),
    );
    expect(
      failed.events.filter((event) => event.type === "shuffled"),
    ).toHaveLength(1);
    expect(failed.zones.arena.map((instance) => instance.card.name)).toEqual([
      source.name,
    ]);
  });

  it("still shuffles after searching a deck without a matching aura", () => {
    const state = prepareSearch([]);
    const played = playCard(
      state,
      inZone(state, source.name, "banished"),
      selecting(undefined),
    );
    expect(
      played.events.filter((event) => event.type === "shuffled"),
    ).toHaveLength(1);
  });

  it("rejects a selected card that is not a Runechant aura", () => {
    const state = prepareSearch([
      aura(),
      { ...filler, name: "Other aura", traits: ["aura"] },
    ]);
    const target = inZone(state, "Other aura", "deck");
    expect(() =>
      playCard(
        state,
        inZone(state, source.name, "banished"),
        selecting(target),
      ),
    ).toThrow();
  });

  it("does not silently put an unmodelled aura into play", () => {
    const state = prepareSearch([{ ...aura(), effects: undefined }]);
    const target = inZone(state, "Runechant of Envy", "deck");
    expect(() =>
      playCard(
        state,
        inZone(state, source.name, "banished"),
        selecting(target),
      ),
    ).toThrow("no verified effects");
  });

  it("replays choices and shuffling deterministically", () => {
    const initial = game([source], [aura()]);
    const setup = {
      deck: [...initial.zones.hand, ...initial.zones.deck].map(
        (instance) => instance.card,
      ),
      order: "asGiven" as const,
      seed: 17,
      triggers: [RUNECHANT],
    };
    const first = setUp(setup);
    const target = inZone(first, "Runechant of Envy", "deck");
    const moves = [
      {
        type: "move" as const,
        uid: inZone(first, source.name),
        to: "banished" as const,
      },
      {
        type: "play" as const,
        uid: inZone(first, source.name),
        answers: [["yes"], [target]],
      },
    ];
    const played = moves.reduce(
      (state, action) => applySessionAction(state, action),
      first,
    );
    expect(replaySession(setup, moves)).toEqual(played);
    expect(replaySession(setup, moves).zones.deck).toEqual(played.zones.deck);
  });

  it("supports an explicit scripted search preference", () => {
    const banisher: RulesCard = {
      ...filler,
      name: "Banisher",
      effects: [{ op: "banish", from: "hand", amount: 1 }],
    };
    const setup = {
      deck: [
        banisher,
        source,
        filler,
        filler,
        aura(),
        aura("Runechant of Wrath"),
        ...Array.from({ length: 12 }, () => filler),
      ],
      order: "asGiven" as const,
      seed: 17,
    };
    const data = {
      version: 1,
      choices: {
        banish: [{ name: source.name }],
        search: [{ name: "Runechant of Wrath" }],
      },
      steps: [
        { do: "play", card: { name: "Banisher" } },
        { do: "play", card: { name: source.name } },
      ],
    };
    expect(() => parseScript(data)).not.toThrow();
    const script = parseScript(data);
    expect(
      runScript(setup, script).state.zones.arena.map(
        (instance) => instance.card.name,
      ),
    ).toContain("Runechant of Wrath");
  });
});
