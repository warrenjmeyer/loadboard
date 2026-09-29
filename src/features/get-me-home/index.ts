// ---------------------------------------------------------------------------
// Everything a host app imports from this folder comes through here. The
// files behind it can move around; these names are the promise.
//
// Modules (a wrapper that loads, around a piece that draws) are listed in
// modules.ts, which is exported too.
// ---------------------------------------------------------------------------

// Modules: the loading wrappers a host mounts.
export { default as GetMeHomePlanner } from './GetMeHomePlanner.tsx'
export type { GetMeHomePlannerProps } from './GetMeHomePlanner.tsx'
export { default as PlannerRoster } from './PlannerRoster.tsx'
export type { PlannerRosterProps } from './PlannerRoster.tsx'
export { default as DriverTripHome } from './DriverTripHome.tsx'
export type { DriverTripHomeProps } from './DriverTripHome.tsx'

// Pieces: draw from data the host already holds. Props via React.ComponentProps<typeof X>.
export { default as PlannerView } from './PlannerView.tsx'
export type { PlannerViewProps } from './PlannerView.tsx'
export { default as RosterTable } from './RosterTable.tsx'
export { default as DriverPlan } from './DriverPlan.tsx'
export { default as StatusChip } from './StatusChip.tsx'

// The loading pattern the wrappers share, for a host building its own.
export { useRosterRead } from './useRosterRead.ts'
export type { RosterRead } from './useRosterRead.ts'

// The register.
export { MODULES } from './modules.ts'
export type { ModuleInfo } from './modules.ts'

// The rules.
export { planRoster, planDriver, scheduleDrive, DEFAULT_POLICY, STATUS_ORDER } from './planHome.ts'
export type {
  Plan, RosterPlan, Schedule, Block, BlockKind, Start, PlannedRoute, PlanWarning, WarningCode, Status, Policy,
} from './planHome.ts'
export { checkStatusRows, statusIds } from './statusTable.ts'
export type { StatusRow } from './statusTable.ts'

// The contract.
export { checkRoster, JOB_TYPES } from './contract.ts'
export type {
  Adapter, Roster, Driver, JobType, Place, Position, Hours, CurrentLoad, Route, HomeTime, PolicyInput,
  IsoMoment, Seconds,
} from './contract.ts'
