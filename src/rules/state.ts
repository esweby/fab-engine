// The rules engine's state (docs/rules-engine.md, step 2): card instances in zones, the turn's
// phase, action points, resources, tokens and an event trace. Every operation returns a new
// state, moves cards only through moveCard, and fails loudly on anything illegal.
//
// UNVERIFIED, for the maintainer to check against the comprehensive rules: one action point at
// the start of the action phase; go again gives it back as the card is played; instants need
// none; reactions can't be played in the action phase; an attack goes to the arena and any
// other action to the graveyard; the end phase puts pitched cards on the bottom of the deck in
// the order they were pitched, then draws up to intellect.
import { ZONES, type HeroSide, type Zone } from "../game.ts";
import { shuffle, type EngineCard } from "../index.ts";
import type { Effect } from "./effects.ts";
import type { Trigger } from "./triggers.ts";

/** A card as the rules engine needs it: the counting engine's card, plus cost and go again. */
export interface RulesCard extends EngineCard {
  /** null for cards with no cost (weapons, equipment). */
  cost: number | null;
  /** Natural go again (the keyword); conditional go again comes from effects. */
  goAgain: boolean;
  /**
   * What playing it does, verified by a player. Missing = not modelled yet: the engine can
   * pitch, hold, arsenal or banish it, but not play it (docs/rules-engine.md).
   */
  effects?: Effect[];
  /** Usurp: as an additional cost, destroy a Runechant if able (+2 power if you do). */
  usurp?: boolean;
  /** The card's own triggers, live while it's in the arena; "self" binds the card. */
  triggers?: Trigger[];
  /** "You may play this from your banished zone." */
  playableFromBanish?: boolean;
  /** A weapon's attack: its cost, and whether it needs a card played from banish this turn. */
  weaponAttack?: { cost: number; needsPlayedFromBanish?: boolean };
}

export interface RulesInstance {
  uid: string;
  card: RulesCard;
}

export type Phase = "start" | "action" | "end";

export type RulesEvent =
  | { type: "drew"; uids: string[] }
  | { type: "moved"; uid: string; from: Zone; to: Zone; faceDown: boolean }
  | { type: "pitched"; uid: string; amount: number }
  | { type: "played"; uid: string; cost: number }
  | { type: "attackPlayed"; uid: string }
  | { type: "tokensCreated"; token: string; amount: number }
  | { type: "tokensRemoved"; token: string; amount: number }
  | { type: "resourcesGained"; amount: number }
  | { type: "actionPointGained" }
  | { type: "triggered"; trigger: string }
  | { type: "traversed"; to: HeroSide }
  | { type: "usurped"; uid: string }
  | { type: "attacking"; uid: string }
  | { type: "arcaneDamage"; amount: number }
  | { type: "lifeLost"; amount: number }
  | { type: "endPhaseStarted"; turn: number }
  | { type: "playedFromBanish"; uid: string }
  | { type: "gateActivated"; target: string }
  | { type: "countersChanged"; uid: string; delta: number }
  /** A goldfish change made by hand: no rules applied, nothing set off. */
  | { type: "manual"; action: string }
  /** Damage dealt, noted by hand in goldfish (combat is out of scope). */
  | { type: "damageNoted"; amount: number }
  | { type: "shuffled" }
  | { type: "turnEnded"; turn: number }
  | { type: "turnStarted"; turn: number };

export interface RulesState {
  /** The game's seed: the deck's first shuffle and every later one. */
  seed: number;
  turn: number;
  phase: Phase;
  side: HeroSide;
  intellect: number;
  /** The deck's first card is its top. */
  zones: Record<Zone, RulesInstance[]>;
  faceDown: string[];
  /** Tokens in play. */
  tokens: Record<string, number>;
  /** Tokens created this turn, reset at the end of the turn. */
  createdThisTurn: Record<string, number>;
  /** Tokens activated this turn (Gates), reset at the end of the turn. */
  activatedThisTurn: Record<string, number>;
  /** Life lost so far (blood debt); damage to an opponent is out of scope. */
  lifeLost: number;
  /** Counters on cards (Malefic's verse counters), by card copy. */
  counters: Record<string, number>;
  /** Cards that may be played from the banished zone this turn (a Gate's target). */
  playableThisTurn: string[];
  /** Weapons that have attacked and once-per-turn triggers that have fired, this turn. */
  usedThisTurn: string[];
  resources: number;
  actionPoints: number;
  /** Everything that happened, in order. */
  events: RulesEvent[];
  /** Triggers in play (hero text, token rules), checked against every event. */
  triggers: Trigger[];
  /** Most triggers one action may resolve: a safeguard against loops, not a game rule. */
  budget: number;
}

