import roster from '../get-me-home/fixtures/roster.json'
import { fixtureAdapter } from '../get-me-home/adapters/fixtureAdapter.ts'
import { mergePolicy, planDriver } from '../get-me-home/planHome.ts'
import type { Adapter, Roster } from '../get-me-home/contract.ts'
import { homeTimeFor } from '../home-time-schedule/rules.ts'
import { sampleStays } from '../home-time-schedule/adapters/sampleAdapter.ts'
import { formatDuration, formatWhen } from '../home-time-schedule/format.ts'
import type { Stay, StayVerdict } from '../home-time-schedule/contract.ts'

// ---------------------------------------------------------------------------
// Where the two tabs meet. Neither feature imports the other -- each folder
// moves to the host on its own -- so the host joins them, and this file is
// the worked example of how. Two joins:
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
// TypeScript checks the first join: homeTimeFor's answer is assigned straight
// into the planner's HomeTime, so if either shape drifts, this stops compiling.
// ---------------------------------------------------------------------------
const SAMPLE = roster as Roster
const NOW = SAMPLE.asOf || new Date().toISOString()
const POLICY = mergePolicy(SAMPLE.policy)

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

export function verdictFor(stay: Stay): StayVerdict | null {
  if (stay.status !== 'REQUESTED' && stay.status !== 'APPROVED') return null
  const driver = SAMPLE.drivers.find((d) => d.driverCode === stay.driverCode)
  if (!driver) {
    return { severity: 'info', text: 'The planner has no position or hours for this driver, so it cannot say whether this can be made.' }
  }
  const plan = planDriver(
    { ...driver, homeTime: { ...driver.homeTime, requestedBy: stay.homeBy } },
    { now: NOW, policy: POLICY },
  )
  switch (plan.status) {
    case 'LATE':
      return { severity: 'error', text: `The planner says this can't be made: earliest home ${formatWhen(plan.schedule?.arriveAt)}, ${formatDuration(-(plan.slackSeconds ?? 0))} late.` }
    case 'TIGHT':
      return { severity: 'warning', text: `Can be made, only just: the trip home has to start by ${formatWhen(plan.leaveBy)}.` }
    case 'ONTRACK':
      return { severity: 'success', text: `Can be made, with ${formatDuration(plan.slackSeconds)} to spare. Earliest home ${formatWhen(plan.schedule?.arriveAt)}.` }
    case 'HOME':
      return { severity: 'success', text: 'Already home.' }
    case 'NOLOCATION':
      return { severity: 'info', text: "The planner can't place this truck, so it can't say whether this can be made." }
    default:
      return null
  }
}
