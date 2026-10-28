// Turn search (docs/turn-search.md): every distinct legal line for one turn, from the start of the
// action phase to the end of the turn, for a later step to score against objectives. Pure and
// deterministic: the same state gives the same lines in the same order. It lists lines; it
// doesn't choose one.
//
// UNVERIFIED, Claude's reading for the maintainer to check: cards are pitched only to pay a cost,
// one at a time until it's paid (so a set is legal when the last card was still needed); every
// choice a card asks for is a branch, except explicit conditions about the opponent, which are
// options; activated abilities that do nothing in the engine (prevention, combat) aren't tried.
import type { ExplicitCondition, ChoiceRequest } from "./effects.ts";
import { effectiveCost } from "./play.ts";
import {
  applySessionAction,
  NeedsChoice,
  type SessionAction,
} from "./session.ts";
import {
  isRunechantAura,
  RulesError,
  type RulesCard,
  type RulesEvent,
  type RulesInstance,
  type RulesState,
} from "./state.ts";

export interface TurnSearchLimits {
  /** Distinct mid-turn states expanded. */
  maxNodes: number;
  /** Distinct lines kept. */
  maxLines: number;
  /** Actions in a line before the end of the turn, pitches included. */
  maxDepth: number;
  /** Answer sets tried for one action's choices. */
  maxChoiceBranches: number;
}

export interface TurnSearchOptions {
  /**
   * Answers to explicit conditions. By default "a hero has lost life this turn" is yes only when
   * Viserai has, and "less life than an opposing hero" is no.
   */
  conditions?: Partial<Record<ExplicitCondition, boolean>>;
  limits?: Partial<TurnSearchLimits>;
}

/** One line: its actions (replayable with applySessionAction) and what it leaves. */
export interface TurnLine {
  actions: SessionAction[];
  /** Attack power + arcane + 2 per usurp, as the play pattern comparison counts it. */
  threatened: number;
  power: number;
  arcane: number;
  usurps: number;
  /** Runechant tokens at the end of the turn. */
  runechants: number;
  /** Runechant auras (sinchants) in the arena at the end of the turn. */
  sinchants: number;
  /** Face-up cards in banish that may be played from there. */
  banishedPlayable: number;
  /** Traversed to the Usurper this turn. */
  flipped: boolean;
  /** Traversed to the Forsaken this turn (the end-phase Gate traverse included). */
  back: boolean;
  /** Cards played: from hand, arsenal or banish (not weapons, abilities or Gates). */
  width: number;
  /** Hand cards held at the end of the turn, before the draw: blockers kept back. */
  held: number;
  /** Life lost this turn (blood debt, Descendancy). */
  lifeLost: number;
  /** After the end of the turn: the next turn's action phase, its hand drawn. */
  state: RulesState;
  /** Equal for lines with the same result: same metrics, same state up to copies of a card. */
  key: string;
}

export interface TurnSearch {
  lines: TurnLine[];
  stats: {
    /** Distinct mid-turn states expanded. */
    nodes: number;
    /** States reached again by another order, and not expanded twice. */
    merged: number;
    /** Lines that ended in a result already listed. */
    duplicateLines: number;
    /** Actions tried, legal or not. */
    attempts: number;
    illegal: number;
    /** The first limit hit; when set, the lines are not every line. */
    truncated?: "nodes" | "lines" | "depth" | "choices";
  };
}

const DEFAULT_LIMITS: TurnSearchLimits = {
  maxNodes: 20_000,
  maxLines: 20_000,
  maxDepth: 16,
  maxChoiceBranches: 256,
};

const PLAYABLE_TYPES = new Set(["action", "attack_action", "instant"]);
const NEEDS_ACTION_POINT = new Set(["action", "attack_action"]);

const cardKey = (card: RulesCard) => `${card.name}|${card.pitch ?? "-"}`;

const startOfTurn = (s: RulesState) =>
  s.events.findLastIndex((e) => e.type === "turnStarted");

/** An action and what it costs, before anything is pitched for it. */
interface Move {
  action: SessionAction;
  cost: number;
  /** The card itself, which can't be pitched to pay for it. */
  self?: string;
}

