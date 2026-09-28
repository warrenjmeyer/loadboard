import { JOB_TYPES } from './planHome.js'

// ---------------------------------------------------------------------------
// THE CONTRACT: what the planner needs from whatever app it is running in.
//
// This file is the handshake between two codebases that cannot see each
// other. The load board fills it from its own API; the host app fills it
// from its own. The planner reads nothing else -- no URL, no token, no
// global -- so an adapter that returns this shape is the whole integration.
//
// fixtures/roster.json is a complete, valid example of it. checkRoster
// below is how an adapter proves it matches: run it over the adapter's
// output, and an empty array means the planner will understand every field.
//
// Units, once more because they are the thing a port gets wrong:
//   durations   SECONDS
//   moments     ISO 8601 WITH A ZONE, "2026-09-29T17:00:00Z" or "...-05:00"
//   positions   decimal degrees, WGS84 -- what every GPS and map API uses
// ---------------------------------------------------------------------------

/**
 * What an adapter hands the planner.
 *
 * @typedef {object} Adapter
 * @property {(args: { organizationId: (string|null), signal: AbortSignal }) => Promise<Roster>} loadRoster
 *   Fetch the roster for one organisation. `signal` aborts when the planner
 *   unmounts or asks again; pass it to fetch/axios. Keep the adapter object
 *   STABLE (module scope or useMemo) -- a new object every render is a new
 *   request every render.
 */

/**
 * @typedef {object} Roster
 * @property {string} [asOf]  Plan as of this moment. Leave it out for live
 *   data (the planner uses the clock); sample data pins it so it never drifts.
 * @property {Policy} [policy]  The company's own limits. Any field left out
 *   falls back to DEFAULT_POLICY in planHome.js.
 * @property {Driver[]} drivers
 */

/**
 * @typedef {object} Policy
 * @property {Object<string, number>} [maxDaysOut]  Days out before a driver is
 *   overdue home, by jobType: { OTR: 21, Regional: 7, Dedicated: 7, Local: 1 }
 * @property {number} [defaultMaxDaysOut]  For a jobType not in maxDaysOut.
 * @property {number} [dueSoonDays]  How many days before the limit counts as "soon".
 */

/**
 * One driver. Only driverCode, name and home are required; every other field
 * may be null, and the planner says what it could not work out rather than
 * guessing.
 *
 * @typedef {object} Driver
 * @property {string} driverCode  Stable key for the driver.
 * @property {string} name
 * @property {('OTR'|'Regional'|'Dedicated'|'Local')} jobType  Picks the days-out limit.
 * @property {string|null} unitNo  The truck, for display.
 * @property {Place} home  Where "home" is. Needs coordinates to be planned.
 * @property {Position|null} position  Where the truck last reported.
 * @property {Hours|null} hours  Hours-of-service clocks as they are NOW.
 * @property {CurrentLoad|null} currentLoad  A load the driver must finish first.
 * @property {Route|null} [routeHome]  A real road route home, if the host has one.
 *   Measured from the load's final stop when there is a currentLoad, otherwise
 *   from the position. Without it the planner estimates (straight line x 1.2).
 * @property {HomeTime} homeTime
 */

/**
 * @typedef {object} Place
 * @property {string} place  "Cedar Rapids, IA" -- what a dispatcher reads.
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {object} Position
 * @property {string|null} near  "Kansas City, MO"
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} reportedAt  When the truck said so. Older than two hours
 *   and the planner warns that the truck has moved since.
 */

/**
 * Seconds LEFT on each clock. Negative means over (treated as zero); null
 * means the ELD did not say. These are the names Geotab's
 * DutyStatusAvailability uses, converted from TimeSpan to seconds.
 *
 * @typedef {object} Hours
 * @property {number|null} driving  Left on the 11-hour driving limit.
 * @property {number|null} duty  Left in the 14-hour on-duty window.
 * @property {number|null} cycle  Left in the 60/70-hour cycle.
 * @property {number|null} [rest]  Driving left before the 30-minute break is due.
 * @property {number|null} [workday]  Where the rule set has one.
 * @property {string|null} [statusLabel]  "Driving", "Off duty" -- display only.
 */

/**
 * @typedef {object} CurrentLoad
 * @property {string} id
 * @property {Place} finalStop  The last delivery. The trip home starts here.
 * @property {string|null} emptyAt  When the truck will be empty at finalStop.
 * @property {Hours|null} [hoursAtEmpty]  Clocks expected at emptyAt, if the host
 *   can project them. Without it the trip home opens with a 10-hour rest.
 */

