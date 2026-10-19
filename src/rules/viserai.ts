// Rules data for Viserai (docs/rules-engine.md, step 5a), written from the printed text the
// maintainer supplied on 19 Oct 2026, Gate to i'Arathael from Fabrary, and Blood Debt from LSS's
// "Rules Reprise: Usurp the Shadow Throne Limited" (10 Sep 2026). Every entry AWAITS THE
// MAINTAINER'S SIGN-OFF of the interaction tests in test/rules/viserai.test.ts.
//
// Our readings, to confirm:
// - "The first attack action card with blood debt you play each turn" counts plays from the
//   whole turn, whichever side Viserai was on.
// - Runechants are destroyed when an attack is played; "when this attacks" comes after, so a
//   Runechant made then survives.
// - Each Runechant is its own source of arcane damage; the engine records the total.
import { parseEffects, type Effect } from "./effects.ts";
import type { RulesCard } from "./state.ts";
import { parseTriggers, type Trigger } from "./triggers.ts";

/**
 * Viserai, the Forsaken: "Whenever you create 1 or more Runechants, banish the top card of your
 * deck. Then if you've created 3 or more Runechants this turn, traverse."
 *
 * Viserai, the Usurper: "The first attack action card with blood debt you play each turn gets go
 * again. At the beginning of each end phase, if you've created or activated a Gate to
 * i'Arathael this turn, you may traverse."
 */
export const VISERAI: Trigger[] = parseTriggers([
  {
    id: "viserai-forsaken",
    on: { event: "tokensCreated", token: "runechant" },
    condition: { side: "forsaken" },
    effects: [
      { op: "banish", from: "deckTop", amount: 1 },
      {
        op: "if",
        check: { createdThisTurn: "runechant", atLeast: 3 },
        then: [{ op: "traverse" }],
      },
    ],
  },
  {
    id: "viserai-usurper-go-again",
    on: { event: "played" },
    condition: {
      all: [
        { side: "usurper" },
        {
          firstPlayedThisTurn: { type: "attack_action", trait: "blood_debt" },
          target: "event",
        },
      ],
    },
    effects: [{ op: "gainActionPoint" }],
  },
  {
    id: "viserai-usurper-traverse",
    on: { event: "endPhaseStarted" },
    condition: {
      all: [
        { side: "usurper" },
        {
          any: [
            { createdThisTurn: "gate", atLeast: 1 },
            { activatedThisTurn: "gate", atLeast: 1 },
          ],
        },
      ],
    },
    optional: true,
    effects: [{ op: "traverse" }],
  },
]);

/**
 * Runechant: "When you play an attack action card or attack with a weapon, destroy Runechant and
 * deal 1 arcane damage to target opposing hero." Weapon attacks come with step 5b.
 */
export const RUNECHANT: Trigger = parseTriggers([
  {
    id: "runechant",
    on: { event: "attackPlayed" },
    condition: { tokens: "runechant", atLeast: 1 },
    effects: [{ op: "destroyAllTokens", token: "runechant", arcaneEach: 1 }],
  },
])[0]!;

/**
 * Blood Debt (LSS): "At the beginning of your end phase, each face-up card with blood debt in
 * your banished zone will put a trigger on the stack – when that trigger resolves, you will lose
 * 1 life." A card banished during the end phase was not there when it began, so it doesn't count.
 */
export const BLOOD_DEBT: Trigger = parseTriggers([
  {
    id: "blood-debt",
    on: { event: "endPhaseStarted" },
    effects: [{ op: "loseLifePerBanished", trait: "blood_debt" }],
  },
])[0]!;

interface CardRules {
  effects: Effect[];
  usurp?: boolean;
  triggers?: Trigger[];
}

/** Verified effects by card name. A card not here is unmodelled: the engine won't play it. */
export const CARD_RULES: Record<string, CardRules> = {
  // "Banish a card from your hand. If it's Runeblade, create a Runechant token. If it's Shadow,
  // create a Gate to i'Arathael token. Go again"
  "Become the Shadow Lord": {
    effects: parseEffects([
      { op: "banish", from: "hand", amount: 1, storeAs: "banished" },
      {
        op: "if",
        check: { has: "runeblade", target: "banished" },
        then: [{ op: "createToken", token: "runechant", amount: 1 }],
      },
      {
        op: "if",
        check: { has: "shadow", target: "banished" },
        then: [{ op: "createToken", token: "gate", amount: 1 }],
      },
    ]),
  },
  // "You may play this from your banished zone. Usurp. When this hits a hero, they banish a card
  // from their hand. Blood Debt" — playing from banish is step 5b; on-hit is out of scope.
  "Cullingsong Gloomblade": { effects: [], usurp: true },
  // "You may play this from your banished zone. Usurp. When this attacks or hits, create a
  // Runechant token. Blood Debt" — the hit is out of scope.
  "Murmuring Gloomblade": {
    effects: [],
    usurp: true,
    triggers: parseTriggers([
      {
        id: "murmuring-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "createToken", token: "runechant", amount: 1 }],
      },
    ]),
  },
};

/** A card with its verified rules attached, or as it was (unmodelled) when it has none. */
export function cardWithRules(card: RulesCard): RulesCard {
  const rules = CARD_RULES[card.name];
  return rules ? { ...card, ...rules } : card;
}
