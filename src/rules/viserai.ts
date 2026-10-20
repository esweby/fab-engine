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
  graveyardToBanish?: boolean;
  activate?: RulesCard["activate"];
  weaponAttack?: RulesCard["weaponAttack"];
  needsDamageThisTurn?: number;
  costReductions?: RulesCard["costReductions"];
}

/**
 * A card whose only modelled rule is its activated ability. Playing it (a potion or an amulet)
 * does nothing more than put it in the arena.
 */
const activated = (
  speed: "instant" | "action",
  cost: number,
  pay: NonNullable<RulesCard["activate"]>["pay"],
  effects: Effect[] = [],
): CardRules => ({
  effects: [],
  activate: { speed, cost, pay, effects: parseEffects(effects) },
});

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

/**
 * A sinchant (Runechant of Envy, Gluttony and so on): "When this is destroyed, create a Runechant
 * token. At the beginning of your action phase or when you play an attack action card, destroy
 * this." Signed off by the maintainer, 20 Oct 2026. Not modelled: "This counts as a Runechant",
 * and usurping.
 */
const sinchant = (name: string): CardRules => {
  const destroyed = [
    { op: "destroySelf" as const },
    { op: "createToken" as const, token: "runechant", amount: 1 },
  ];
  return {
    effects: [],
    triggers: parseTriggers([
      {
        id: `${name}-attack-action`,
        on: { event: "played" },
        condition: { cardIs: { type: "attack_action" }, target: "event" },
        effects: destroyed,
      },
      {
        id: `${name}-action-phase`,
        on: { event: "turnStarted" },
        effects: destroyed,
      },
    ]),
  };
};
const SINCHANTS = [
  "Envy",
  "Gluttony",
  "Greed",
  "Lust",
  "Pride",
  "Sloth",
  "Wrath",
];

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
  ...Object.fromEntries(
    SINCHANTS.map((sin) => [
      `Runechant of ${sin}`,
      sinchant(`runechant-of-${sin.toLowerCase()}`),
    ]),
  ),
  // The first batch of drafts the maintainer accepted on the effects page (step 9b; their
  // verdicts, 20 Oct 2026): each card's rules are its accepted draft.
  // "You may play this from your banished zone. Usurp When this hits a hero, you may banish target
  // aura permanent they control. Blood Debt"
  "Bloodsong Gloomblade": {
    effects: parseEffects([]),
    usurp: true,
    playableFromBanish: true,
  },
  // "When this attacks, opt 1."
  "Conflicting Thoughts": {
    effects: parseEffects([]),
    triggers: parseTriggers([
      {
        id: "conflicting-thoughts-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "opt", amount: 1 }],
      },
    ]),
  },
  // "You may play this from your banished zone. Usurp Blood Debt"
  "Demonbound Gloomblade": {
    effects: parseEffects([]),
    usurp: true,
    playableFromBanish: true,
  },
  // "Create a Runechant token. The next attack action card you rune gate this turn gets +3{p}. Go
  // again"
  "Envelop in Darkness": {
    effects: parseEffects([
      { op: "createToken", token: "runechant", amount: 1 },
    ]),
  },
  // "Opt 1"
  "Fate Foreseen": { effects: parseEffects([{ op: "opt", amount: 1 }]) },
  // "You may play this from your banished zone. Blood Debt"
  "Ghostly Visit": { effects: parseEffects([]), playableFromBanish: true },
  // "When this attacks, create a Runechant token."
  "Hocus Pocus": {
    effects: parseEffects([]),
    triggers: parseTriggers([
      {
        id: "hocus-pocus-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "createToken", token: "runechant", amount: 1 }],
      },
    ]),
  },
  // "You may play this from your banished zone. This card's {p} and {d} are equal to twice the
  // number of cards in your pitch zone with different costs. Blood Debt"
  "Mutated Mass": { effects: parseEffects([]), playableFromBanish: true },
  // "Your next Runeblade or Shadow attack this turn gets +3{p}. Create a Runechant token. Go
  // again"
  "Otherworldly Sins": {
    effects: parseEffects([
      { op: "createToken", token: "runechant", amount: 1 },
    ]),
  },
  // "You may play this from your banished zone. Usurp When this hits a hero, they banish a card in
  // their arsenal. Blood Debt"
  "Plundersong Gloomblade": {
    effects: parseEffects([]),
    usurp: true,
    playableFromBanish: true,
  },
  // "You may play this from your banished zone. The next attack action card you rune gate this
  // turn gets +5{p}. Go again Blood Debt"
  "Putrid Stirrings": { effects: parseEffects([]), playableFromBanish: true },
  // "You may play this from your banished zone. When this is played from your banished zone, deal
  // 1 arcane damage to target hero. Blood Debt"
  "Rifted Torment": { effects: parseEffects([]), playableFromBanish: true },
  // "Create a Gate to i'Arathael token. Go again"
  "Rites of Nightfall": {
    effects: parseEffects([{ op: "createToken", token: "gate", amount: 1 }]),
  },
  // "You may play this from your banished zone. Usurp When this hits, create a Gate to i'Arathael
  // token. Blood Debt"
  "Shadowake Gloomblade": {
    effects: parseEffects([]),
    usurp: true,
    playableFromBanish: true,
  },
  // "When this attacks, create 2 Runechant tokens."
  "Spellblade Assault": {
    effects: parseEffects([]),
    triggers: parseTriggers([
      {
        id: "spellblade-assault-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "createToken", token: "runechant", amount: 2 }],
      },
    ]),
  },
  // "When this attacks, create a Runechant token."
  "Spellblade Strike": {
    effects: parseEffects([]),
    triggers: parseTriggers([
      {
        id: "spellblade-strike-attacks",
        on: { event: "attacking", self: true },
        effects: [{ op: "createToken", token: "runechant", amount: 1 }],
      },
    ]),
  },
  // "You may play this from your banished zone. Usurp When this hits a hero, deal 2 arcane damage
  // to any target. Blood Debt"
  "Vexing Gloomblade": {
    effects: parseEffects([]),
    usurp: true,
    playableFromBanish: true,
  },
  // "You may play this from your banished zone. Blood Debt"
  "Void Wraith": { effects: parseEffects([]), playableFromBanish: true },
  // "You may play this from your banished zone. Your next Shadow attack this turn gets +1{p}. Go
  // again Blood Debt"
  // Accepted before its +1 power note was added; the bonus is combat, out of scope.
  "Abyssal Bite": { effects: parseEffects([]), playableFromBanish: true },
  // "You may play this from your banished zone. Your next Shadow attack this turn gets overpower.
  // Go again Blood Debt"
  // Accepted before its overpower note was added; the bonus is combat, out of scope.
  "Abyssal Force": { effects: parseEffects([]), playableFromBanish: true },
  // The second batch the maintainer accepted (20 Oct 2026). What most of these abilities do
  // (prevention, combat, an opponent's cards) is out of scope, so the rules are how each is paid.
  // "If this would be put into your graveyard from anywhere, instead banish it."
  "Embraforged Gauntlet": { effects: [], graveyardToBanish: true },
  "Engulfing Shadows": { effects: [], graveyardToBanish: true },
  ...Object.fromEntries(
    [
      "Amethyst Amulet",
      "Amulet of Echoes",
      "Amulet of Ignition",
      "Amulet of Intervention",
      "Amulet of Oblation",
      "Bruised Leather",
      "Diamond Amulet",
      "Four Finger Gloves",
      "Hood of Second Thoughts",
      "Platinum Amulet",
      "Potion of Déjà Vu",
      "Potion of Ironhide",
      "Potion of Luck",
      "Potion of Seeing",
      "Ragamuffin's Hat",
      "Runaways",
      "Silken Gi",
      "Threadbare Tunic",
      "Unflinching Foothold",
      "Vigilant Dodgers",
    ].map((name) => [name, activated("instant", 0, "destroy")]),
  ),
  ...Object.fromEntries(
    [
      "Bracers of Belief",
      "Captain's Coat",
      "Cracker Jax",
      "Crazy Brew",
      "Goliath Gauntlet",
      "Healing Potion",
      "Imperial Edict",
      "Imperial Seal of Command",
      "Onyx Amulet",
      "Pearl Amulet",
      "Potion of Strength",
      "Pounamu Amulet",
      "Quick Clicks",
      "Sapphire Amulet",
      "Swiftstrike Bracers",
      "Timesnap Potion",
    ].map((name) => [name, activated("action", 0, "destroy")]),
  ),
  ...Object.fromEntries(
    [
      "Fearless Confrontation",
      "Ripple Away",
      "Shelter from the Storm",
      "Tip-Off",
    ].map((name) => [name, activated("instant", 0, "discard")]),
  ),
  // "Instant – Destroy Energy Potion: Gain {r}{r}." ("Gain 2 pitch": the maintainer's note.)
  "Energy Potion": activated("instant", 0, "destroy", [
    { op: "gainResources", amount: 2 },
  ]),
  "Exude Confidence": activated("instant", 3, "none"),
  Firebreathing: activated("instant", 1, "none"),
  "Helio's Mitre": activated("instant", 2, "none"),
  "Helm of Hindsight": activated("instant", 3, "destroy"),
  "Sheltered Cove": activated("instant", 3, "destroy"),
  "Ornate Tessen": activated("instant", 1, "destroy"),
  "Imperial Warhorn": activated("action", 1, "destroy"),
  "Mage Master Boots": activated("action", 1, "destroy"),
  "Myrkhellir Helm": activated("action", 2, "destroy"),
  "Punching Gloves": activated("action", 2, "destroy"),
  "Quartermaster's Boots": activated("action", 2, "destroy"),
  "Time Skippers": activated("action", 3, "destroy"),
  // "Instant – Destroy this: Opt N"
  ...Object.fromEntries(
    ["Clarity Potion", "Opal Amulet", "Talismanic Lens"].map((name) => [
      name,
      activated("instant", 0, "destroy", [{ op: "opt", amount: 2 }]),
    ]),
  ),
  ...Object.fromEntries(
    [
      "Seeker's Gilet",
      "Seeker's Hood",
      "Seeker's Leggings",
      "Seeker's Mitts",
    ].map((name) => [
      name,
      activated("instant", 1, "destroy", [{ op: "opt", amount: 1 }]),
    ]),
  ),
  // The third batch the maintainer accepted (20 Oct 2026).
  // "This costs {r} less to play for each Runechant you control." The rest is combat.
  ...Object.fromEntries(
    ["Amplify the Arknight", "Ninth Blade of the Blood Oath", "Rune Flash"].map(
      (name) => [
        name,
        { effects: [], costReductions: [{ amount: "perRunechant" as const }] },
      ],
    ),
  ),
  // Costs {r} less for each Runechant you control; create a Runechant token. The prevention is
  // combat. A defence reaction, so goldfish doesn't play it in the action phase.
  "Reduce to Runechant": {
    effects: parseEffects([
      { op: "createToken", token: "runechant", amount: 1 },
    ]),
    costReductions: [{ amount: "perRunechant" }],
  },
  // "If you lose {h} during your turn, destroy Dimenxxional Crossroads." Its arcane damage isn't
  // modelled (the maintainer, 20 Oct 2026). An aura, so it stays in the arena.
  "Dimenxxional Crossroads": {
    effects: [],
    triggers: parseTriggers([
      {
        id: "dimenxxional-crossroads-life-lost",
        on: { event: "lifeLost" },
        effects: [{ op: "destroySelf" }],
      },
    ]),
  },
};

