// Step 5a (docs/rules-engine.md): Viserai, the Runechant token, Usurp, Blood Debt and the first
// real cards, from their printed text (supplied by the maintainer, 19 Oct 2026; Gate to
// i'Arathael from Fabrary; Blood Debt from LSS's "Rules Reprise: Usurp the Shadow Throne").
//
// Each test's expected outcome is read from that text and AWAITS THE MAINTAINER'S SIGN-OFF.
// Two readings are ours, flagged where used:
// - Usurper go again counts blood debt attacks played earlier that turn, on either side.
// - "When this attacks" comes after the Runechants are destroyed for playing the attack.
import { describe, expect, it } from "vitest";
import {
  BLOOD_DEBT,
  cardWithRules,
  endTurn,
  pitchCard,
  playCard,
  RUNECHANT,
  setUp,
  VISERAI,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";

// Card facts as printed (cost, pitch, type, classes and talents); effects from verified data.
const fact = (name: string, over: Partial<RulesCard>): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 1,
    cost: 0,
    goAgain: false,
    type: "action",
    roles: [],
    traits: [],
    amounts: {},
    ...over,
  });
const BSL = () =>
  fact("Become the Shadow Lord", {
    pitch: 3,
    goAgain: true,
    traits: ["runeblade", "shadow"],
  });
