// Engine calibration (docs/engine-calibration.md): the simulated distributions from a batch, and
// the pre-registered checks against the observed ones that services/fablazing/cmd/fablazing-
// observed writes. The thresholds were approved by the maintainer before anything was compared
// (T1–T5, 21 Oct 2026) and never move; T6 waits for approval and is only checked when asked for.
// A divergence means investigating a missing rule, a scripted decision or the data.
import type { BatchReport } from "./batch.ts";

/** Whole numbers: counts[v] had value v. Percentiles are nearest-rank, as in the Go side. */
export interface Dist {
  n: number;
  counts: number[];
  median: number;
  p2_5: number;
  p97_5: number;
}

/** One observed population, as fablazing-observed writes it (turn indexes from 0). */
export interface ObservedGroup {
  sides: number;
  by_turn: {
    turn_index: number;
    arcane_damage_dealt: Dist;
    damage_dealt: Dist;
    damage_threatened: Dist;
  }[];
  first_traverse: {
    sides: number;
    never: number;
    by_turn_index: number[];
    median: number;
    p2_5: number;
    p97_5: number;
  };
}

export interface SimulatedDistributions {
  /** Per engine turn, from 1, over the completed runs that reached it. */
  byTurn: { turn: number; arcane: Dist; threatened: Dist }[];
  /** The first traverse to the Usurper, by engine turn (counts[t] for turn t). */
  firstTraverse: { runs: number; never: number } & Dist;
}

export type Threshold = "T1" | "T2" | "T3" | "T4" | "T6a" | "T6b";
export type Verdict = "within" | "investigate" | "not enough data";

export interface Check {
  threshold: Threshold;
  /** The engine turn checked; none for T4. */
  turn?: number;
  verdict: Verdict;
  observed?: number | [number, number];
  simulated?: number;
  /** T2 and T6b: the largest gap between the cumulative distributions. */
  gap?: number;
}

export interface CompareOptions {
  /** 0 compares engine turn N with turn index N − 1; 1 with index N. */
  shift: 0 | 1;
  /** Engine turns checked, from 1. */
  turns: number;
  /** Default T1–T4; T5 needs a Gate script and T6 waits for approval. */
  thresholds?: Threshold[];
  minObserved?: number;
  minSimulated?: number;
}

export const MIN_OBSERVED = 200;
export const MIN_SIMULATED = 1000;
const GAP = 0.15;
const SHARE_GAP = 0.1;

export function dist(xs: number[]): Dist {
  if (xs.length === 0)
    return { n: 0, counts: [], median: 0, p2_5: 0, p97_5: 0 };
  const sorted = xs
    .map((x) => Math.max(0, Math.round(x)))
    .sort((a, b) => a - b);
  const counts = Array<number>(sorted[sorted.length - 1]! + 1).fill(0);
  for (const x of sorted) counts[x]!++;
  const rank = (p: number) =>
    sorted[Math.max(Math.ceil(p * sorted.length), 1) - 1]!;
  return {
    n: sorted.length,
    counts,
    median: rank(0.5),
    p2_5: rank(0.025),
    p97_5: rank(0.975),
  };
}

/** The Kolmogorov–Smirnov distance, read as an effect size (no p-value). */
export function ksDistance(a: Dist, b: Dist): number {
  if (a.n === 0 || b.n === 0) return 0;
  let ca = 0;
  let cb = 0;
  let gap = 0;
  for (let v = 0; v < Math.max(a.counts.length, b.counts.length); v++) {
    ca += a.counts[v] ?? 0;
    cb += b.counts[v] ?? 0;
    gap = Math.max(gap, Math.abs(ca / a.n - cb / b.n));
  }
  return gap;
}

/** First-traverse turns per run (null for never) as a distribution. */
export function firstTraverseOf(turns: (number | null)[]) {
  const traversed = turns.filter((t): t is number => t !== null);
  return {
    runs: turns.length,
    never: turns.length - traversed.length,
    ...dist(traversed),
  };
}

