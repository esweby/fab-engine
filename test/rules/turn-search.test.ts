// Turn search (docs/turn-search.md): every distinct legal line for one turn, for task 7 to score.
// UNVERIFIED: the search's own rules (pitching only to pay, which choices branch) are Claude's
// reading for the maintainer to check; card rules are the verified CARD_RULES.
import { describe, expect, it } from "vitest";
import {
  replayLine,
  searchTurn,
  type RulesState,
  type TurnLine,
} from "../../src/rules/index.ts";
import {
  BSL,
  EMBRACE,
  ENSHRINE,
  MURMURING,
  OTHERWORLDLY,
  start,
  uidOf,
} from "./turn-search-cards.ts";

const names = (s: RulesState, line: TurnLine) =>
  line.actions.map((a) => {
    const uid = "uid" in a ? a.uid : "target" in a ? a.target : undefined;
    const card = uid
      ? Object.values(s.zones)
          .flat()
          .find((i) => i.uid === uid)?.card.name
      : undefined;
    return card ? `${a.type} ${card}` : a.type;
  });

describe("searchTurn", () => {
  it("pitching blue Become the Shadow Lord and playing it are different lines", () => {
    const s = start({ hand: [BSL(), MURMURING(1)] });
    const { lines } = searchTurn(s);
    const pitched = lines.filter((l) =>
      l.actions.some(
        (a) =>
          a.type === "pitch" && a.uid === uidOf(s, "Become the Shadow Lord"),
      ),
    );
    const played = lines.filter((l) =>
      l.actions.some(
        (a) =>
          a.type === "play" && a.uid === uidOf(s, "Become the Shadow Lord"),
      ),
    );
    expect(pitched.length).toBeGreaterThan(0);
    expect(played.length).toBeGreaterThan(0);
    // Pitched to pay for Murmuring from hand: 4 power, no Runechant to usurp.
    expect(Math.max(...pitched.map((l) => l.threatened))).toBe(4);
    // Played, banishing Murmuring: a Runechant and a Gate, and Murmuring waits in banish.
    const banished = played.find(
      (l) => l.width === 1 && l.banishedPlayable === 1,
    );
    expect(banished).toMatchObject({ runechants: 1, threatened: 0 });
    expect(banished!.state.tokens.gate).toBe(1);
  });

  it("finds Murmuring banished from hand, then played from banish", () => {
    const s = start({ hand: [BSL(), MURMURING(3), ENSHRINE()] });
    const { lines } = searchTurn(s);
    const line = lines.find(
      (l) =>
        names(s, l).join(", ") ===
        "play Become the Shadow Lord, pitch Enshrine Sin, play Murmuring Gloomblade, endTurn",
    );
    expect(line).toBeDefined();
    // BSL's banish is answered with Murmuring.
    expect(line!.actions[0]).toMatchObject({
      answers: [[uidOf(s, "Murmuring Gloomblade")]],
    });
    // Usurped the Runechant BSL made (2 + 2); Murmuring's own Runechant is carried.
    expect(line).toMatchObject({ threatened: 4, runechants: 1, width: 2 });
  });

  it("finds a line that reaches 3 Runechants and traverses to the Usurper", () => {
    const s = start({
      hand: [OTHERWORLDLY(), EMBRACE(), MURMURING(1), MURMURING(1)],
      resources: 3,
    });
    const { lines } = searchTurn(s);
    const flipped = lines.filter((l) => l.flipped);
    expect(flipped.length).toBeGreaterThan(0);
    expect(flipped.every((l) => l.state.side === "usurper")).toBe(true);
    expect(lines.some((l) => !l.flipped)).toBe(true);
  });

  it("only pitches to pay a cost, and never past it", () => {
    const s = start({ hand: [BSL(), ENSHRINE(), MURMURING(1)] });
    const { lines } = searchTurn(s);
    const murmuring = uidOf(s, "Murmuring Gloomblade");
    for (const line of lines) {
      line.actions.forEach((action, i) => {
        if (action.type !== "pitch") return;
        // BSL and Enshrine cost 0, so a pitch only ever pays for Murmuring (2) or a Gate (1),
        // and one blue covers either.
        const next = line.actions.slice(i).find((a) => a.type !== "pitch")!;
        expect(
          (next.type === "play" && next.uid === murmuring) ||
            next.type === "activateGate",
        ).toBe(true);
      });
      expect(
        line.actions.filter((a) => a.type === "pitch").length,
      ).toBeLessThan(2);
    }
  });

  it("merges lines that reach the same state, so order alone isn't a new line", () => {
    const s = start({ hand: [ENSHRINE(), OTHERWORLDLY()], resources: 1 });
    const { lines, stats } = searchTurn(s);
    expect(stats.merged).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("offers each hand card, or none, for the arsenal", () => {
    const s = start({ hand: [BSL(), MURMURING(1)] });
    const { lines } = searchTurn(s);
    const ends = lines
      .filter((l) => l.actions.length === 1)
      .map((l) => l.actions[0]);
    expect(ends).toEqual([
      { type: "endTurn" },
      { type: "endTurn", arsenal: uidOf(s, "Become the Shadow Lord") },
      { type: "endTurn", arsenal: uidOf(s, "Murmuring Gloomblade") },
    ]);
  });

  it("every line replays to the same result, and the search is deterministic", () => {
    const s = start({ hand: [BSL(), MURMURING(1), ENSHRINE(), EMBRACE()] });
    const first = searchTurn(s);
    const second = searchTurn(s);
    expect(second.lines.map((l) => l.key)).toEqual(
      first.lines.map((l) => l.key),
    );
    for (const line of first.lines)
      expect(replayLine(s, line.actions).key).toBe(line.key);
  });

  it("stops at its limits and says so", () => {
    const s = start({ hand: [BSL(), MURMURING(1), ENSHRINE(), EMBRACE()] });
    const { lines, stats } = searchTurn(s, { limits: { maxLines: 5 } });
    expect(lines).toHaveLength(5);
    expect(stats.truncated).toBe("lines");
  });

  it("branches on traversing back to the Forsaken in the end phase", () => {
    const s = start({ hand: [BSL(), MURMURING(1)], side: "usurper" });
    const { lines } = searchTurn(s);
    // BSL banishing Murmuring makes a Gate, so the Usurper may traverse back.
    const gate = lines.filter((l) =>
      l.actions.some(
        (a) =>
          a.type === "play" && a.uid === uidOf(s, "Become the Shadow Lord"),
      ),
    );
    expect(gate.some((l) => l.back)).toBe(true);
    expect(gate.some((l) => !l.back)).toBe(true);
  });
});
