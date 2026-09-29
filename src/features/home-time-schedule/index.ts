// ---------------------------------------------------------------------------
// Everything a host app imports from this folder comes through here.
// ---------------------------------------------------------------------------
export { default as HomeTimeSchedule } from './HomeTimeSchedule.tsx'
export type { HomeTimeScheduleProps } from './HomeTimeSchedule.tsx'
export { default as ScheduleView } from './ScheduleView.tsx'
export type { ScheduleViewProps } from './ScheduleView.tsx'
export { default as DriverHomeTime } from './DriverHomeTime.tsx'
export type { DriverHomeTimeProps } from './DriverHomeTime.tsx'

export { homeTimeFor, applyAction, actionsFor, checkNewStay, needsDecision, MOVES } from './rules.ts'
export type { PlannerHomeTime } from './rules.ts'

export { checkStatusRows, statusIds } from './statusTable.ts'
export type { StayStatusRow } from './statusTable.ts'

export { checkSchedule, STAY_STATUSES } from './contract.ts'
export type {
  Stay, StayStatus, StayAction, StayVerdict, NewStay, ScheduleData, ScheduleDriver, ScheduleAdapter, IsoMoment,
} from './contract.ts'
