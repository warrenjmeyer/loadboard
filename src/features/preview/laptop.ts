import { STATE_ZONES, stateOf, zonedFromWallClock } from '../get-me-home/adapters/dockTime.ts'
import { zoneKey } from '../get-me-home/adapters/loadboardRoster.ts'
import type { ApiHours, ApiPositions, ApiZones } from '../get-me-home/adapters/loadboardRoster.ts'
import type { HomeStay, Hours, LoadPlanData, LoadStatus, Place, PlanDriver, PlanLoad } from '../driver-load-plans/contract.ts'
import type { ScheduleData, ScheduleDriver, Stay, StaySource, StayStatus } from '../home-time-schedule/contract.ts'

// ---------------------------------------------------------------------------
// The laptop database's rows, turned into the tabs' data. Pure: rows and
// GeoTab payloads in, contract data out -- the same job the host's API will
// do, written once here for the preview's "Laptop database" data.
//
// The rows are exactly what the host SQL returns (03_scoped_reads.sql,
// 05_load_plan_reads.sql, 07_stay_writes.sql), handed over by the dev
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
// Dev-only, like everything in preview/.
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
