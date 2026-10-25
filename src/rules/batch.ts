// Seeded batches and reports (docs/rules-engine.md, step 7). A batch runs one script many times
// on seeded shuffles and reports per completed turn. Rates are successful completed runs over
// completed runs; failed runs (the processing budget) are counted apart, never as successes.
// Every report records its inputs, including a hash of the rules data it ran on.
import { ENGINE_VERSION, random } from "../index.ts";
import {
  runScript,
  type Script,
  type ScriptRun,
  type Selector,
} from "./script.ts";
import type { RulesCard, RulesEvent, RulesSetup } from "./state.ts";
import type { Trigger } from "./triggers.ts";

/** A banished-zone question, asked at the end of every turn. */
export interface BanishQuery {
  id: string;
  /** entered: it was banished at some point by then; remains: it's in the banished zone then. */
  kind: "entered" | "remains";
  card: Selector;
}

export interface TurnRecord {
  /** Runechants made this turn. */
  runechants: number;
  /** A Gate made at some point by the end of this turn. */
  gateBy: boolean;
  onUsurperAtEnd: boolean;
  /** Life lost by the end of this turn. */
  lifeLost: number;
  /** Arcane damage dealt this turn (Runechants). */
  arcane: number;
  /**
   * Damage threatened this turn: each attack's printed power, plus 2 for each usurp. A goldfish
   * count, unblocked; power bonuses that are combat aren't counted (docs/engine-calibration.md).
   */
  threatened: number;
  queries: Record<string, boolean>;
}

export interface RunSummary {
  policyMatches?: Record<string, number>;
  seed: number;
  completed: boolean;
  failure?: string;
  turns: TurnRecord[];
  gateByTurn: boolean[];
  /** The turn Viserai first traversed to the Usurper, or null if never. */
  firstTraverseTurn: number | null;
}

export interface TurnReport {
  turn: number;
  /** Completed runs that reached the end of this turn. */
  runsReached: number;
  /** Average Runechants made this turn. */
  runechantsMade: number;
  /** Share of runs with a Gate made by the end of this turn. */
  gateBy: number;
  onUsurperAtEnd: number;
  /** Average life lost by the end of this turn. */
  lifeLost: number;
  /** Share of runs for which each query holds at the end of this turn. */
  queries: Record<string, number>;
}

export interface BatchReport {
  runs: number;
  completed: number;
  failed: number;
  failures: { message: string; count: number }[];
  byTurn: TurnReport[];
  perRun: RunSummary[];
  inputs: {
    runs: number;
    seed: number;
    engineVersion: string;
    rulesDataVersion: string;
    script: Script;
    policy?: Pick<BatchPolicy, "id" | "assumptions">;
  };
}

export type BatchSetup = Omit<RulesSetup, "seed">;
export interface BatchPolicy {
  id: string;
  assumptions: Record<string, string | number | boolean>;
  run: (setup: RulesSetup, script: Script) => ScriptRun;
}
export interface BatchOptions {
  runs: number;
  seed: number;
  queries?: BanishQuery[];
  policy?: BatchPolicy;
}

const fits = (card: RulesCard, sel: Selector) =>
  (sel.name === undefined || card.name === sel.name) &&
  (sel.type === undefined || card.type === sel.type) &&
  (sel.trait === undefined || card.traits.includes(sel.trait)) &&
  (sel.pitch === undefined || card.pitch === sel.pitch);

/** Each card copy by its id: d0… for the deck, w0… weapons, e0… equipment (as setUp names them). */
function cardsById(setup: BatchSetup) {
  const byId = new Map<string, RulesCard>();
  setup.deck.forEach((c, i) => byId.set(`d${i}`, c));
  (setup.weapons ?? []).forEach((c, i) => byId.set(`w${i}`, c));
  (setup.equipment ?? []).forEach((c, i) => byId.set(`e${i}`, c));
  return byId;
}

/** Turn-by-turn facts from a run's trace. */
function summarise(
  trace: RulesEvent[],
  cards: Map<string, RulesCard>,
  startSide: RulesSetup["side"],
  queries: BanishQuery[],
): TurnRecord[] {
  const turns: TurnRecord[] = [];
  const banished = new Set<string>();
  const entered = new Set<string>();
  let side = startSide ?? "forsaken";
  let runechants = 0;
  let gate = false;
  let lifeLost = 0;
  let arcane = 0;
  let threatened = 0;
  const any = (ids: Set<string>, sel: Selector) =>
    [...ids].some((id) => {
      const c = cards.get(id);
      return !!c && fits(c, sel);
    });
  for (const e of trace) {
    if (e.type === "tokensCreated" && e.token === "runechant")
      runechants += e.amount;
    if (e.type === "tokensCreated" && e.token === "gate") gate = true;
    if (e.type === "traversed") side = e.to;
    if (e.type === "lifeLost") lifeLost += e.amount;
    if (e.type === "arcaneDamage") arcane += e.amount;
    if (e.type === "attackPlayed") threatened += cards.get(e.uid)?.power ?? 0;
    if (e.type === "usurped") threatened += 2;
    if (e.type === "moved") {
      if (e.to === "banished") {
        banished.add(e.uid);
        entered.add(e.uid);
      } else if (e.from === "banished") banished.delete(e.uid);
    }
    if (e.type === "turnEnded") {
      turns.push({
        runechants,
        gateBy: gate,
        onUsurperAtEnd: side === "usurper",
        lifeLost,
        arcane,
        threatened,
        queries: Object.fromEntries(
          queries.map((q) => [
            q.id,
            any(q.kind === "entered" ? entered : banished, q.card),
          ]),
        ),
      });
      runechants = 0;
      arcane = 0;
      threatened = 0;
    }
  }
  return turns;
}

