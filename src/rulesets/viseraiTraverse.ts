// Viserai's traverse, as a rule set switched on explicitly (README "Shared game engine": game
// logic lives in rule sets, checked by a player). UNVERIFIED, from the hero text:
// - Forsaken: create 3 or more Runechants in a turn and you traverse to Usurper.
// - Usurper: create (or activate) a Gate in a turn and you may traverse back at end of turn.
// Viserai starts on Forsaken. Each turn is a fresh hand of 4 (intellect); costs, pitching and
// the arsenal aren't modelled, and using an existing Gate isn't counted.
import {
  handsByTurn,
  random,
  shuffle,
  type Deck,
  type EngineCard,
} from "../index.ts";

export interface TraverseResult {
  /** Share of games that have reached Usurper by the end of each turn. */
  reachedUsurper: number[];
  /** Share of games on Usurper at the end of each turn. */
  onUsurper: number[];
  /** Share of games that have flipped back to Forsaken by the end of each turn. */
  flippedBack: number[];
  /** Share of games that never reach Usurper within the turns run. */
  neverReached: number;
  /** Average turn of the first flip, among games that flip. */
  averageFirstFlip: number | null;
}

const amount = (
  c: EngineCard,
  key: "runechants" | "gates",
  conditions: "met" | "unmet",
) => {
  const all = c.amounts[key] ?? 0;
  const unconditional = c.amounts[`${key}Unconditional`];
  return conditions === "met" || unconditional === undefined
    ? all
    : unconditional;
};

export function runTraverse(
  deck: Deck,
  options: {
    turns: number;
    runs: number;
    seed: number;
    handSize?: number;
    conditions?: "met" | "unmet";
  },
): TraverseResult {
  const { turns, runs } = options;
  const conditions = options.conditions ?? "met";
  const reached = Array.from({ length: turns }, () => 0);
  const on = Array.from({ length: turns }, () => 0);
  const back = Array.from({ length: turns }, () => 0);
  let firstSum = 0;
  let firstCount = 0;
  const seeds = random(options.seed);

  for (let run = 0; run < runs; run++) {
    const order = shuffle(deck.cards, Math.floor(seeds() * 2 ** 31));
    const hands = handsByTurn(order, turns, options.handSize ?? 4, "fresh");
    let side: "forsaken" | "usurper" = "forsaken";
    let everReached = false;
    let everBack = false;
    hands.forEach((hand, t) => {
      const cards = hand.filter((c): c is EngineCard => !!c);
      if (side === "forsaken") {
        const runechants = cards.reduce(
          (n, c) => n + amount(c, "runechants", conditions),
          0,
        );
        if (runechants >= 3) {
          side = "usurper";
          if (!everReached) {
            everReached = true;
            firstSum += t + 1;
            firstCount++;
          }
        }
      } else if (cards.some((c) => amount(c, "gates", conditions) > 0)) {
        side = "forsaken";
        everBack = true;
      }
      if (everReached) reached[t]!++;
      if (side === "usurper") on[t]!++;
      if (everBack) back[t]!++;
    });
  }

  const share = (xs: number[]) => xs.map((n) => n / runs);
  return {
    reachedUsurper: share(reached),
    onUsurper: share(on),
    flippedBack: share(back),
    neverReached: (runs - firstCount) / runs,
    averageFirstFlip: firstCount ? firstSum / firstCount : null,
  };
}
