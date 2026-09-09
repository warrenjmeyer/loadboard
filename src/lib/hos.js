// ---------------------------------------------------------------------------
// Reading the telematics payloads out loud.
//
// The API sends seconds and ISO timestamps because those are unambiguous;
// what a dispatcher wants to read is "6h 40m" and "12 min ago". These are
// the only places that translation happens, so a clock that shows "0h 0m"
// where it should show a dash is a bug in one file.
// ---------------------------------------------------------------------------

// Seconds remaining on a clock, as hours and minutes. Negative is "over",
// which is worth a word rather than a minus sign a tired eye slides past.
export function formatClock(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  const over = seconds < 0
  const total = Math.abs(Math.round(seconds / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  const text = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  return over ? `${text} over` : text
}

// A CSS class for a clock: fine, getting low, or gone. The thresholds are
// the ones dispatch actually uses -- under two hours of drive time is "not
// this load", not "hurry".
export function clockClass(seconds) {
  if (seconds === null || seconds === undefined) return 'clock-unknown'
  if (seconds <= 0) return 'clock-over'
  if (seconds < 2 * 3600) return 'clock-low'
  return 'clock-ok'
}

// "just now", "12 min ago", "3 h ago", "2 d ago". Minutes in, words out.
export function formatAge(minutes) {
  if (minutes === null || minutes === undefined) return null
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} d ago`
}

// A report older than this is not where the truck IS; it is where the
// truck WAS. Two hours covers a lunch stop with the key off.
export const STALE_MINUTES = 120

export function isStale(minutes) {
  return minutes === null || minutes === undefined || minutes > STALE_MINUTES
}

// A compass point from a bearing in degrees. Eight is enough: "heading W
// at 62 mph" is what the dispatcher says on the phone.
export function compass(bearing) {
  if (bearing === null || bearing === undefined) return null
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return points[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

// Links out. Both leave the app, and both are built here so the rest of the
// code never assembles a URL.
//
// The Geotab one lands on the live map with this one vehicle selected. The
// device id is Geotab's, returned by the API; the fragment syntax is the one
// MyGeotab itself writes into the address bar when you click a vehicle.
const GEOTAB_SERVER = 'https://my.geotab.com'

export function geotabMapUrl(database, deviceId) {
  if (!database || !deviceId) return null
  return `${GEOTAB_SERVER}/${encodeURIComponent(database)}/#map,liveVehicleIds:!(${encodeURIComponent(deviceId)})`
}

export function mapsUrl(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}
