// Line scoring (docs/turn-objectives.md, "Scoring settings"): each line the turn search finds is
// scored on what it threatens this turn and what it leaves for the next, and the best is played.
// The objectives are broad ideas from the game state, as the maintainer put it (28 Oct 2026), not a
// fixed table per turn.
//
// UNVERIFIED: every weight below is Claude's draft for the maintainer to check. The settings
// themselves are the maintainer's: burst at 9 with a big burst at 14 above it, Runechants carried
// and cards in banish to play out, coming back to the Forsaken as a goal, width, and how many
// blockers to hold back (no default).
import type { BatchPolicy } from "./batch.ts";
import type { ScriptRun } from "./script.ts";
import { searchTurn, type TurnLine, type TurnSearchOptions } from "./search.ts";
import { RulesError, setUp, type RulesState } from "./state.ts";

export interface LineScoreSettings {
  /** Per point threatened (power + arcane + 2 per usurp). */
  damage: number;
  /** A burst: added once the line threatens `at` or more. */
  burst: { at: number; bonus: number };
  /** A big burst: added on top of the burst at `at` or more. */
  bigBurst: { at: number; bonus: number };
  /** Per Runechant token carried into the next turn (for usurp). */
  runechants: number;
  /** Per sinchant (Runechant aura) carried into the next turn. */
  sinchants: number;
  /** Per card face up in banish that can be played from there next turn. */
  banishedPlayable: number;
  /** Traversing to the Usurper this turn. */
  flip: number;
  /** Traversing back to the Forsaken this turn: a goal in itself. */
  back: number;
  /** Per card played (from hand, arsenal or banish). */
  width: number;
  /** A card left in the arsenal. */
  arsenal: number;
  /** Per life lost this turn (blood debt, Descendancy), taken off. */
  lifeLost: number;
  /**
   * Hand cards to keep back as blockers. Only lines that hold at least this many are chosen, or as
   * many as any line can. Unset: no hand card is kept for blocking.
   */
  holdBack?: number;
}

/** UNVERIFIED defaults, Claude's draft (28 Oct 2026). Blockers held back has no default. */
export const DEFAULT_LINE_SCORE_SETTINGS: LineScoreSettings = {
  damage: 1,
  burst: { at: 9, bonus: 4 },
  bigBurst: { at: 14, bonus: 4 },
  runechants: 1,
  sinchants: 1,
  banishedPlayable: 1.5,
  flip: 2,
  back: 3,
  width: 0.5,
  arsenal: 1,
  lifeLost: 0.5,
};

/** One line's score under the settings. */
export function scoreLine(
  line: TurnLine,
  settings: LineScoreSettings = DEFAULT_LINE_SCORE_SETTINGS,
): number {
  const s = settings;
  return (
    s.damage * line.threatened +
    (line.threatened >= s.burst.at ? s.burst.bonus : 0) +
    (line.threatened >= s.bigBurst.at ? s.bigBurst.bonus : 0) +
    s.runechants * line.runechants +
    s.sinchants * line.sinchants +
    s.banishedPlayable * line.banishedPlayable +
    (line.flipped ? s.flip : 0) +
    (line.back ? s.back : 0) +
    s.width * line.width +
    (line.state.zones.arsenal.length > 0 ? s.arsenal : 0) -
    s.lifeLost * line.lifeLost
  );
}

/**
 * The best-scoring line among those that hold back enough blockers. Ties go to the first in the
 * list, so the search's order makes the choice deterministic.
 */
export function pickLine(
  lines: readonly TurnLine[],
  settings: LineScoreSettings = DEFAULT_LINE_SCORE_SETTINGS,
): TurnLine {
  if (lines.length === 0) throw new RulesError("No line to choose from.");
  const most = Math.max(...lines.map((l) => l.held));
  const hold = Math.min(settings.holdBack ?? 0, most);
  let best: TurnLine | undefined;
  let bestScore = -Infinity;
  for (const line of lines) {
    if (line.held < hold) continue;
    const score = scoreLine(line, settings);
    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  }
  return best!;
}

/** Searches the turn from an action phase and returns the best-scoring line. */
export function chooseLine(
  state: RulesState,
  settings: LineScoreSettings = DEFAULT_LINE_SCORE_SETTINGS,
  search: TurnSearchOptions = {},
): TurnLine {
  return pickLine(searchTurn(state, search).lines, settings);
}

export interface ObjectivePlayOptions {
  turns: number;
  settings?: LineScoreSettings;
  search?: TurnSearchOptions;
}

export interface ObjectiveRun extends ScriptRun {
  /** The line played each turn, in order. */
  lines: TurnLine[];
}

/** Plays `turns` turns from an action phase, each with the line chooseLine picks. */
export function playByObjectives(
  initial: RulesState,
  options: ObjectivePlayOptions,
): ObjectiveRun {
  let state = initial;
  const lines: TurnLine[] = [];
  try {
    for (let turn = 0; turn < options.turns; turn++) {
      const line = chooseLine(state, options.settings, options.search);
      lines.push(line);
      state = line.state;
    }
  } catch (e) {
    if (!(e instanceof RulesError)) throw e;
    return {
      state,
      trace: state.events,
      steps: [],
      lines,
      failure: e.message,
    };
  }
  return { state, trace: state.events, steps: [], lines };
}

/** The line chooser as a batch policy, so it runs on the same seeds as a script. */
export function objectivePolicy(options: ObjectivePlayOptions): BatchPolicy {
  const settings = options.settings ?? DEFAULT_LINE_SCORE_SETTINGS;
  return {
    id: "line-scoring-v1",
    assumptions: {
      label: "Assumed",
      strategy:
        "UNVERIFIED: every legal line each turn, scored on damage, burst, what it leaves, flipping, coming back and width",
      turns: options.turns,
      settings: JSON.stringify(settings),
    },
    run: (setup) => playByObjectives(setUp(setup), options),
  };
}