const MURMURING = () =>
  fact("Murmuring Gloomblade", {
    type: "attack_action",
    cost: 2,
    pitch: 1,
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const CULLINGSONG = () =>
  fact("Cullingsong Gloomblade", {
    type: "attack_action",
    traits: ["runeblade", "shadow", "blood_debt"],
  });
const MALEFIC = () =>
  fact("Malefic Incantation", { goAgain: true, traits: ["runeblade"] });
const GENERIC = (name = "Generic card") =>
  fact(name, { pitch: 3, traits: ["generic"] });
/** A made-up card for counting: one effect creating several Runechants. */
const MAKES = (n: number) =>
  fact(`Makes ${n}`, {
    effects: [{ op: "createToken", token: "runechant", amount: n }],
  });

const RULES = [...VISERAI, RUNECHANT, BLOOD_DEBT];
/** The hand is exactly these cards; the deck below them is generic cards. */
function game(
  hand: RulesCard[],
  over: Partial<Parameters<typeof setUp>[0]> = {},
) {
  return setUp({
    deck: [
      ...hand,
      ...Array.from({ length: 4 - hand.length }, (_, i) =>
        GENERIC(`Spare ${i}`),
      ),
      ...Array.from({ length: 20 }, (_, i) => GENERIC(`Deck ${i}`)),
    ],
    seed: 1,
    order: "asGiven",
    triggers: RULES,
    ...over,
  });
}
const uid = (s: RulesState, name: string) =>
  s.zones.hand.find((i) => i.card.name === name)!.uid;
const names = (s: RulesState, zone: keyof RulesState["zones"]) =>
  s.zones[zone].map((i) => i.card.name);
const pick = (s: RulesState, name: string) => () => [uid(s, name)];

describe("Become the Shadow Lord", () => {
  it("banishing a Shadow Runeblade card makes a Runechant and a Gate; Viserai banishes the top card", () => {
    const s = game([BSL(), MURMURING()]);
    const next = playCard(
      s,
      uid(s, "Become the Shadow Lord"),
      pick(s, "Murmuring Gloomblade"),
    );
    expect(next.tokens).toEqual({ runechant: 1, gate: 1 });
    expect(names(next, "banished")).toEqual(["Murmuring Gloomblade", "Deck 0"]);
    expect(names(next, "graveyard")).toEqual(["Become the Shadow Lord"]);
    // Go again: the action point comes back.
    expect(next.actionPoints).toBe(1);
  });

  it("banishing a Runeblade card with no Shadow makes a Runechant and no Gate", () => {
    const s = game([BSL(), MALEFIC()]);
    const next = playCard(
      s,
      uid(s, "Become the Shadow Lord"),
      pick(s, "Malefic Incantation"),
    );
    expect(next.tokens).toEqual({ runechant: 1 });
    expect(names(next, "banished")).toEqual(["Malefic Incantation", "Deck 0"]);
  });

  it("banishing anything else makes nothing, so Viserai doesn't trigger", () => {
    const s = game([BSL(), GENERIC()]);
    const next = playCard(
      s,
      uid(s, "Become the Shadow Lord"),
      pick(s, "Generic card"),
    );
    expect(next.tokens).toEqual({});
    expect(names(next, "banished")).toEqual(["Generic card"]);
  });
});

describe("Viserai, the Forsaken", () => {
  it("cards making 1, 2 then 1 Runechant: banish, banish and traverse, then nothing on the Usurper", () => {
    let s = game([MAKES(1), MAKES(2), MAKES(1)]);
    const [a, b, c] = s.zones.hand.map((i) => i.uid);
    s = { ...s, actionPoints: 3 };
    s = playCard(s, a!);
    expect(s.side).toBe("forsaken");
    s = playCard(s, b!);
    expect(s.side).toBe("usurper");
    expect(s.events.map((e) => e.type)).toContain("traversed");
    s = playCard(s, c!);
    expect(names(s, "banished")).toEqual(["Deck 0", "Deck 1"]);
  });

  it("banishes once for one effect that makes several Runechants", () => {
    const s = game([MAKES(3)]);
    const next = playCard(s, uid(s, "Makes 3"));
    expect(names(next, "banished")).toEqual(["Deck 0"]);
    expect(next.side).toBe("usurper");
  });
});

describe("Runechants and Usurp", () => {
  it("Cullingsong usurps one Runechant; playing the attack destroys the rest for 1 arcane each", () => {
    const s = { ...game([CULLINGSONG()]), tokens: { runechant: 3 } };
    const next = playCard(s, uid(s, "Cullingsong Gloomblade"));
    expect(next.tokens.runechant).toBe(0);
    expect(next.events).toEqual(
      expect.arrayContaining([
        { type: "usurped", uid: uid(s, "Cullingsong Gloomblade") },
        { type: "arcaneDamage", amount: 2 },
      ]),
    );
  });

  it("with no Runechants, Cullingsong is played without usurping", () => {
    const s = game([CULLINGSONG()]);
    const next = playCard(s, uid(s, "Cullingsong Gloomblade"));
    expect(next.events.map((e) => e.type)).not.toContain("usurped");
    expect(names(next, "arena")).toEqual(["Cullingsong Gloomblade"]);
  });

  it("Murmuring's Runechant, made as it attacks, survives the destruction and sets off Viserai (our reading)", () => {
    let s: RulesState = {
      ...game([MURMURING(), GENERIC("Blue")]),
      tokens: { runechant: 1 },
    };
    s = pitchCard(s, uid(s, "Blue"));
    const next = playCard(s, uid(s, "Murmuring Gloomblade"));
    expect(next.tokens.runechant).toBe(1);
    expect(names(next, "banished")).toEqual(["Deck 0"]);
    const types = next.events.map((e) => e.type);
    expect(types.indexOf("usurped")).toBeLessThan(types.indexOf("attacking"));
  });
});

describe("Viserai, the Usurper", () => {
  it("gives the first blood debt attack each turn go again, and not the second (our reading)", () => {
    let s = game([CULLINGSONG(), CULLINGSONG(), GENERIC()], {
      side: "usurper",
    });
    const [first, second] = s.zones.hand.map((i) => i.uid);
    s = playCard(s, first!);
    expect(s.actionPoints).toBe(1);
    s = playCard(s, second!);
    expect(s.actionPoints).toBe(0);
  });

  it("may traverse at the start of the end phase after making a Gate this turn", () => {
    let s = game([BSL(), MURMURING()], { side: "usurper" });
    s = playCard(
      s,
      uid(s, "Become the Shadow Lord"),
      pick(s, "Murmuring Gloomblade"),
    );
    const asked: string[] = [];
    const next = endTurn(s, {}, (request) => {
      asked.push(request.prompt);
      return ["yes"];
    });
    expect(asked).toEqual(["Use viserai-usurper-traverse?"]);
    expect(next.side).toBe("forsaken");
  });

  it("isn't asked to traverse without a Gate this turn", () => {
    const s = game([GENERIC()], { side: "usurper" });
    expect(endTurn(s).side).toBe("usurper");
  });
});

describe("Blood Debt", () => {
  it("loses 1 life at the start of the end phase per face-up blood debt card in the banished zone", () => {
    let s = game([MURMURING(), CULLINGSONG(), CULLINGSONG()]);
    const [m, c1, c2] = s.zones.hand.map((i) => i.uid);
    s = {
      ...s,
      zones: { ...s.zones, hand: [], banished: s.zones.hand.slice(0, 3) },
      faceDown: [c2!],
    };
    void m;
    void c1;
    const next = endTurn(s);
    expect(next.lifeLost).toBe(2);
    expect(next.events).toContainEqual({ type: "lifeLost", amount: 2 });
  });
});
