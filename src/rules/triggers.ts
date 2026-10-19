// Events and triggers (docs/rules-engine.md, step 4). A trigger is data: the event it waits for,
// an optional condition checked when it would trigger, and effects. After each action, new
// events are matched against the triggers in play, and pending triggers resolve one at a time
// in a loop; their own events are matched in turn, so cascades need no recursion.
//
// The queue resolves first in, first out. That is an implementation detail, not a claim about
// Flesh and Blood's ordering: when a verified card needs a different order, it is added here.
import { z } from "zod";
import { ZONES, type Zone } from "../game.ts";
import {
  checkSchema,
  effectSchema,
  holds,
  runEffects,
  validateBindings,
  type Check,
  type ChoiceRequest,
  type Choose,
  type Effect,
} from "./effects.ts";
import {
  RulesBudgetExceeded,
  RulesError,
  withEvents,
  type RulesEvent,
  type RulesState,
} from "./state.ts";

export interface EventMatcher {
  event: RulesEvent["type"];
  /** For token events. */
  token?: string;
  /** For moves. */
  from?: Zone;
  to?: Zone;
  /** On a card's own trigger: only events about that card ("when this attacks"). */
  self?: boolean;
}

export interface Trigger {
  /** Names the trigger in the trace, e.g. "viserai-forsaken". */
  id: string;
  on: EventMatcher;
  /** Checked when the event happens; the event's card is bound as "event". */
  condition?: Check;
  /** "You may": the player is asked first. */
  optional?: boolean;
  /** "Once per turn": fires at most once a turn (per card, for a card's own trigger). */
  oncePerTurn?: boolean;
  effects: Effect[];
}

const EVENT_TYPES = [
  "drew",
  "moved",
  "pitched",
  "played",
  "attackPlayed",
  "tokensCreated",
  "tokensRemoved",
  "resourcesGained",
  "actionPointGained",
  "triggered",
  "turnEnded",
  "turnStarted",
  "traversed",
  "usurped",
  "attacking",
  "arcaneDamage",
  "lifeLost",
  "endPhaseStarted",
  "playedFromBanish",
  "gateActivated",
  "countersChanged",
] as const satisfies readonly RulesEvent["type"][];

const zone = z.enum(ZONES);
const triggerSchema = z.strictObject({
  id: z.string().min(1).max(60),
  on: z.strictObject({
    event: z.enum(EVENT_TYPES),
    token: z.string().min(1).optional(),
    from: zone.optional(),
    to: zone.optional(),
    self: z.boolean().optional(),
  }),
  condition: checkSchema.optional(),
  optional: z.boolean().optional(),
  oncePerTurn: z.boolean().optional(),
  effects: z.array(effectSchema),
});

/** Trigger data checked against the schema and its bindings ("event" is always bound). */
export function parseTriggers(data: unknown): Trigger[] {
  const parsed = z.array(triggerSchema).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new RulesError(
      `Invalid trigger at ${issue.path.join(".") || "the top"}: ${issue.message}`,
    );
  }
  for (const t of parsed.data)
    validateBindings(t.condition, t.effects, new Set(["event", "self"]));
  return parsed.data;
}

function matches(
  on: EventMatcher,
  e: RulesEvent,
  self: string | undefined,
): boolean {
  if (on.event !== e.type) return false;
  if (on.self && (!("uid" in e) || e.uid !== self)) return false;
  if (on.token !== undefined && (!("token" in e) || e.token !== on.token))
    return false;
  if (on.from !== undefined && (!("from" in e) || e.from !== on.from))
    return false;
  if (on.to !== undefined && (!("to" in e) || e.to !== on.to)) return false;
  return true;
}

const bindingsFor = (e: RulesEvent, self: string | undefined) =>
  new Map([
    ["event", "uid" in e ? [e.uid] : []],
    ["self", self ? [self] : []],
  ]);

/** The triggers in play: the game's own (hero, tokens, rules) and those of cards in the arena. */
function triggersInPlay(s: RulesState) {
  return [
    ...s.triggers.map((trigger) => ({ trigger, self: undefined })),
    ...s.zones.arena.flatMap((i) =>
      (i.card.triggers ?? []).map((trigger) => ({ trigger, self: i.uid })),
    ),
  ];
}

/**
 * Resolves every trigger set off by events from `since` onwards, and by their own events, until
 * none are pending. Throws RulesBudgetExceeded, with the trace, past the state's budget.
 */
export function resolveTriggers(
  state: RulesState,
  since: number,
  choose: Choose,
): RulesState {
  let s = state;
  let cursor = since;
  let resolved = 0;
  const pending: {
    trigger: Trigger;
    event: RulesEvent;
    self: string | undefined;
    tokens: Record<string, number>;
  }[] = [];
  const onceKey = (t: Trigger, self: string | undefined) =>
    `${t.id}:${self ?? ""}`;
  for (;;) {
    for (; cursor < s.events.length; cursor++) {
      const event = s.events[cursor]!;
      for (const { trigger, self } of triggersInPlay(s))
        if (
          matches(trigger.on, event, self) &&
          !(
            trigger.oncePerTurn &&
            s.usedThisTurn.includes(onceKey(trigger, self))
          ) &&
          (!trigger.condition ||
            holds(s, trigger.condition, bindingsFor(event, self)))
        )
          pending.push({ trigger, event, self, tokens: { ...s.tokens } });
    }
    const next = pending.shift();
    if (!next) return s;
    if (++resolved > s.budget)
      throw new RulesBudgetExceeded(
        `More than ${s.budget} triggers resolved in one action; the run stops here.`,
        s.events,
      );
    const { trigger, event, self, tokens } = next;
    if (trigger.oncePerTurn) {
      if (s.usedThisTurn.includes(onceKey(trigger, self))) continue;
      s = { ...s, usedThisTurn: [...s.usedThisTurn, onceKey(trigger, self)] };
    }
    if (trigger.optional) {
      const request: ChoiceRequest = {
        kind: "confirm",
        prompt: `Use ${trigger.id}?`,
        options: ["yes"],
        count: 1,
        optional: true,
      };
      const answer = choose(request);
      if (answer.length > 1 || (answer.length === 1 && answer[0] !== "yes"))
        throw new RulesError(`Not a legal answer to "${request.prompt}".`);
      if (answer.length === 0) continue;
    }
    s = runEffects(
      withEvents(s, { type: "triggered", trigger: trigger.id }),
      trigger.effects,
      choose,
      bindingsFor(event, self),
      tokens,
    );
  }
}
