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
  if (from === "banished") {
    // UNVERIFIED reading: a face-down card can't be played from there.
    if (
      s.faceDown.includes(uid) ||
      !(card.playableFromBanish || s.playableThisTurn.includes(uid))
    )
      throw new RulesError(
        `${card.name} can't be played from the banished zone.`,
      );
  } else if (from !== "hand" && from !== "arsenal")
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
  // Attacks wait in the arena; auras stay there until destroyed; other actions resolve.
  const stays = attack || card.traits.includes("aura");
  const moved = moveCard(
    {
      ...paid,
      playableThisTurn: paid.playableThisTurn.filter((u) => u !== uid),
    },
    uid,
    stays ? "arena" : "graveyard",
  );
  const played = withEvents(
    moved,
    ...(from === "banished"
      ? [{ type: "playedFromBanish" as const, uid }]
      : []),
    { type: "played", uid, cost },
    ...(attack ? [{ type: "attackPlayed" as const, uid }] : []),
  );
  const resolved = resolveTriggers(
    runEffects(played, card.effects, choose, new Map([["self", [uid]]])),
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

const isActionCard = (type: string | undefined) =>
  type === "action" || type === "attack_action";

/**
 * Gate to i'Arathael: "Instant – {r}, destroy this: You may play target action card with blood
 * debt from your banished zone this turn."
 */
export function activateGate(
  s: RulesState,
  target: string,
  choose: Choose = noChoices,
): RulesState {
  if ((s.tokens.gate ?? 0) < 1)
    throw new RulesError("No Gate to i'Arathael to activate.");
  const { card } = instance(s, target);
  if (
    zoneOf(s, target) !== "banished" ||
    !isActionCard(card.type) ||
    !card.traits.includes("blood_debt")
  )
    throw new RulesError(
      `${card.name} isn't an action card with blood debt in your banished zone.`,
    );
  if (s.resources < 1)
    throw new RulesError(
      `Activating a Gate costs 1 resource; ${s.resources} available.`,
    );
  const paid = removeTokens({ ...s, resources: s.resources - 1 }, "gate", 1);
  const activated = withEvents(
    {
      ...paid,
      activatedThisTurn: {
        ...paid.activatedThisTurn,
        gate: (paid.activatedThisTurn.gate ?? 0) + 1,
      },
      playableThisTurn: [...paid.playableThisTurn, target],
    },
    { type: "gateActivated", target },
  );
  return resolveTriggers(activated, s.events.length, choose);
}

/** A weapon's attack: an action, paid for, once a turn ({t}). Combat is out of scope. */
export function attackWithWeapon(
  s: RulesState,
  uid: string,
  choose: Choose = noChoices,
): RulesState {
  const { card } = instance(s, uid);
  if (zoneOf(s, uid) !== "weapons" || !card.weaponAttack)
    throw new RulesError(`${card.name} can't attack.`);
  if (s.phase !== "action")
    throw new RulesError("Weapons attack in the action phase.");
  if (s.usedThisTurn.includes(uid))
    throw new RulesError(`${card.name} has already attacked this turn.`);
  const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
  if (
    card.weaponAttack.needsPlayedFromBanish &&
    !s.events.slice(turnStart + 1).some((e) => e.type === "playedFromBanish")
  )
    throw new RulesError(
      `${card.name} needs a card played from a banished zone this turn.`,
    );
  if (s.actionPoints < 1) throw new RulesError("No action point left.");
  const cost = card.weaponAttack.cost;
  if (cost > s.resources)
    throw new RulesError(
      `${card.name} costs ${cost} to attack; ${s.resources} available.`,
    );
  const declared = withEvents(
    {
      ...s,
      resources: s.resources - cost,
      actionPoints: s.actionPoints - 1,
      usedThisTurn: [...s.usedThisTurn, uid],
    },
    { type: "attackPlayed", uid },
  );
  const resolved = resolveTriggers(declared, s.events.length, choose);
  return resolveTriggers(
    withEvents(resolved, { type: "attacking", uid }),
    resolved.events.length,
    choose,
  );
}
