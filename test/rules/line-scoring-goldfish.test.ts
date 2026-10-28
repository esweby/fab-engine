// The maintainer's goldfish game (28 Oct 2026) against the line chooser with the default settings
// (docs/turn-objectives.md, "The goldfish game against the chooser"). Turns 3 and 4 pick the
// maintainer's line. Turns 1 and 2 don't, and the differences are pinned here, not tuned away.
// UNVERIFIED: the weights are Claude's draft.
import { describe, expect, it } from "vitest";
import {
  chooseLine,
  replayLine,
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

const played = (s: RulesState, actions: SessionAction[]) =>
  actions.flatMap((a) =>
    a.type === "play" || a.type === "weaponAttack"
      ? [
          Object.values(s.zones)
            .flat()
            .find((i) => i.uid === a.uid)!.card.name,
        ]
      : [],
  );

describe("the maintainer's goldfish game against the line chooser", () => {
  it("turn 1: flips and comes back with Greed played, where the maintainer set up", () => {
    const s = start({
      hand: [MURMURING(3), SHADOW_OF_URSUR(), GREED(), BSL()],
      weapons: [NEBULA()],
    });
    const chosen = chooseLine(s);
    // The maintainer: BSL, Murmuring from banish, Greed to the arsenal (4).
    expect(played(s, chosen.actions)).toEqual([
      "Runechant of Greed",
      "Become the Shadow Lord",
      "Murmuring Gloomblade",
      "Seven Sin Nebula",
    ]);
    expect(chosen).toMatchObject({
      threatened: 9,
      flipped: true,
      back: true,
      runechants: 0,
    });
  });

  it("turn 2: bursts and flips with Greed from the arsenal, where the maintainer held it", () => {
    const s = start({
      hand: [DESCENDANCY(), DEMONBOUND(), ENSHRINE(), MURMURING(3)],
      deck: [EMBRACE()],
      arsenal: [GREED()],
      weapons: [NEBULA()],
      tokens: { runechant: 1 },
    });
    const chosen = chooseLine(s);
    // The maintainer: Enshrine, Murmuring paid with Demonbound and Descendancy (5), Greed held.
    expect(played(s, chosen.actions)).toEqual([
      "Enshrine Sin",
      "Runechant of Greed",
      "Murmuring Gloomblade",
      "Demonbound Gloomblade",
    ]);
    expect(chosen).toMatchObject({ threatened: 11, flipped: true, width: 4 });
  });

  it("turn 3: the maintainer's line", () => {
    const s = start({
      hand: [MURMURING(1), EMBRACE(), CULLINGSONG(), OTHERWORLDLY()],
      arsenal: [GREED()],
      weapons: [NEBULA()],
      tokens: { runechant: 1 },
      // Fyendal's Spring Tunic isn't modelled: its 1 resource is given by hand.
      resources: 1,
    });
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    const theirs = replayLine(s, [
      { type: "play", uid: uidOf(s, "Embrace Ursur"), answers: [[murmuring]] },
      { type: "play", uid: uidOf(s, "Runechant of Greed") },
      { type: "pitch", uid: uidOf(s, "Cullingsong Gloomblade") },
      { type: "pitch", uid: uidOf(s, "Otherworldly Sins") },
      { type: "play", uid: murmuring },
      { type: "endTurn" },
    ]);
    expect(chooseLine(s).key).toBe(theirs.key);
  });

  it("turn 4: the maintainer's line", () => {
    const s = start({
      hand: [SHADOW_OF_URSUR(), BSL(), MURMURING(1), EMBRACE()],
      weapons: [NEBULA()],
      tokens: { runechant: 2 },
      side: "usurper",
    });
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    const theirs = replayLine(s, [
      { type: "pitch", uid: uidOf(s, "Shadow of Ursur") },
      { type: "play", uid: uidOf(s, "Embrace Ursur"), answers: [[murmuring]] },
      { type: "play", uid: murmuring },
      { type: "pitch", uid: uidOf(s, "Become the Shadow Lord") },
      { type: "weaponAttack", uid: uidOf(s, "Seven Sin Nebula") },
      { type: "endTurn" },
    ]);
    expect(chooseLine(s).key).toBe(theirs.key);
  });
});
