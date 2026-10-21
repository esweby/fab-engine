// Engine calibration (docs/engine-calibration.md): what a batch reports per turn for the
// comparison with real games. Threatened damage is a goldfish count, not combat: each attack
// played threatens its printed power, plus 2 when Usurp destroys a Runechant. Nothing is blocked.
import { describe, expect, it } from "vitest";
import {
  BLOOD_DEBT,
  parseScript,
  runBatch,
  RUNECHANT,
  VISERAI,
  type RulesCard,
} from "../../src/rules/index.ts";
import {
  compare,
  dist,
  firstTraverseOf,
  ksDistance,
  robustness,
  type ObservedGroup,
  type SimulatedDistributions,
  type Threshold,
} from "../../src/rules/calibration.ts";

const card = (name: string, over: Partial<RulesCard> = {}): RulesCard => ({
  id: name,
  name,
  pitch: 3,
  cost: 0,
  goAgain: true,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
  ...over,
});
const maker = (n: number) =>
  card(`Maker ${n}`, {
    effects: [{ op: "createToken", token: "runechant", amount: n }],
  });
const STRIKE = card("Strike", { type: "attack_action", power: 3, effects: [] });
const USURPER = card("Usurping Strike", {
  type: "attack_action",
  power: 4,
  usurp: true,
  effects: [],
});
const FILLER = card("Filler");
const RULES = [...VISERAI, RUNECHANT, BLOOD_DEBT];

const once = (deck: RulesCard[], steps: unknown[], weapons: RulesCard[] = []) =>
  runBatch(
    {
      deck: [...deck, ...Array<RulesCard>(40).fill(FILLER)],
      weapons,
      order: "asGiven",
      triggers: RULES,
    },
    parseScript({ version: 1, steps }),
    { runs: 1, seed: 1 },
  ).perRun[0]!;

describe("calibration facts per turn", () => {
  it("counts printed power as threatened damage and Runechants as arcane damage", () => {
    const run = once(
      [maker(3), STRIKE, STRIKE],
      [
        { do: "play", card: { name: "Maker 3" } },
        { do: "play", card: { name: "Strike" } },
        { do: "play", card: { name: "Strike" } },
        { do: "endTurn" },
        { do: "endTurn" },
      ],
    );
    expect(run.turns.map((t) => [t.threatened, t.arcane])).toEqual([
      [6, 3],
      [0, 0],
    ]);
  });

  it("adds 2 when Usurp destroys a Runechant", () => {
    const run = once(
      [maker(1), USURPER],
      [
        { do: "play", card: { name: "Maker 1" } },
        { do: "play", card: { name: "Usurping Strike" } },
        { do: "endTurn" },
      ],
    );
    expect(run.turns[0]!.threatened).toBe(6);
    expect(run.turns[0]!.arcane).toBe(0);
  });

  it("counts a weapon attack's power", () => {
    const sword = card("Sword", {
      type: "weapon",
      pitch: null,
      cost: null,
      goAgain: false,
      power: 2,
      weaponAttack: { cost: 0 },
    });
    const run = once(
      [FILLER],
      [{ do: "attackWithWeapon" }, { do: "endTurn" }],
      [sword],
    );
    expect(run.turns[0]!.threatened).toBe(2);
  });

  it("records the turn of the first traverse to the Usurper", () => {
    const traverses = once(
      [FILLER, FILLER, FILLER, FILLER, maker(3)],
      [
        // Pitch the first hand so the Maker is drawn for turn 2.
        { do: "repeat", times: 4, steps: [{ do: "pitch", card: {} }] },
        { do: "endTurn" },
        { do: "play", card: { name: "Maker 3" } },
        { do: "endTurn" },
      ],
    );
    expect(traverses.firstTraverseTurn).toBe(2);
    const never = once([FILLER], [{ do: "endTurn" }]);
    expect(never.firstTraverseTurn).toBeNull();
  });
});

