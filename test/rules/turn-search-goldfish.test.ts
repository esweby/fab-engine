// The maintainer's goldfish game (28 Oct 2026, going first, their 52-card list): each turn's start
// state as they told it, and their line as engine actions. The check is that the search finds the
// same result among its lines. Where the engine's verified rules give a different number from the
// maintainer's, the engine's is used and the gap is listed (docs/turn-search.md).
import { describe, expect, it } from "vitest";
import {
  replayLine,
  searchTurn,
  type RulesState,
  type SessionAction,
} from "../../src/rules/index.ts";
import {
  BSL,
  CULLINGSONG,
  DEMONBOUND,
  DESCENDANCY,
  EMBRACE,
  ENSHRINE,
  GREED,
  MURMURING,
  NEBULA,
  OTHERWORLDLY,
  SHADOW_OF_URSUR,
  start,
  uidOf,
} from "./turn-search-cards.ts";

function expectFound(s: RulesState, actions: SessionAction[]) {
  const theirs = replayLine(s, actions);
  const { lines, stats } = searchTurn(s);
  expect(stats.truncated).toBeUndefined();
  expect(lines.map((l) => l.key)).toContain(theirs.key);
  return theirs;
}

describe("the maintainer's goldfish game against the turn search", () => {
  it("turn 1: BSL banishing Murmuring, Murmuring from banish, Greed to arsenal", () => {
    const s = start({
      hand: [MURMURING(3), SHADOW_OF_URSUR(), GREED(), BSL()],
      weapons: [NEBULA()],
    });
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    const line = expectFound(s, [
      {
        type: "play",
        uid: uidOf(s, "Become the Shadow Lord"),
        answers: [[murmuring]],
      },
      { type: "pitch", uid: uidOf(s, "Shadow of Ursur") },
      { type: "play", uid: murmuring },
      { type: "endTurn", arsenal: uidOf(s, "Runechant of Greed") },
    ]);
    // The maintainer: 4 (1 arcane + 3). The engine: Murmuring usurps BSL's Runechant, 2 + 2.
    expect(line).toMatchObject({
      threatened: 4,
      arcane: 0,
      runechants: 1,
      width: 2,
    });
  });

  it("turn 2: Enshrine, then Murmuring paid with Demonbound and Descendancy", () => {
    const s = start({
      hand: [DESCENDANCY(), DEMONBOUND(), ENSHRINE(), MURMURING(3)],
      deck: [EMBRACE()],
      arsenal: [GREED()],
      weapons: [NEBULA()],
      tokens: { runechant: 1 },
    });
    const line = expectFound(s, [
      // Opt 1: Embrace Ursur to the bottom.
      {
        type: "play",
        uid: uidOf(s, "Enshrine Sin"),
        answers: [[uidOf(s, "Embrace Ursur")]],
      },
      { type: "pitch", uid: uidOf(s, "Demonbound Gloomblade") },
      { type: "pitch", uid: uidOf(s, "Arknight Descendancy") },
      { type: "play", uid: uidOf(s, "Murmuring Gloomblade") },
      { type: "endTurn" },
    ]);
    // The maintainer: 5 (2 arcane + 3). The engine: usurp 2 + 2 power + 1 arcane.
    expect(line).toMatchObject({ threatened: 5, arcane: 1, width: 2 });
  });

  it("turn 3: Embrace banishing Murmuring, Greed, Murmuring from banish, traverse", () => {
    const s = start({
      hand: [MURMURING(1), EMBRACE(), CULLINGSONG(), OTHERWORLDLY()],
      arsenal: [GREED()],
      weapons: [NEBULA()],
      tokens: { runechant: 1 },
      // Fyendal's Spring Tunic isn't modelled: its 1 resource is given by hand.
      resources: 1,
    });
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    const line = expectFound(s, [
      // With the Tunic's resource already in the pool, Embrace is paid from it and both reds
      // pay for Murmuring: the same cards, pitched in a different order.
      { type: "play", uid: uidOf(s, "Embrace Ursur"), answers: [[murmuring]] },
      { type: "play", uid: uidOf(s, "Runechant of Greed") },
      { type: "pitch", uid: uidOf(s, "Cullingsong Gloomblade") },
      { type: "pitch", uid: uidOf(s, "Otherworldly Sins") },
      { type: "play", uid: murmuring },
      { type: "endTurn" },
    ]);
    // The maintainer: 11. The engine: Embrace 3 + 1 arcane, Murmuring 4 + 2 usurp. Greed's draw
    // ("counts as a Runechant", usurped) isn't modelled, so there's no Sloth to arsenal.
    expect(line).toMatchObject({
      threatened: 10,
      flipped: true,
      back: false,
      width: 3,
    });
  });

  it("turn 4: on the Usurper, Embrace, Murmuring from banish, the Nebula", () => {
    const s = start({
      hand: [SHADOW_OF_URSUR(), BSL(), MURMURING(1), EMBRACE()],
      weapons: [NEBULA()],
      tokens: { runechant: 2 },
      side: "usurper",
    });
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    const line = expectFound(s, [
      { type: "pitch", uid: uidOf(s, "Shadow of Ursur") },
      { type: "play", uid: uidOf(s, "Embrace Ursur"), answers: [[murmuring]] },
      { type: "play", uid: murmuring },
      { type: "pitch", uid: uidOf(s, "Become the Shadow Lord") },
      { type: "weaponAttack", uid: uidOf(s, "Seven Sin Nebula") },
      { type: "endTurn" },
    ]);
    // The maintainer: 16. The engine: Embrace 3 + 2 arcane, Murmuring 4 + 2 usurp, the Nebula
    // 3 + 1 arcane. Murmuring makes 1 Runechant as it attacks; its hit is out of scope.
    expect(line).toMatchObject({ threatened: 15, arcane: 3, width: 2 });
  });
});
