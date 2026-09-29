// ---------------------------------------------------------------------------
// Reading load plans out loud. Copies of the other tabs' formatters, not
// imports, for their reason: each folder moves in one piece. Times show in
// the reader's zone, as everywhere in these tabs.
// ---------------------------------------------------------------------------
import type { Place, PlanLoad } from './contract.ts'

const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const WEEKDAY_TIME = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const MONEY = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
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

// A window: "Mon 1:00 PM – 3:00 PM", or both ends in full when they fall on
// different days. One end missing shows the other alone.
export function formatWindow(startIso: string | null | undefined, endIso: string | null | undefined, asOfIso: string): string {
  const a = parse(startIso)
  const b = parse(endIso)
  if (!Number.isFinite(a) && !Number.isFinite(b)) return 'no time given'
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return formatShort(Number.isFinite(a) ? startIso : endIso, asOfIso)
  const sameDay = new Date(a).toDateString() === new Date(b).toDateString()
  return `${formatShort(startIso, asOfIso)} – ${sameDay ? TIME.format(b) : formatShort(endIso, asOfIso)}`
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

export function formatMiles(miles: number | null | undefined): string {
  return miles === null || miles === undefined || !Number.isFinite(miles) ? '— mi' : `${Math.round(miles).toLocaleString()} mi`
}

export function formatMoney(amount: number | null | undefined): string | null {
  return amount === null || amount === undefined || !Number.isFinite(amount) ? null : MONEY.format(amount)
}

export const placeName = (p: Place | null | undefined): string => p?.place || 'an unplaced stop'

// "Joliet, IL → Davenport, IA"
export const lane = (load: PlanLoad): string => `${placeName(load.origin)} → ${placeName(load.destination)}`

// A board column's heading: { weekday: "Mon", date: "28" }.
export function dayHeading(startMs: number): { weekday: string; date: string } {
  return { weekday: WEEKDAY.format(startMs), date: String(new Date(startMs).getDate()) }
}
