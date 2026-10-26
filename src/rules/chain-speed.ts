// UNVERIFIED comparison proxy, matching the registered Go chain rather than attributing a Gate's source or target.
import type { RulesCard, RulesEvent } from "./state.ts";
import { RulesError } from "./state.ts";
import type { BatchReport } from "./batch.ts";

export type ChainDelay = 0 | 1 | 2;
export interface BslGateBloodDebtMatch {
  reached: 0 | 1 | 2 | 3;
  setupTurn: number | null;
  gateTurn: number | null;
  payoffTurn: number | null;
  delay: ChainDelay | null;
}

export interface ChainSpeedDistribution {
  chain: "bsl-gate-blood-debt";
  population: number;
  reached: [number, number, number, number];
  by_delay: [number, number, number];
}

export function validateChainSpeed(distribution: ChainSpeedDistribution): void {
  const { chain, population, reached, by_delay: byDelay } = distribution;
  if (
    chain !== "bsl-gate-blood-debt" ||
    !Array.isArray(reached) ||
    reached.length !== 4 ||
    !Array.isArray(byDelay) ||
    byDelay.length !== 3 ||
    ![population, ...reached, ...byDelay].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    reached.reduce((total, count) => total + count, 0) !== population ||
    byDelay.reduce((total, count) => total + count, 0) !== reached[3]
  )
    throw new RulesError("Invalid BSL chain-speed counts or population.");
}

export function chainSpeedDistribution(
  report: BatchReport,
): ChainSpeedDistribution {
  if (!report.inputs.measureBslGateBloodDebt)
    throw new RulesError(
      "Chain-speed measurement was not requested for this batch.",
    );
  const distribution: ChainSpeedDistribution = {
    chain: "bsl-gate-blood-debt",
    population: 0,
    reached: [0, 0, 0, 0],
    by_delay: [0, 0, 0],
  };
  for (const run of report.perRun) {
    if (!run.completed) continue;
    if (!run.bslGateBloodDebt)
      throw new RulesError(
        "Missing chain-speed measurement for a completed run.",
      );
    const match = run.bslGateBloodDebt;
    distribution.population++;
    distribution.reached[match.reached]++;
    if (match.delay !== null) distribution.by_delay[match.delay]++;
  }
  validateChainSpeed(distribution);
  return distribution;
}

export function measureBslGateBloodDebt(
  trace: readonly RulesEvent[],
  cards: ReadonlyMap<string, RulesCard>,
): BslGateBloodDebtMatch {
  let turn = 1;
  const events = trace.map((event) => {
    if (event.type === "turnStarted") turn = event.turn;
    return { event, turn };
  });
  let best: BslGateBloodDebtMatch = {
    reached: 0,
    setupTurn: null,
    gateTurn: null,
    payoffTurn: null,
    delay: null,
  };
  for (const [index, setup] of events.entries()) {
    if (setup.event.type !== "played") continue;
    const card = cards.get(setup.event.uid);
    if (card?.name !== "Become the Shadow Lord" || card.pitch !== 3) continue;
    const attempt: BslGateBloodDebtMatch = {
      reached: 1,
      setupTurn: setup.turn,
      gateTurn: null,
      payoffTurn: null,
      delay: null,
    };
    for (let gateIndex = index + 1; gateIndex < events.length; gateIndex++) {
      const gate = events[gateIndex]!;
      if (gate.turn - setup.turn > 2) break;
      if (gate.event.type !== "gateActivated") continue;
      attempt.reached = 2;
      attempt.gateTurn = gate.turn;
      for (const payoff of events.slice(gateIndex + 1)) {
        if (payoff.turn !== gate.turn) break;
        if (
          payoff.event.type !== "played" ||
          !cards.get(payoff.event.uid)?.traits.includes("blood_debt")
        )
          continue;
        attempt.reached = 3;
        attempt.payoffTurn = payoff.turn;
        attempt.delay = (payoff.turn - setup.turn) as ChainDelay;
        break;
      }
      break;
    }
    if (attempt.reached > best.reached) best = attempt;
  }
  return best;
}
