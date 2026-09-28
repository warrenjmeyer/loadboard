// ---------------------------------------------------------------------------
// Reading the plan out loud.
//
// The load board has its own formatters (src/lib/format.js, src/lib/hos.js).
// These are copies of the few this feature needs, not imports, on purpose:
// the folder has to move to another app in one piece, and an import that
// reaches outside it is a file the other side does not have.
//
// Times show in the READER's zone -- a dispatcher planning a fleet reads one
// clock, their own -- and the page says so under the table.
// ---------------------------------------------------------------------------

// "10h 30m", "45m", and past a day "2d 4h": nobody plans a trip home to the
// minute once it is measured in days.
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const total = Math.round(Math.abs(seconds) / 60)
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

// "Tue, Sep 29, 12:00 PM"
export function formatWhen(iso) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? WHEN.format(ms) : '—'
}

// The table's short form. Inside the coming week a weekday is enough --
// "Tue 6:00 PM" -- and it is a third the width of the full date, which in a
// seven-column table is the difference between the status column showing and
// scrolling off the edge. Further out it names the date instead.
const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const SIX_DAYS_MS = 6 * 24 * 3600 * 1000

export function formatShort(iso, asOfIso) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const asOf = Date.parse(asOfIso)
  const near = Number.isFinite(asOf) && Math.abs(ms - asOf) < SIX_DAYS_MS
  return (near ? WEEKDAY_TIME : DATE_TIME).format(ms)
}

// "12:00 PM" -- for the end of a block that ends the day it started.
export function formatTime(iso) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? TIME.format(ms) : '—'
}

export function sameDay(a, b) {
  const x = new Date(a)
  const y = new Date(b)
  return x.toDateString() === y.toDateString()
}

export function formatMiles(miles) {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return '—'
  return Math.round(miles).toLocaleString()
}

// "12 min", "3 h", "2 d". Callers add "ago" where it belongs.
export function formatAge(minutes) {
  if (minutes === null || minutes === undefined) return null
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} d`
}
