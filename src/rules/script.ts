// Scripts and the scripted policy (docs/rules-engine.md, step 6). A script is data: a few step
// kinds, a bounded repeat and an if on the state, never a language. The scripted policy only
// ever picks among cards the rules allow right now, by fixed rules, so the same setup and script
// always give the same trace.
//
// UNVERIFIED policy choices (not game rules, but they shape results): a play pays by pitching
// the highest pitch first; among cards that fit a step, the lowest pitch goes first, then hand,
// arsenal and banished-zone order; optional triggers are used unless the script says no.
import { z } from "zod";
import {
  checkSchema,
  EXPLICIT_CONDITIONS,
  ExplicitAnswerRequired,
  holds,
  validateBindings,
  type Check,
  type ChoiceRequest,
  type Choose,
  type ExplicitCondition,
} from "./effects.ts";
import {
  effectiveCost,
  activateGate,
  attackWithWeapon,
  endTurn,
  pitchCard,
  playCard,
} from "./play.ts";
import {
  RulesBudgetExceeded,
  RulesError,
  setUp,
  type RulesEvent,
  type RulesInstance,
  type RulesSetup,
  type RulesState,
} from "./state.ts";

export interface Selector {
  name?: string;
  type?: string;
  trait?: string;
  pitch?: number;
}

export type ScriptStep =
  | { do: "play"; card: Selector; from?: "hand" | "arsenal" | "banished" }
  | { do: "pitch"; card: Selector }
  | { do: "activateGate"; target: Selector }
  | { do: "attackWithWeapon"; weapon?: Selector }
  | { do: "endTurn"; arsenal?: Selector }
  | { do: "repeat"; times: number; steps: ScriptStep[] }
  | { do: "if"; check: Check; then: ScriptStep[]; else?: ScriptStep[] }
  | { do: "stop" };

export interface Script {
  version: 1;
  choices?: {
    /** When a card must be banished from hand: the first of these that fits, in order. */
    banish?: Selector[];
    neverBanish?: Selector[];
    keep?: Selector[];
    /** UNVERIFIED policy: explicit search preferences, otherwise lowest pitch first. */
    search?: Selector[];
    /** Optional triggers by id: false to decline. Unlisted ones are used. */
    optional?: Record<string, boolean>;
    /** UNVERIFIED policy: fixed payment or the maximum leaving the stated life; default zero. */
    lifePayment?:
      | number
      | {
          card: { name: string; pitch?: number };
          startingLife: number;
          minimumRemainingLife: number;
        };
    /** Explicit assumptions for this run, not a policy inferred from opponent state. */
    conditions?: Partial<Record<ExplicitCondition, boolean>>;
  };
  steps: ScriptStep[];
}

const text = z.string().min(1).max(60);
const selectorSchema = z.strictObject({
  name: text.optional(),
  type: text.optional(),
  trait: text.optional(),
  pitch: z.number().int().min(0).max(3).optional(),
});
const stepSchema: z.ZodType<ScriptStep> = z.lazy(() =>
  z.union([
    z.strictObject({
      do: z.literal("play"),
      card: selectorSchema,
      from: z.enum(["hand", "arsenal", "banished"]).optional(),
    }),
    z.strictObject({ do: z.literal("pitch"), card: selectorSchema }),
    z.strictObject({ do: z.literal("activateGate"), target: selectorSchema }),
    z.strictObject({
      do: z.literal("attackWithWeapon"),
      weapon: selectorSchema.optional(),
    }),
    z.strictObject({
      do: z.literal("endTurn"),
      arsenal: selectorSchema.optional(),
    }),
    z.strictObject({
      do: z.literal("repeat"),
      times: z.number().int().min(1).max(10),
      steps: z.array(stepSchema).max(50),
    }),
    z.strictObject({
      do: z.literal("if"),
      check: checkSchema,
      then: z.array(stepSchema).max(50),
      else: z.array(stepSchema).max(50).optional(),
    }),
    z.strictObject({ do: z.literal("stop") }),
  ]),
);
const scriptSchema = z.strictObject({
  version: z.literal(1),
  choices: z
    .strictObject({
      banish: z.array(selectorSchema).max(20).optional(),
      neverBanish: z.array(selectorSchema).max(20).optional(),
      keep: z.array(selectorSchema).max(20).optional(),
      search: z.array(selectorSchema).max(20).optional(),
      optional: z.record(text, z.boolean()).optional(),
      lifePayment: z
        .union([
          z.number().int().min(0).max(20),
          z.strictObject({
            card: z.strictObject({
              name: text,
              pitch: z.number().int().min(0).max(3).optional(),
            }),
            startingLife: z.number().int().positive(),
            minimumRemainingLife: z.number().int().positive(),
          }),
        ])
        .optional(),
      conditions: z
        .partialRecord(z.enum(EXPLICIT_CONDITIONS), z.boolean())
        .optional(),
    })
    .optional(),
  steps: z.array(stepSchema).max(200),
});

