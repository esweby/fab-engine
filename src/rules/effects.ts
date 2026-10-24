// Card effects (docs/rules-engine.md, step 3): a small, typed set of operations stored as data,
// checked before any run, and executed in order. An operation can bind what it did (storeAs) for
// a later check; conditions read the state as it stands when they resolve; a choice the rules
// leave to the player is asked of the caller, from the legal options only.
import { z } from "zod";
import type { HeroSide } from "../game.ts";
import {
  createTokens,
  instance,
  isRunechantAura,
  moveCard,
  removeTokens,
  RulesError,
  withEvents,
  shuffleDeck,
  type RulesState,
} from "./state.ts";

export type Check =
  /** A card bound earlier has this trait (class, talent or fact, e.g. "shadow"). */
  | { has: string; target: string }
  | { createdThisTurn: string; atLeast: number }
  | { activatedThisTurn: string; atLeast: number }
  | { damageDealtThisTurn: number }
  | { latestAttack: string }
  | { playedFromBanish: string }
  /** The bound card is of this type and/or has this trait. */
  | { cardIs: { type?: string; trait?: string }; target: string }
  /** The bound card has at least this many counters. */
  | { counters: number; target: string }
  /** The bound card is the first card played this turn matching the filter. */
  | {
      firstPlayedThisTurn: { type?: string; trait?: string };
      target: string;
    }
  /**
   * The first card played this turn matching the filter is still in the arena (an attack still
   * attacking), without go again of its own.
   */
  | { firstPlayedThisTurnInArena: { type?: string; trait?: string } }
  /** A trigger with this id has fired this turn. */
  | { triggeredThisTurn: string }
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
  | { op: "allowRunechantAuraPlay" }
  | { op: "searchRunechantAura" }
  | { op: "payLifeForToken"; token: string; maximum: number }
  | { op: "removeToken"; token: string; amount: number }
  | { op: "gainResources"; amount: number }
  | { op: "gainActionPoint" }
  | { op: "grantGoAgain"; target: string }
  | {
      op: "grantGoAgain";
      firstPlayedThisTurn: { type?: string; trait?: string };
    }
  /**
   * Opt: look at the top cards of the deck and put any of them on the bottom. keepPitch: the
   * pitch the card's next step wants on top (Pull from Beyond's Gate).
   */
  | { op: "opt"; amount: number; keepPitch?: number }
  /** Viserai: turn the hero card to its other side. */
  | { op: "traverse" }
  /** Destroy every token of a kind, dealing arcane damage for each (the Runechant rule). */
  | { op: "destroyAllTokens"; token: string; arcaneEach: number }
  /** Lose 1 life for each face-up card with the trait in the banished zone (Blood Debt). */
  | { op: "loseLifePerBanished"; trait: string }
  /** Counters on this card ("self"). */
  | { op: "addCounters"; amount: number }
  | { op: "removeCounter" }
  /** "When it has none, destroy it": this card to the graveyard once it has no counters. */
  | { op: "destroySelfIfNoCounters" }
  /** This card ("self") from the arena to the graveyard (a sinchant destroying itself). */
  | { op: "destroySelf" }
  | { op: "if"; check: Check; then: Effect[]; else?: Effect[] };

