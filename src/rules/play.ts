// The player's actions (docs/rules-engine.md, steps 2 to 4): play, pitch and end the turn. Each
// resolves the triggers its events set off before it returns. A card with no verified effects
// can't be played by the engine. UNVERIFIED turn rules: see state.ts.
import { noChoices, runEffects, type Choose } from "./effects.ts";
import { resolveTriggers } from "./triggers.ts";
import {
  finishEndPhase,
  instance,
  pitchOnly,
  removeTokens,
  startEndPhase,
  moveCard,
  RulesError,
  withEvents,
  zoneOf,
  type RulesState,
} from "./state.ts";

const NEEDS_ACTION_POINT = new Set(["action", "attack_action"]);
const PLAYABLE_IN_ACTION_PHASE = new Set([
  "action",
  "attack_action",
  "instant",
]);

/** Play a card from hand or arsenal: pay its cost and, for an action, an action point. */
export function playCard(
  s: RulesState,
  uid: string,
  choose: Choose = noChoices,
): RulesState {
  const { card } = instance(s, uid);
  const from = zoneOf(s, uid);
  if (from !== "hand" && from !== "arsenal")
    throw new RulesError(`${card.name} isn't in hand or arsenal.`);
  if (s.phase !== "action")
    throw new RulesError(`Cards are played in the action phase.`);
  if (!PLAYABLE_IN_ACTION_PHASE.has(card.type ?? ""))
    throw new RulesError(`${card.name} can't be played in the action phase.`);
  if (card.effects === undefined)
    throw new RulesError(
      `${card.name} has no verified effects yet, so the engine can't play it.`,
    );
  const action = NEEDS_ACTION_POINT.has(card.type ?? "");
  if (action && s.actionPoints < 1)
    throw new RulesError("No action point left.");
  const cost = card.cost ?? 0;
  if (cost > s.resources)
    throw new RulesError(
      `${card.name} costs ${cost}; ${s.resources} available.`,
    );
  const attack = card.type === "attack_action";
  let paid: RulesState = {
    ...s,
    resources: s.resources - cost,
    actionPoints: s.actionPoints - (action ? 1 : 0) + (card.goAgain ? 1 : 0),
  };
  // Usurp: an additional cost, paid if able.
  if (card.usurp && (paid.tokens.runechant ?? 0) > 0)
    paid = withEvents(removeTokens(paid, "runechant", 1), {
      type: "usurped",
      uid,
    });
  const played = withEvents(
    moveCard(paid, uid, attack ? "arena" : "graveyard"),
    { type: "played", uid, cost },
    ...(attack ? [{ type: "attackPlayed" as const, uid }] : []),
  );
  const resolved = resolveTriggers(
    runEffects(played, card.effects, choose),
    s.events.length,
    choose,
  );
  if (!attack) return resolved;
  // The attack resolves and becomes attacking ("when this attacks"); combat itself is out of
  // scope.
  return resolveTriggers(
    withEvents(resolved, { type: "attacking", uid }),
    resolved.events.length,
    choose,
  );
}

/** Pitch a card from hand, then resolve what it sets off. */
export function pitchCard(
  s: RulesState,
  uid: string,
  choose: Choose = noChoices,
): RulesState {
  return resolveTriggers(pitchOnly(s, uid), s.events.length, choose);
}

/**
 * End the turn: the start of the end phase and its triggers, then the rest of the end phase
 * (see finishEndPhase) and anything that sets off.
 */
export function endTurn(
  s: RulesState,
  options: { arsenal?: string } = {},
  choose: Choose = noChoices,
): RulesState {
  const started = resolveTriggers(startEndPhase(s), s.events.length, choose);
  return resolveTriggers(
    finishEndPhase(started, options),
    started.events.length,
    choose,
  );
}
