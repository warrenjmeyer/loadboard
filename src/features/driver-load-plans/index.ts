// ---------------------------------------------------------------------------
// Everything a host app imports from this folder comes through here.
//
// Modules (a wrapper that loads, around a piece that draws) are listed in
// modules.ts, which is exported too.
// ---------------------------------------------------------------------------

// Modules: the loading wrappers a host mounts.
export { default as DriverLoadPlans } from './DriverLoadPlans.tsx'
export type { DriverLoadPlansProps } from './DriverLoadPlans.tsx'
export { default as OpenLoads } from './OpenLoads.tsx'
export type { OpenLoadsProps } from './OpenLoads.tsx'
export { default as SuggestDriver } from './SuggestDriver.tsx'
export type { SuggestDriverProps } from './SuggestDriver.tsx'
export { default as LoadPlanBoard } from './LoadPlanBoard.tsx'
export type { LoadPlanBoardProps } from './LoadPlanBoard.tsx'
export { default as DriverLoadPlan } from './DriverLoadPlan.tsx'
export type { DriverLoadPlanProps } from './DriverLoadPlan.tsx'
export { default as LegChip } from './LegChip.tsx'

// Pieces: draw from data the host already holds.
export { default as LoadPlansView } from './LoadPlansView.tsx'
export type { LoadPlansViewProps } from './LoadPlansView.tsx'
export { default as OpenLoadList } from './OpenLoadList.tsx'
export type { OpenLoadListProps } from './OpenLoadList.tsx'
export { default as CandidateList } from './CandidateList.tsx'
export type { CandidateListProps } from './CandidateList.tsx'
export { default as PlanTimeline } from './PlanTimeline.tsx'
export type { PlanTimelineProps } from './PlanTimeline.tsx'
export { default as PlanList } from './PlanList.tsx'
export type { PlanListProps } from './PlanList.tsx'

// Keeping separately-mounted modules in step, and the loading pattern they share.
export { PlanSync, usePlanSync } from './sync.tsx'
export { usePlanRead } from './usePlanRead.ts'
export type { PlanRead } from './usePlanRead.ts'

// The register.
export { MODULES } from './modules.ts'
export type { ModuleInfo } from './modules.ts'

// What each scoped read returns -- the server's specification.
export { scopePlanBoard, scopeDriverPlan, scopeOpenLoads, scopeCandidates } from './scope.ts'

// The rules.
export {
  planFor, planWithLegs, startFor, legTo, suggestDrivers, whyNot, summarize, conflictsWith, freeCounts,
  assign, unassign, deadhead, milesBetween, plainDrive, picksUpWithin,
  ESTIMATE, TIGHT_SECONDS, BOARD_DAYS, RESTART_SECONDS, FRESH_HOURS,
} from './rules.ts'
export type { DriveFn, DriveResult, Leg, LegVerdict, LegStart, StartKind, PlannedLoad, PlanSummary, Candidate } from './rules.ts'

// The contract.
export { checkLoadPlans, LOAD_STATUSES } from './contract.ts'
export type {
  PlanLoad, LoadStatus, PlanDriver, HomeStay, Hours, Place, LoadPlanData, LoadPlanAdapter, ReadArgs, IsoMoment,
} from './contract.ts'