const name = z.string().min(1).max(40);
const amount = z.number().int().min(1).max(20);
export const checkSchema: z.ZodType<Check> = z.lazy(() =>
  z.union([
    z.strictObject({ has: name, target: name }),
    z.strictObject({
      createdThisTurn: name,
      atLeast: z.number().int().min(0),
    }),
    z.strictObject({ tokens: name, atLeast: z.number().int().min(0) }),
    z.strictObject({ damageDealtThisTurn: z.number().int().min(1) }),
    z.strictObject({ latestAttack: name }),
    z.strictObject({ playedFromBanish: name }),
    z.strictObject({
      activatedThisTurn: name,
      atLeast: z.number().int().min(0),
    }),
    z.strictObject({
      cardIs: z.strictObject({
        type: name.optional(),
        trait: name.optional(),
      }),
      target: name,
    }),
    z.strictObject({ counters: z.number().int().min(0), target: name }),
    z.strictObject({
      firstPlayedThisTurn: z.strictObject({
        type: name.optional(),
        trait: name.optional(),
      }),
      target: name,
    }),
    z.strictObject({
      firstPlayedThisTurnInArena: z.strictObject({
        type: name.optional(),
        trait: name.optional(),
      }),
    }),
    z.strictObject({ triggeredThisTurn: name }),
    z.strictObject({ side: z.enum(["forsaken", "usurper"]) }),
    z.strictObject({ all: z.array(checkSchema).min(1) }),
    z.strictObject({ any: z.array(checkSchema).min(1) }),
    z.strictObject({ not: checkSchema }),
  ]),
);
export const effectSchema: z.ZodType<Effect> = z.lazy(() =>
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
    z.strictObject({ op: z.literal("allowRunechantAuraPlay") }),
    z.strictObject({ op: z.literal("searchRunechantAura") }),
    z.strictObject({
      op: z.literal("payLifeForToken"),
      token: name,
      maximum: amount,
    }),
    z.strictObject({ op: z.literal("removeToken"), token: name, amount }),
    z.strictObject({ op: z.literal("gainResources"), amount }),
    z.strictObject({ op: z.literal("gainActionPoint") }),
    z.strictObject({ op: z.literal("grantGoAgain"), target: name }),
    z.strictObject({
      op: z.literal("grantGoAgain"),
      firstPlayedThisTurn: z.strictObject({
        type: name.optional(),
        trait: name.optional(),
      }),
    }),
    z.strictObject({
      op: z.literal("opt"),
      amount,
      keepPitch: z.number().int().min(1).max(3).optional(),
    }),
    z.strictObject({ op: z.literal("traverse") }),
    z.strictObject({
      op: z.literal("destroyAllTokens"),
      token: name,
      arcaneEach: z.number().int().min(0).max(10),
    }),
    z.strictObject({ op: z.literal("loseLifePerBanished"), trait: name }),
    z.strictObject({ op: z.literal("addCounters"), amount }),
    z.strictObject({ op: z.literal("removeCounter") }),
    z.strictObject({ op: z.literal("destroySelfIfNoCounters") }),
    z.strictObject({ op: z.literal("destroySelf") }),
    z.strictObject({
      op: z.literal("if"),
      check: checkSchema,
      then: z.array(effectSchema),
      else: z.array(effectSchema).optional(),
    }),
  ]),
);

