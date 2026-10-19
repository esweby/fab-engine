// The game state behind goldfishing and scenarios (README "Shared game engine", phase two step
// 4): zones, weapon and equipment slots, token counts, hero side, turn number and a seeded
// shuffle, changed only by actions. It moves cards and counts things; it knows no card rules.
// Ending a turn follows the basic turn rules (pitched cards go to the bottom of the deck, then
// draw up to intellect): UNVERIFIED, for a player to check.
import { random, shuffle, type EngineCard } from "./index.ts";

export const ZONES = [
  "deck",
  "hand",
  "arsenal",
  "pitch",
  "arena",
  "graveyard",
  "banished",
  "weapons",
  "equipment",
] as const;
export type Zone = (typeof ZONES)[number];
export type HeroSide = "forsaken" | "usurper";

/** One copy of a card in the game, with its own id so copies can move separately. */
export interface CardInstance {
  uid: string;
  card: EngineCard;
}

export type GameAction =
  | { type: "draw"; count?: number }
  | { type: "move"; uid: string; to: Zone; position?: "top" | "bottom" }
  | { type: "token"; token: string; delta: number }
  | { type: "traverse" }
  | { type: "shuffle" }
  | { type: "endTurn" };

export interface GameState {
  seed: number;
  turn: number;
  side: HeroSide;
  intellect: number;
  /** The deck's first card is its top. */
  zones: Record<Zone, CardInstance[]>;
  tokens: Record<string, number>;
  /** Every action so far, so a game can be replayed from its seed. */
  log: GameAction[];
}

/** The present state and every state before it, for undo. */
export interface GameHistory {
  past: GameState[];
  present: GameState;
}

export interface GameSetup {
  /** The main deck: one entry per copy. */
  deck: EngineCard[];
  weapons?: EngineCard[];
  equipment?: EngineCard[];
  seed: number;
  /** Viserai's intellect is 4. */
  intellect?: number;
  side?: HeroSide;
}

const emptyZones = (): Record<Zone, CardInstance[]> =>
  Object.fromEntries(ZONES.map((z) => [z, []])) as unknown as Record<
    Zone,
    CardInstance[]
  >;

function drawCards(state: GameState, count: number): GameState {
  const drawn = state.zones.deck.slice(0, Math.max(0, count));
  return {
    ...state,
    zones: {
      ...state.zones,
      deck: state.zones.deck.slice(drawn.length),
      hand: [...state.zones.hand, ...drawn],
    },
  };
}

/** A shuffle's seed: the game's seed and how many shuffles came before, so replays match. */
function shuffleSeed(state: GameState) {
  const before = state.log.filter((a) => a.type === "shuffle").length;
  return Math.floor(random(state.seed + (before + 1) * 7919)() * 2 ** 31);
}

/** Applies one action, returning the next state. The state passed in isn't changed. */
export function apply(state: GameState, action: GameAction): GameState {
  const next = ((): GameState => {
    switch (action.type) {
      case "draw":
        return drawCards(state, action.count ?? 1);
      case "move": {
        const from = ZONES.find((z) =>
          state.zones[z].some((c) => c.uid === action.uid),
        );
        if (!from) throw new Error(`No card ${action.uid}`);
        const moving = state.zones[from].find((c) => c.uid === action.uid)!;
        const zones = { ...state.zones };
        zones[from] = zones[from].filter((c) => c.uid !== action.uid);
        zones[action.to] =
          action.to === "deck" && action.position !== "bottom"
            ? [moving, ...zones[action.to]]
            : [...zones[action.to], moving];
        return { ...state, zones };
      }
      case "token":
        return {
          ...state,
          tokens: {
            ...state.tokens,
            [action.token]: Math.max(
              0,
              (state.tokens[action.token] ?? 0) + action.delta,
            ),
          },
        };
      case "traverse":
        return {
          ...state,
          side: state.side === "forsaken" ? "usurper" : "forsaken",
        };
      case "shuffle":
        return {
          ...state,
          zones: {
            ...state.zones,
            deck: shuffle(state.zones.deck, shuffleSeed(state)),
          },
        };
      case "endTurn": {
        // Pitched cards go to the bottom of the deck, in the order pitched; then draw up to
        // intellect (UNVERIFIED: the basic turn rules, not any card's).
        const cleared: GameState = {
          ...state,
          turn: state.turn + 1,
          zones: {
            ...state.zones,
            deck: [...state.zones.deck, ...state.zones.pitch],
            pitch: [],
          },
        };
        return drawCards(cleared, state.intellect - cleared.zones.hand.length);
      }
    }
  })();
  return { ...next, log: [...state.log, action] };
}

/** A new game: the deck shuffled with the seed, the loadout in play, and a hand drawn. */
export function newGame(setup: GameSetup): GameHistory {
  const zones = emptyZones();
  zones.deck = shuffle(
    setup.deck.map((card, i) => ({ uid: `d${i}`, card })),
    setup.seed,
  );
  zones.weapons = (setup.weapons ?? []).map((card, i) => ({
    uid: `w${i}`,
    card,
  }));
  zones.equipment = (setup.equipment ?? []).map((card, i) => ({
    uid: `e${i}`,
    card,
  }));
  const intellect = setup.intellect ?? 4;
  const state = drawCards(
    {
      seed: setup.seed,
      turn: 1,
      side: setup.side ?? "forsaken",
      intellect,
      zones,
      tokens: {},
      log: [],
    },
    intellect,
  );
  return { past: [], present: state };
}

/** Applies an action, keeping the state before it for undo. */
export function act(history: GameHistory, action: GameAction): GameHistory {
  return {
    past: [...history.past, history.present],
    present: apply(history.present, action),
  };
}

/** Back one action; at the start of the game, nothing changes. */
export function undo(history: GameHistory): GameHistory {
  const previous = history.past.at(-1);
  return previous
    ? { past: history.past.slice(0, -1), present: previous }
    : history;
}

/** Plays a log back from a game's setup: the same seed and actions give the same game. */
export function replay(setup: GameSetup, log: GameAction[]): GameHistory {
  return log.reduce(act, newGame(setup));
}
