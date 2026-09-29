// ---------------------------------------------------------------------------
// Reading the schedule out loud. Copies of the planner's formatters, not
// imports, for the planner's reason: each folder moves in one piece.
// Times show in the reader's zone, as everywhere in both tabs.
// ---------------------------------------------------------------------------

const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const SIX_DAYS_MS = 6 * 24 * 3600 * 1000

function parse(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : NaN
}

// "Tue, Sep 29, 6:00 PM"
export function formatWhen(iso: string | null | undefined): string {
  const t = parse(iso)
  return Number.isFinite(t) ? WHEN.format(t) : '—'
}

// "Tue 6:00 PM" inside the coming week, "Oct 8, 6:00 PM" beyond it.
export function formatShort(iso: string | null | undefined, asOfIso: string): string {
  const t = parse(iso)
  if (!Number.isFinite(t)) return '—'
  const asOf = Date.parse(asOfIso)
  return (Number.isFinite(asOf) && Math.abs(t - asOf) < SIX_DAYS_MS ? WEEKDAY_TIME : DATE_TIME).format(t)
}

// "4d 12h", "18h 00m", "45m".
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const total = Math.round(Math.abs(seconds) / 60)
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

// "13 h ago", "2 d ago".
export function formatAgo(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} d ago`
}

// A board column's heading: { weekday: "Mon", date: "28" }.
export function dayHeading(startMs: number): { weekday: string; date: string } {
  return { weekday: WEEKDAY.format(startMs), date: String(new Date(startMs).getDate()) }
}

// ---------------------------------------------------------------------------
// The two ends of a datetime-local input. The input speaks the browser's own
// wall clock ("2026-10-02T18:00", no zone); the contract speaks instants. A
// driver asking to be home by six means six where they are, which is where
// the browser is -- so the browser's zone is the right one to read it in.
// ---------------------------------------------------------------------------
export function toLocalInput(iso: string | null | undefined): string {
  const t = parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const t = new Date(value).getTime() // no zone in the string: read as local time
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
