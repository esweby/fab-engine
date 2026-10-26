import { describe, expect, it } from "vitest";
import {
  cardWithRules,
  parseScript,
  runScript,
  type RulesCard,
} from "../../src/rules/index.ts";
const card = (name: string, overrides: Partial<RulesCard> = {}): RulesCard =>
  cardWithRules({
    id: name,
    name,
    pitch: 3,
    cost: 0,
    type: "action",
    goAgain: false,
    roles: [],
    traits: [],
    amounts: {},
    ...overrides,
  });
const shard = () =>
  card("Arknight Shard", {
    type: "resource",
    cost: null,
    traits: ["runeblade"],
  });
const bsl = () =>
  card("Become the Shadow Lord", {
    goAgain: true,
    traits: ["shadow", "runeblade"],
  });
const shadow = () =>
  card("Demonbound Gloomblade", {
    type: "attack_action",
    traits: ["shadow", "runeblade", "blood_debt"],
  });
const choices = {
  neverBanish: [{ name: "Arknight Shard" }],
  banish: [{ name: "Arknight Shard" }],
};
const step = { do: "play" as const, card: { name: "Become the Shadow Lord" } };
const setup = (deck: RulesCard[]) => ({
  deck,
  order: "asGiven" as const,
  seed: 17,
});
describe("hand-banish exclusions", () => {
  it("declines an optional multi-card banish when protection leaves too few choices", () => {
    const effect = card("Optional fixture", {
      effects: [
        { op: "banish", from: "hand", amount: 2, optional: true },
        { op: "createToken", token: "runechant", amount: 1 },
      ],
    });
    const result = runScript(setup([effect, shard(), shadow()]), {
      version: 1,
      choices,
      steps: [{ do: "play", card: { name: "Optional fixture" } }],
    });
    expect(result.steps[0]?.outcome).toBe("done");
    expect(result.state.zones.banished).toHaveLength(0);
    expect(
      result.state.zones.hand.map((instance) => instance.card.name),
    ).toEqual(["Arknight Shard", "Demonbound Gloomblade"]);
    expect(result.state.tokens.runechant).toBe(1);
  });

  it("does not partially fulfil a mandatory multi-card banish", () => {
    const effect = card("Mandatory fixture", {
      effects: [{ op: "banish", from: "hand", amount: 2 }],
    });
    const result = runScript(setup([effect, shard(), shadow()]), {
      version: 1,
      choices,
      steps: [{ do: "play", card: { name: "Mandatory fixture" } }],
    });
    expect(result.steps[0]?.outcome).toBe("skipped");
    expect(result.state.zones.banished).toHaveLength(0);
    expect(result.state.zones.hand).toHaveLength(3);
  });
  it("excludes Shard even from explicit banish preferences", () => {
    const result = runScript(setup([shard(), bsl(), shadow()]), {
      version: 1,
      choices,
      steps: [step],
    });
    expect(
      result.state.zones.banished.map((instance) => instance.card.name),
    ).toEqual(["Demonbound Gloomblade"]);
    expect(
      result.state.zones.hand.some(
        (instance) => instance.card.name === "Arknight Shard",
      ),
    ).toBe(true);
  });
  it("skips a mandatory hand-banish play rather than choosing only protected Shard", () => {
    const result = runScript(setup([shard(), bsl()]), {
      version: 1,
      choices,
      steps: [step],
    });
    expect(result.steps[0]?.outcome).toBe("skipped");
    expect(
      result.state.zones.hand.map((instance) => instance.card.name),
    ).toEqual(["Arknight Shard", "Become the Shadow Lord"]);
    expect(result.state.zones.banished).toHaveLength(0);
  });
  it("still permits explicit and automatic Shard pitching", () => {
    const expensive = card("Expensive", { cost: 3, effects: [] });
    const explicit = runScript(setup([shard()]), {
      version: 1,
      choices,
      steps: [{ do: "pitch", card: { name: "Arknight Shard" } }],
    });
    expect(explicit.state.zones.pitch).toHaveLength(1);
    const automatic = runScript(setup([shard(), expensive]), {
      version: 1,
      choices,
      steps: [{ do: "play", card: { name: "Expensive" } }],
    });
    expect(automatic.steps[0]?.outcome).toBe("done");
    expect(automatic.state.zones.pitch[0]?.card.name).toBe("Arknight Shard");
  });
  it("does not prevent rules-required deck-top banishment", () => {
    const effect = card("Fixture", {
      effects: [{ op: "banish", from: "deckTop", amount: 1 }],
    });
    const result = runScript(
      { ...setup([effect, shard()]), intellect: 1 },
      {
        version: 1,
        choices,
        steps: [{ do: "play", card: { name: "Fixture" } }],
      },
    );
    expect(result.state.zones.banished[0]?.card.name).toBe("Arknight Shard");
  });
  it("keeps the existing generic script unchanged when no exclusion is supplied", () => {
    const result = runScript(setup([shard(), bsl(), shadow()]), {
      version: 1,
      steps: [step],
    });
    expect(result.state.zones.banished[0]?.card.name).toBe("Arknight Shard");
  });
  it("records exclusions in parsed script data", () => {
    const result = parseScript({ version: 1, choices, steps: [step] });
    expect(result.choices).toHaveProperty("neverBanish", choices.neverBanish);
  });
});
