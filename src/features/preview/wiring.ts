import roster from '../get-me-home/fixtures/roster.json'
import { fixtureAdapter } from '../get-me-home/adapters/fixtureAdapter.ts'
import { scheduleDrive } from '../get-me-home/planHome.ts'
import type { Adapter, Roster } from '../get-me-home/contract.ts'
import { homeTimeFor } from '../home-time-schedule/rules.ts'
import { sampleStays } from '../home-time-schedule/adapters/sampleAdapter.ts'
import type { Stay } from '../home-time-schedule/contract.ts'
import { makeVerdictFor } from './verdict.ts'
import { makeSampleLoadPlanAdapter } from '../driver-load-plans/adapters/sampleAdapter.ts'
import type { DriveFn } from '../driver-load-plans/rules.ts'
import type { HomeStay, LoadPlanAdapter } from '../driver-load-plans/contract.ts'

// ---------------------------------------------------------------------------
// Where the tabs meet. No feature imports another -- each folder moves to
// the host on its own -- so the host joins them, and this file is the worked
// example of how. Four joins:
//
//   1. The planner's home time comes FROM the schedule. The planner's sample
//      drivers keep their positions and hours; their lastHomeAt and
//      requestedBy are replaced by what the schedule's stays say. Decline
//      Terrell's request in the schedule tab and the planner stops calling
//      him "Won't make it" -- because he no longer asked.
//
//   2. The schedule's Approve button shows the PLANNER's verdict: that
//      driver, planned against the home-by the request asks for.
//
//   3. The load plans' legs are timed by the PLANNER's hours model: the
//      same 11/14/70, breaks, rests and restarts that plan a trip home plan
//      the empty miles to a pickup.
//
//   4. The load plans' home time is the SCHEDULE's approved and current
//      stays, as they stand. Approve Terrell's request in the schedule tab
//      and the Laredo load stops suggesting him.
//
// TypeScript checks joins 1 and 3: homeTimeFor's answer is assigned straight
// into the planner's HomeTime, and the load plans' Hours go straight into
// scheduleDrive, so if either side's shape drifts, this stops compiling.
// ---------------------------------------------------------------------------
const SAMPLE = roster as Roster
const NOW = SAMPLE.asOf || new Date().toISOString()

// Both reads, the same join: whatever the planner's sample returns, its home
// time is replaced by the schedule's.
function withScheduleHomeTime(r: Roster): Roster {
  const stays = sampleStays()
  return { ...r, drivers: r.drivers.map((d) => ({ ...d, homeTime: homeTimeFor(stays, d.driverCode, r.asOf || NOW) })) }
}

export const plannerOnSchedule: Adapter = {
  async loadRoster(args) {
    return withScheduleHomeTime(await fixtureAdapter.loadRoster(args))
  },
  async loadDriver(args) {
    return withScheduleHomeTime(await fixtureAdapter.loadDriver(args))
  },
}

// The schedule's Approve button shows the planner's verdict on the sample
// drivers, on the sample clock (verdict.ts has the join itself).
export const verdictFor = makeVerdictFor(SAMPLE, { now: NOW })

export const driveFor: DriveFn = ({ driveSeconds, hours, startAt }) => {
  const s = scheduleDrive({ driveSeconds, hours, startAt })
  // Even when the planner cannot read the hours and rests first to be safe,
  // its model decided the arrival -- the rest shows up in restSeconds.
  return s ? { arriveAt: s.arriveAt, restSeconds: s.offSeconds, hoursConsidered: true } : null
}

const plannable = (s: Stay): s is Stay & { status: HomeStay['status'] } => s.status === 'APPROVED' || s.status === 'HOME'

/** The schedule's stays, as the load plans need them: approved or home now. */
export function scheduleHomeStays(): HomeStay[] {
  return sampleStays().filter(plannable).map((s) => ({ driverCode: s.driverCode, homeBy: s.homeBy, backOut: s.backOut, status: s.status }))
}

export const loadPlansOnSchedule: LoadPlanAdapter = makeSampleLoadPlanAdapter({ stays: scheduleHomeStays })
