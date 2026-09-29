import { homeTimeFor, overlaps } from './rules.ts'
import type { IsoMoment, ScheduleData, ScheduleDriver, Stay } from './contract.ts'

// ---------------------------------------------------------------------------
// WHAT EACH READ RETURNS, exactly. One function per ScheduleAdapter read,
// from everything the store holds to the slice one screen needs.
//
// These are the specification of the server's four queries. The sample
// adapter runs them over its in-memory stays; a server in JavaScript can run
// them as they stand; a server in anything else answers the same questions
// in SQL, and scope.test.ts is the list of what "the same" means.
//
// Every driver in a scoped answer carries lastHomeAt, worked out from ALL of
// that driver's stays -- because the stay it comes from (a DONE one, weeks
// old) is exactly what the scope leaves out.
// ---------------------------------------------------------------------------

function withLastHome(driver: ScheduleDriver, all: ScheduleData, now: IsoMoment): ScheduleDriver {
  return { ...driver, lastHomeAt: homeTimeFor(all.stays, driver.driverCode, now).lastHomeAt }
}

function driversFor(all: ScheduleData, stays: readonly Stay[], now: IsoMoment): ScheduleDriver[] {
  const codes = new Set(stays.map((s) => s.driverCode))
  return all.drivers.filter((d) => codes.has(d.driverCode)).map((d) => withLastHome(d, all, now))
}

const clockOf = (all: ScheduleData) => all.asOf || new Date().toISOString()

/** loadQueue: requests waiting on dispatch, and only the drivers they are for. */
export function scopeQueue(all: ScheduleData): ScheduleData {
  const now = clockOf(all)
  const stays = all.stays.filter((s) => s.status === 'REQUESTED')
  return { asOf: all.asOf, drivers: driversFor(all, stays, now), stays }
}

/** loadBoard: every driver (the board has a row for each), and the stays that occupy the window. */
export function scopeBoard(all: ScheduleData, { from, to }: { from: IsoMoment; to: IsoMoment }): ScheduleData {
  const now = clockOf(all)
  return {
    asOf: all.asOf,
    drivers: all.drivers.map((d) => withLastHome(d, all, now)),
    stays: all.stays.filter((s) => overlaps(s, from, to)),
  }
}

/** loadDriverStays: one driver and their stays -- nobody else's. */
export function scopeDriver(all: ScheduleData, driverCode: string): ScheduleData {
  const now = clockOf(all)
  return {
    asOf: all.asOf,
    drivers: all.drivers.filter((d) => d.driverCode === driverCode).map((d) => withLastHome(d, all, now)),
    stays: all.stays.filter((s) => s.driverCode === driverCode),
  }
}

/** loadStay: one stay and its driver; nothing at all when there is no such stay. */
export function scopeStay(all: ScheduleData, id: string): ScheduleData {
  const now = clockOf(all)
  const stays = all.stays.filter((s) => s.id === id)
  return { asOf: all.asOf, drivers: driversFor(all, stays, now), stays }
}
