// Card effects (docs/rules-engine.md, step 3): a small, typed set of operations stored as data,
// checked before any run, and executed in order. An operation can bind what it did (storeAs) for
// a later check; conditions read the state as it stands when they resolve; a choice the rules
// leave to the player is asked of the caller, from the legal options only.
import { z } from "zod";
import type { HeroSide } from "../game.ts";
import {
  createTokens,
  instance,
  moveCard,
  removeTokens,
  RulesError,
  withEvents,
  type RulesState,
} from "./state.ts";

export type Check =
  /** A card bound earlier has this trait (class, talent or fact, e.g. "shadow"). */
  | { has: string; target: string }
  | { createdThisTurn: string; atLeast: number }
  | { tokens: string; atLeast: number }
  | { side: HeroSide }
  | { all: Check[] }
  | { any: Check[] }
  | { not: Check };

export type Effect =
  | {
      op: "banish";
      from: "hand" | "deckTop" | "graveyard";
      amount: number;
      optional?: boolean;
      faceDown?: boolean;
      storeAs?: string;
    }
  | { op: "createToken"; token: string; amount: number }
  | { op: "removeToken"; token: string; amount: number }
  | { op: "gainResources"; amount: number }
  | { op: "gainActionPoint" }
  | { op: "if"; check: Check; then: Effect[]; else?: Effect[] };

const name = z.string().min(1).max(40);
const amount = z.number().int().min(1).max(20);
const checkSchema: z.ZodType<Check> = z.lazy(() =>
  z.union([
    z.strictObject({ has: name, target: name }),
    z.strictObject({
      createdThisTurn: name,
      atLeast: z.number().int().min(0),
    }),
    z.strictObject({ tokens: name, atLeast: z.number().int().min(0) }),
    z.strictObject({ side: z.enum(["forsaken", "usurper"]) }),
    z.strictObject({ all: z.array(checkSchema).min(1) }),
    z.strictObject({ any: z.array(checkSchema).min(1) }),
    z.strictObject({ not: checkSchema }),
  ]),
);
const effectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z.strictObject({
      op: z.literal("banish"),
      from: z.enum(["hand", "deckTop", "graveyard"]),
      amount,
      optional: z.boolean().optional(),
      faceDown: z.boolean().optional(),
      storeAs: name.optional(),
    }),
    z.strictObject({ op: z.literal("createToken"), token: name, amount }),
    z.strictObject({ op: z.literal("removeToken"), token: name, amount }),
    z.strictObject({ op: z.literal("gainResources"), amount }),
    z.strictObject({ op: z.literal("gainActionPoint") }),
    z.strictObject({
      op: z.literal("if"),
      check: checkSchema,
      then: z.array(effectSchema),
      else: z.array(effectSchema).optional(),
    }),
  ]),
);

function bindingsUsed(check: Check): string[] {
  if ("target" in check) return [check.target];
  if ("all" in check) return check.all.flatMap(bindingsUsed);
  if ("any" in check) return check.any.flatMap(bindingsUsed);
  if ("not" in check) return bindingsUsed(check.not);
  return [];
}

/** Every binding is set before it is read. A branch's bindings stay inside the branch. */
function checkBindings(effects: Effect[], bound: Set<string>) {
  const here = new Set(bound);
  for (const e of effects) {
    if (e.op === "if") {
      for (const b of bindingsUsed(e.check))
        if (!here.has(b))
          throw new RulesError(`Binding "${b}" is used before it is set.`);
      checkBindings(e.then, here);
      checkBindings(e.else ?? [], here);
    }
    if (e.op === "banish" && e.storeAs) here.add(e.storeAs);
  }
}

/** Effect data checked against the schema and its bindings, before any run. */
export function parseEffects(data: unknown): Effect[] {
  const parsed = z.array(effectSchema).safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new RulesError(
      `Invalid effect at ${issue.path.join(".") || "the top"}: ${issue.message}`,
    );
  }
  checkBindings(parsed.data, new Set());
  return parsed.data;
}

/** A choice the rules leave to the player. */
export interface ChoiceRequest {
  kind: "cards";
  /** Why, in plain words: "Banish a card from hand". */
  prompt: string;
  /** The legal options, as card ids. */
  options: string[];
  /** How many to choose. */
  count: number;
  /** Whether choosing none is allowed. */
  optional: boolean;
}
export type Choose = (request: ChoiceRequest) => string[];

/** For runs that should never need a choice. */
export const noChoices: Choose = (request) => {
  throw new RulesError(`A choice is needed: ${request.prompt}.`);
};

function checkChoice(request: ChoiceRequest, chosen: string[]) {
  const allowed = new Set(request.options);
  const fine =
    new Set(chosen).size === chosen.length &&
    chosen.every((uid) => allowed.has(uid)) &&
    (chosen.length === request.count ||
      (request.optional && chosen.length === 0));
  if (!fine)
    throw new RulesError(
      `Not a legal choice for "${request.prompt}": choose ${request.count} of the options.`,
    );
}

function holds(
  s: RulesState,
  check: Check,
  bindings: Map<string, string[]>,
): boolean {
  if ("has" in check)
    return (bindings.get(check.target) ?? []).some((uid) =>
      instance(s, uid).card.traits.includes(check.has),
    );
  if ("createdThisTurn" in check)
    return (s.createdThisTurn[check.createdThisTurn] ?? 0) >= check.atLeast;
  if ("tokens" in check) return (s.tokens[check.tokens] ?? 0) >= check.atLeast;
  if ("side" in check) return s.side === check.side;
  if ("all" in check) return check.all.every((c) => holds(s, c, bindings));
  if ("any" in check) return check.any.some((c) => holds(s, c, bindings));
  return !holds(s, check.not, bindings);
}

const BANISH_FROM = {
  hand: "Banish a card from hand",
  graveyard: "Banish a card from the graveyard",
} as const;

/** Runs effects in order. The state given is never changed. */
export function runEffects(
  state: RulesState,
  effects: Effect[],
  choose: Choose,
  bindings: Map<string, string[]> = new Map(),
): RulesState {
  let s = state;
  for (const e of effects) {
    switch (e.op) {
      case "banish": {
        let chosen: string[];
        if (e.from === "deckTop") {
          chosen = s.zones.deck.slice(0, e.amount).map((i) => i.uid);
        } else {
          const options = s.zones[e.from].map((i) => i.uid);
          const count = Math.min(e.amount, options.length);
          chosen = [];
          if (count > 0) {
            const request: ChoiceRequest = {
              kind: "cards",
              prompt: BANISH_FROM[e.from],
              options,
              count,
              optional: !!e.optional,
            };
            chosen = choose(request);
            checkChoice(request, chosen);
          }
        }
        for (const uid of chosen)
          s = moveCard(s, uid, "banished", { faceDown: e.faceDown });
        if (e.storeAs) bindings.set(e.storeAs, chosen);
        break;
      }
      case "createToken":
        s = createTokens(s, e.token, e.amount);
        break;
      case "removeToken":
        s = removeTokens(s, e.token, e.amount);
        break;
      case "gainResources":
        s = withEvents(
          { ...s, resources: s.resources + e.amount },
          { type: "resourcesGained", amount: e.amount },
        );
        break;
      case "gainActionPoint":
        s = withEvents(
          { ...s, actionPoints: s.actionPoints + 1 },
          { type: "actionPointGained" },
        );
        break;
      case "if":
        s = runEffects(
          s,
          holds(s, e.check, bindings) ? e.then : (e.else ?? []),
          choose,
          new Map(bindings),
        );
        break;
    }
  }
  return s;
}