/** The simulated distributions from a batch's completed runs. */
export function simulatedDistributions(
  report: BatchReport,
  turns: number,
): SimulatedDistributions {
  const done = report.perRun.filter((r) => r.completed);
  return {
    byTurn: Array.from({ length: turns }, (_, t) => {
      const reached = done.flatMap((r) => (r.turns[t] ? [r.turns[t]!] : []));
      return {
        turn: t + 1,
        arcane: dist(reached.map((r) => r.arcane)),
        threatened: dist(reached.map((r) => r.threatened)),
      };
    }),
    firstTraverse: firstTraverseOf(done.map((r) => r.firstTraverseTurn)),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The pre-registered checks for one observed population. */
export function compare(
  observed: ObservedGroup,
  sim: SimulatedDistributions,
  options: CompareOptions,
): Check[] {
  const wanted = new Set(options.thresholds ?? ["T1", "T2", "T3", "T4"]);
  const minObs = options.minObserved ?? MIN_OBSERVED;
  const minSim = options.minSimulated ?? MIN_SIMULATED;
  const index = (turn: number) => turn - 1 + options.shift;
  const checks: Check[] = [];

  const medianAndGap = (
    median: Threshold,
    gapId: Threshold,
    pick: (t: ObservedGroup["by_turn"][number]) => Dist,
    simPick: (t: SimulatedDistributions["byTurn"][number]) => Dist,
  ) => {
    for (let turn = 1; turn <= options.turns; turn++) {
      const o = observed.by_turn[index(turn)];
      const s = sim.byTurn[turn - 1];
      const od = o ? pick(o) : undefined;
      const sd = s ? simPick(s) : undefined;
      const enough = !!od && !!sd && od.n >= minObs && sd.n >= minSim;
      if (wanted.has(median))
        checks.push({
          threshold: median,
          turn,
          verdict: !enough
            ? "not enough data"
            : sd!.median < od!.p2_5 || sd!.median > od!.p97_5
              ? "investigate"
              : "within",
          ...(od ? { observed: [od.p2_5, od.p97_5] as [number, number] } : {}),
          ...(sd ? { simulated: sd.median } : {}),
        });
      if (wanted.has(gapId)) {
        const gap = enough ? ksDistance(od!, sd!) : undefined;
        checks.push({
          threshold: gapId,
          turn,
          verdict:
            gap === undefined
              ? "not enough data"
              : gap > GAP
                ? "investigate"
                : "within",
          ...(gap === undefined ? {} : { gap }),
        });
      }
    }
  };
  medianAndGap(
    "T1",
    "T2",
    (t) => t.arcane_damage_dealt,
    (t) => t.arcane,
  );
  medianAndGap(
    "T6a",
    "T6b",
    (t) => t.damage_threatened,
    (t) => t.threatened,
  );

  const ft = observed.first_traverse;
  const sft = sim.firstTraverse;
  if (wanted.has("T3"))
    for (let turn = 1; turn <= options.turns; turn++) {
      const enough = ft.sides >= minObs && sft.runs >= minSim;
      const o = enough
        ? sum(ft.by_turn_index.slice(0, index(turn) + 1)) / ft.sides
        : undefined;
      const s = enough
        ? sum(sft.counts.slice(0, turn + 1)) / sft.runs
        : undefined;
      checks.push({
        threshold: "T3",
        turn,
        verdict:
          o === undefined || s === undefined
            ? "not enough data"
            : Math.abs(o - s) > SHARE_GAP
              ? "investigate"
              : "within",
        ...(o === undefined ? {} : { observed: o }),
        ...(s === undefined ? {} : { simulated: s }),
      });
    }
  if (wanted.has("T4")) {
    const traversed = ft.sides - ft.never;
    const enough = traversed >= minObs && sft.n >= minSim;
    const asIndex = index(sft.median);
    checks.push({
      threshold: "T4",
      verdict: !enough
        ? "not enough data"
        : asIndex < ft.p2_5 || asIndex > ft.p97_5
          ? "investigate"
          : "within",
      observed: [ft.p2_5, ft.p97_5],
      simulated: asIndex,
    });
  }
  return checks;
}

/**
 * Whether each pooled divergence is robust: it also diverges in most of the matchups with
 * enough data for that check. Otherwise it's matchup-dependent.
 */
export function robustness(
  pooled: Pick<Check, "threshold" | "turn" | "verdict">[],
  matchups: Record<string, Pick<Check, "threshold" | "turn" | "verdict">[]>,
) {
  return pooled
    .filter((c) => c.verdict === "investigate")
    .map((c) => {
      const same = Object.values(matchups)
        .map((checks) =>
          checks.find((m) => m.threshold === c.threshold && m.turn === c.turn),
        )
        .filter((m) => m && m.verdict !== "not enough data");
      const diverging = same.filter((m) => m!.verdict === "investigate").length;
      return {
        threshold: c.threshold,
        ...(c.turn === undefined ? {} : { turn: c.turn }),
        matchups: same.length,
        diverging,
        robust: diverging > same.length / 2,
      };
    });
}
