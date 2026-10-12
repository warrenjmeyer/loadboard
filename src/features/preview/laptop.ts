import { STATE_ZONES, stateOf, zonedFromWallClock } from '../get-me-home/adapters/dockTime.ts'
import { zoneKey } from '../get-me-home/adapters/loadboardRoster.ts'
import type { ApiHours, ApiPositions, ApiZones } from '../get-me-home/adapters/loadboardRoster.ts'
import type { HomeStay, Hours, LoadPlanData, LoadStatus, Place, PlanDriver, PlanLoad } from '../driver-load-plans/contract.ts'
import type { ScheduleData, ScheduleDriver, Stay, StaySource, StayStatus } from '../home-time-schedule/contract.ts'
import type { Roster } from '../get-me-home/contract.ts'
import type { DriverList, DriverPay, DriverRecord, DriverSummary, DriverType, PayBasis, PayFrequency } from '../driver-master/contract.ts'
import { planFor } from '../driver-load-plans/rules.ts'
import { homeTimeFor } from '../home-time-schedule/rules.ts'

// ---------------------------------------------------------------------------
// The laptop database's rows, turned into the tabs' data. Pure: rows and
// GeoTab payloads in, contract data out -- the same job the host's API will
// do, written once here for the preview's "Laptop database" data.
//
// The rows are exactly what the host SQL returns (03_scoped_reads.sql,
// 05_load_plan_reads.sql, 07_stay_writes.sql, 09_driver_reads.sql,
// 10_driver_writes.sql), handed over by the dev
// server (tools/local-db/plugin.mjs). What the database does not hold comes
// from GeoTab, through the deployed API, as the planner's live data does:
//
//   a place's map position    the GeoTab zone named like the town
//   a truck's position        GeoTab, by unit number
//   a driver's hours          GeoTab, by driver code
//   a dock time's zone        the dock's state (dockTime.ts)
//
// Missing GeoTab data -- not signed in, a town with no zone -- is left
// missing, and the tab says so where it shows. Nothing is guessed.
//
// Dev-server only: the laptop database is offered under `npm run dev` alone,
// never on the deployed preview.
// ---------------------------------------------------------------------------

// ---- The schedule --------------------------------------------------------

/** One stay as 03_scoped_reads.sql and 07_stay_writes.sql return it. */
export interface StayRow {
  id: string
  driverCode: string
  status: string
  homeBy: string
  backOut: string
  note: string | null
  requestedAt: string
  decidedAt: string | null
  decidedByUser: string | null
  declineReason: string | null
  arrivedAt: string | null
  arrivedSource: string | null
  leftAt: string | null
  leftSource: string | null
}

/** One driver as 03_scoped_reads.sql returns them. */
export interface ScheduleDriverRow {
  driverCode: string
  name: string
  unitNo: string | null
  lastHomeAt: string | null
}

// The database keeps the dispatcher's user id; a screen shows a name. The
// laptop has no users to look it up in, so a decision says who in general.
export function toStay(row: StayRow): Stay {
  return {
    id: row.id,
    driverCode: row.driverCode,
    homeBy: row.homeBy,
    backOut: row.backOut,
    status: row.status as StayStatus,
    note: row.note,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedAt ? 'Dispatch' : null,
    declineReason: row.declineReason,
    arrivedAt: row.arrivedAt,
    leftAt: row.leftAt,
    arrivedSource: row.arrivedSource as StaySource | null,
    leftSource: row.leftSource as StaySource | null,
  }
}

export function toScheduleData({ stays, drivers }: { stays: StayRow[]; drivers: ScheduleDriverRow[] }): ScheduleData {
  return {
    drivers: drivers.map((d): ScheduleDriver => ({ driverCode: d.driverCode, name: d.name, unitNo: d.unitNo, lastHomeAt: d.lastHomeAt })),
    stays: stays.map(toStay),
  }
}

// ---- The load plans ------------------------------------------------------

/** One load as 05_load_plan_reads.sql returns it: places as text, dock times
 * with no zone ("2026-09-30T13:00:00"). */
export interface LoadRow {
  id: string
  status: string
  driverCode: string | null
  origin: string
  destination: string
  pickupStart: string | null
  pickupEnd: string | null
  deliveryStart: string | null
  deliveryEnd: string | null
  miles: number | null
  rate: number | null
  equipment: string | null
  plannedAt: string | null
}

/** One driver as 05_load_plan_reads.sql returns them; home is "Dubuque, IA". */
export interface PlanDriverRow {
  driverCode: string
  name: string
  unitNo: string | null
  home: string | null
}

export interface HomeStayRow {
  driverCode: string
  homeBy: string
  backOut: string
  status: string
}

/** What GeoTab adds. Each may be missing (null): then so is what it adds. */
export interface GeoTab {
  zones: ApiZones | null
  positions: ApiPositions | null
  hours: ApiHours | null
}

export function placeFrom(name: string | null, zones: ApiZones | null): Place {
  const zone = name && zones ? zones.zones.find((z) => zoneKey(z.name) === zoneKey(name)) : undefined
  return { place: name, latitude: zone ? zone.latitude : null, longitude: zone ? zone.longitude : null }
}

/** A dock's wall-clock time, zoned by the state the dock is in. */
export function dockMoment(wall: string | null, place: string | null): string | null {
  const state = stateOf(place)
  const zone = state ? STATE_ZONES[state] : undefined
  return wall && zone ? zonedFromWallClock(wall, zone) : null
}

function hoursOf(driverCode: string, hours: ApiHours | null): Hours | null {
  const row = hours?.drivers.find((h) => h.driverCode === driverCode)
  if (!row || !row.hasAvailability) return null
  return { driving: row.driving, duty: row.duty, cycle: row.cycle, rest: row.rest, workday: row.workday }
}