function bindingsUsed(check: Check): string[] {
  if ("playedFromBanish" in check) return [check.playedFromBanish];
  if ("latestAttack" in check) return [check.latestAttack];
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
    if (e.op === "grantGoAgain" && "target" in e && !here.has(e.target))
      throw new RulesError(`Binding "${e.target}" is used before it is set.`);
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

/** A condition and effects whose bindings must all be set, given the ones bound already. */
export function validateBindings(
  condition: Check | undefined,
  effects: Effect[],
  bound: Set<string>,
) {
  for (const b of condition ? bindingsUsed(condition) : [])
    if (!bound.has(b))
      throw new RulesError(`Binding "${b}" is used before it is set.`);
  checkBindings(effects, bound);
}

/** A choice the rules leave to the player. */
export interface ChoiceRequest {
  /** cards: pick ids; confirm: choose "yes" or nothing; number: choose an offered amount. */
  kind: "cards" | "confirm" | "number";
  /** Why, in plain words: "Banish a card from hand". */
  prompt: string;
  /** The offered card ids, confirmation or amounts as strings. */
  options: string[];
  /** How many to choose. */
  count: number;
  /** Whether choosing none is allowed. */
  optional: boolean;
  /** The trigger asking, for a confirm (e.g. "viserai-usurper-traverse"). */
  source?: string;
  /** What the card would rather have, for a policy that can't ask (Opt: a pitch on top). */
  prefer?: { pitch?: number };
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

export function holds(
  s: RulesState,
  check: Check,
  bindings: Map<string, string[]>,
): boolean {
  if ("playedFromBanish" in check) {
    const target = bindings.get(check.playedFromBanish)?.[0];
    const played = s.events.findLastIndex(
      (event) => event.type === "played" && event.uid === target,
    );
    const previous = s.events[played - 1];
    return (
      !!target &&
      previous?.type === "playedFromBanish" &&
      previous.uid === target
    );
  }
  if ("damageDealtThisTurn" in check) {
    const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
    const damage = s.events
      .slice(turnStart + 1)
      .reduce(
        (total, event) =>
          event.type === "damageNoted" || event.type === "arcaneDamage"
            ? total + event.amount
            : total,
        0,
      );
    return damage >= check.damageDealtThisTurn;
  }
  if ("latestAttack" in check) {
    const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
    const latest = s.events
      .slice(turnStart + 1)
      .findLast(
        (event) =>
          event.type === "attackPlayed" || event.type === "attackNoted",
      );
    return (
      !!latest &&
      "uid" in latest &&
      (bindings.get(check.latestAttack) ?? []).includes(latest.uid)
    );
  }
  if ("has" in check)
    return (bindings.get(check.target) ?? []).some((uid) =>
      instance(s, uid).card.traits.includes(check.has),
    );
  if ("createdThisTurn" in check)
    return (s.createdThisTurn[check.createdThisTurn] ?? 0) >= check.atLeast;
  if ("tokens" in check) return (s.tokens[check.tokens] ?? 0) >= check.atLeast;
  if ("activatedThisTurn" in check)
    return (s.activatedThisTurn[check.activatedThisTurn] ?? 0) >= check.atLeast;
  if ("cardIs" in check) {
    const target = (bindings.get(check.target) ?? [])[0];
    if (!target) return false;
    const c = instance(s, target).card;
    return (
      (check.cardIs.type === undefined || c.type === check.cardIs.type) &&
      (check.cardIs.trait === undefined ||
        c.traits.includes(check.cardIs.trait))
    );
  }
  if ("counters" in check) {
    const target = (bindings.get(check.target) ?? [])[0];
    return !!target && (s.counters[target] ?? 0) >= check.counters;
  }
  if ("firstPlayedThisTurn" in check) {
    const target = (bindings.get(check.target) ?? [])[0];
    const f = check.firstPlayedThisTurn;
    const fits = (uid: string) => {
      const c = instance(s, uid).card;
      return (
        (f.type === undefined || c.type === f.type) &&
        (f.trait === undefined || c.traits.includes(f.trait))
      );
    };
    const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
    const first = s.events
      .slice(turnStart + 1)
      .find((e) => e.type === "played" && fits(e.uid));
    return !!target && !!first && "uid" in first && first.uid === target;
  }
  if ("firstPlayedThisTurnInArena" in check) {
    const f = check.firstPlayedThisTurnInArena;
    const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
    const first = s.events.slice(turnStart + 1).find((e) => {
      if (e.type !== "played") return false;
      const c = instance(s, e.uid).card;
      return (
        (f.type === undefined || c.type === f.type) &&
        (f.trait === undefined || c.traits.includes(f.trait))
      );
    });
    if (!first || first.type !== "played") return false;
    const inArena = s.zones.arena.find((i) => i.uid === first.uid);
    return !!inArena && !hasGoAgain(s, inArena.uid);
  }
  if ("triggeredThisTurn" in check) {
    const turnStart = s.events.findLastIndex((e) => e.type === "turnStarted");
    return s.events
      .slice(turnStart + 1)
      .some(
        (e) => e.type === "triggered" && e.trigger === check.triggeredThisTurn,
      );
  }
  if ("side" in check) return s.side === check.side;
  if ("all" in check) return check.all.every((c) => holds(s, c, bindings));
  if ("any" in check) return check.any.some((c) => holds(s, c, bindings));
  return !holds(s, check.not, bindings);
}

const BANISH_FROM = {
  hand: "Banish a card from hand",
  graveyard: "Banish a card from the graveyard",
} as const;

function hasGoAgain(state: RulesState, uid: string): boolean {
  if (instance(state, uid).card.goAgain) return true;
  const played = state.events.findLastIndex(
    (event) => event.type === "played" && event.uid === uid,
  );
  return state.events
    .slice(played + 1)
    .some((event) => event.type === "goAgainGranted" && event.uid === uid);
}

/** Runs effects in order. The state given is never changed. */
export function runEffects(
  state: RulesState,
  effects: Effect[],
  choose: Choose,
  bindings: Map<string, string[]> = new Map(),
  /** Tokens in play when the triggering event happened ("destroy this" on each token). */
  tokensAtEvent?: Record<string, number>,
): RulesState {
  const self = () => {
    const uid = (bindings.get("self") ?? [])[0];
    if (!uid) throw new RulesError("This effect needs the card it's on.");
    return uid;
  };
  const changeCounters = (st: RulesState, uid: string, delta: number) =>
    withEvents(
      {
        ...st,
        counters: { ...st.counters, [uid]: (st.counters[uid] ?? 0) + delta },
      },
      { type: "countersChanged", uid, delta },
    );
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
      case "opt": {
        // One card at a time to the bottom; choosing none keeps the rest on top, in order.
        // UNVERIFIED: reordering the cards kept on top isn't modelled yet.
        let looking = s.zones.deck.slice(0, e.amount).map((i) => i.uid);
        while (looking.length > 0) {
          const request: ChoiceRequest = {
            kind: "cards",
            prompt: `Opt ${e.amount}: put a card on the bottom of your deck`,
            options: looking,
            count: 1,
            optional: true,
            ...(e.keepPitch ? { prefer: { pitch: e.keepPitch } } : {}),
          };
          const chosen = choose(request);
          checkChoice(request, chosen);
          if (chosen.length === 0) break;
          s = moveCard(s, chosen[0]!, "deck", { position: "bottom" });
          looking = looking.filter((uid) => uid !== chosen[0]);
        }
        break;
      }
      case "createToken":
        s = createTokens(s, e.token, e.amount);
        break;
      case "allowRunechantAuraPlay":
        // UNVERIFIED: Embrace Sin grants one aura play per copy, until turn end.
        s = {
          ...s,
          runechantAuraPlaysThisTurn: (s.runechantAuraPlaysThisTurn ?? 0) + 1,
        };
        break;
      case "searchRunechantAura": {
        // UNVERIFIED: Sinspeaker puts the chosen aura into the arena without playing it.
        const options = s.zones.deck
          .filter((instance) => isRunechantAura(instance.card))
          .map((instance) => instance.uid);
        const request: ChoiceRequest = {
          kind: "cards",
          prompt: "Search your deck for an aura with Runechant in its name",
          options,
          count: 1,
          optional: true,
        };
        const chosen = options.length > 0 ? choose(request) : [];
        checkChoice(request, chosen);
        if (chosen[0]) {
          const selected = instance(s, chosen[0]);
          if (selected.card.effects === undefined)
            throw new RulesError(
              `${selected.card.name} has no verified effects yet, so it can't be put into the arena.`,
            );
          s = moveCard(s, chosen[0], "arena");
        }
        s = shuffleDeck(s);
        break;
      }
      case "payLifeForToken": {
        const request: ChoiceRequest = {
          kind: "number",
          prompt: `Pay up to ${e.maximum} life to create that many ${e.token === "runechant" ? "Runechants" : e.token}`,
          options: Array.from({ length: e.maximum + 1 }, (_, amount) =>
            String(amount),
          ),
          count: 1,
          optional: false,
        };
        const chosen = choose(request);
        checkChoice(request, chosen);
        const paid = Number(chosen[0]);
        if (paid > 0) {
          s = withEvents(
            { ...s, lifeLost: s.lifeLost + paid },
            { type: "lifeLost", amount: paid },
          );
          s = createTokens(s, e.token, paid);
        }
        break;
      }
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
      case "grantGoAgain": {
        let target: string | undefined;
        if ("target" in e) target = bindings.get(e.target)?.[0];
        else {
          const turnStart = s.events.findLastIndex(
            (event) => event.type === "turnStarted",
          );
          const filter = e.firstPlayedThisTurn;
          const first = s.events.slice(turnStart + 1).find((event) => {
            if (event.type !== "played") return false;
            const card = instance(s, event.uid).card;
            return (
              (filter.type === undefined || card.type === filter.type) &&
              (filter.trait === undefined || card.traits.includes(filter.trait))
            );
          });
          if (first && first.type === "played") target = first.uid;
        }
        if (target && !hasGoAgain(s, target))
          s = withEvents(
            { ...s, actionPoints: s.actionPoints + 1 },
            { type: "goAgainGranted", uid: target },
            { type: "actionPointGained" },
          );
        break;
      }
      case "traverse": {
        const to = s.side === "forsaken" ? "usurper" : "forsaken";
        s = withEvents({ ...s, side: to }, { type: "traversed", to });
        break;
      }
      case "destroyAllTokens": {
        const now = s.tokens[e.token] ?? 0;
        const n = tokensAtEvent
          ? Math.min(now, tokensAtEvent[e.token] ?? 0)
          : now;
        if (n > 0) {
          s = removeTokens(s, e.token, n);
          if (e.arcaneEach > 0)
            s = withEvents(s, {
              type: "arcaneDamage",
              amount: n * e.arcaneEach,
            });
        }
        break;
      }
      case "loseLifePerBanished": {
        const n = s.zones.banished.filter(
          (i) => !s.faceDown.includes(i.uid) && i.card.traits.includes(e.trait),
        ).length;
        if (n > 0)
          s = withEvents(
            { ...s, lifeLost: s.lifeLost + n },
            { type: "lifeLost", amount: n },
          );
        break;
      }
      case "addCounters":
        s = changeCounters(s, self(), e.amount);
        break;
      case "removeCounter":
        if ((s.counters[self()] ?? 0) > 0) s = changeCounters(s, self(), -1);
        break;
      case "destroySelf": {
        const uid = self();
        if (s.zones.arena.some((i) => i.uid === uid))
          s = moveCard(s, uid, "graveyard");
        break;
      }
      case "destroySelfIfNoCounters": {
        const uid = self();
        if (
          (s.counters[uid] ?? 0) === 0 &&
          s.zones.arena.some((i) => i.uid === uid)
        )
          s = moveCard(s, uid, "graveyard");
        break;
      }
      case "if":
        s = runEffects(
          s,
          holds(s, e.check, bindings) ? e.then : (e.else ?? []),
          choose,
          new Map(bindings),
          tokensAtEvent,
        );
        break;
    }
  }
  return s;
}
