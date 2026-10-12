import { byName, summaryOf } from './rules.ts'
import type { DriverList, DriverRecord } from './contract.ts'

// ---------------------------------------------------------------------------
// WHAT EACH READ RETURNS, exactly, and to whom. One function per
// DriverMasterAdapter read, from every driver the store holds to the slice
// one screen needs -- with pay taken out for anyone but an admin.
//
// These are the specification of the server's two queries
// (src/features/sql/09_driver_reads.sql). The sample adapter runs them over
// its in-memory drivers; scope.test.ts is the list of what "the same" means.
// ---------------------------------------------------------------------------

/** Who is asking, as the server knows it from the signed-in user. A driver,
 * or anyone else who is neither dispatch nor admin, is 'other' -- refused. */
export type Caller = 'admin' | 'dispatch' | 'other'

export interface Allowed {
  read: boolean
  /** Add drivers; see and change pay, the SSN and the driver type. */
  admin: boolean
}

export function allowed(caller: Caller): Allowed {
  return { read: caller === 'admin' || caller === 'dispatch', admin: caller === 'admin' }
}

export const REFUSED = 'Only dispatch and admin keep the driver master.'

/** loadDriverList: a line per driver -- active ones, or all of them -- with
 * no address, SSN or pay; and what the caller may do. */
export function scopeDriverList(all: readonly DriverRecord[], { includeInactive, caller }: { includeInactive: boolean; caller: Caller }): DriverList {
  const may = allowed(caller)
  return {
    drivers: all.filter((d) => includeInactive || d.isActive).map(summaryOf).sort(byName),
    you: { canAdd: may.admin, canSeePay: may.admin },
  }
}

/** loadDriver: one driver, everything about them -- pay for an admin, null
 * for anyone else. Null for a code nobody has. */
export function scopeDriver(all: readonly DriverRecord[], driverCode: string, { caller }: { caller: Caller }): DriverRecord | null {
  const found = all.find((d) => d.driverCode === driverCode)
  if (!found) return null
  return allowed(caller).admin ? found : { ...found, pay: null }
}
