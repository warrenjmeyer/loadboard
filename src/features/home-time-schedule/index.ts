// ---------------------------------------------------------------------------
// Everything a host app imports from this folder comes through here.
//
// Modules (a wrapper that loads, around a piece that draws) are listed in
// modules.ts, which is exported too.
// ---------------------------------------------------------------------------

// Modules: the loading wrappers a host mounts.
export { default as HomeTimeSchedule } from './HomeTimeSchedule.tsx'
export type { HomeTimeScheduleProps } from './HomeTimeSchedule.tsx'
export { default as DecisionQueue } from './DecisionQueue.tsx'
export type { DecisionQueueProps } from './DecisionQueue.tsx'
export { default as ScheduleBoard } from './ScheduleBoard.tsx'
export type { ScheduleBoardProps } from './ScheduleBoard.tsx'
export { default as StayDetails } from './StayDetails.tsx'
export type { StayDetailsProps } from './StayDetails.tsx'
export { default as DriverHomeTime } from './DriverHomeTime.tsx'
export type { DriverHomeTimeProps } from './DriverHomeTime.tsx'
export { default as RequestHomeTime } from './RequestHomeTime.tsx'
export type { RequestHomeTimeProps } from './RequestHomeTime.tsx'

// Pieces: draw from data the host already holds. Props via React.ComponentProps<typeof X>.
export { default as ScheduleView } from './ScheduleView.tsx'
export type { ScheduleViewProps } from './ScheduleView.tsx'
export { default as DecisionList } from './DecisionList.tsx'
export { default as Board } from './Board.tsx'
export { default as StayDialog } from './StayDialog.tsx'
export { default as DriverStays } from './DriverStays.tsx'
export type { DriverStaysProps } from './DriverStays.tsx'
export { default as RequestForm } from './RequestForm.tsx'

// Keeping separately-mounted modules in step, and the loading pattern they share.
export { ScheduleSync, useScheduleSync } from './sync.tsx'
export { useScheduleRead } from './useScheduleRead.ts'
export type { ScheduleRead } from './useScheduleRead.ts'

// The register.
export { MODULES } from './modules.ts'
export type { ModuleInfo } from './modules.ts'

// What each scoped read returns -- the server's specification.
export { scopeQueue, scopeBoard, scopeDriver, scopeStay } from './scope.ts'

// The rules.
export {
  homeTimeFor, applyAction, actionsFor, checkNewStay, needsDecision, overlaps, MOVES,
  detectHomeMoves, HOME_RADIUS_MILES, DWELL_MINUTES,
} from './rules.ts'
export type { PlannerHomeTime, Fix, HomePoint, HomeMove } from './rules.ts'
export { checkStatusRows, statusIds, checkSourceRows, sourceIds } from './lookups.ts'
export type { StayStatusRow, StaySourceRow } from './lookups.ts'

// The contract.
export { checkSchedule, STAY_STATUSES, STAY_SOURCES } from './contract.ts'
export type {
  Stay, StayStatus, StayAction, StaySource, StayVerdict, NewStay, ScheduleData, ScheduleDriver, ScheduleAdapter,
  ReadArgs, IsoMoment,
} from './contract.ts'