function moves(s: RulesState): Move[] {
  const result: Move[] = [];
  const seen = new Set<string>();
  const once = (key: string) => !seen.has(key) && !!seen.add(key);
  for (const zone of ["hand", "arsenal", "banished"] as const)
    for (const { uid, card } of s.zones[zone]) {
      if (
        card.effects === undefined ||
        !PLAYABLE_TYPES.has(card.type ?? "") ||
        s.faceDown.includes(uid) ||
        (NEEDS_ACTION_POINT.has(card.type ?? "") &&
          !card.instantWhen &&
          s.actionPoints < 1) ||
        !once(`play ${zone} ${cardKey(card)}`)
      )
        continue;
      result.push({
        action: { type: "play", uid },
        cost: effectiveCost(s, uid),
        self: uid,
      });
    }
  if ((s.tokens.gate ?? 0) > 0)
    for (const { uid, card } of s.zones.banished)
      if (
        !s.faceDown.includes(uid) &&
        card.effects !== undefined &&
        NEEDS_ACTION_POINT.has(card.type ?? "") &&
        card.traits.includes("blood_debt") &&
        !s.playableThisTurn.includes(uid) &&
        once(`gate ${cardKey(card)}`)
      )
        result.push({ action: { type: "activateGate", target: uid }, cost: 1 });
  if (s.actionPoints > 0)
    for (const { uid, card } of s.zones.weapons)
      if (card.weaponAttack && !s.usedThisTurn.includes(uid))
        result.push({
          action: { type: "weaponAttack", uid },
          cost: card.weaponAttack.cost,
        });
  for (const zone of ["hand", "arena", "equipment", "weapons"] as const)
    for (const { uid, card } of s.zones[zone])
      if (
        card.activate?.effects.length &&
        (card.activate.speed === "instant" || s.actionPoints > 0) &&
        once(`activate ${zone} ${cardKey(card)}`)
      )
        result.push({
          action: { type: "activate", uid },
          cost: card.activate.cost,
          self: uid,
        });
  return result;
}

/**
 * The sets of hand cards that may be pitched to pay `deficit`: enough in total, and each card
 * still needed when it was pitched (the largest goes last). Copies of a card count once. Each
 * set is in the order it's pitched.
 */
function payments(s: RulesState, deficit: number, self?: string): string[][] {
  if (deficit <= 0) return [[]];
  const groups = new Map<string, RulesInstance[]>();
  for (const i of s.zones.hand)
    if (i.uid !== self && i.card.pitch !== null && i.card.pitch > 0)
      groups.set(cardKey(i.card), [...(groups.get(cardKey(i.card)) ?? []), i]);
  const ordered = [...groups.values()].sort(
    (a, b) =>
      a[0]!.card.pitch! - b[0]!.card.pitch! ||
      cardKey(a[0]!.card).localeCompare(cardKey(b[0]!.card)),
  );
  const result: string[][] = [];
  const walk = (g: number, chosen: RulesInstance[], sum: number) => {
    if (sum >= deficit) {
      const last = Math.max(...chosen.map((i) => i.card.pitch!));
      if (sum - last < deficit) result.push(chosen.map((i) => i.uid));
      return;
    }
    if (g === ordered.length) return;
    const group = ordered[g]!;
    for (let n = 0; n <= group.length; n++)
      walk(
        g + 1,
        [...chosen, ...group.slice(0, n)],
        sum + n * group[0]!.card.pitch!,
      );
  };
  walk(0, [], 0);
  // Pitched lowest first, so the card that pays the last of the cost goes last.
  return result.map((uids) =>
    [...uids].sort(
      (a, b) =>
        s.zones.hand.find((i) => i.uid === a)!.card.pitch! -
        s.zones.hand.find((i) => i.uid === b)!.card.pitch!,
    ),
  );
}

function* combinations<T>(items: T[], count: number): Generator<T[]> {
  if (count === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - count; i++)
    for (const rest of combinations(items.slice(i + 1), count - 1))
      yield [items[i]!, ...rest];
}

