// Rules data for Viserai (docs/rules-engine.md, step 5), written from the printed text the
// maintainer supplied on 19 Oct 2026, Gate to i'Arathael from Fabrary, and Blood Debt from LSS's
// "Rules Reprise: Usurp the Shadow Throne Limited" (10 Sep 2026).
//
// Step 5a (test/rules/viserai.test.ts) was signed off by the maintainer on 19 Oct 2026,
// including two readings: "the first attack action card with blood debt you play each turn"
// counts the whole turn, whichever side Viserai was on; and a Runechant made "when this
// attacks" survives, as Runechants are destroyed when the attack is played.
// Step 5b (test/rules/banish-gates.test.ts) was signed off on 19 Oct 2026, including its readings:
// face-down banished cards can't be played, {t} means a weapon attacks once a turn, and
// Malefic's Runechant survives the attack that made it.
//
// Each Runechant destroys itself ("destroy this"), so only those in play when the attack was
// played go; the engine records the arcane damage as a total.
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
  playableFromBanish?: boolean;
  weaponAttack?: RulesCard["weaponAttack"];
}

/** Malefic Incantation: the same text at each pitch, with 3, 2 or 1 verse counters. */
const malefic = (verses: number): CardRules => ({
  // "Go again. This enters the arena with N verse counters. When it has none, destroy it."
  effects: parseEffects([{ op: "addCounters", amount: verses }]),
  // "Once per turn, when you play an attack action card, remove a verse counter from this. If
  // you do, create a Runechant token."
  triggers: parseTriggers([
    {
      id: "malefic-incantation",
      on: { event: "played" },
      condition: {
        all: [
          { cardIs: { type: "attack_action" }, target: "event" },
          { counters: 1, target: "self" },
        ],
      },
      oncePerTurn: true,
      effects: [
        { op: "removeCounter" },
        { op: "createToken", token: "runechant", amount: 1 },
        { op: "destroySelfIfNoCounters" },
      ],
    },
  ]),
});

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
  // from their hand. Blood Debt" — the hit is out of scope.
  "Cullingsong Gloomblade": {
    effects: [],
    usurp: true,
    playableFromBanish: true,
  },
  // "You may play this from your banished zone. Usurp. When this attacks or hits, create a
  // Runechant token. Blood Debt" — the hit is out of scope.
  "Murmuring Gloomblade": {
    effects: [],
    usurp: true,
    playableFromBanish: true,
    triggers: parseTriggers([
      {
        id: "murmuring-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "createToken", token: "runechant", amount: 1 }],
      },
    ]),
  },
  // "Action – {r}, {t}: Attack. Activate this only if you've played a card from a banished zone
  // this turn. When this hits a hero, create a Runechant token." — the hit is out of scope.
  "Seven Sin Nebula": {
    effects: [],
    weaponAttack: { cost: 1, needsPlayedFromBanish: true },
  },
};

/** Rules that differ by pitch (1 red, 2 yellow, 3 blue). */
const BY_PITCH: Record<string, Record<number, CardRules>> = {
  "Malefic Incantation": { 1: malefic(3), 2: malefic(2), 3: malefic(1) },
};

/** A card's verified rules at a pitch, or undefined when it's unmodelled. */
export function verifiedRulesFor(
  name: string,
  pitch: number | null,
): CardRules | undefined {
  return (
    CARD_RULES[name] ?? (pitch === null ? undefined : BY_PITCH[name]?.[pitch])
  );
}

/** A card with its verified rules attached, or as it was (unmodelled) when it has none. */
export function cardWithRules(card: RulesCard): RulesCard {
  const rules = verifiedRulesFor(card.name, card.pitch);
  return rules ? { ...card, ...rules } : card;
}
