import { mergePolicy, planDriver } from '../get-me-home/planHome.ts'
import type { Roster } from '../get-me-home/contract.ts'
import { formatDuration, formatWhen } from '../home-time-schedule/format.ts'
import type { IsoMoment, Stay, StayVerdict } from '../home-time-schedule/contract.ts'

// ---------------------------------------------------------------------------
// The planner's verdict on a request for home time, shown beside Approve so
// nobody agrees to a promise the hours cannot keep. The schedule does not
// know the planner; the host, which has both, joins them -- this is the join.
//
// Given any planner roster: the sample one (wiring.ts), or the live one the
// laptop-database preview loads from Millstream and GeoTab. The driver is
// planned against the home-by the request asks for; everything else about
// them -- where the truck is, the hours left, the load on it -- is the
// roster's.
//
// Pure, so node --test runs it (verdict.test.ts).
// ---------------------------------------------------------------------------
export function makeVerdictFor(roster: Roster, { now }: { now?: IsoMoment | null } = {}): (stay: Stay) => StayVerdict | null {
  const policy = mergePolicy(roster.policy)
  return (stay) => {
    if (stay.status !== 'REQUESTED' && stay.status !== 'APPROVED') return null
    const driver = roster.drivers.find((d) => d.driverCode === stay.driverCode)
    if (!driver) {
      return { severity: 'info', text: 'The planner has no position or hours for this driver, so it cannot say whether this can be made.' }
    }
    const plan = planDriver(
      { ...driver, homeTime: { ...driver.homeTime, requestedBy: stay.homeBy } },
      // The clock: pinned for the sample, the real one for live data.
      { now: now || roster.asOf || new Date().toISOString(), policy },
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
}

/** Every request gets the same sentence: why the planner cannot say. For a
 * roster that could not be loaded -- not signed in, say. */
export function verdictUnavailable(reason: string): (stay: Stay) => StayVerdict | null {
  return (stay) => (stay.status === 'REQUESTED' || stay.status === 'APPROVED'
    ? { severity: 'info', text: `The planner cannot say: ${reason}` }
    : null)
}