function lostLifeThisTurn(s: RulesState): boolean {
  return s.events
    .slice(startOfTurn(s) + 1)
    .some((e) => e.type === "lifeLost" && e.amount > 0);
}

/** Every answer worth trying to a choice: copies of a card are one answer. */
function answersTo(
  request: ChoiceRequest,
  s: RulesState,
  cards: Map<string, RulesCard>,
  options: TurnSearchOptions,
): string[][] {
  switch (request.kind) {
    case "condition": {
      const condition = request.condition!;
      const yes =
        options.conditions?.[condition] ??
        (condition === "hero_lost_life_this_turn"
          ? lostLifeThisTurn(s)
          : false);
      return [[yes ? "yes" : "no"]];
    }
    case "confirm":
      return [[], ["yes"]];
    case "number":
      return request.options.map((o) => [o]);
    case "cards": {
      const seen = new Set<string>();
      const distinct = request.options.filter((uid) => {
        const card = cards.get(uid);
        const key = card ? cardKey(card) : uid;
        return !seen.has(key) && !!seen.add(key);
      });
      const count = Math.min(request.count, distinct.length);
      return [
        ...(request.optional || count === 0 ? [[]] : []),
        ...(count > 0 ? combinations(distinct, count) : []),
      ];
    }
  }
}

/** A state up to copies of a card, plus what this turn's conditions read from its events. */
function stateKey(s: RulesState, cards: Map<string, RulesCard>): string {
  const k = (uid: string) => {
    const card = cards.get(uid);
    return card ? cardKey(card) : uid;
  };
  const sorted = (uids: string[]) => uids.map(k).sort();
  const entries = (r: Record<string, number>) =>
    Object.entries(r)
      .filter(([, n]) => n !== 0)
      .sort(([a], [b]) => a.localeCompare(b));
  const zones = Object.fromEntries(
    Object.entries(s.zones).map(([zone, list]) => [
      zone,
      zone === "deck"
        ? list.map((i) => k(i.uid))
        : sorted(list.map((i) => i.uid)),
    ]),
  );
  const turn = s.events.slice(startOfTurn(s) + 1);
  const firstBloodDebtAttack = turn.find(
    (e) =>
      e.type === "played" &&
      cards.get(e.uid)?.type === "attack_action" &&
      cards.get(e.uid)?.traits.includes("blood_debt"),
  );
  const latestAttack = turn.findLast(
    (e) => e.type === "attackPlayed" || e.type === "attackNoted",
  );
  const arena = new Set(s.zones.arena.map((i) => i.uid));
  return JSON.stringify({
    phase: s.phase,
    turn: s.turn,
    side: s.side,
    zones,
    faceDown: sorted(s.faceDown),
    tokens: entries(s.tokens),
    created: entries(s.createdThisTurn),
    activated: entries(s.activatedThisTurn),
    counters: Object.entries(s.counters)
      .filter(([, n]) => n !== 0)
      .map(([uid, n]) => `${k(uid)}:${n}`)
      .sort(),
    playable: sorted(s.playableThisTurn),
    auraPlays: s.runechantAuraPlaysThisTurn ?? 0,
    used: s.usedThisTurn
      .map((u) =>
        u
          .split(":")
          .map((part) => (cards.has(part) ? k(part) : part))
          .join(":"),
      )
      .sort(),
    resources: s.resources,
    actionPoints: s.actionPoints,
    lifeLost: s.lifeLost,
    usurped: turn.some((e) => e.type === "usurped"),
    fromBanish: turn.some((e) => e.type === "playedFromBanish"),
    damage: turn.reduce(
      (n, e) =>
        e.type === "arcaneDamage" || e.type === "damageNoted"
          ? n + e.amount
          : n,
      0,
    ),
    lostLife: lostLifeThisTurn(s),
    firstBloodDebtAttack:
      firstBloodDebtAttack && "uid" in firstBloodDebtAttack
        ? k(firstBloodDebtAttack.uid)
        : null,
    latestAttack:
      latestAttack && "uid" in latestAttack ? k(latestAttack.uid) : null,
    triggered: [
      ...new Set(
        turn.flatMap((e) => (e.type === "triggered" ? [e.trigger] : [])),
      ),
    ].sort(),
    goAgain: sorted(
      turn.flatMap((e) =>
        e.type === "goAgainGranted" && arena.has(e.uid) ? [e.uid] : [],
      ),
    ),
  });
}