/** The turn of the first traverse to the Usurper in a trace, or null. */
function firstTraverse(trace: RulesEvent[]): number | null {
  let turn = 1;
  for (const e of trace) {
    if (e.type === "turnStarted") turn = e.turn;
    if (e.type === "traversed" && e.to === "usurper") return turn;
  }
  return null;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const share = (xs: boolean[]) => mean(xs.map((x) => (x ? 1 : 0)));

/** Runs a script `runs` times on seeded shuffles (or the given order) and reports on it. */
export function runBatch(
  setup: BatchSetup,
  script: Script,
  options: BatchOptions,
): BatchReport {
  const queries = options.queries ?? [];
  const cards = cardsById(setup);
  const seeds = random(options.seed);
  const perRun: RunSummary[] = [];
  for (let n = 0; n < options.runs; n++) {
    const seed = Math.floor(seeds() * 2 ** 31);
    const run = (options.policy?.run ?? runScript)({ ...setup, seed }, script);
    const turns = run.failure
      ? []
      : summarise(run.trace, cards, setup.side, queries);
    perRun.push({
      ...(run.policyMatches ? { policyMatches: { ...run.policyMatches } } : {}),
      seed,
      completed: !run.failure,
      ...(run.failure ? { failure: run.failure } : {}),
      turns,
      gateByTurn: turns.map((t) => t.gateBy),
      firstTraverseTurn: run.failure ? null : firstTraverse(run.trace),
    });
  }
  const done = perRun.filter((r) => r.completed);
  const maxTurns = Math.max(0, ...done.map((r) => r.turns.length));
  const byTurn: TurnReport[] = Array.from({ length: maxTurns }, (_, t) => {
    const reached = done.flatMap((r) => (r.turns[t] ? [r.turns[t]!] : []));
    return {
      turn: t + 1,
      runsReached: reached.length,
      runechantsMade: mean(reached.map((r) => r.runechants)),
      gateBy: share(reached.map((r) => r.gateBy)),
      onUsurperAtEnd: share(reached.map((r) => r.onUsurperAtEnd)),
      lifeLost: mean(reached.map((r) => r.lifeLost)),
      queries: Object.fromEntries(
        queries.map((q) => [q.id, share(reached.map((r) => r.queries[q.id]!))]),
      ),
    };
  });
  const failureCounts = new Map<string, number>();
  for (const r of perRun)
    if (r.failure)
      failureCounts.set(r.failure, (failureCounts.get(r.failure) ?? 0) + 1);
  return {
    runs: options.runs,
    completed: done.length,
    failed: options.runs - done.length,
    failures: [...failureCounts].map(([message, count]) => ({
      message,
      count,
    })),
    byTurn,
    perRun,
    inputs: {
      runs: options.runs,
      seed: options.seed,
      engineVersion: ENGINE_VERSION,
      rulesDataVersion: rulesDataVersion(
        [...setup.deck, ...(setup.weapons ?? []), ...(setup.equipment ?? [])],
        setup.triggers ?? [],
      ),
      script,
      ...(options.policy
        ? {
            policy: {
              id: options.policy.id,
              assumptions: { ...options.policy.assumptions },
            },
          }
        : {}),
    },
  };
}

/** Two scripts on the same setup and seeds: each report, and b minus a per turn. */
export function compareBatches(
  setup: BatchSetup,
  [first, second]: [Script, Script],
  options: BatchOptions,
) {
  const a = runBatch(setup, first, options);
  const b = runBatch(setup, second, options);
  const turns = Math.min(a.byTurn.length, b.byTurn.length);
  return {
    a,
    b,
    byTurn: Array.from({ length: turns }, (_, t) => {
      const x = a.byTurn[t]!;
      const y = b.byTurn[t]!;
      return {
        turn: t + 1,
        runechantsMade: y.runechantsMade - x.runechantsMade,
        gateBy: y.gateBy - x.gateBy,
        onUsurperAtEnd: y.onUsurperAtEnd - x.onUsurperAtEnd,
        lifeLost: y.lifeLost - x.lifeLost,
      };
    }),
  };
}

/** How many deck cards have verified effects, and which don't. */
export function coverage(deck: RulesCard[]) {
  const unmodelled = deck.filter((c) => c.effects === undefined);
  return {
    modelled: deck.length - unmodelled.length,
    total: deck.length,
    unmodelled: [...new Set(unmodelled.map((c) => c.name))],
  };
}

/** JSON with object keys sorted, so the same data always hashes the same. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(x) ?? "null";
}

/**
 * A hash (FNV-1a, 32 bits) of the rules data a run used: each distinct card's facts and rules,
 * and the game's triggers. A changed card changes it, so an old result is never silently re-read.
 */
export function rulesDataVersion(
  cards: RulesCard[],
  triggers: Trigger[],
): string {
  const distinct = [...new Map(cards.map((c) => [stable(c), c])).values()].sort(
    (a, b) => stable(a).localeCompare(stable(b)),
  );
  const text = stable({ cards: distinct, triggers });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
