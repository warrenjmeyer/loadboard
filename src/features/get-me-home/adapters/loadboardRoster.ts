import type { Driver, Hours, JobType, Place, Position, Roster } from '../contract.ts'
import { STATE_ZONES, stateOf, zonedFromWallClock } from './dockTime.ts'

// ---------------------------------------------------------------------------
// The load board's own API, turned into the planner's Roster.
//
// Four answers the load board already gives, and not a request more:
//
//   GET /api/roster                every driver, home town, job, current load
//   GET /api/telematics/positions  where each truck is, and who is in it
//   GET /api/telematics/hours      each driver's clocks, from GeoTab
//   GET /api/telematics/zones      the fleet's named places, with centres
//
// Pure: the payloads in, a Roster out. loadboardAdapter.ts does the asking.
// Like the fixture adapter this is the load board's half of the handshake and
// does not port -- but it is the worked example of what the host's adapter
// has to do with its own data.
//
// Coordinates come from GeoTab ZONES, the same way the load map places a
// stop: "WATERLOO, IA" is a 3 km box named exactly as the board spells the
// town, and its centre is the town. A home town or a delivery with no zone of
// that name has no coordinates, and the planner says so rather than guessing.
// ---------------------------------------------------------------------------

/** One row of GET /api/roster -- only the fields used here. `home` and `job`
 * are optional because an API deployed before they were added has neither. */
export interface ApiRosterDriver {
  driverCode: string
  name: string
  unitNo: string | null
  home?: { city: string | null; state: string | null } | null
  job?: string | null
  currentLoad: {
    id: string
    status: string
    destination: string | null
    /** Naive local wall-clock at the dock: "2026-09-28T16:00:00". */
    deliveryEnd: string | null
  } | null
}

export interface ApiTruck {
  unitNo: string
  reported: boolean
  dateTime: string | null
  latitude: number | null
  longitude: number | null
  near?: string | null
  /** Who GeoTab says is in the seat right now. */
  driver: { driverCode: string | null; name: string | null } | null
}

export interface ApiPositions {
  asOf: string
  trucks: ApiTruck[]
}

export interface ApiHoursRow {
  driverCode: string
  hasAvailability: boolean
  driving: number | null
  duty: number | null
  workday: number | null
  cycle: number | null
  rest: number | null
  statusLabel: string | null
}

export interface ApiHours {
  asOf: string
  drivers: ApiHoursRow[]
}

export interface ApiZones {
  zones: { name: string; key?: string; latitude: number; longitude: number }[]
}

// Trimmed, single-spaced, upper-cased: the same key the load board's map and
// ETA use to find a zone, so a place matches here exactly when it matches there.
export function zoneKey(name: string | null | undefined): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

// "OTR Driver" -> "OTR". The board's `job` column is free text written for a
// pay statement, so this looks for the word rather than the whole value, and
// a job it cannot read is null -- the planner then uses its default limit.
export function jobTypeOf(job: string | null | undefined): JobType | null {
  const j = String(job || '')
  if (/\bOTR\b|over[- ]the[- ]road/i.test(j)) return 'OTR'
  if (/regional/i.test(j)) return 'Regional'
  if (/dedicated/i.test(j)) return 'Dedicated'
  if (/local/i.test(j)) return 'Local'
  return null
}

export function buildLoadboardRoster({ roster, positions, hours, zones }: {
  roster: ApiRosterDriver[]
  positions: ApiPositions
  hours: ApiHours
  zones: ApiZones
}): Roster {
  const zoneByKey = new Map(zones.zones.map((z) => [z.key || zoneKey(z.name), z]))
  const hoursByCode = new Map(hours.drivers.map((h) => [h.driverCode, h]))

  const placeAt = (place: string | null): Place => {
    const zone = place ? zoneByKey.get(zoneKey(place)) : undefined
    return { place, latitude: zone ? zone.latitude : null, longitude: zone ? zone.longitude : null }
  }

  const drivers: Driver[] = roster.map((d) => {
    // The truck GeoTab says this driver is sitting in beats the one the roster
    // says is theirs: a swap is exactly when the regular truck is somewhere else.
    const truck = positions.trucks.find((t) => t.driver?.driverCode === d.driverCode)
      || positions.trucks.find((t) => d.unitNo !== null && t.unitNo === d.unitNo)
      || null

    const position: Position | null = truck && truck.reported && truck.latitude !== null && truck.longitude !== null
      ? { near: truck.near ?? null, latitude: truck.latitude, longitude: truck.longitude, reportedAt: truck.dateTime }
      : null

    const row = hoursByCode.get(d.driverCode)
    const clocks: Hours | null = row && row.hasAvailability
      ? { driving: row.driving, duty: row.duty, cycle: row.cycle, rest: row.rest, workday: row.workday, statusLabel: row.statusLabel }
      : null

    const city = d.home?.city?.trim() || null
    const state = d.home?.state?.trim() || null
    const homePlace = city && state ? `${city}, ${state}` : city

    const load = d.currentLoad
    const zone = load ? STATE_ZONES[stateOf(load.destination) || ''] : undefined

    return {
      driverCode: d.driverCode,
      name: d.name,
      jobType: jobTypeOf(d.job),
      unitNo: truck ? truck.unitNo : d.unitNo,
      home: placeAt(homePlace),
      position,
      hours: clocks,
      currentLoad: load
        ? {
          id: load.id,
          finalStop: placeAt(load.destination),
          // The end of the delivery window: when the truck should be empty if
          // the load is on time. The ETA route knows better, but it is a
          // metered call per load, and a roster of twenty would be twenty.
          emptyAt: zone ? zonedFromWallClock(load.deliveryEnd, zone) : null,
        }
        : null,
      routeHome: null,
      // Nothing in the load board records home time yet -- no last-home date,
      // no requests. That is the Driver Home Time Schedule's data, and until it
      // exists every driver is honestly "not known" rather than invented.
      homeTime: { lastHomeAt: null, requestedBy: null },
    }
  })

  return { drivers }
}
