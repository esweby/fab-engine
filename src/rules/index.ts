// The rules engine (docs/rules-engine.md): built beside the counting engine, switched in card by
// card. Plain TypeScript, no React, no network, no scores.
export {
  checkInvariants,
  createTokens,
  moveCard,
  removeTokens,
  RulesBudgetExceeded,
  RulesError,
  setUp,
  type Phase,
  type RulesCard,
  type RulesEvent,
  type RulesInstance,
  type RulesSetup,
  type RulesState,
} from "./state.ts";
export {
  noChoices,
  parseEffects,
  runEffects,
  type Check,
  type ChoiceRequest,
  type Choose,
  type Effect,
} from "./effects.ts";
export { endTurn, pitchCard, playCard } from "./play.ts";
export {
  parseTriggers,
  resolveTriggers,
  type EventMatcher,
  type Trigger,
} from "./triggers.ts";
