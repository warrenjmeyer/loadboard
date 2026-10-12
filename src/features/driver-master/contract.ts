// ---------------------------------------------------------------------------
// THE CONTRACT for the Driver Master tab: what it needs from the app it runs
// in, and what it asks that app to do.
//
// The driver master is DRVR.Drivers (src/features/sql/01_DRVR_Drivers.sql):
// one row per driver, kept here rather than copied in. Every other tab reads
// it -- the planner and the schedule take a driver's home from City and
// State, the planner takes how long they may be out from Job -- so this tab
// is where those facts are put right.
//
// TWO KINDS OF FIELD. Who the driver is and where they live (DriverDetails)
// is for dispatch and admin alike. How they are paid -- the SSN's last four,
// rate, basis, frequency, pay group, and whether they are a company driver or
// an owner/operator (DriverPay, and driverType) -- is for ADMIN ALONE (decided
// 2026-10-12). The server leaves `pay` out of every answer to anyone else,
// and refuses a change to it from anyone else. A screen that hides the pay
// section is being courteous; the server is what keeps it private.
//
// A driver is never deleted: their stays and load plans point at them.
// Leaving is `isActive: false`, and coming back is `true` again.
//
// No runtime imports, so plain Node can load it, and so it moves on its own.
// ---------------------------------------------------------------------------

/** ISO 8601 date-time WITH a zone. */
export type IsoMoment = string

export const DRIVER_TYPES = ['COMPANY', 'OWNER'] as const
export type DriverType = (typeof DRIVER_TYPES)[number]

/** How an owner/operator is paid: by the mile, or a share of the linehaul.
 * A company driver has none -- the load board's CK_Drivers_paybasis. */
export const PAY_BASES = ['MILEAGE', 'PERCENTAGE'] as const
export type PayBasis = (typeof PAY_BASES)[number]

/** Weekly, biweekly, semimonthly, monthly -- the load board's CK_Drivers_payfreq. */
export const PAY_FREQUENCIES = ['W', 'B', 'S', 'M'] as const
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]

/** One line of the driver list. No street address, no SSN, no pay: a list is
 * for finding a driver, and finding one needs none of those. */
export interface DriverSummary {
  driverCode: string
  firstName: string
  lastName: string
  /** Home, as a town: "Waterloo", "IA". */
  city: string
  state: string
  /** "OTR Driver", "Owner Operator"... */
  job: string
  driverType: DriverType
  /** Their regular truck. */
  unitNo: string | null
  isActive: boolean
  /** Whether a sign-in is linked to them (DRVR.Drivers.User_Uuid). Only
   * whether -- the id itself never leaves the server. Without one, a driver
   * cannot use their own screens. */
  hasLogin: boolean
}

/** Who the driver is and where they live. Dispatch and admin both see and
 * change these. */
export interface DriverDetails {
  firstName: string
  lastName: string
  address1: string
  address2: string | null
  /** City and State are also where "home" is for the planner and the
   * schedule: the town, placed on the map by the GeoTab zone of that name. */
  city: string
  state: string
  postalCode: string
  country: string
  /** Picks how long they can be out before they are overdue home. */
  job: string
  jobType: string
  location: string
  department: string
  unitNo: string | null
  truckDescription: string | null
}

/** How they are paid. ADMIN ONLY, to see and to change. */
export interface DriverPay {
  /** Last four of the SSN, "3308". Never more is stored. */
  ssnLast4: string
  /** Dollars a mile for MILEAGE and for a company driver (1.88); a fraction
   * of the linehaul for PERCENTAGE (0.68 is 68%). */
  payRate: number
  payFrequency: PayFrequency
  /** OWNER only; null for COMPANY. */
  payBasis: PayBasis | null
  payGroup: string
}

/** One driver, as loadDriver answers. */
export interface DriverRecord extends DriverDetails {
  driverCode: string
  /** Shown to dispatch; changed by admin only, since it decides how they are paid. */
  driverType: DriverType
  isActive: boolean
  hasLogin: boolean
  /** Null when the caller may not see pay -- anyone but an admin. */
  pay: DriverPay | null
  /** The row's version as the caller read it, handed back unchanged with a
   * save. If someone saved in between, the save is refused rather than
   * quietly undoing their change. Opaque: compare it, never parse it. */
  version: string
}

/** What a save changes: only the fields that changed. `driverType` and `pay`
 * are admin-only; anyone else sending them is refused. */
export type DriverChanges = Partial<DriverDetails> & {
  driverType?: DriverType
  pay?: Partial<DriverPay>
}

/** A new driver, complete. Admin only: a driver cannot be added without
 * their pay, and only an admin sees pay. */
export interface NewDriver extends DriverDetails {
  driverCode: string
  driverType: DriverType
  pay: DriverPay
}

export interface DriverList {
  /** Sorted by last name, then first. */
  drivers: DriverSummary[]
  /** What the server will let the caller do -- so the screen offers only
   * that. It says; it does not decide: the server still checks every move. */
  you: { canAdd: boolean; canSeePay: boolean }
}

/** Every read gets these. */
export interface ReadArgs {
  organizationId: string | null
  signal: AbortSignal
}

/** What the tab needs from the host. Keep it STABLE (module scope or useMemo).
 *
 * READS ARE SCOPED PER SCREEN, as in the other tabs: the list reads a line
 * per driver and no more; the editor reads one driver. scope.ts says exactly
 * what each returns.
 *
 * WHO: dispatch and admin. A driver -- anyone else -- is refused every
 * method, not answered with an empty list. Within that, pay is admin's
 * alone. The server enforces all of it from the signed-in user; the screens
 * are courteous, the server is strict. */
