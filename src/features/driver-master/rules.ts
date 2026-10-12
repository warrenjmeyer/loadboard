import { DRIVER_TYPES, PAY_BASES, PAY_FREQUENCIES } from './contract.ts'
import type { DriverChanges, DriverDetails, DriverPay, DriverRecord, DriverSummary, DriverType, NewDriver, PayFrequency } from './contract.ts'

// ---------------------------------------------------------------------------
// THE DRIVER MASTER'S RULES: what a driver must be to be stored, what a save
// may change and who may change it. Pure functions, no React, no I/O -- the
// form shows these problems beside each field, the sample adapter refuses
// with them, and the host's server refuses with the same words
// (src/features/sql/10_driver_writes.sql).
//
// Lengths are DRVR.Drivers' columns. A value longer than its column would be
// cut short or refused by SQL Server; saying so here, beside the field, is
// kinder than either.
// ---------------------------------------------------------------------------

/** A field's problem, by field name. Empty means fine. */
export type Problems = Record<string, string>

export const LIMITS = {
  driverCode: 20, firstName: 50, lastName: 50, address1: 100, address2: 100, city: 60, state: 2, postalCode: 10,
  country: 40, job: 60, jobType: 60, location: 60, department: 60, unitNo: 20, truckDescription: 80, payGroup: 20,
} as const

/** The fifty states and DC, for a driver whose country is the USA. */
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = { W: 'Weekly', B: 'Every two weeks', S: 'Twice a month', M: 'Monthly' }
export const DRIVER_TYPE_LABEL: Record<DriverType, string> = { COMPANY: 'Company driver', OWNER: 'Owner/operator' }

/** A driver code: letters and digits, upper case -- "TBOONE". It is the join
 * to the load board, GeoTab and every other tab, so it never changes once
 * made. */
export const CODE_PATTERN = /^[A-Z0-9]{2,20}$/

const DETAIL_KEYS = ['firstName', 'lastName', 'address1', 'address2', 'city', 'state', 'postalCode', 'country', 'job', 'jobType', 'location', 'department', 'unitNo', 'truckDescription'] as const
const OPTIONAL_KEYS = new Set<string>(['address2', 'unitNo', 'truckDescription'])
const PAY_KEYS = ['ssnLast4', 'payRate', 'payFrequency', 'payBasis', 'payGroup'] as const

const LABEL: Record<string, string> = {
  driverCode: 'Driver code', firstName: 'First name', lastName: 'Last name', address1: 'Address', address2: 'Address line 2',
  city: 'City', state: 'State', postalCode: 'ZIP code', country: 'Country', job: 'Job', jobType: 'Job type', location: 'Location',
  department: 'Department', unitNo: 'Truck', truckDescription: 'Truck description', ssnLast4: 'SSN last four',
  payRate: 'Pay rate', payFrequency: 'Pay frequency', payBasis: 'Pay basis', payGroup: 'Pay group', driverType: 'Driver type',
}

// ---- Tidying what was typed -------------------------------------------------

const tidy = (v: string) => v.replace(/\s+/g, ' ').trim()

/** Spaces tidied, the state in capitals, an empty optional field as null. */
export function normalizeDetails(d: DriverDetails): DriverDetails {
  const out = { ...d }
  for (const k of DETAIL_KEYS) {
    const v = d[k]
    const t = typeof v === 'string' ? tidy(v) : null
    ;(out as Record<string, string | null>)[k] = OPTIONAL_KEYS.has(k) ? (t ? t : null) : (t ?? '')
  }
  out.state = out.state.toUpperCase()
  out.country = out.country || 'USA'
  return out
}

export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase()
}

// ---- What a driver must be ----------------------------------------------------

function length(problems: Problems, key: string, value: string | null): void {
  const max = (LIMITS as Record<string, number>)[key]
  if (value && max && value.length > max) problems[key] = `${LABEL[key]} is ${value.length} characters; it can be ${max} at most.`
}

/** Problems with who the driver is and where they live. */
export function checkDetails(raw: DriverDetails): Problems {
  const d = normalizeDetails(raw)
  const problems: Problems = {}
  for (const k of DETAIL_KEYS) {
    if (!OPTIONAL_KEYS.has(k) && !d[k]) problems[k] = `${LABEL[k]} is needed.`
    else length(problems, k, d[k])
  }
  if (d.country.toUpperCase() === 'USA') {
    if (d.state && !(US_STATES as readonly string[]).includes(d.state)) problems.state = `${d.state} is not a US state. Use its two letters: IA, IL, NE...`
    if (d.postalCode && !/^\d{5}(-\d{4})?$/.test(d.postalCode)) problems.postalCode = 'A ZIP code is five digits, or five and four: 52401 or 52401-1234.'
  }
  return problems
}

