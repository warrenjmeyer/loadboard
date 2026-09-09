// ---------------------------------------------------------------------------
// Turning what Geotab says into what the app shows. Pure functions: no
// network, no database, so every one of them is tested in
// telematicsRules.test.js against literal Geotab payloads.
//
// The joins here are the whole integration, so they are worth stating:
//
//   truck   dbo.Trucks.unit_no  ==  Geotab Device.name        ("Demo - 05")
//   driver  Drivers first+last  ==  Geotab User first+last    ("Dale Foster")
//
// Both are by NAME, the same way the route link is (src/lib/geotab.js), and
// with the same weakness: rename either side and the pairing goes quiet. A
// truck with no matching device, or a driver with no matching user, is
// reported as such rather than dropped, so the gap is visible on the page.
// ---------------------------------------------------------------------------

// Geotab durations are .NET TimeSpan strings: "10:15:00", "1.02:03:04"
// (one day, two hours), "-00:30:00" when a clock is in violation, and
// "00:00:00.0000000" with fractional seconds when nothing is left. Seconds
// out, whole, sign kept. Anything unreadable is null, never 0 -- an unknown
// clock and an exhausted one are different facts.
function parseTimeSpan(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null
  const m = /^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(String(value).trim())
  if (!m) return null
  const [, sign, days, h, min, s] = m
  const total = (Number(days || 0) * 24 + Number(h)) * 3600 + Number(min) * 60 + Number(s)
  return sign ? -total : total
}

// How old a report is, in whole minutes. null for a missing or unreadable
// time; never negative, because a clock a few seconds ahead of ours is not
// a report from the future.
function ageMinutes(iso, now = new Date()) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 60000))
}

// Geotab speaks km/h. The board speaks mph.
function kphToMph(kph) {
  if (kph === null || kph === undefined || !Number.isFinite(Number(kph))) return null
  return Math.round(Number(kph) * 0.621371)
}

// "Dale Foster" and "dale  foster" are the same person. Whitespace
// collapsed and case folded, which is exactly as much normalising as two
// systems seeded from the same list need.
function nameKey(first, last) {
  return `${first || ''} ${last || ''}`.replace(/\s+/g, ' ').trim().toUpperCase()
}

// Match Geotab users to dbo.Drivers rows by name. Returns
//   { byCode: Map<driverCode, geotabUserId>, byUserId: Map<geotabUserId, driverCode>, unmatched: [driverCode...] }
// Two Geotab users with one name is a real possibility on a demo database
// (the stock demo ships duplicate names); the first is taken and it is not
// an error, because nothing here can tell which is meant.
function matchDrivers(geotabUsers, drivers) {
  const byName = new Map()
  for (const u of geotabUsers || []) {
    const key = nameKey(u.firstName, u.lastName)
    if (key && !byName.has(key)) byName.set(key, u.id)
  }
  const byCode = new Map()
  const byUserId = new Map()
  const unmatched = []
  for (const d of drivers || []) {
    const id = byName.get(nameKey(d.firstName, d.lastName))
    if (id) {
      byCode.set(d.driverCode, id)
      byUserId.set(id, d.driverCode)
    } else {
      unmatched.push(d.driverCode)
    }
  }
  return { byCode, byUserId, unmatched }
}

// A truck's row on the positions list. `truck` is the app's record (from
// dbo.Trucks, with its regular driver and current load already joined);
// `device` and `status` are Geotab's, either of which may be missing.
//
// `driverCode` is who Geotab says is in the seat right now -- a DriverChange
// record, which is what the Drive app writes -- mapped back to our code. It
// can differ from the regular driver, and when it does the page says so.
function positionRow(truck, device, status, users, byUserId, now = new Date()) {
  const row = {
    unitNo: truck.unitNo,
    status: truck.status,
    regularDriver: truck.regularDriver || null,
    currentLoad: truck.currentLoad || null,
    geotabDeviceId: device ? device.id : null,
    reported: false,
    dateTime: null,
    ageMinutes: null,
    latitude: null,
    longitude: null,
    speedMph: null,
    bearing: null,
    isDriving: false,
    communicating: false,
    driver: null,
  }
  if (!device) return row
  if (!status) return row

  row.reported = Boolean(status.dateTime)
  row.dateTime = status.dateTime || null
  row.ageMinutes = ageMinutes(status.dateTime, now)
  row.latitude = Number.isFinite(status.latitude) ? Number(status.latitude.toFixed(5)) : null
  row.longitude = Number.isFinite(status.longitude) ? Number(status.longitude.toFixed(5)) : null
  row.speedMph = kphToMph(status.speed)
  row.bearing = Number.isFinite(status.bearing) && status.bearing >= 0 ? Math.round(status.bearing) : null
  row.isDriving = Boolean(status.isDriving)
  row.communicating = Boolean(status.isDeviceCommunicating)

  const driverId = status.driver && typeof status.driver === 'object' ? status.driver.id : status.driver
  if (driverId && driverId !== 'UnknownDriverId') {
    const u = (users || []).find((x) => x.id === driverId)
    row.driver = {
      driverCode: byUserId.get(driverId) || null,
      name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : null,
    }
  }
  return row
}

