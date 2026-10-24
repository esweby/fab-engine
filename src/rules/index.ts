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
  type CostReduction,
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
  type ExplicitCondition,
} from "./effects.ts";
export {
  activateCard,
  activateGate,
  attackWithWeapon,
  effectiveCost,
  endTurn,
  pitchCard,
  playCard,
} from "./play.ts";
export {
  parseTriggers,
  resolveTriggers,
  type EventMatcher,
  type Trigger,
} from "./triggers.ts";
export {
  BLOOD_DEBT,
  CARD_RULES,
  cardWithRules,
  RUNECHANT,
  verifiedRulesFor,
  VISERAI,
} from "./viserai.ts";
export {
  parseScript,
  runScript,
  scriptedOpt,
  type Script,
  type ScriptRun,
  type ScriptStep,
  type Selector,
  type StepOutcome,
} from "./script.ts";
export {
  compareBatches,
  coverage,
  rulesDataVersion,
  runBatch,
  type BanishQuery,
  type BatchOptions,
  type BatchReport,
  type BatchSetup,
  type RunSummary,
  type TurnRecord,
  type TurnReport,
} from "./batch.ts";
export {
  compare,
  dist,
  firstTraverseOf,
  ksDistance,
  MIN_OBSERVED,
  MIN_SIMULATED,
  robustness,
  simulatedDistributions,
  type Check as CalibrationCheck,
  type CompareOptions,
  type Dist,
  type ObservedGroup,
  type SimulatedDistributions,
  type Threshold,
  type Verdict,
} from "./calibration.ts";
export {
  applySessionAction,
  NeedsChoice,
  replaySession,
  type SessionAction,
} from "./session.ts";
export { describeCheck, describeEffects } from "./describe.ts";