/** Problems with how they are paid. */
export function checkPay(p: DriverPay, driverType: DriverType): Problems {
  const problems: Problems = {}
  if (!(DRIVER_TYPES as readonly string[]).includes(driverType)) problems.driverType = 'Choose company driver or owner/operator.'
  if (!/^\d{4}$/.test(String(p.ssnLast4 ?? '').trim())) problems.ssnLast4 = 'The last four digits of their SSN: four digits, no more.'
  if (typeof p.payRate !== 'number' || !Number.isFinite(p.payRate)) problems.payRate = 'Pay rate is needed, as a number.'
  else if (p.payRate < 0) problems.payRate = 'Pay rate cannot be below zero.'
  else if (p.payBasis === 'PERCENTAGE' && (p.payRate <= 0 || p.payRate > 1)) problems.payRate = 'A share of the linehaul is a fraction: 0.68 for 68%.'
  else if (p.payRate > 99999.9999) problems.payRate = 'Pay rate is too large to store.'
  else if (Math.abs(p.payRate * 10000 - Math.round(p.payRate * 10000)) > 1e-6) problems.payRate = 'Pay rate keeps four decimal places at most.'
  if (!(PAY_FREQUENCIES as readonly string[]).includes(p.payFrequency)) problems.payFrequency = 'Choose how often they are paid.'
  if (!tidy(String(p.payGroup ?? ''))) problems.payGroup = 'Pay group is needed.'
  else length(problems, 'payGroup', tidy(p.payGroup))
  // The load board's CK_Drivers_paybasis: an owner has a basis, a company driver none.
  if (driverType === 'OWNER' && !(PAY_BASES as readonly (string | null)[]).includes(p.payBasis)) problems.payBasis = 'An owner/operator is paid by the mile or by a share of the linehaul. Choose one.'
  if (driverType === 'COMPANY' && p.payBasis !== null) problems.payBasis = 'A company driver has no pay basis.'
  return problems
}

/** Problems with a new driver, the code included. `taken` is every code in
 * use, active or not -- a code is never reused. */
export function checkNewDriver(n: NewDriver, taken: readonly string[]): Problems {
  const problems: Problems = { ...checkDetails(n), ...checkPay(n.pay, n.driverType) }
  const code = normalizeCode(n.driverCode || '')
  if (!code) problems.driverCode = 'Driver code is needed.'
  else if (!CODE_PATTERN.test(code)) problems.driverCode = 'A driver code is 2 to 20 letters and digits: TBOONE.'
  else if (taken.some((t) => t.toUpperCase() === code)) problems.driverCode = `${code} is taken. Codes are never reused, even for a driver who has left.`
  return problems
}

/** A record's problems as one paragraph, for a refusal. */
export function sentence(problems: Problems): string {
  return Object.values(problems).join(' ')
}

// ---- What a save may change -------------------------------------------------

/** Only the fields that differ between the driver as read and the form as
 * it stands -- what a save sends. Pay only when the record came with pay
 * (an admin's); a form that was never shown it cannot change it. */
export function changesBetween(before: DriverRecord, after: { details: DriverDetails; driverType: DriverType; pay: DriverPay | null }): DriverChanges {
  const was = normalizeDetails(before)
  const now = normalizeDetails(after.details)
  const changes: DriverChanges = {}
  for (const k of DETAIL_KEYS) if (was[k] !== now[k]) (changes as Record<string, unknown>)[k] = now[k]
  if (before.pay && after.pay) {
    if (after.driverType !== before.driverType) changes.driverType = after.driverType
    const pay: Partial<DriverPay> = {}
    for (const k of PAY_KEYS) {
      const a = k === 'ssnLast4' || k === 'payGroup' ? tidy(String(after.pay[k])) : after.pay[k]
      if (a !== before.pay[k]) (pay as Record<string, unknown>)[k] = a
    }
    if (Object.keys(pay).length > 0) changes.pay = pay
  }
  return changes
}

export function hasChanges(changes: DriverChanges): boolean {
  return Object.keys(changes).length > 0
}

export const STALE_MESSAGE = (code: string) => `${code} was changed by someone else since you opened it. Close it and open it again to see what changed.`
export const PAY_IS_ADMINS = 'Only an admin changes pay, the SSN or the driver type.'

/** A save, as the server must take it: on the version read, by someone
 * allowed to make it, leaving a driver fit to store. The new version is the
 * store's to give, not this. */
