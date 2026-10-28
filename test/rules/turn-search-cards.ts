// Viserai cards for the turn search tests, with printed cost, pitch and power from the local card
// data (variants table, 28 Oct 2026) and effects from the verified rules (CARD_RULES). Natural go
// again only where it's printed as a keyword without a condition.
import {
  cardWithRules,
  RUNECHANT,
  setUp,
  VISERAI,
  BLOOD_DEBT,
  type RulesCard,
  type RulesState,
} from "../../src/rules/index.ts";
import type { HeroSide } from "../../src/game.ts";

const fact = (name: string, over: Partial<RulesCard>): RulesCard =>
  cardWithRules({
    id: `${name}-${over.pitch ?? 1}`,
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

const GLOOM = ["runeblade", "shadow", "blood_debt"];
const MURMURING_POWER: Record<number, number> = { 1: 4, 2: 3, 3: 2 };

export const BSL = () =>
  fact("Become the Shadow Lord", {
    pitch: 3,
    goAgain: true,
    traits: ["runeblade", "shadow"],
  });
export const MURMURING = (pitch: 1 | 2 | 3) =>
  fact("Murmuring Gloomblade", {
    type: "attack_action",
    pitch,
    cost: 2,
    power: MURMURING_POWER[pitch],
    traits: GLOOM,
  });
export const SHADOW_OF_URSUR = () =>
  fact("Shadow of Ursur", {
    type: "attack_action",
    pitch: 3,
    power: 2,
    traits: GLOOM,
  });
export const GREED = () =>
  fact("Runechant of Greed", {
    type: "instant",
    pitch: 2,
    traits: ["runeblade", "aura"],
  });
export const DESCENDANCY = () =>
  fact("Arknight Descendancy", {
    type: "attack_action",
    pitch: 3,
    cost: 5,
    power: 6,
    traits: GLOOM,
  });
export const DEMONBOUND = () =>
  fact("Demonbound Gloomblade", {
    type: "attack_action",
    pitch: 1,
    power: 3,
    traits: GLOOM,
  });
export const ENSHRINE = () =>
  fact("Enshrine Sin", { pitch: 3, goAgain: true, traits: GLOOM });
export const EMBRACE = () =>
  fact("Embrace Ursur", {
    type: "attack_action",
    pitch: 1,
    cost: 1,
    power: 3,
    traits: ["runeblade", "shadow"],
  });
export const CULLINGSONG = () =>
  fact("Cullingsong Gloomblade", {
    type: "attack_action",
    pitch: 1,
    power: 2,
    traits: GLOOM,
  });
export const OTHERWORLDLY = () =>
  fact("Otherworldly Sins", {
    pitch: 1,
    cost: 1,
    goAgain: true,
    traits: ["runeblade", "shadow"],
  });
export const NEBULA = (): RulesCard =>
  fact("Seven Sin Nebula", {
    type: "weapon",
    pitch: null,
    cost: null,
    power: 3,
    traits: ["runeblade", "shadow"],
  });
/** An unmodelled card for the rest of the deck. */
export const FILLER = (n: number): RulesCard => ({
  id: `deck-${n}`,
  name: `Deck ${n}`,
  pitch: 1,
  cost: 0,
  goAgain: false,
  type: "action",
  roles: [],
  traits: [],
  amounts: {},
});

export interface Start {
  hand: RulesCard[];
  /** The top of the deck first; fillers follow. */
  deck?: RulesCard[];
  arsenal?: RulesCard[];
  weapons?: RulesCard[];
  tokens?: Record<string, number>;
  side?: HeroSide;
  resources?: number;
}

/** The start of an action phase with exactly this hand, arsenal and tokens. */
export function start(s: Start): RulesState {
  const deck = [
    ...s.hand,
    ...(s.arsenal ?? []),
    ...(s.deck ?? []),
    ...Array.from({ length: 20 }, (_, i) => FILLER(i)),
  ];
  const game = setUp({
    deck,
    order: "asGiven",
    seed: 1,
    intellect: s.hand.length,
    weapons: s.weapons,
    side: s.side,
    triggers: [...VISERAI, RUNECHANT, BLOOD_DEBT],
  });
  const arsenal = (s.arsenal ?? []).map((_, i) => game.zones.deck[i]!);
  return {
    ...game,
    intellect: 4,
    resources: s.resources ?? 0,
    tokens: s.tokens ?? {},
    zones: {
      ...game.zones,
      arsenal,
      deck: game.zones.deck.slice(arsenal.length),
    },
  };
}

export const uidOf = (s: RulesState, name: string, pitch?: number) => {
  const found = Object.values(s.zones)
    .flat()
    .find(
      (i) =>
        i.card.name === name && (pitch === undefined || i.card.pitch === pitch),
    );
  if (!found) throw new Error(`No ${name} in the game.`);
  return found.uid;
};