/**
 * @typedef {object} Route
 * @property {number} miles
 * @property {number} driveSeconds  Driving time only; the planner adds the rest.
 * @property {string} [source]  "here-truck", "google", ... -- shown to the dispatcher.
 */

/**
 * The home-time record. This is what the Driver Home Time Schedule keeps;
 * the planner only reads it.
 *
 * @typedef {object} HomeTime
 * @property {string|null} lastHomeAt  When they were last home. Counts days out.
 * @property {string|null} requestedBy  Home by this moment, if a request is open.
 * @property {string|null} [note]  The reason, in the driver's words, if given.
 */

const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/

function checkMoment(problems, where, value, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    problems.push(`${where} is not an ISO 8601 date-time: ${JSON.stringify(value)}`)
  } else if (!ZONED.test(value)) {
    problems.push(`${where} has no time zone (end it in Z or +hh:mm): ${value}`)
  }
}

function checkPlace(problems, where, p, { required = false } = {}) {
  if (p === null || p === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  for (const k of ['latitude', 'longitude']) {
    if (p[k] !== null && p[k] !== undefined && typeof p[k] !== 'number') {
      problems.push(`${where}.${k} must be a number, not ${JSON.stringify(p[k])}`)
    }
  }
}

function checkHours(problems, where, h) {
  if (h === null || h === undefined) return
  for (const k of ['driving', 'duty', 'cycle', 'rest', 'workday']) {
    const v = h[k]
    if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isFinite(v))) {
      problems.push(`${where}.${k} must be seconds as a number, not ${JSON.stringify(v)}`)
    }
  }
  // The classic unit mistake: hours sent where seconds were wanted. Eleven
  // "seconds" of driving is a driver who cannot move.
  if (typeof h.driving === 'number' && h.driving > 0 && h.driving <= 14) {
    problems.push(`${where}.driving is ${h.driving} -- that looks like hours; the contract wants seconds`)
  }
}

// ---------------------------------------------------------------------------
// Every way a roster fails to match the contract, as sentences. An empty
// array means it matches. Meant for an adapter's tests and for a console
// line during the port -- not for the screen.
// ---------------------------------------------------------------------------
export function checkRoster(roster) {
  if (!roster || typeof roster !== 'object') return ['the roster must be an object']
  if (!Array.isArray(roster.drivers)) return ['roster.drivers must be an array']

  const problems = []
  checkMoment(problems, 'roster.asOf', roster.asOf)

  const seen = new Set()
  roster.drivers.forEach((d, i) => {
    const at = `drivers[${i}]${d && d.driverCode ? ` (${d.driverCode})` : ''}`
    if (!d || typeof d !== 'object') {
      problems.push(`${at} is not an object`)
      return
    }
    if (!d.driverCode) problems.push(`${at}.driverCode is required`)
    else if (seen.has(d.driverCode)) problems.push(`${at}.driverCode is a duplicate`)
    seen.add(d.driverCode)

    if (!d.name) problems.push(`${at}.name is required`)
    if (d.jobType && !JOB_TYPES.includes(d.jobType)) {
      problems.push(`${at}.jobType "${d.jobType}" is not one of ${JOB_TYPES.join(', ')} -- the default days-out limit will be used`)
    }
    if (!d.home || !d.home.place) problems.push(`${at}.home.place is required`)
    checkPlace(problems, `${at}.home`, d.home, { required: true })
    checkPlace(problems, `${at}.position`, d.position)
    if (d.position) checkMoment(problems, `${at}.position.reportedAt`, d.position.reportedAt)
    checkHours(problems, `${at}.hours`, d.hours)

    if (d.currentLoad) {
      checkPlace(problems, `${at}.currentLoad.finalStop`, d.currentLoad.finalStop, { required: true })
      checkMoment(problems, `${at}.currentLoad.emptyAt`, d.currentLoad.emptyAt)
      checkHours(problems, `${at}.currentLoad.hoursAtEmpty`, d.currentLoad.hoursAtEmpty)
    }
    if (d.routeHome) {
      for (const k of ['miles', 'driveSeconds']) {
        if (typeof d.routeHome[k] !== 'number') problems.push(`${at}.routeHome.${k} must be a number`)
      }
    }

    if (!d.homeTime || typeof d.homeTime !== 'object') {
      problems.push(`${at}.homeTime is required (its fields may be null)`)
    } else {
      checkMoment(problems, `${at}.homeTime.lastHomeAt`, d.homeTime.lastHomeAt)
      checkMoment(problems, `${at}.homeTime.requestedBy`, d.homeTime.requestedBy)
    }
  })
  return problems
}
