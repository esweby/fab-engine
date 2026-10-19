// The shared game engine (README "Shared game engine"): plain TypeScript, no React, no network.
// It shuffles, deals and counts. It knows no card rules: those come in as card data (roles,
// traits, amounts) worked out by the app, or as rule sets switched on explicitly.
import { z } from "zod";

export const ENGINE_VERSION = "0.1.0";

/** A card as the engine sees it: names and numbers, no rules. */
export interface EngineCard {
  id: string;
  name: string;
  pitch: number | null;
  /** Role ids from @vdb/cards, e.g. "gate_generator". */
  roles: string[];
  /** Plain facts, e.g. "blood_debt", "shadow", "runeblade". */
  traits: string[];
  /** Numbers to total, e.g. { runechants: 2 }. */
  amounts: Record<string, number>;
}

/** A deck to run against. Blanks stand for cards outside the core. */
export interface Deck {
  cards: (EngineCard | null)[];
  coreCards: number;
  blanks: number;
}

export function buildDeck(
  core: { card: EngineCard; copies: number }[],
  deckSize: number,
): Deck {
  const cards: (EngineCard | null)[] = core.flatMap(({ card, copies }) =>
    Array.from({ length: copies }, () => card),
  );
  const coreCards = cards.length;
  const blanks = Math.max(0, deckSize - coreCards);
  return {
    cards: [...cards, ...Array.from({ length: blanks }, () => null)],
    coreCards,
    blanks,
  };
}

/** mulberry32: a small seeded generator, so any shuffle can be reproduced. */
export function random(seed: number) {
  let h = seed | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seed. Returns a new array. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// The scenario contract (README "The scenario contract"): definitions are typed, validated,
// versioned data, never code.
const filterSchema = z.strictObject({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  trait: z.string().min(1).optional(),
  pitch: z.number().int().optional(),
});
const blockSchema = z.strictObject({
  label: z.string().min(1),
  filter: filterSchema,
  /** Total this amount across matching cards instead of counting them. */
  total: z.string().min(1).optional(),
  min: z.number().int().min(0),
});
export type Block = z.infer<typeof blockSchema>;
export type ConditionGroup =
  { all: (ConditionGroup | Block)[] } | { any: (ConditionGroup | Block)[] };
const groupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.union([
    z.strictObject({
      all: z.array(z.union([groupSchema, blockSchema])).min(1),
    }),
    z.strictObject({
      any: z.array(z.union([groupSchema, blockSchema])).min(1),
    }),
  ]),
);

export const scenarioSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().min(1),
  /** 0 = the opening hand; N = the hand after turn N's draw. */
  horizon: z.number().int().min(0).max(10),
  /** fresh: every card is used or pitched and a new hand drawn; drawUp: draw back up. */
  turnModel: z.enum(["fresh", "drawUp"]),
  /** Which zones conditions can see. Only the hand until steps exist. */
  access: z.array(z.enum(["hand"])).min(1),
  condition: groupSchema,
});
export type ScenarioDefinition = z.infer<typeof scenarioSchema>;

export interface ScenarioResult {
  successRate: number;
  /** Success if checked after each turn's draw, turns 1 to the horizon. */
  byTurn: number[];
  /** Blocks that were false in failed runs, most common first. */
  failures: { label: string; share: number }[];
  inputs: {
    runs: number;
    seed: number;
    handSize: number;
    deckSize: number;
    coreCards: number;
    blanks: number;
    definitionVersion: number;
    engineVersion: string;
  };
}

const isBlock = (x: ConditionGroup | Block): x is Block => "label" in x;

function matches(card: EngineCard | null, f: Block["filter"]) {
  if (!card) return false;
  if (f.name !== undefined && card.name !== f.name) return false;
  if (f.role !== undefined && !card.roles.includes(f.role)) return false;
  if (f.trait !== undefined && !card.traits.includes(f.trait)) return false;
  if (f.pitch !== undefined && card.pitch !== f.pitch) return false;
  return true;
}

function blockTrue(b: Block, visible: (EngineCard | null)[]) {
  const hits = visible.filter((c) => matches(c, b.filter)) as EngineCard[];
  const value = b.total
    ? hits.reduce((n, c) => n + (c.amounts[b.total!] ?? 0), 0)
    : hits.length;
  return value >= b.min;
}

/** Evaluates the tree, collecting the labels of blocks that were false. */
function evaluate(
  g: ConditionGroup,
  visible: (EngineCard | null)[],
  falseBlocks: Set<string>,
): boolean {
  const items = "all" in g ? g.all : g.any;
  const results = items.map((item) => {
    if (!isBlock(item)) return evaluate(item, visible, falseBlocks);
    const ok = blockTrue(item, visible);
    if (!ok) falseBlocks.add(item.label);
    return ok;
  });
  return "all" in g ? results.every(Boolean) : results.some(Boolean);
}

/** The hand at each turn from 1 to `turns`, under a turn model. */
export function handsByTurn(
  cards: (EngineCard | null)[],
  turns: number,
  handSize: number,
  turnModel: "fresh" | "drawUp",
): (EngineCard | null)[][] {
  const hands: (EngineCard | null)[][] = [];
  let pos = 0;
  let hand: (EngineCard | null)[] = [];
  for (let t = 0; t < turns; t++) {
    // Without steps nothing leaves the hand, so drawUp keeps the opening hand.
    if (turnModel === "fresh" || t === 0) {
      hand = cards.slice(pos, pos + handSize);
      pos += handSize;
    }
    hands.push(hand);
  }
  return hands;
}

export function runScenario(
  definition: ScenarioDefinition,
  deck: Deck,
  options: { runs: number; seed: number; handSize?: number },
): ScenarioResult {
  const def = scenarioSchema.parse(definition);
  const handSize = options.handSize ?? 4;
  const turns = Math.max(1, def.horizon);
  const successByTurn = Array.from({ length: turns }, () => 0);
  const falseCounts = new Map<string, number>();
  let successes = 0;
  const seeds = random(options.seed);

  for (let run = 0; run < options.runs; run++) {
    const order = shuffle(deck.cards, Math.floor(seeds() * 2 ** 31));
    const hands = handsByTurn(order, turns, handSize, def.turnModel);
    hands.forEach((hand, t) => {
      if (evaluate(def.condition, hand, new Set())) successByTurn[t]!++;
    });
    const falseBlocks = new Set<string>();
    if (evaluate(def.condition, hands[turns - 1]!, falseBlocks)) successes++;
    else {
      for (const label of falseBlocks) {
        falseCounts.set(label, (falseCounts.get(label) ?? 0) + 1);
      }
    }
  }

  const failed = options.runs - successes;
  return {
    successRate: successes / options.runs,
    byTurn: def.horizon === 0 ? [] : successByTurn.map((n) => n / options.runs),
    failures: [...falseCounts]
      .map(([label, n]) => ({ label, share: n / failed }))
      .sort((a, b) => b.share - a.share),
    inputs: {
      runs: options.runs,
      seed: options.seed,
      handSize,
      deckSize: deck.cards.length,
      coreCards: deck.coreCards,
      blanks: deck.blanks,
      definitionVersion: def.version,
      engineVersion: ENGINE_VERSION,
    },
  };
}

export * from "./game.ts";