interface Metrics {
  threatened: number;
  power: number;
  arcane: number;
  usurps: number;
  flipped: boolean;
  back: boolean;
  width: number;
  lifeLost: number;
}

function metrics(events: RulesEvent[], cards: Map<string, RulesCard>): Metrics {
  const m: Metrics = {
    threatened: 0,
    power: 0,
    arcane: 0,
    usurps: 0,
    flipped: false,
    back: false,
    width: 0,
    lifeLost: 0,
  };
  for (const e of events) {
    if (e.type === "attackPlayed") m.power += cards.get(e.uid)?.power ?? 0;
    if (e.type === "usurped") m.usurps++;
    if (e.type === "arcaneDamage") m.arcane += e.amount;
    if (e.type === "played") m.width++;
    if (e.type === "lifeLost") m.lifeLost += e.amount;
    if (e.type === "traversed") {
      if (e.to === "usurper") m.flipped = true;
      else m.back = true;
    }
  }
  m.threatened = m.power + m.arcane + 2 * m.usurps;
  return m;
}

const cardsOf = (s: RulesState) =>
  new Map(
    Object.values(s.zones)
      .flat()
      .map((i) => [i.uid, i.card]),
  );

/**
 * A line's result: `final` is the state after its endTurn. What the turn leaves is read as it
 * stood when the turn ended, before the next turn's draw and start-of-turn triggers.
 */
function summarise(
  start: RulesState,
  final: RulesState,
  actions: SessionAction[],
  cards: Map<string, RulesCard>,
): TurnLine {
  const events = final.events.slice(start.events.length);
  const ended = events.findIndex((e) => e.type === "turnEnded");
  if (ended < 0) throw new RulesError("A line must end the turn.");
  const after = events.slice(ended + 1);
  let runechants = final.tokens.runechant ?? 0;
  const banishedAfter = new Set<string>();
  const leftArena = new Set<string>();
  const enteredArena = new Set<string>();
  const leftHand = new Set<string>();
  const enteredHand = new Set<string>();
  for (const e of after) {
    if (e.type === "drew") for (const uid of e.uids) enteredHand.add(uid);
    if (e.type === "tokensCreated" && e.token === "runechant")
      runechants -= e.amount;
    if (e.type === "tokensRemoved" && e.token === "runechant")
      runechants += e.amount;
    if (e.type === "moved") {
      if (e.to === "banished") banishedAfter.add(e.uid);
      if (e.from === "arena") leftArena.add(e.uid);
      if (e.to === "arena") enteredArena.add(e.uid);
      if (e.from === "hand") leftHand.add(e.uid);
      if (e.to === "hand") enteredHand.add(e.uid);
    }
  }
  const arenaAtEnd = [
    ...final.zones.arena.map((i) => i.uid).filter((u) => !enteredArena.has(u)),
    ...leftArena,
  ];
  const held =
    final.zones.hand.filter((i) => !enteredHand.has(i.uid)).length +
    [...leftHand].filter((uid) => !enteredHand.has(uid)).length;
  const m = metrics(events.slice(0, ended), cards);
  const banishedPlayable = final.zones.banished.filter(
    (i) =>
      !banishedAfter.has(i.uid) &&
      !final.faceDown.includes(i.uid) &&
      !!i.card.playableFromBanish,
  ).length;
  const sinchants = arenaAtEnd.filter((u) => {
    const card = cards.get(u);
    return !!card && isRunechantAura(card);
  }).length;
  const result = { ...m, runechants, sinchants, banishedPlayable, held };
  return {
    actions,
    ...result,
    state: final,
    key: `${JSON.stringify(result)}|${stateKey(final, cards)}`,
  };
}

/** A line's result, from its actions; the last one ends the turn. */
export function replayLine(
  start: RulesState,
  actions: SessionAction[],
): TurnLine {
  const final = actions.reduce(
    (s, action) => applySessionAction(s, action),
    start,
  );
  return summarise(start, final, actions, cardsOf(start));
}