// Every truck's position, one row per truck in dbo.Trucks, in unit order.
// The app's fleet is the list; Geotab annotates it. A device Geotab has that
// the app does not is not a truck as far as dispatch is concerned.
function positionRows({ trucks, devices, statuses, users, drivers }, now = new Date()) {
  const deviceByName = new Map((devices || []).map((d) => [String(d.name || '').trim(), d]))
  const statusByDevice = new Map()
  for (const s of statuses || []) {
    const id = s.device && typeof s.device === 'object' ? s.device.id : s.device
    if (id) statusByDevice.set(id, s)
  }
  const { byUserId } = matchDrivers(users, drivers)
  return (trucks || [])
    .map((t) => {
      const device = deviceByName.get(String(t.unitNo).trim()) || null
      const status = device ? statusByDevice.get(device.id) || null : null
      return positionRow(t, device, status, users, byUserId, now)
    })
    .sort((a, b) => a.unitNo.localeCompare(b.unitNo, undefined, { numeric: true }))
}

// The duty statuses that describe where a driver IS, as opposed to the
// annotations (certifications, login, exemptions) that share the log.
// Yard move counts as on duty and personal conveyance as off, which is how
// the regulation treats them; the label keeps the finer word.
const DUTY_STATES = {
  OFF: { label: 'Off duty', group: 'OFF' },
  SB: { label: 'Sleeper berth', group: 'OFF' },
  D: { label: 'Driving', group: 'D' },
  ON: { label: 'On duty', group: 'ON' },
  YM: { label: 'Yard move', group: 'ON' },
  PC: { label: 'Personal conveyance', group: 'OFF' },
  WT: { label: 'Wait time', group: 'ON' },
}

function isDutyState(status) {
  return Boolean(status && DUTY_STATES[status])
}

// The most recent duty-state log for a driver. Geotab's list is not
// guaranteed ordered and includes certification and login entries that say
// nothing about duty status; those are skipped.
function latestDutyLog(logs) {
  let best = null
  for (const l of logs || []) {
    if (!isDutyState(l.status) || !l.dateTime) continue
    if (!best || Date.parse(l.dateTime) > Date.parse(best.dateTime)) best = l
  }
  return best
}

// A driver's hours row. `availability` is Geotab's DutyStatusAvailability
// for this driver (or null when they have none -- a user who is not an HOS
// driver, or a database with no logs); `logs` are their recent
// DutyStatusLogs, from which the current status is taken.
//
// Clocks are in seconds remaining; negative means over. null means Geotab did
// not say, and the page shows a dash for it rather than a zero.
function hosRow(driver, availability, logs, now = new Date()) {
  const latest = latestDutyLog(logs)
  const state = latest ? DUTY_STATES[latest.status] : null
  const a = availability || null
  return {
    driverCode: driver.driverCode,
    name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
    driverType: driver.driverType || null,
    unitNo: driver.unitNo || null,
    matched: Boolean(driver.geotabUserId),
    status: latest ? latest.status : null,
    statusLabel: state ? state.label : null,
    statusGroup: state ? state.group : null,
    statusSince: latest ? latest.dateTime : null,
    statusMinutes: latest ? ageMinutes(latest.dateTime, now) : null,
    hasAvailability: Boolean(a),
    driving: a ? parseTimeSpan(a.driving) : null,
    duty: a ? parseTimeSpan(a.duty) : null,
    workday: a ? parseTimeSpan(a.workday) : null,
    cycle: a ? parseTimeSpan(a.cycle) : null,
    rest: a ? parseTimeSpan(a.rest) : null,
    cycleRest: a ? parseTimeSpan(a.cycleRest) : null,
    exemptions: {
      sixteenHour: Boolean(a && a.is16HourExemptionAvailable),
      adverseDriving: Boolean(a && a.isAdverseDrivingExemptionAvailable),
      offDutyDeferral: Boolean(a && a.isOffDutyDeferralExemptionAvailable),
    },
  }
}

// Which clock runs out first, and whether any already has. The page uses it
// to sort the roster so the driver dispatch cannot legally send anywhere is
// at the top of the list rather than found by reading twenty-four rows.
function tightestClock(row) {
  const clocks = [
    ['driving', row.driving],
    ['duty', row.duty],
    ['workday', row.workday],
    ['cycle', row.cycle],
  ].filter(([, v]) => v !== null && v !== undefined)
  if (clocks.length === 0) return null
  clocks.sort((x, y) => x[1] - y[1])
  return { clock: clocks[0][0], seconds: clocks[0][1], over: clocks[0][1] < 0 }
}

module.exports = {
  parseTimeSpan,
  ageMinutes,
  kphToMph,
  nameKey,
  matchDrivers,
  positionRow,
  positionRows,
  DUTY_STATES,
  isDutyState,
  latestDutyLog,
  hosRow,
  tightestClock,
}
