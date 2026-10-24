// UNVERIFIED card drafts; explicit answers are not an opponent simulation.
import { describe, expect, it } from "vitest";
import {
  applySessionAction,
  checkInvariants,
  moveCard,
  parseTriggers,
  parseScript,
  playCard,
  replaySession,
  runScript,
  setUp,
  type Choose,
  type RulesCard,
} from "../../src/rules/index.ts";

const filler: RulesCard = {
  id: "filler",
  name: "Filler",
  pitch: 3,
  type: "action",
  cost: 0,
  goAgain: false,
  roles: [],
  traits: [],
  amounts: {},
  effects: [],
};
const cull: RulesCard = {
  ...filler,
  id: "cull",
  name: "Draft Cull",
  playableFromBanish: true,
  instantWhen: "hero_lost_life_this_turn",
  effects: [{ op: "banish", from: "hand", amount: 1 }],
};
const proposedScar = [
  {
    id: "draft-scar",
    on: { event: "played", self: true },
    effects: [
      {
        op: "ifAnswered",
        condition: "less_life_than_opposing_hero",
        then: [{ op: "grantGoAgain", target: "self" }],
      },
    ],
  },
];
const scar = (): RulesCard => {
  expect(() => parseTriggers(proposedScar)).not.toThrow();
  return {
    ...filler,
    id: "scar",
    name: "Draft Scar",
    type: "attack_action",
    triggers: parseTriggers(proposedScar),
  };
};
const setup = (
  card: RulesCard,
  rest: RulesCard[] = [filler, filler, filler],
) => ({
  deck: [card, ...rest],
  order: "asGiven" as const,
  seed: 17,
});
const answer =
  (yes: boolean): Choose =>
  (request) =>
    request.kind === "condition"
      ? [yes ? "yes" : "no"]
      : request.options.slice(0, request.count);

describe("Cull's proposed timing and self banish", () => {
  it("requires an answer before using instant speed with no action point", () => {
    const initial = { ...setUp(setup(cull)), actionPoints: 0 };
    expect(() => playCard(initial, initial.zones.hand[0]!.uid)).toThrow(
      "choice is needed",
    );
    expect(() =>
      playCard(initial, initial.zones.hand[0]!.uid, answer(false)),
    ).toThrow("No action point");
    const played = playCard(initial, initial.zones.hand[0]!.uid, answer(true));
    expect(played.actionPoints).toBe(0);
    expect(played.zones.banished).toHaveLength(1);
    expect(played.events).toContainEqual({
      type: "played",
      uid: initial.zones.hand[0]!.uid,
      cost: 0,
    });
    checkInvariants(played);
  });

  it.each([
    [true, 1],
    [false, 0],
  ] as const)("with answer %s leaves %s action points", (yes, remaining) => {
    const initial = setUp(setup(cull));
    const played = playCard(initial, initial.zones.hand[0]!.uid, answer(yes));
    expect(played.actionPoints).toBe(remaining);
    expect(played.zones.banished[0]!.uid).not.toBe(initial.zones.hand[0]!.uid);
    expect(played.zones.hand).toHaveLength(2);
  });

  it("can play from face-up banish, but not face down", () => {
    let initial = setUp(setup(cull));
    const uid = initial.zones.hand[0]!.uid;
    initial = moveCard(initial, uid, "banished");
    expect(playCard(initial, uid, answer(true)).zones.banished).toHaveLength(1);
    expect(() =>
      playCard({ ...initial, faceDown: [uid] }, uid, answer(true)),
    ).toThrow("can't be played");
  });

  it("does not ask for a hand card when no cards remain", () => {
    const initial = setUp(setup(cull, []));
    const played = playCard(initial, initial.zones.hand[0]!.uid, (request) => {
      expect(request.kind).toBe("condition");
      return ["no"];
    });
    expect(played.zones.banished).toEqual([]);
  });

  it("does not waive costs or permit play outside the action phase", () => {
    const initial = setUp(setup({ ...cull, cost: 1 }));
    expect(() =>
      playCard(initial, initial.zones.hand[0]!.uid, answer(true)),
    ).toThrow("costs 1");
    expect(() =>
      playCard(
        { ...initial, phase: "end" },
        initial.zones.hand[0]!.uid,
        answer(true),
      ),
    ).toThrow("action phase");
  });
});

describe("Scar's proposed explicit life comparison", () => {
  it.each([
    [true, 1],
    [false, 0],
  ] as const)("with answer %s leaves %s action points", (yes, remaining) => {
    const initial = setUp(setup(scar()));
    const played = playCard(initial, initial.zones.hand[0]!.uid, answer(yes));
    expect(played.actionPoints).toBe(remaining);
    checkInvariants(played);
  });

  it("does not guess a missing answer or accept an empty or invalid answer", () => {
    const initial = setUp(setup(scar()));
    const uid = initial.zones.hand[0]!.uid;
    expect(() => playCard(initial, uid)).toThrow("choice is needed");
    for (const invalid of [[], ["maybe"], ["yes", "no"]])
      expect(() => playCard(initial, uid, () => invalid)).toThrow(
        "Not a legal choice",
      );
    expect(initial.actionPoints).toBe(1);
  });

  it("does not give two action points if another source already gave go again", () => {
    const initial = setUp(setup({ ...scar(), goAgain: true }));
    expect(
      playCard(initial, initial.zones.hand[0]!.uid, answer(true)).actionPoints,
    ).toBe(1);
  });

  it("records separate answers for replay rather than carrying one to a later play", () => {
    const initialSetup = setup(scar(), [scar(), filler, filler]);
    const initial = setUp(initialSetup);
    const actions = [
      {
        type: "play" as const,
        uid: initial.zones.hand[0]!.uid,
        answers: [["yes"]],
      },
      {
        type: "play" as const,
        uid: initial.zones.hand[1]!.uid,
        answers: [["no"]],
      },
    ];
    const played = actions.reduce(
      (state, action) => applySessionAction(state, action),
      initial,
    );
    expect(played.actionPoints).toBe(0);
    expect(replaySession(initialSetup, actions)).toEqual(played);
  });
});

describe("explicit scripted conditions", () => {
  it.each([true, false])("uses an explicit Scar answer of %s", (value) => {
    const data = {
      version: 1,
      choices: { conditions: { less_life_than_opposing_hero: value } },
      steps: [{ do: "play", card: { name: "Draft Scar" } }],
    };
    expect(() => parseScript(data)).not.toThrow();
    const played = runScript(setup(scar()), parseScript(data));
    expect(played.steps[0]!.outcome).toBe("done");
    expect(played.state.actionPoints).toBe(value ? 1 : 0);
  });

  it("refuses a run with a missing condition answer instead of silently skipping the card", () => {
    const script = parseScript({
      version: 1,
      steps: [{ do: "play", card: { name: cull.name } }],
    });
    expect(() => runScript(setup(cull), script)).toThrow("explicit answer");
  });
});