/** Something the rules don't allow; the state is left as it was. */
export class RulesError extends Error {
  override name = "RulesError";
}

/** A run that resolved more triggers than its budget: failed, with its trace kept. */
export class RulesBudgetExceeded extends RulesError {
  override name = "RulesBudgetExceeded";
  constructor(
    message: string,
    readonly events: RulesEvent[],
  ) {
    super(message);
  }
}

const emptyZones = () =>
  Object.fromEntries(ZONES.map((z) => [z, []])) as unknown as Record<
    Zone,
    RulesInstance[]
  >;

export const withEvents = (
  s: RulesState,
  ...events: RulesEvent[]
): RulesState => ({
  ...s,
  events: [...s.events, ...events],
});

export function zoneOf(s: RulesState, uid: string): Zone | undefined {
  return ZONES.find((z) => s.zones[z].some((i) => i.uid === uid));
}

export function instance(s: RulesState, uid: string): RulesInstance {
  const zone = zoneOf(s, uid);
  if (!zone) throw new RulesError(`No card ${uid} in the game.`);
  return s.zones[zone].find((i) => i.uid === uid)!;
}

export function draw(s: RulesState, count: number): RulesState {
  const drawn = s.zones.deck.slice(0, Math.max(0, count));
  if (drawn.length === 0) return s;
  return withEvents(
    {
      ...s,
      zones: {
        ...s.zones,
        deck: s.zones.deck.slice(drawn.length),
        hand: [...s.zones.hand, ...drawn],
      },
    },
    { type: "drew", uids: drawn.map((i) => i.uid) },
  );
}

function startTurn(s: RulesState): RulesState {
  return withEvents(
    { ...s, phase: "action", actionPoints: 1 },
    { type: "turnStarted", turn: s.turn },
  );
}

export interface RulesSetup {
  /** The main deck, one entry per copy. */
  deck: RulesCard[];
  weapons?: RulesCard[];
  equipment?: RulesCard[];
  seed: number;
  /** "asGiven" keeps the deck in the order given (fixed-order scripts and tests). */
  order?: "shuffled" | "asGiven";
  side?: HeroSide;
  /** Viserai's intellect is 4. */
  intellect?: number;
  triggers?: Trigger[];
  /** Most triggers one action may resolve (default 1,000). */
  budget?: number;
}

/**
 * A new game: the deck shuffled with the seed (or as given), weapons and equipment in their
 * slots, a hand drawn up to intellect, and turn 1's action phase. Copies get the same ids, in
 * the same shuffle, as the counting engine's newGame, so a seed deals the same game in both.
 */
export function setUp(setup: RulesSetup): RulesState {
  const zones = emptyZones();
  const deck = setup.deck.map((card, i) => ({ uid: `d${i}`, card }));
  zones.deck = setup.order === "asGiven" ? deck : shuffle(deck, setup.seed);
  zones.weapons = (setup.weapons ?? []).map((card, i) => ({
    uid: `w${i}`,
    card,
  }));
  zones.equipment = (setup.equipment ?? []).map((card, i) => ({
    uid: `e${i}`,
    card,
  }));
  const intellect = setup.intellect ?? 4;
  const state: RulesState = {
    seed: setup.seed,
    turn: 1,
    phase: "start",
    side: setup.side ?? "forsaken",
    intellect,
    zones,
    faceDown: [],
    tokens: {},
    createdThisTurn: {},
    activatedThisTurn: {},
    lifeLost: 0,
    counters: {},
    playableThisTurn: [],
    usedThisTurn: [],
    resources: 0,
    actionPoints: 0,
    events: [],
    triggers: setup.triggers ?? [],
    budget: setup.budget ?? 1000,
  };
  return startTurn(draw(state, intellect));
}

/** The one way a card changes zone. */
export function moveCard(
  s: RulesState,
  uid: string,
  to: Zone,
  options: { position?: "top" | "bottom"; faceDown?: boolean } = {},
): RulesState {
  const from = zoneOf(s, uid);
  if (!from) throw new RulesError(`No card ${uid} in the game.`);
  const moving = s.zones[from].find((i) => i.uid === uid)!;
  const zones = {
    ...s.zones,
    [from]: s.zones[from].filter((i) => i.uid !== uid),
  };
  zones[to] =
    to === "deck" && options.position === "top"
      ? [moving, ...zones[to]]
      : [...zones[to], moving];
  const faceDown = !!options.faceDown;
  return withEvents(
    {
      ...s,
      zones,
      faceDown: faceDown
        ? [...s.faceDown.filter((u) => u !== uid), uid]
        : s.faceDown.filter((u) => u !== uid),
    },
    { type: "moved", uid, from, to, faceDown },
  );
}

