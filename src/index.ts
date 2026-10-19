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
  /** The card's type, e.g. "attack_action" or "weapon". */
  type?: string;
}

/** A deck to run against. Blanks stand for cards outside the core. */
export interface Deck {
  cards: (EngineCard | null)[];
  coreCards: number;
  blanks: number;
  /** Weapons and equipment: in play from the start, and always visible to conditions. */
  gear?: EngineCard[];
}

export function buildDeck(
  core: { card: EngineCard; copies: number }[],
  deckSize: number,
  gear: EngineCard[] = [],
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
    gear,
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
  type: z.string().min(1).optional(),
});
const blockSchema = z.strictObject({
  label: z.string().min(1),
  filter: filterSchema,
  /** Total this amount across matching cards instead of counting them. */
  total: z.string().min(1).optional(),
  min: z.number().int().min(0),
  /** At most this many: with min, "exactly" is min = max. */
  max: z.number().int().min(0).optional(),
  /** Count each card once, however many copies are visible. */
  distinct: z.boolean().optional(),
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
  /** Which zones conditions can see. Weapons and equipment are always visible. */
  access: z.array(z.enum(["hand", "arsenal", "topOfDeck"])).min(1),
  /** Cards assumed to already be somewhere: each takes one copy out of the deck. */
  fixed: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        pitch: z.number().int().optional(),
        zone: z.enum(["hand", "arsenal"]),
      }),
    )
    .refine((f) => f.filter((c) => c.zone === "arsenal").length <= 1, {
      message: "Only one card fits in the arsenal.",
    })
    .optional(),
  condition: groupSchema,
});
export type ScenarioDefinition = z.infer<typeof scenarioSchema>;

const FAILED_SEEDS = 5;

export interface ScenarioResult {
  successRate: number;
  /** Success if checked after each turn's draw, turns 1 to the horizon. */
  byTurn: number[];
  /** Blocks that were false in failed runs, most common first. */
  failures: { label: string; share: number }[];
  /** The shuffle seeds of a few failed runs, to open in goldfish (newGame with the same seed). */
  failedSeeds: number[];
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
  if (f.type !== undefined && card.type !== f.type) return false;
  return true;
}

function blockTrue(b: Block, visible: (EngineCard | null)[]) {
  const all = visible.filter((c) => matches(c, b.filter)) as EngineCard[];
  const hits = b.distinct
    ? all.filter((c, i) => all.findIndex((d) => d.name === c.name) === i)
    : all;
  const value = b.total
    ? hits.reduce((n, c) => n + (c.amounts[b.total!] ?? 0), 0)
    : hits.length;
  return value >= b.min && (b.max === undefined || value <= b.max);
}

/** A scenario that can't run on a deck, such as one fixing more copies than it has. */
export class ScenarioCannotRun extends Error {
  override name = "ScenarioCannotRun";
}

const COLOUR: Record<number, string> = { 1: "red", 2: "yellow", 3: "blue" };

/** A card assumed to already be in hand or arsenal (the scenario contract's fixed cards). */
export type FixedCard = NonNullable<ScenarioDefinition["fixed"]>[number];

/**
 * Takes each fixed card's copy out of the deck, or says why it can't. Scenarios and goldfish
 * both use it, so a run's seed deals the same game in each.
 */
export function takeFixed<T>(
  items: readonly T[],
  cardOf: (item: T) => EngineCard | null,
  fixed: readonly FixedCard[],
) {
  const fits = (f: FixedCard, item: T) => {
    const c = cardOf(item);
    return (
      !!c && c.name === f.name && (f.pitch === undefined || c.pitch === f.pitch)
    );
  };
  const rest = [...items];
  const placed = fixed.map((f) => {
    const i = rest.findIndex((item) => fits(f, item));
    if (i < 0) {
      const wanted = fixed.filter(
        (g) => g.name === f.name && g.pitch === f.pitch,
      ).length;
      const has = items.filter((item) => fits(f, item)).length;
      const what =
        f.pitch === undefined
          ? f.name
          : `${f.name} (${COLOUR[f.pitch] ?? `pitch ${f.pitch}`})`;
      throw new ScenarioCannotRun(
        `Needs ${wanted} ${wanted === 1 ? "copy" : "copies"} of ${what}; the deck has ${has}.`,
      );
    }
    return { item: rest.splice(i, 1)[0]!, zone: f.zone };
  });
  return {
    rest,
    hand: placed.filter((p) => p.zone === "hand").map((p) => p.item),
    arsenal: placed.filter((p) => p.zone === "arsenal").map((p) => p.item),
  };
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
  return tableByTurn(cards, [], turns, handSize, turnModel).map((t) => t.hand);
}

/**
 * What's on the table after each turn's draw: the hand, and the top card of the deck. Fixed
 * hand cards count towards the first hand. Without steps nothing leaves the hand, so drawUp
 * keeps the opening hand; fresh draws a new one each turn. The arsenal isn't touched.
 */
function tableByTurn(
  cards: (EngineCard | null)[],
  fixedHand: EngineCard[],
  turns: number,
  handSize: number,
  turnModel: "fresh" | "drawUp",
) {
  const out: { hand: (EngineCard | null)[]; top: EngineCard | null }[] = [];
  let pos = 0;
  let hand: (EngineCard | null)[] = [];
  for (let t = 0; t < turns; t++) {
    if (t === 0) {
      const draw = Math.max(0, handSize - fixedHand.length);
      hand = [...fixedHand, ...cards.slice(0, draw)];
      pos = draw;
    } else if (turnModel === "fresh") {
      hand = cards.slice(pos, pos + handSize);
      pos += handSize;
    }
    out.push({ hand, top: cards[pos] ?? null });
  }
  return out;
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
  const failedSeeds: number[] = [];
  const seeds = random(options.seed);

  const fixed = takeFixed(deck.cards, (c) => c, def.fixed ?? []);
  const sees = (zone: (typeof def.access)[number]) => def.access.includes(zone);
  const gear = deck.gear ?? [];

  for (let run = 0; run < options.runs; run++) {
    const runSeed = Math.floor(seeds() * 2 ** 31);
    const order = shuffle(fixed.rest, runSeed);
    const table = tableByTurn(
      order,
      fixed.hand,
      turns,
      handSize,
      def.turnModel,
    );
    const visible = table.map(({ hand, top }) => [
      ...(sees("hand") ? hand : []),
      ...(sees("arsenal") ? fixed.arsenal : []),
      ...(sees("topOfDeck") ? [top] : []),
      ...gear,
    ]);
    visible.forEach((cards, t) => {
      if (evaluate(def.condition, cards, new Set())) successByTurn[t]!++;
    });
    const falseBlocks = new Set<string>();
    if (evaluate(def.condition, visible[turns - 1]!, falseBlocks)) successes++;
    else {
      if (failedSeeds.length < FAILED_SEEDS) failedSeeds.push(runSeed);
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
    failedSeeds,
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
