// The first batch of effect drafts the maintainer accepted on the effects page (step 9b; their
// verdicts, 20 Oct 2026). Each card's rules are its accepted draft; these tests play a few of them
// to show the rules do what the drafts said.
import { describe, expect, it } from "vitest";
import {
  cardWithRules,
  playCard,
  setUp,
  verifiedRulesFor,
  type Choose,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

/** Every card and pitch accepted in the batch. */
const ACCEPTED: [string, number][] = [
  ["Abyssal Bite", 3],
  ["Abyssal Force", 3],
  ["Blood Tribute", 1],
  ["Blood Tribute", 2],
  ["Blood Tribute", 3],
  ["Bloodsong Gloomblade", 1],
  ["Conflicting Thoughts", 1],
  ["Demonbound Gloomblade", 1],
  ["Envelop in Darkness", 1],
  ["Even Bigger Than That!", 1],
  ["Even Bigger Than That!", 2],
  ["Even Bigger Than That!", 3],
  ["Fate Foreseen", 1],
  ["Ghostly Visit", 1],
  ["Hocus Pocus", 1],
  ["Mutated Mass", 3],
  ["Otherworldly Sins", 1],
  ["Plundersong Gloomblade", 1],
  ["Putrid Stirrings", 1],
  ["Read the Runes", 1],
  ["Read the Runes", 2],
  ["Read the Runes", 3],
  ["Rifted Torment", 1],
  ["Rites of Nightfall", 3],
  ["Shadowake Gloomblade", 1],
  ["Spellblade Assault", 1],
  ["Spellblade Strike", 1],
  ["Vexing Gloomblade", 1],
  ["Void Wraith", 1],
  ["Whisper of the Oracle", 1],
  ["Whisper of the Oracle", 2],
  ["Whisper of the Oracle", 3],
];

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 1,
    cost: 0,
    goAgain: false,
    type: "action",
    roles: [],
    traits: [],
    amounts: {},
    ...over,
  });
const filler = (i: number) => card(`Filler ${i}`, { pitch: 3, effects: [] });

/** These cards in hand, then the named cards on top of the deck, then filler. */
function game(hand: RulesCard[], top: RulesCard[] = []): RulesState {
  return {
    ...setUp({
      deck: [
        ...hand,
        ...Array.from({ length: 4 - hand.length }, (_, i) => filler(i)),
        ...top,
        ...Array.from({ length: 20 }, (_, i) => filler(10 + i)),
      ],
      seed: 1,
      order: "asGiven",
    }),
    resources: 5,
  };
}
const inHand = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
const keepAll: Choose = () => [];

describe("the first accepted batch", () => {
  it("has verified rules for every accepted card and pitch", () => {
    const missing = ACCEPTED.filter(([n, p]) => !verifiedRulesFor(n, p));
    expect(missing).toEqual([]);
  });

  it("Read the Runes makes 3, 2 or 1 Runechants by pitch", () => {
    for (const [pitch, made] of [
      [1, 3],
      [2, 2],
      [3, 1],
    ] as const) {
      const s = game([card("Read the Runes", { pitch })]);
      const next = playCard(s, inHand(s, "Read the Runes"), keepAll);
      expect(next.tokens.runechant).toBe(made);
    }
  });

  it("Blood Tribute opts, then banishes the top card", () => {
    const s = game(
      [card("Blood Tribute", { type: "instant" })],
      [card("Top"), card("Second")],
    );
    // Opt 3: put "Top" on the bottom; keep the rest.
    let asked = 0;
    const next = playCard(s, inHand(s, "Blood Tribute"), (request) => {
      asked++;
      return asked === 1
        ? [
            request.options.find(
              (uid) =>
                uid.length > 0 &&
                s.zones.deck.find((i) => i.uid === uid)?.card.name === "Top",
            )!,
          ]
        : [];
    });
    expect(next.zones.banished.map((i) => i.card.name)).toEqual(["Second"]);
  });

  it("Spellblade Assault makes 2 Runechants when it attacks", () => {
    const s = game([card("Spellblade Assault", { type: "attack_action" })]);
    const next = playCard(s, inHand(s, "Spellblade Assault"), keepAll);
    expect(next.tokens.runechant).toBe(2);
  });

  it("Otherworldly Sins makes a Runechant", () => {
    const s = game([card("Otherworldly Sins", { goAgain: true })]);
    const next = playCard(s, inHand(s, "Otherworldly Sins"), keepAll);
    expect(next.tokens.runechant).toBe(1);
  });

  it("gives the Gloomblades Usurp and play from banish", () => {
    for (const name of [
      "Bloodsong Gloomblade",
      "Demonbound Gloomblade",
      "Plundersong Gloomblade",
      "Shadowake Gloomblade",
      "Vexing Gloomblade",
    ])
      expect(verifiedRulesFor(name, 1)).toMatchObject({
        usurp: true,
        playableFromBanish: true,
      });
  });
});