function checkStepBindings(steps: ScriptStep[]) {
  for (const step of steps) {
    if (step.do === "if") {
      // Scripts bind nothing: a check reads the state only.
      validateBindings(step.check, [], new Set());
      checkStepBindings(step.then);
      checkStepBindings(step.else ?? []);
    }
    if (step.do === "repeat") checkStepBindings(step.steps);
  }
}

/** Script data checked against the schema before any run. */
export function parseScript(data: unknown): Script {
  const parsed = scriptSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new RulesError(
      `Invalid script at ${issue.path.join(".") || "the top"}: ${issue.message}`,
    );
  }
  checkStepBindings(parsed.data.steps);
  return parsed.data;
}

const fits = (i: RulesInstance, sel: Selector) =>
  (sel.name === undefined || i.card.name === sel.name) &&
  (sel.type === undefined || i.card.type === sel.type) &&
  (sel.trait === undefined || i.card.traits.includes(sel.trait)) &&
  (sel.pitch === undefined || i.card.pitch === sel.pitch);

/** Cards in these zones that fit, lowest pitch first, then zone order and position. */
function candidates(
  s: RulesState,
  sel: Selector,
  zones: (keyof RulesState["zones"])[],
) {
  return zones
    .flatMap((z) => s.zones[z])
    .map((i, order) => ({ i, order }))
    .filter(({ i }) => fits(i, sel))
    .sort(
      (a, b) =>
        (a.i.card.pitch ?? Infinity) - (b.i.card.pitch ?? Infinity) ||
        a.order - b.order,
    )
    .map(({ i }) => i.uid);
}

/**
 * Opt in a scripted run (the maintainer, 20 Oct 2026): keep on top the card the next step can use
 * best, putting the cards above it on the bottom one at a time. Best first: a card of the pitch
 * the card wants (Pull from Beyond's Gate), then anything playable from banish, then Rune Gate and
 * Usurp cards, then Runeblade and Shadow; ties go to the card nearer the top.
 */
export function scriptedOpt(
  looking: {
    uid: string;
    card: {
      traits: string[];
      pitch?: number | null;
      playableFromBanish?: boolean;
      usurp?: boolean;
    };
  }[],
  prefer: { pitch?: number } = {},
): string[] {
  const score = ({ card }: (typeof looking)[number]) => {
    const has = (t: string) => card.traits.includes(t);
    const kind =
      card.playableFromBanish || has("playable_from_banish")
        ? 3
        : card.usurp || has("rune_gate") || has("usurp")
          ? 2
          : has("runeblade") || has("shadow")
            ? 1
            : 0;
    return (
      (prefer.pitch !== undefined && card.pitch === prefer.pitch ? 10 : 0) +
      kind
    );
  };
  let best = 0;
  looking.forEach((i, n) => {
    if (score(i) > score(looking[best]!)) best = n;
  });
  return best === 0 ? [] : [looking[0]!.uid];
}

/** The scripted policy's answers to the rules' choices. */
function scriptedChoices(script: Script, current: () => RulesState): Choose {
  return (request: ChoiceRequest) => {
    if (request.kind === "condition") {
      const answer =
        request.condition && script.choices?.conditions?.[request.condition];
      if (typeof answer !== "boolean")
        throw new ExplicitAnswerRequired(
          `An explicit answer is required for ${request.condition}.`,
        );
      return [answer ? "yes" : "no"];
    }
    if (request.kind === "number") {
      const policy = script.choices?.lifePayment;
      const context = request.paymentContext;
      let amount = typeof policy === "number" ? policy : 0;
      if (
        typeof policy === "object" &&
        context?.card &&
        context.card.name === policy.card.name &&
        (policy.card.pitch === undefined ||
          context.card.pitch === policy.card.pitch)
      ) {
        const affordable =
          policy.startingLife - context.lifeLost - policy.minimumRemainingLife;
        amount = Math.max(
          0,
          ...request.options.map(Number).filter((value) => value <= affordable),
        );
      }
      const answer = String(amount);
      if (!request.options.includes(answer))
        throw new RulesError(
          `Life payment ${answer} is not one of the offered choices.`,
        );
      return [answer];
    }
    if (request.kind === "confirm")
      return script.choices?.optional?.[request.source ?? ""] === false
        ? []
        : ["yes"];
    const s = current();
    if (request.prompt.startsWith("Opt"))
      return scriptedOpt(
        request.options.map((uid) => s.zones.deck.find((i) => i.uid === uid)!),
        request.prefer,
      );
    const options = request.options
      .map((uid) =>
        [...s.zones.hand, ...s.zones.graveyard, ...s.zones.deck].find(
          (i) => i.uid === uid,
        )!,
      )
      .filter(
        (instance) =>
          request.from !== "hand" ||
          !script.choices?.keep?.some((selector) => fits(instance, selector)),
      )
      .filter(
        (instance) =>
          request.from !== "hand" ||
          !request.prompt.startsWith("Banish") ||
          !script.choices?.neverBanish?.some((selector) =>
            fits(instance, selector),
          ),
      );
    const preferred = request.prompt.startsWith("Banish")
      ? (script.choices?.banish ?? [])
      : request.prompt.startsWith("Search")
        ? (script.choices?.search ?? [])
        : [];
    const ranked = [
      ...preferred.flatMap((sel) => options.filter((i) => fits(i, sel))),
      ...[...options].sort(
        (a, b) => (a.card.pitch ?? Infinity) - (b.card.pitch ?? Infinity),
      ),
    ];
    const chosen = [...new Set(ranked.map((i) => i.uid))].slice(
      0,
      request.count,
    );
    return request.optional && chosen.length < request.count ? [] : chosen;
  };
}

