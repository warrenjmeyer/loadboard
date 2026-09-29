import { loadSpan, picksUpWithin, planFor, staySpan, touches } from './rules.ts'
import type { IsoMoment, LoadPlanData, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// WHAT EACH READ RETURNS, exactly. One function per LoadPlanAdapter read,
// from everything the store holds to the slice one screen needs.
//
// These are the specification of the server's four queries. The sample
// adapter runs them over its in-memory loads; a server in JavaScript can run
// them as they stand; a server in anything else answers the same questions
// in SQL, and scope.test.ts is the list of what "the same" means.
//
// Stays arrive already reduced to what planning needs -- approved, or home
// now -- because a requested, declined or finished stay is nothing a load
// can run into.
// ---------------------------------------------------------------------------

const onPlan = (l: PlanLoad) => l.status === 'Covered' || l.status === 'In Transit'

/** loadPlanBoard: every driver (the board has a row for each), their planned
 * loads that touch the window, and the stays that touch it. */
export function scopePlanBoard(all: LoadPlanData, { from, to }: { from: IsoMoment; to: IsoMoment }): LoadPlanData {
  return {
    asOf: all.asOf,
    drivers: all.drivers,
    loads: all.loads.filter((l) => onPlan(l) && touches(loadSpan(l), from, to)),
    stays: all.stays.filter((s) => touches(staySpan(s), from, to)),
  }
}

/** loadDriverPlan: one driver, their whole plan, their stays -- nobody else's. */
export function scopeDriverPlan(all: LoadPlanData, driverCode: string): LoadPlanData {
  return {
    asOf: all.asOf,
    drivers: all.drivers.filter((d) => d.driverCode === driverCode),
    loads: planFor(all, driverCode),
    stays: all.stays.filter((s) => s.driverCode === driverCode),
  }
}

/** loadOpenLoads: Available loads whose pickup window touches the window.
 * No drivers, no stays: a list of work, not of people. */
export function scopeOpenLoads(all: LoadPlanData, { from, to }: { from: IsoMoment; to: IsoMoment }): LoadPlanData {
  return { asOf: all.asOf, drivers: [], loads: all.loads.filter((l) => picksUpWithin(l, from, to)), stays: [] }
}

/** loadCandidates: the one load, and everything ranking drivers for it takes
 * -- every driver, their planned loads, their stays. The load comes back
 * whatever its status, so a screen can say it was taken meanwhile; an
 * unknown id is nothing at all. */
export function scopeCandidates(all: LoadPlanData, loadId: string): LoadPlanData {
  const load = all.loads.find((l) => l.id === loadId)
  if (!load) return { asOf: all.asOf, drivers: [], loads: [], stays: [] }
  return {
    asOf: all.asOf,
    drivers: all.drivers,
    loads: [load, ...all.loads.filter((l) => l.id !== loadId && onPlan(l))],
    stays: all.stays,
  }
}