/**
 * Every distinct legal line for the turn, from a state in the action phase: plays from hand,
 * arsenal and banish, pitches to pay, Gates, weapon attacks, abilities that do something, every
 * choice they ask for, and the end of the turn with each arsenal choice and optional trigger.
 * Ending the turn is a line at every point, so holding cards is always one.
 */
export function searchTurn(
  start: RulesState,
  options: TurnSearchOptions = {},
): TurnSearch {
  if (start.phase !== "action")
    throw new RulesError("A turn search starts in the action phase.");
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const cards = cardsOf(start);
  const stats: TurnSearch["stats"] = {
    nodes: 0,
    merged: 0,
    duplicateLines: 0,
    attempts: 0,
    illegal: 0,
  };
  const lines: TurnLine[] = [];
  const lineKeys = new Set<string>();
  const visited = new Set<string>();
  const stop = (reason: NonNullable<TurnSearch["stats"]["truncated"]>) => {
    stats.truncated ??= reason;
  };
  const stopped = () =>
    stats.truncated === "lines" || stats.truncated === "nodes";

  /** The action with each set of answers its choices may take, and where each leads. */
  function* resolved(
    s: RulesState,
    action: SessionAction,
  ): Generator<{ state: RulesState; action: SessionAction }> {
    const pending: string[][][] = [[]];
    let tried = 0;
    while (pending.length > 0) {
      if (++tried > limits.maxChoiceBranches) {
        stop("choices");
        return;
      }
      const answers = pending.shift()!;
      const move = answers.length > 0 ? { ...action, answers } : action;
      stats.attempts++;
      try {
        yield { state: applySessionAction(s, move), action: move };
      } catch (e) {
        if (e instanceof NeedsChoice)
          for (const answer of answersTo(e.request, s, cards, options))
            pending.push([...answers, answer]);
        else if (e instanceof RulesError) stats.illegal++;
        else throw e;
      }
    }
  }

  function endings(s: RulesState, path: SessionAction[]) {
    const arsenal =
      s.zones.arsenal.length > 0
        ? []
        : [
            ...new Map(
              s.zones.hand.map((i) => [cardKey(i.card), i.uid] as const),
            ).values(),
          ];
    for (const choice of [undefined, ...arsenal]) {
      const end: SessionAction =
        choice === undefined
          ? { type: "endTurn" }
          : { type: "endTurn", arsenal: choice };
      for (const { state, action } of resolved(s, end)) {
        const line = summarise(start, state, [...path, action], cards);
        if (lineKeys.has(line.key)) {
          stats.duplicateLines++;
          continue;
        }
        if (lines.length >= limits.maxLines) {
          stop("lines");
          return;
        }
        lineKeys.add(line.key);
        lines.push(line);
      }
    }
  }

  function expand(s: RulesState, path: SessionAction[]) {
    if (stopped()) return;
    const key = stateKey(s, cards);
    if (visited.has(key)) {
      stats.merged++;
      return;
    }
    if (stats.nodes >= limits.maxNodes) {
      stop("nodes");
      return;
    }
    visited.add(key);
    stats.nodes++;
    endings(s, path);
    const next = moves(s);
    if (next.length === 0) return;
    for (const move of next) {
      for (const pitches of payments(s, move.cost - s.resources, move.self)) {
        if (path.length + pitches.length + 1 > limits.maxDepth) {
          stop("depth");
          continue;
        }
        let paid = s;
        const pitched: SessionAction[] = [];
        try {
          for (const uid of pitches) {
            const pitch: SessionAction = { type: "pitch", uid };
            paid = applySessionAction(paid, pitch);
            pitched.push(pitch);
          }
        } catch (e) {
          // A pitch that asks for a choice or breaks a rule isn't searched.
          if (!(e instanceof RulesError || e instanceof NeedsChoice)) throw e;
          stats.illegal++;
          continue;
        }
        for (const { state, action } of resolved(paid, move.action)) {
          expand(state, [...path, ...pitched, action]);
          if (stopped()) return;
        }
      }
    }
  }

  expand(start, []);
  return { lines, stats };
}