export function applyChanges(record: DriverRecord & { pay: DriverPay }, version: string, changes: DriverChanges, { canChangePay }: { canChangePay: boolean }): { record: DriverRecord & { pay: DriverPay } } | { error: string } {
  if (version !== record.version) return { error: STALE_MESSAGE(record.driverCode) }
  if ((changes.pay !== undefined || changes.driverType !== undefined) && !canChangePay) return { error: PAY_IS_ADMINS }
  const unknown = Object.keys(changes).filter((k) => !(DETAIL_KEYS as readonly string[]).includes(k) && k !== 'pay' && k !== 'driverType')
  if (unknown.length > 0) return { error: `${unknown.join(', ')} cannot be changed here.` }
  const details = normalizeDetails({ ...record, ...pick(changes) })
  const driverType = changes.driverType ?? record.driverType
  const pay: DriverPay = { ...record.pay, ...changes.pay }
  if (typeof pay.ssnLast4 === 'string') pay.ssnLast4 = pay.ssnLast4.trim()
  if (typeof pay.payGroup === 'string') pay.payGroup = tidy(pay.payGroup)
  const problems = { ...checkDetails(details), ...checkPay(pay, driverType) }
  if (Object.keys(problems).length > 0) return { error: sentence(problems) }
  return { record: { ...record, ...details, driverType, pay } }
}

function pick(changes: DriverChanges): Partial<DriverDetails> {
  const out: Partial<DriverDetails> = {}
  for (const k of DETAIL_KEYS) if (k in changes) (out as Record<string, unknown>)[k] = changes[k]
  return out
}

/** A driver leaving or coming back, on the version read. */
export function applyActive<R extends DriverRecord>(record: R, version: string, active: boolean): { record: R } | { error: string } {
  if (version !== record.version) return { error: STALE_MESSAGE(record.driverCode) }
  return { record: { ...record, isActive: active } }
}

// ---- Helping the person typing ----------------------------------------------

/** A code in the house style -- first initial and last name, "TBOONE" -- that
 * nobody has: TBOONE2, TBOONE3... when it is taken. Empty until there is a
 * last name to make it from. */
export function suggestCode(firstName: string, lastName: string, taken: readonly string[]): string {
  const letters = (s: string) => s.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase()
  const last = letters(lastName)
  if (!last) return ''
  const base = (letters(firstName).slice(0, 1) + last).slice(0, LIMITS.driverCode)
  const used = new Set(taken.map((t) => t.toUpperCase()))
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const tail = String(n)
    const candidate = base.slice(0, LIMITS.driverCode - tail.length) + tail
    if (!used.has(candidate)) return candidate
  }
}

/** Whether a line of the list matches what was typed in the search box:
 * every word somewhere in the code, name, home town or truck. */
export function matchesSearch(d: DriverSummary, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [d.driverCode, d.firstName, d.lastName, d.city, d.state, d.unitNo || '', d.job].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Last name, then first, then code -- how a dispatcher looks for someone. */
export function byName(a: DriverSummary, b: DriverSummary): number {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.driverCode.localeCompare(b.driverCode)
}

export function fullName(d: { firstName: string; lastName: string }): string {
  return `${d.firstName} ${d.lastName}`.trim()
}

/** "$1.8800 a mile, weekly" or "68% of the linehaul, weekly". */
export function describePay(pay: DriverPay): string {
  const how = pay.payBasis === 'PERCENTAGE'
    ? `${Math.round(pay.payRate * 10000) / 100}% of the linehaul`
    : `$${pay.payRate.toFixed(4)} a mile`
  return `${how}, ${PAY_FREQUENCY_LABEL[pay.payFrequency].toLowerCase()}`
}

/** How the planner will count this job for home time: the planner's
 * jobTypeOf (get-me-home/adapters/loadboardRoster.ts), written again so this
 * folder moves on its own -- sampleData.test.ts checks the two agree. Null
 * means no rule matches and the planner uses its default. */
export function homeTimeRule(job: string | null | undefined): 'OTR' | 'Regional' | 'Dedicated' | 'Local' | null {
  const j = String(job || '')
  if (/\bOTR\b|over[- ]the[- ]road/i.test(j)) return 'OTR'
  if (/regional/i.test(j)) return 'Regional'
  if (/dedicated/i.test(j)) return 'Dedicated'
  if (/local/i.test(j)) return 'Local'
  return null
}

/** A list line from a record -- what loadDriverList returns for each. */
export function summaryOf(r: DriverRecord): DriverSummary {
  return {
    driverCode: r.driverCode, firstName: r.firstName, lastName: r.lastName, city: r.city, state: r.state,
    job: r.job, driverType: r.driverType, unitNo: r.unitNo, isActive: r.isActive, hasLogin: r.hasLogin,
  }
}

/** An empty form for a new driver. */
export function blankNewDriver(): NewDriver {
  return {
    driverCode: '', firstName: '', lastName: '', address1: '', address2: null, city: '', state: '', postalCode: '', country: 'USA',
    job: '', jobType: '', location: '', department: '', unitNo: null, truckDescription: null,
    driverType: 'COMPANY', pay: { ssnLast4: '', payRate: 0, payFrequency: 'W', payBasis: null, payGroup: '' },
  }
}
