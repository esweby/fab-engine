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

/** A card as the rules engine needs it: the counting engine's card, plus cost and go again. */
export interface RulesCard extends EngineCard {
  /** null for cards with no cost (weapons, equipment). */
  cost: number | null;
  /** Natural go again (the keyword); conditional go again comes from effects. */
  goAgain: boolean;
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
  | { type: "turnEnded"; turn: number }
  | { type: "turnStarted"; turn: number };

export interface RulesState {
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
  resources: number;
  actionPoints: number;
  /** Everything that happened, in order. */
  events: RulesEvent[];
}

/** Something the rules don't allow; the state is left as it was. */
export class RulesError extends Error {
  override name = "RulesError";
}

const emptyZones = () =>
  Object.fromEntries(ZONES.map((z) => [z, []])) as unknown as Record<
    Zone,
    RulesInstance[]
  >;

const withEvents = (s: RulesState, ...events: RulesEvent[]): RulesState => ({
  ...s,
  events: [...s.events, ...events],
});

function zoneOf(s: RulesState, uid: string): Zone | undefined {
  return ZONES.find((z) => s.zones[z].some((i) => i.uid === uid));
}

function instance(s: RulesState, uid: string): RulesInstance {
  const zone = zoneOf(s, uid);
  if (!zone) throw new RulesError(`No card ${uid} in the game.`);
  return s.zones[zone].find((i) => i.uid === uid)!;
}

function draw(s: RulesState, count: number): RulesState {
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
    turn: 1,
    phase: "start",
    side: setup.side ?? "forsaken",
    intellect,
    zones,
    faceDown: [],
    tokens: {},
    createdThisTurn: {},
    resources: 0,
    actionPoints: 0,
    events: [],
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

/** Pitch a card from hand: to the pitch zone, adding its pitch value to resources. */
export function pitchCard(s: RulesState, uid: string): RulesState {
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

const NEEDS_ACTION_POINT = new Set(["action", "attack_action"]);
const PLAYABLE_IN_ACTION_PHASE = new Set([
  "action",
  "attack_action",
  "instant",
]);

/** Play a card from hand or arsenal: pay its cost and, for an action, an action point. */
export function playCard(s: RulesState, uid: string): RulesState {
  const { card } = instance(s, uid);
  const from = zoneOf(s, uid);
  if (from !== "hand" && from !== "arsenal")
    throw new RulesError(`${card.name} isn't in hand or arsenal.`);
  if (s.phase !== "action")
    throw new RulesError(`Cards are played in the action phase.`);
  if (!PLAYABLE_IN_ACTION_PHASE.has(card.type ?? ""))
    throw new RulesError(`${card.name} can't be played in the action phase.`);
  const action = NEEDS_ACTION_POINT.has(card.type ?? "");
  if (action && s.actionPoints < 1)
    throw new RulesError("No action point left.");
  const cost = card.cost ?? 0;
  if (cost > s.resources)
    throw new RulesError(
      `${card.name} costs ${cost}; ${s.resources} available.`,
    );
  const attack = card.type === "attack_action";
  const paid: RulesState = {
    ...s,
    resources: s.resources - cost,
    actionPoints: s.actionPoints - (action ? 1 : 0) + (card.goAgain ? 1 : 0),
  };
  const moved = moveCard(paid, uid, attack ? "arena" : "graveyard");
  return withEvents(
    moved,
    { type: "played", uid, cost },
    ...(attack ? [{ type: "attackPlayed" as const, uid }] : []),
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

/**
 * The end phase: optionally a card from hand into an empty arsenal, pitched cards to the
 * bottom of the deck, the turn's counters reset, a draw up to intellect, and the next turn's
 * action phase.
 */
export function endTurn(
  s: RulesState,
  options: { arsenal?: string } = {},
): RulesState {
  let next: RulesState = { ...s, phase: "end" };
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
    { ...next, resources: 0, actionPoints: 0, createdThisTurn: {} },
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
  for (const uid of s.faceDown)
    if (!seen.has(uid)) throw new RulesError(`Face-down card ${uid} is gone.`);
}
