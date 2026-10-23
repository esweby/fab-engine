// Goldfish on the rules engine (docs/rules-engine.md, step 8). Rules actions resolve effects and
// triggers through the engine; sandbox actions are applied by hand, marked manual, and set
// nothing off, except noting damage and traversing. The player can play unmodelled cards and
// test lines the engine doesn't support. A manual change may leave a state the rules wouldn't allow: that's accepted here and
// never possible in a scenario run.
//
// When the engine needs a choice, the action stops with NeedsChoice. The interface asks, then
// applies the action again with the answer recorded on it, so a session's log replays exactly.
import { shuffle } from "../index.ts";
import type { Zone } from "../game.ts";
import { noChoices, type ChoiceRequest, type Choose } from "./effects.ts";
import { resolveTriggers } from "./triggers.ts";
import {
  activateCard,
  activateGate,
  attackWithWeapon,
  endTurn,
  pitchCard,
  playCard,
} from "./play.ts";
import {
  createTokens,
  draw,
  moveCard,
  removeTokens,
  RulesError,
  setUp,
  withEvents,
  type RulesSetup,
  type RulesState,
} from "./state.ts";

/** Answers to the engine's choices, in the order it asks. */
type Answers = { answers?: string[][] };

export type SessionAction =
  // By the rules
  | ({ type: "play"; uid: string } & Answers)
  | ({ type: "pitch"; uid: string } & Answers)
  | ({ type: "activateGate"; target: string } & Answers)
  /** A card's activated ability ("Instant - {r}, destroy this: …"). */
  | ({ type: "activate"; uid: string } & Answers)
  | ({ type: "weaponAttack"; uid: string } & Answers)
  | ({ type: "endTurn"; arsenal?: string } & Answers)
  // By hand
  | {
      type: "move";
      uid: string;
      to: Zone;
      position?: "top" | "bottom";
      faceDown?: boolean;
    }
  | { type: "token"; token: string; delta: number }
  | { type: "resources"; delta: number }
  /** An action point given or taken by hand, e.g. a go again the engine doesn't model. */
  | { type: "actionPoints"; delta: number }
  | { type: "counter"; uid: string; delta: number }
  /** Mark a weapon or piece of equipment used this turn, or unused again. */
  | { type: "use"; uid: string }
  /** Note an attack with a weapon the engine can't attack with yet: used this turn. */
  | { type: "markAttack"; uid: string }
  | { type: "life"; delta: number }
  | { type: "damage"; delta: number }
  | { type: "traverse" }
  | { type: "draw"; count?: number }
  | { type: "shuffle" };

/** The engine needs a choice the action didn't carry: ask, then apply it with the answer. */
export class NeedsChoice extends Error {
  override name = "NeedsChoice";
  constructor(readonly request: ChoiceRequest) {
    super(`A choice is needed: ${request.prompt}`);
  }
}

function answering(answers: string[][] = []): Choose {
  let next = 0;
  return (request) => {
    if (next < answers.length) return answers[next++]!;
    throw new NeedsChoice(request);
  };
}

const manual = (s: RulesState, action: string) =>
  withEvents(s, { type: "manual", action });

/** Apply one goldfish action. Throws RulesError (with the reason) or NeedsChoice. */
export function applySessionAction(
  s: RulesState,
  action: SessionAction,
): RulesState {
  switch (action.type) {
    case "play":
      return playCard(s, action.uid, answering(action.answers));
    case "pitch":
      return pitchCard(s, action.uid, answering(action.answers));
    case "activateGate":
      return activateGate(s, action.target, answering(action.answers));
    case "activate":
      return activateCard(s, action.uid, answering(action.answers));
    case "weaponAttack":
      return attackWithWeapon(s, action.uid, answering(action.answers));
    case "endTurn":
      return endTurn(s, { arsenal: action.arsenal }, answering(action.answers));
    case "move":
      return manual(
        moveCard(s, action.uid, action.to, {
          position: action.position,
          faceDown: action.faceDown,
        }),
        "move",
      );
    case "token": {
      if (action.delta === 0) return s;
      const changed =
        action.delta > 0
          ? createTokens(s, action.token, action.delta)
          : removeTokens(s, action.token, -action.delta);
      return manual(changed, "token");
    }
    case "resources":
      return manual(
        { ...s, resources: Math.max(0, s.resources + action.delta) },
        "resources",
      );
    case "actionPoints":
      return manual(
        { ...s, actionPoints: Math.max(0, s.actionPoints + action.delta) },
        "actionPoints",
      );
    case "counter":
      return manual(
        {
          ...s,
          counters: {
            ...s.counters,
            [action.uid]: Math.max(
              0,
              (s.counters[action.uid] ?? 0) + action.delta,
            ),
          },
        },
        "counter",
      );
    case "use":
      return manual(
        {
          ...s,
          usedThisTurn: s.usedThisTurn.includes(action.uid)
            ? s.usedThisTurn.filter((u) => u !== action.uid)
            : [...s.usedThisTurn, action.uid],
        },
        "use",
      );
    case "markAttack":
      return manual(
        withEvents(
          {
            ...s,
            usedThisTurn: s.usedThisTurn.includes(action.uid)
              ? s.usedThisTurn
              : [...s.usedThisTurn, action.uid],
          },
          { type: "attackNoted", uid: action.uid },
        ),
        "attack",
      );
    case "life":
      return manual({ ...s, lifeLost: s.lifeLost - action.delta }, "life");
    case "damage":
      return resolveTriggers(
        manual(
          withEvents(s, { type: "damageNoted", amount: action.delta }),
          "damage",
        ),
        s.events.length,
        noChoices,
      );
    case "traverse": {
      // Viserai's abilities answer to the side
      // he's on, however he got there (the maintainer, 20 Oct 2026: traversing by hand to the
      // Usurper gives the turn's first blood debt attack go again).
      const to = s.side === "forsaken" ? "usurper" : "forsaken";
      const traversed = manual(
        withEvents({ ...s, side: to }, { type: "traversed", to }),
        "traverse",
      );
      return resolveTriggers(traversed, s.events.length, noChoices);
    }
    case "draw":
      return manual(draw(s, action.count ?? 1), "draw");
    case "shuffle": {
      // Each shuffle gets its own seed from the game's: the same session shuffles the same way.
      const before = s.events.filter((e) => e.type === "shuffled").length;
      const shuffled = withEvents(
        {
          ...s,
          zones: {
            ...s.zones,
            deck: shuffle(s.zones.deck, s.seed * 31 + before + 1),
          },
        },
        { type: "shuffled" },
      );
      return manual(shuffled, "shuffle");
    }
    default:
      throw new RulesError(
        `Unknown action: ${(action as { type?: string }).type ?? "none"}.`,
      );
  }
}

/** A session rebuilt from its setup and log. Throws RulesError if the log no longer fits. */
export function replaySession(
  setup: RulesSetup,
  log: SessionAction[],
): RulesState {
  return log.reduce((s, action) => {
    try {
      return applySessionAction(s, action);
    } catch (e) {
      if (e instanceof NeedsChoice)
        throw new RulesError(
          `The log is missing an answer: ${e.request.prompt}.`,
        );
      throw e;
    }
  }, setUp(setup));
}