describe("calibration comparison", () => {
  const d = (xs: number[]) => dist(xs);
  const many = (pairs: [number, number][]) =>
    pairs.flatMap(([v, n]) => Array<number>(n).fill(v));

  it("takes nearest-rank percentiles, as the Go side does", () => {
    expect(dist([3, 1, 4, 1, 5, 9, 2, 6])).toEqual({
      n: 8,
      counts: [0, 2, 1, 1, 1, 1, 1, 0, 0, 1],
      median: 3,
      p2_5: 1,
      p97_5: 9,
    });
    expect(dist([])).toEqual({
      n: 0,
      counts: [],
      median: 0,
      p2_5: 0,
      p97_5: 0,
    });
  });

  it("measures the largest gap between two cumulative distributions", () => {
    expect(ksDistance(d([0, 0, 1, 1]), d([0, 0, 1, 1]))).toBe(0);
    expect(ksDistance(d([0, 0, 0, 0]), d([1, 1, 1, 1]))).toBe(1);
    expect(ksDistance(d([0, 1, 2, 3]), d([0, 0, 2, 3]))).toBeCloseTo(0.25);
  });

  const turnOf = (arcane: number[], threatened: number[] = arcane) => ({
    arcane: d(arcane),
    threatened: d(threatened),
  });
  const observedGroup = (
    byIndex: number[][],
    firstTraverse: { byTurnIndex: number[]; never: number },
  ): ObservedGroup => {
    const ft = many(firstTraverse.byTurnIndex.map((n, i) => [i, n]));
    const fd = d(ft);
    return {
      sides: ft.length + firstTraverse.never,
      by_turn: byIndex.map((xs, i) => ({
        turn_index: i,
        arcane_damage_dealt: d(xs),
        damage_dealt: d(xs),
        damage_threatened: d(xs),
      })),
      first_traverse: {
        sides: ft.length + firstTraverse.never,
        never: firstTraverse.never,
        by_turn_index: fd.counts,
        median: fd.median,
        p2_5: fd.p2_5,
        p97_5: fd.p97_5,
      },
    };
  };
  const simulatedOf = (
    byTurn: number[][],
    firstTraverse: (number | null)[],
  ): SimulatedDistributions => ({
    byTurn: byTurn.map((xs, i) => ({ turn: i + 1, ...turnOf(xs) })),
    firstTraverse: firstTraverseOf(firstTraverse),
  });
  const ones = (v: number, n: number) => Array<number>(n).fill(v);

  it("T1: investigates a simulated median outside the observed 95% range", () => {
    const observed = observedGroup(
      [
        ones(0, 300),
        many([
          [1, 290],
          [9, 10],
        ]),
      ],
      { byTurnIndex: [], never: 300 },
    );
    const sim = simulatedOf([ones(0, 1000), ones(12, 1000)], ones(0, 0));
    const t1 = compare(observed, sim, { shift: 0, turns: 2 }).filter(
      (c) => c.threshold === "T1",
    );
    expect(t1.map((c) => [c.turn, c.verdict])).toEqual([
      [1, "within"],
      [2, "investigate"],
    ]);
  });

  it("maps engine turn N to turn index N - 1, or N with shift 1", () => {
    const observed = observedGroup([ones(5, 300), ones(0, 300)], {
      byTurnIndex: [],
      never: 300,
    });
    const sim = simulatedOf([ones(5, 1000)], []);
    const verdict = (shift: 0 | 1) =>
      compare(observed, sim, { shift, turns: 1 }).find(
        (c) => c.threshold === "T1",
      )!.verdict;
    expect(verdict(0)).toBe("within");
    expect(verdict(1)).toBe("investigate");
  });

  it("T2: investigates a distribution gap over 0.15", () => {
    const observed = observedGroup(
      [
        many([
          [0, 150],
          [1, 150],
        ]),
      ],
      {
        byTurnIndex: [],
        never: 300,
      },
    );
    const close = simulatedOf(
      [
        many([
          [0, 450],
          [1, 550],
        ]),
      ],
      [],
    );
    const far = simulatedOf(
      [
        many([
          [0, 800],
          [1, 200],
        ]),
      ],
      [],
    );
    const t2 = (sim: SimulatedDistributions) =>
      compare(observed, sim, { shift: 0, turns: 1 }).find(
        (c) => c.threshold === "T2",
      )!;
    expect(t2(close).verdict).toBe("within");
    expect(t2(far).verdict).toBe("investigate");
    expect(t2(far).gap).toBeCloseTo(0.3);
  });

  it("T3 and T4: the share traversed by each turn, and the median turn", () => {
    // Observed: half traverse on turn index 0, half on index 1.
    const observed = observedGroup([ones(0, 400), ones(0, 400)], {
      byTurnIndex: [200, 200],
      never: 0,
    });
    // Simulated: everyone traverses on turn 2.
    const sim = simulatedOf([ones(0, 1000), ones(0, 1000)], ones(2, 1000));
    const checks = compare(observed, sim, { shift: 0, turns: 2 });
    const t3 = checks.filter((c) => c.threshold === "T3");
    expect(t3.map((c) => [c.turn, c.observed, c.simulated, c.verdict])).toEqual(
      [
        [1, 0.5, 0, "investigate"],
        [2, 1, 1, "within"],
      ],
    );
    const t4 = checks.find((c) => c.threshold === "T4")!;
    // The simulated median, turn 2, is index 1: inside the observed 0 to 1.
    expect(t4.verdict).toBe("within");
  });

  it("says not enough data below 200 observed sides or 1,000 runs", () => {
    const observed = observedGroup([ones(0, 199)], {
      byTurnIndex: [],
      never: 199,
    });
    const sim = simulatedOf([ones(0, 999)], ones(null as never, 0));
    const verdicts = new Set(
      compare(observed, sim, { shift: 0, turns: 1 }).map((c) => c.verdict),
    );
    expect(verdicts).toEqual(new Set(["not enough data"]));
  });

  it("checks T6 only when it's asked for", () => {
    const observed = observedGroup([ones(0, 300)], {
      byTurnIndex: [],
      never: 300,
    });
    const sim = simulatedOf([ones(0, 1000)], []);
    const ids = (t?: Threshold[]) =>
      new Set(
        compare(observed, sim, { shift: 0, turns: 1, thresholds: t }).map(
          (c) => c.threshold,
        ),
      );
    expect(ids()).toEqual(new Set(["T1", "T2", "T3", "T4"]));
    expect(ids(["T6a", "T6b"])).toEqual(new Set(["T6a", "T6b"]));
  });

  it("calls a divergence robust when it holds pooled and in most matchups", () => {
    const pooled = [
      { threshold: "T1" as const, turn: 1, verdict: "investigate" as const },
    ];
    const matchups = {
      a: [
        { threshold: "T1" as const, turn: 1, verdict: "investigate" as const },
      ],
      b: [
        { threshold: "T1" as const, turn: 1, verdict: "investigate" as const },
      ],
      c: [{ threshold: "T1" as const, turn: 1, verdict: "within" as const }],
      d: [
        {
          threshold: "T1" as const,
          turn: 1,
          verdict: "not enough data" as const,
        },
      ],
    };
    expect(robustness(pooled, matchups)).toEqual([
      { threshold: "T1", turn: 1, matchups: 3, diverging: 2, robust: true },
    ]);
  });
});