/**
 * Pitch a card from hand: to the pitch zone, adding its pitch value to resources. Without
 * triggers: the engine's pitchCard (play.ts) resolves them.
 */
export function pitchOnly(s: RulesState, uid: string): RulesState {
  const { card } = instance(s, uid);
  if (card.pitch === null)
    throw new RulesError(`${card.name} can't be pitched.`);
  if (zoneOf(s, uid) !== "hand")
    throw new RulesError(`${card.name} isn't in hand.`);
  const moved = moveCard(s, uid, "pitch");
  return withEvents(
    { ...moved, resources: moved.resources + card.pitch },
    { type: "pitched", uid, amount: card.pitch },
  );
}

export function createTokens(
  s: RulesState,
  token: string,
  amount: number,
): RulesState {
  if (!Number.isInteger(amount) || amount < 1)
    throw new RulesError(`Can't create ${amount} ${token} tokens.`);
  return withEvents(
    {
      ...s,
      tokens: { ...s.tokens, [token]: (s.tokens[token] ?? 0) + amount },
      createdThisTurn: {
        ...s.createdThisTurn,
        [token]: (s.createdThisTurn[token] ?? 0) + amount,
      },
    },
    { type: "tokensCreated", token, amount },
  );
}

export function removeTokens(
  s: RulesState,
  token: string,
  amount: number,
): RulesState {
  const have = s.tokens[token] ?? 0;
  if (!Number.isInteger(amount) || amount < 1 || amount > have)
    throw new RulesError(`Can't remove ${amount} ${token}; ${have} in play.`);
  return withEvents(
    { ...s, tokens: { ...s.tokens, [token]: have - amount } },
    { type: "tokensRemoved", token, amount },
  );
}

/** The start of the end phase, where its triggers (blood debt, the Usurper) happen. */
export function startEndPhase(s: RulesState): RulesState {
  return withEvents(
    { ...s, phase: "end" },
    { type: "endPhaseStarted", turn: s.turn },
  );
}

/**
 * The rest of the end phase: optionally a card from hand into an empty arsenal, pitched cards
 * to the bottom of the deck, the turn's counters reset, a draw up to intellect, and the next
 * turn's action phase. Without triggers: the engine's endTurn (play.ts) resolves them.
 */
export function finishEndPhase(
  s: RulesState,
  options: { arsenal?: string } = {},
): RulesState {
  let next = s;
  if (options.arsenal !== undefined) {
    if (next.zones.arsenal.length > 0)
      throw new RulesError("The arsenal is full.");
    if (zoneOf(next, options.arsenal) !== "hand")
      throw new RulesError("Only a card from hand goes in the arsenal.");
    next = moveCard(next, options.arsenal, "arsenal");
  }
  for (const pitched of [...next.zones.pitch])
    next = moveCard(next, pitched.uid, "deck", { position: "bottom" });
  next = withEvents(
    {
      ...next,
      resources: 0,
      actionPoints: 0,
      createdThisTurn: {},
      activatedThisTurn: {},
      playableThisTurn: [],
      usedThisTurn: [],
    },
    { type: "turnEnded", turn: s.turn },
  );
  next = draw(next, next.intellect - next.zones.hand.length);
  return startTurn({ ...next, turn: s.turn + 1 });
}

/** Throws if the state breaks a rule every state must keep (docs/rules-engine.md). */
export function checkInvariants(s: RulesState): void {
  const seen = new Map<string, Zone>();
  for (const zone of ZONES) {
    for (const { uid } of s.zones[zone]) {
      const other = seen.get(uid);
      if (other)
        throw new RulesError(
          `Card ${uid} is in two zones: ${other} and ${zone}.`,
        );
      seen.set(uid, zone);
    }
  }
  if (s.resources < 0) throw new RulesError("Resources below zero.");
  if (s.actionPoints < 0) throw new RulesError("Action points below zero.");
  for (const [token, n] of Object.entries(s.tokens))
    if (n < 0) throw new RulesError(`${token} tokens below zero.`);
  for (const [uid, n] of Object.entries(s.counters))
    if (n < 0) throw new RulesError(`Counters on ${uid} below zero.`);
  for (const uid of s.faceDown)
    if (!seen.has(uid)) throw new RulesError(`Face-down card ${uid} is gone.`);
}
