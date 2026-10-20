// Effects in plain words (docs/rules-engine.md, step 9): how a draft or a verified card's rules
// read, so a player can check them against the printed text.
import type { Check, Effect } from "./effects.ts";

const TOKENS: Record<string, [string, string]> = {
  runechant: ["Runechant", "Runechants"],
  gate: ["Gate", "Gates"],
  eloquence: ["Eloquence", "Eloquence"],
};
const TRAITS: Record<string, string> = {
  runeblade: "Runeblade",
  shadow: "Shadow",
  generic: "Generic",
  blood_debt: "blood debt",
  aura: "an aura",
};
const TYPES: Record<string, string> = {
  attack_action: "an attack action card",
  action: "a non-attack action card",
  instant: "an instant",
};

const tokens = (token: string, n: number) => {
  const [one, many] = TOKENS[token] ?? [token, token];
  return `${n} ${n === 1 ? one : many}`;
};

function check(c: Check): string {
  if ("has" in c) return `that card is ${TRAITS[c.has] ?? c.has}`;
  if ("createdThisTurn" in c)
    return `you've made ${tokens(c.createdThisTurn, c.atLeast)} or more this turn`;
  if ("activatedThisTurn" in c)
    return `you've activated ${tokens(c.activatedThisTurn, c.atLeast)} or more this turn`;
  if ("tokens" in c) return `you have ${tokens(c.tokens, c.atLeast)} or more`;
  if ("side" in c)
    return `Viserai is on ${c.side === "usurper" ? "Usurper" : "Forsaken"}`;
  if ("cardIs" in c) {
    const what = [
      c.cardIs.type ? (TYPES[c.cardIs.type] ?? c.cardIs.type) : "",
      c.cardIs.trait ? `with ${TRAITS[c.cardIs.trait] ?? c.cardIs.trait}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `it's ${what || "a card"}`;
  }
  if ("counters" in c) return `this has ${c.counters} or more counters`;
  if ("firstPlayedThisTurn" in c) return "it's the first such card this turn";
  if ("all" in c) return c.all.map(check).join(" and ");
  if ("any" in c) return c.any.map(check).join(" or ");
  return `not (${check(c.not)})`;
}

function phrase(e: Effect): string {
  switch (e.op) {
    case "banish": {
      const n = `${e.amount} card${e.amount === 1 ? "" : "s"}`;
      const from =
        e.from === "hand"
          ? "from your hand (the player chooses)"
          : e.from === "deckTop"
            ? "from the top of your deck"
            : "from your graveyard (the player chooses)";
      return `banish ${n} ${from}${e.faceDown ? " face down" : ""}${e.optional ? ", if they want" : ""}`;
    }
    case "createToken":
      return `create ${tokens(e.token, e.amount)}`;
    case "removeToken":
      return `destroy ${tokens(e.token, e.amount)}`;
    case "gainResources":
      return `gain ${e.amount} resource${e.amount === 1 ? "" : "s"}`;
    case "gainActionPoint":
      return "gain an action point (go again)";
    case "opt":
      return e.amount === 1
        ? "opt 1 (look at the top card of your deck and you may put it on the bottom)"
        : `opt ${e.amount} (look at the top ${e.amount} cards of your deck and put any on the bottom)`;
    case "traverse":
      return "traverse";
    case "destroyAllTokens":
      return `destroy every ${TOKENS[e.token]?.[0] ?? e.token}${e.arcaneEach ? `, dealing ${e.arcaneEach} arcane damage for each` : ""}`;
    case "loseLifePerBanished":
      return `lose 1 life for each face-up card with ${TRAITS[e.trait] ?? e.trait} in your banished zone`;
    case "addCounters":
      return `put ${e.amount} counter${e.amount === 1 ? "" : "s"} on this`;
    case "removeCounter":
      return "remove a counter from this";
    case "destroySelfIfNoCounters":
      return "destroy this if it has no counters";
    case "destroySelf":
      return "destroy this";
    case "if": {
      const then = e.then.map(phrase).join(", then ");
      const otherwise = e.else?.length
        ? `; otherwise ${e.else.map(phrase).join(", then ")}`
        : "";
      return `if ${check(e.check)}: ${then}${otherwise}`;
    }
  }
}

const sentence = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}.`;

/** One sentence per effect, in order. */
export function describeEffects(effects: Effect[]): string[] {
  return effects.map((e) => sentence(phrase(e)));
}

/** A trigger's condition in plain words, for "When …, if …:" lines. */
export function describeCheck(c: Check): string {
  return check(c);
}