/** Rules that differ by pitch (1 red, 2 yellow, 3 blue). */
const BY_PITCH: Record<string, Record<number, CardRules>> = {
  "Malefic Incantation": { 1: malefic(3), 2: malefic(2), 3: malefic(1) },
  // Accepted on the effects page, 20 Oct 2026 (as above).
  // "Opt 3, then banish the top card of your deck."
  "Blood Tribute": {
    1: {
      effects: parseEffects([
        { op: "opt", amount: 3 },
        { op: "banish", from: "deckTop", amount: 1 },
      ]),
    },
    2: {
      effects: parseEffects([
        { op: "opt", amount: 2 },
        { op: "banish", from: "deckTop", amount: 1 },
      ]),
    },
    3: {
      effects: parseEffects([
        { op: "opt", amount: 1 },
        { op: "banish", from: "deckTop", amount: 1 },
      ]),
    },
  },
  // "Play this only if you've dealt {p} damage this turn. Opt 3, then reveal the top card of your
  // deck. If it has {p} greater than the total damage you've dealt this turn, create a Quicken
  // token and draw a card."
  // Only the Opt is drafted; the reveal, Quicken and draw aren't. It needs damage noted this turn
  // ("you have to deal physical damage": the maintainer, 20 Oct 2026).
  "Even Bigger Than That!": {
    1: {
      effects: parseEffects([{ op: "opt", amount: 3 }]),
      needsDamageThisTurn: 1,
    },
    2: {
      effects: parseEffects([{ op: "opt", amount: 2 }]),
      needsDamageThisTurn: 1,
    },
    3: {
      effects: parseEffects([{ op: "opt", amount: 1 }]),
      needsDamageThisTurn: 1,
    },
  },
  // "Create 3 Runechant tokens."
  "Read the Runes": {
    1: {
      effects: parseEffects([
        { op: "createToken", token: "runechant", amount: 3 },
      ]),
    },
    2: {
      effects: parseEffects([
        { op: "createToken", token: "runechant", amount: 2 },
      ]),
    },
    3: {
      effects: parseEffects([
        { op: "createToken", token: "runechant", amount: 1 },
      ]),
    },
  },
  // "Opt 4 Go again"
  "Whisper of the Oracle": {
    1: { effects: parseEffects([{ op: "opt", amount: 4 }]) },
    2: { effects: parseEffects([{ op: "opt", amount: 3 }]) },
    3: { effects: parseEffects([{ op: "opt", amount: 2 }]) },
  },
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