/** Pitch from hand, highest pitch first, until a card's cost is covered. */
function payFor(
  s: RulesState,
  uid: string,
  choose: Choose,
  keep: Selector[] = [],
): RulesState {
  let next = s;
  const pitchable = s.zones.hand
    .filter(
      (i) =>
        i.uid !== uid &&
        i.card.pitch !== null &&
        !keep.some((selector) => fits(i, selector)),
    )
    .map((i, order) => ({ i, order }))
    .sort((a, b) => b.i.card.pitch! - a.i.card.pitch! || a.order - b.order);
  for (const { i } of pitchable) {
    if (next.resources >= effectiveCost(next, uid)) break;
    next = pitchCard(next, i.uid, choose);
  }
  return next;
}

export interface StepOutcome {
  step: ScriptStep["do"];
  outcome: "done" | "skipped";
  /** Why a step was skipped. */
  reason?: string;
}

export interface ScriptRun {
  policyMatches?: Record<string, number>;
  state: RulesState;
  /** Every event, in order: the run's full trace. */
  trace: RulesEvent[];
  steps: StepOutcome[];
  /** Set when the run stopped early (the processing budget); its trace is kept. */
  failure?: string;
}

class Stop {}

/** Runs a script from a setup. The same setup and script always give the same run. */
export function runScript(setup: RulesSetup, script: Script): ScriptRun {
  return runScriptFromState(setUp(setup), script);
}

export function runScriptFromState(
  initial: RulesState,
  script: Script,
): ScriptRun {
  let state = initial;
  const steps: StepOutcome[] = [];
  const choose = scriptedChoices(script, () => state);
  const kept = (uid: string) =>
    state.zones.hand.some(
      (instance) =>
        instance.uid === uid &&
        script.choices?.keep?.some((selector) => fits(instance, selector)),
    );

  /** Tries each candidate in order; the first the rules allow is done. */
  function attempt(
    step: ScriptStep["do"],
    uids: string[],
    act: (s: RulesState, uid: string) => RulesState,
  ) {
    if (uids.length === 0) {
      steps.push({
        step,
        outcome: "skipped",
        reason: "No card fits the step.",
      });
      return;
    }
    let reason = "";
    for (const uid of uids) {
      try {
        state = act(state, uid);
        steps.push({ step, outcome: "done" });
        return;
      } catch (e) {
        if (e instanceof ExplicitAnswerRequired) throw e;
        if (!(e instanceof RulesError) || e instanceof RulesBudgetExceeded)
          throw e;
        reason = e.message;
      }
    }
    steps.push({ step, outcome: "skipped", reason });
  }

  function run(list: ScriptStep[]) {
    for (const step of list) {
      switch (step.do) {
        case "play":
          attempt(
            "play",
            candidates(
              state,
              step.card,
              step.from ? [step.from] : ["hand", "arsenal", "banished"],
            ).filter((uid) => !kept(uid)),
            (s, uid) =>
              playCard(
                payFor(s, uid, choose, script.choices?.keep),
                uid,
                choose,
              ),
          );
          break;
        case "pitch":
          attempt(
            "pitch",
            candidates(state, step.card, ["hand"]).filter((uid) => !kept(uid)),
            (s, uid) => pitchCard(s, uid, choose),
          );
          break;
        case "activateGate":
          attempt(
            "activateGate",
            candidates(state, step.target, ["banished"]).filter(
              (uid) => !state.faceDown.includes(uid),
            ),
            (s, uid) => activateGate(s, uid, choose),
          );
          break;
        case "attackWithWeapon":
          attempt(
            "attackWithWeapon",
            candidates(state, step.weapon ?? {}, ["weapons"]),
            (s, uid) => attackWithWeapon(s, uid, choose),
          );
          break;
        case "endTurn": {
          const arsenal = step.arsenal
            ? candidates(state, step.arsenal, ["hand"])[0]
            : undefined;
          state = endTurn(state, { arsenal }, choose);
          steps.push({ step: "endTurn", outcome: "done" });
          break;
        }
        case "repeat":
          for (let n = 0; n < step.times; n++) run(step.steps);
          break;
        case "if":
          run(
            holds(state, step.check, new Map()) ? step.then : (step.else ?? []),
          );
          break;
        case "stop":
          throw new Stop();
      }
    }
  }

  try {
    run(script.steps);
  } catch (e) {
    if (e instanceof RulesBudgetExceeded)
      return { state, trace: e.events, steps, failure: e.message };
    if (!(e instanceof Stop)) throw e;
  }
  return { state, trace: state.events, steps };
}