function positionOf(unitNo: string | null, positions: ApiPositions | null): PlanDriver['position'] {
  const truck = unitNo ? positions?.trucks.find((t) => t.unitNo === unitNo) : undefined
  if (!truck || !truck.reported || truck.latitude === null || truck.longitude === null) return null
  return { place: truck.near ?? null, latitude: truck.latitude, longitude: truck.longitude, reportedAt: truck.dateTime }
}

export function toLoad(row: LoadRow, zones: ApiZones | null): PlanLoad {
  return {
    id: row.id,
    status: row.status as LoadStatus,
    driverCode: row.driverCode,
    origin: placeFrom(row.origin, zones),
    destination: placeFrom(row.destination, zones),
    // Pickup times are the origin dock's; delivery times the destination's.
    pickupStart: dockMoment(row.pickupStart, row.origin),
    pickupEnd: dockMoment(row.pickupEnd, row.origin),
    deliveryStart: dockMoment(row.deliveryStart, row.destination),
    deliveryEnd: dockMoment(row.deliveryEnd, row.destination),
    miles: row.miles,
    rate: row.rate,
    equipment: row.equipment,
    plannedAt: row.plannedAt,
  }
}

export function toLoadPlanData(
  { loads, drivers, stays }: { loads: LoadRow[]; drivers: PlanDriverRow[]; stays: HomeStayRow[] },
  geotab: GeoTab,
): LoadPlanData {
  return {
    drivers: drivers.map((d): PlanDriver => ({
      driverCode: d.driverCode,
      name: d.name,
      unitNo: d.unitNo,
      home: placeFrom(d.home, geotab.zones),
      position: positionOf(d.unitNo, geotab.positions),
      hours: hoursOf(d.driverCode, geotab.hours),
    })),
    loads: loads.map((l) => toLoad(l, geotab.zones)),
    stays: stays
      .filter((s) => s.status === 'APPROVED' || s.status === 'HOME')
      .map((s): HomeStay => ({ driverCode: s.driverCode, homeBy: s.homeBy, backOut: s.backOut, status: s.status as HomeStay['status'] })),
  }
}

// ---- The planner ---------------------------------------------------------

/** The planner's live roster -- Millstream's drivers, GeoTab's positions and
 * hours -- with what the laptop database knows put in its place:
 *
 *   currentLoad  the first load on the driver's laptop plan: the one under
 *                way first, then the earliest pickup -- the rule the load
 *                board's /api/roster uses, over the laptop's loads, so the
 *                three tabs agree on what each truck is doing;
 *   homeTime     from the laptop's stays, as the schedule tab shows them.
 *
 * Positions and hours stay GeoTab's. A driver with nothing on the laptop
 * plan has no current load, whatever Millstream says. */
export function rosterOnLaptop(roster: Roster, { plans, schedule, now }: {
  plans: LoadPlanData
  schedule: ScheduleData
  now: string
}): Roster {
  return {
    ...roster,
    drivers: roster.drivers.map((d) => {
      const load = planFor(plans, d.driverCode)[0]
      const fromStays = homeTimeFor(schedule.stays, d.driverCode, now)
      const scoped = schedule.drivers.find((s) => s.driverCode === d.driverCode)
      return {
        ...d,
        currentLoad: load
          ? { id: load.id, finalStop: load.destination, emptyAt: load.deliveryEnd ?? load.deliveryStart }
          : null,
        // A road route home was measured from where Millstream's load ended;
        // the laptop's may end elsewhere, so the planner estimates instead.
        routeHome: null,
        // A scoped driver carries lastHomeAt from ALL their stays, older than
        // the window included -- so it wins where it is there.
        homeTime: { ...fromStays, lastHomeAt: scoped?.lastHomeAt ?? fromStays.lastHomeAt },
      }
    }),
  }
}


// ---- The driver master -------------------------------------------------------

/** One line as 09_driver_reads.sql's loadDriverList returns it. */
export type DriverLineRow = DriverSummary

/** One driver as 09's loadDriver and 10_driver_writes.sql return it: every
 * column flat, pay NULL unless canSeePay. */
export interface DriverRow extends Omit<DriverRecord, 'pay' | 'driverType'> {
  driverType: string
  canSeePay: boolean
  ssnLast4: string | null
  payRate: number | null
  payFrequency: string | null
  payBasis: string | null
  payGroup: string | null
}

/** A driver row as the tab's DriverRecord: pay folded into `pay` for a
 * caller who may see it, and null -- not an object of nulls -- for anyone
 * else. canSeePay decides, because payBasis is NULL for every company
 * driver and so cannot. */
export function toDriverRecord(row: DriverRow): DriverRecord {
  const { canSeePay, ssnLast4, payRate, payFrequency, payBasis, payGroup, ...rest } = row
  const pay: DriverPay | null = canSeePay
    ? { ssnLast4: ssnLast4 ?? '', payRate: payRate ?? 0, payFrequency: (payFrequency ?? 'W') as PayFrequency, payBasis: (payBasis ?? null) as PayBasis | null, payGroup: payGroup ?? '' }
    : null
  return { ...rest, driverType: rest.driverType as DriverType, pay }
}

/** loadDriverList's two result sets -- the lines, and what the caller may do. */
export function toDriverList({ drivers, you }: { drivers: DriverLineRow[]; you: { canAdd: boolean; canSeePay: boolean } | undefined }): DriverList {
  return { drivers, you: { canAdd: Boolean(you?.canAdd), canSeePay: Boolean(you?.canSeePay) } }
}