export interface DriverMasterAdapter {
  /** A line per driver: active ones, or every one with includeInactive.
   * WHO: dispatch or admin. */
  loadDriverList(args: ReadArgs & { includeInactive: boolean }): Promise<DriverList>
  /** One driver, everything about them -- `pay` only for an admin, null for
   * dispatch. Null for a code nobody has. WHO: dispatch or admin. */
  loadDriver(args: ReadArgs & { driverCode: string }): Promise<DriverRecord | null>
  /** Change a driver. `version` is the one read; a save over someone else's
   * newer one is refused. Resolves to the driver as stored.
   * WHO: dispatch or admin; driverType and pay, admin only. */
  saveDriver(driverCode: string, version: string, changes: DriverChanges): Promise<DriverRecord>
  /** Add a driver. The code must be new. WHO: admin. */
  addDriver(driver: NewDriver): Promise<DriverRecord>
  /** A driver leaves (false) or comes back (true). WHO: dispatch or admin. */
  setDriverActive(driverCode: string, version: string, active: boolean): Promise<DriverRecord>
}

// ---------------------------------------------------------------------------
// Checking data from outside -- `unknown`, as in the other tabs, because the
// types say what a server should send and this checks what it did.
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown) => typeof v === 'string'
const isTextOrNull = (v: unknown) => v === null || typeof v === 'string'

function fields(problems: string[], at: string, r: Rec, required: readonly string[], optional: readonly string[]): void {
  for (const k of required) if (!isText(r[k])) problems.push(`${at}.${k} must be text`)
  for (const k of optional) if (!isTextOrNull(r[k] ?? null)) problems.push(`${at}.${k} must be text or null`)
}

const SUMMARY_TEXT = ['driverCode', 'firstName', 'lastName', 'city', 'state', 'job'] as const
const DETAIL_TEXT = ['firstName', 'lastName', 'address1', 'city', 'state', 'postalCode', 'country', 'job', 'jobType', 'location', 'department'] as const
const DETAIL_OPTIONAL = ['address2', 'unitNo', 'truckDescription'] as const

/** Every way some data fails to be a DriverList, as sentences. Empty means it is.
 * Also refuses a list that carries what a list must not: a street address,
 * an SSN or pay -- a server that sends them has widened the read. */
export function checkDriverList(data: unknown): string[] {
  if (!isRec(data)) return ['the driver list must be an object']
  if (!Array.isArray(data.drivers)) return ['drivers must be an array']
  const problems: string[] = []
  if (!isRec(data.you) || typeof data.you.canAdd !== 'boolean' || typeof data.you.canSeePay !== 'boolean') {
    problems.push('you must say canAdd and canSeePay, each true or false')
  }
  const codes = new Set<string>()
  data.drivers.forEach((d: unknown, i: number) => {
    const at = `drivers[${i}]`
    if (!isRec(d)) return void problems.push(`${at} is not an object`)
    fields(problems, at, d, SUMMARY_TEXT, ['unitNo'])
    if (typeof d.driverCode === 'string') {
      if (codes.has(d.driverCode)) problems.push(`${at}.driverCode ${d.driverCode} is a duplicate`)
      codes.add(d.driverCode)
    }
    if (!(DRIVER_TYPES as readonly unknown[]).includes(d.driverType)) problems.push(`${at}.driverType must be one of ${DRIVER_TYPES.join(', ')}`)
    for (const k of ['isActive', 'hasLogin']) if (typeof d[k] !== 'boolean') problems.push(`${at}.${k} must be true or false`)
    for (const k of ['address1', 'ssnLast4', 'pay', 'payRate']) if (k in d) problems.push(`${at} carries ${k}, which a list must not`)
  })
  return problems
}

/** Every way some data fails to be a DriverRecord, as sentences. Empty means it is. */
export function checkDriverRecord(data: unknown): string[] {
  if (!isRec(data)) return ['the driver must be an object']
  const problems: string[] = []
  fields(problems, 'driver', data, ['driverCode', 'version', ...DETAIL_TEXT], DETAIL_OPTIONAL)
  if (!(DRIVER_TYPES as readonly unknown[]).includes(data.driverType)) problems.push(`driver.driverType must be one of ${DRIVER_TYPES.join(', ')}`)
  for (const k of ['isActive', 'hasLogin']) if (typeof data[k] !== 'boolean') problems.push(`driver.${k} must be true or false`)
  if (data.pay === undefined) problems.push('driver.pay must be there: null when the caller may not see it')
  else if (data.pay !== null) {
    if (!isRec(data.pay)) problems.push('driver.pay must be an object or null')
    else {
      const p = data.pay
      if (typeof p.ssnLast4 !== 'string') problems.push('driver.pay.ssnLast4 must be text')
      if (typeof p.payRate !== 'number' || !Number.isFinite(p.payRate)) problems.push('driver.pay.payRate must be a number')
      if (!(PAY_FREQUENCIES as readonly unknown[]).includes(p.payFrequency)) problems.push(`driver.pay.payFrequency must be one of ${PAY_FREQUENCIES.join(', ')}`)
      if (p.payBasis !== null && !(PAY_BASES as readonly unknown[]).includes(p.payBasis)) problems.push(`driver.pay.payBasis must be ${PAY_BASES.join(', ')} or null`)
      if (typeof p.payGroup !== 'string') problems.push('driver.pay.payGroup must be text')
    }
  }
  return problems
}
