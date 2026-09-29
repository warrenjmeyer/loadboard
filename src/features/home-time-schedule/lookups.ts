import { STAY_SOURCES, STAY_STATUSES } from './contract.ts'
import type { StaySource, StayStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// The stakeholder's two lookup tables for a stay, and the schedule's own
// lists of the same things, kept in step:
//
//   DRVR.fk_Home_Time_Status  REQUESTED ... CANCELLED   STAY_STATUSES
//   DRVR.fk_Home_Time_Source  GEOTAB, DISPATCH, OTHER   STAY_SOURCES
//
// Both are STORED -- a stay's status and its arrival and departure sources
// are foreign keys into these tables -- so each table and its list must
// agree, and nothing else makes them: the tables are edited through the
// app, the lists live in contract.ts. The checks here look at both.
//
// Matched by NAME, never by Id or Choice_Key: the app hands both out in
// creation order, so a database built in another order would disagree on
// either. The ...Ids functions turn a name into the Id a column stores.
//
// The rows keep the tables' own column names, so an API can hand them over
// exactly as SELECT * returns them.
// ---------------------------------------------------------------------------

interface LookupRowBase {
  Choice_Key: string | null
  IsActive: number | null
  j?: number
  TTP_ID?: number | null
  Created_At?: string | null
  Updated_At?: string | null
  Created_By?: string | null
}

/** One row of DRVR.fk_Home_Time_Status, as SELECT * returns it. */
export interface StayStatusRow extends LookupRowBase {
  Home_Time_Status_Id: number
  Home_Time_Status: string
}

/** One row of DRVR.fk_Home_Time_Source, as SELECT * returns it. */
export interface StaySourceRow extends LookupRowBase {
  Home_Time_Source_Id: number
  Home_Time_Source: string
}

// The row the app puts first in every lookup table -- Id 0, key "-" -- and
// the column default: "not set yet", not a status or a source.
const PLACEHOLDER = 'Undefined'

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

interface Lookup<T extends string> {
  known: readonly T[]
  idColumn: string
  nameColumn: string
  /** "status" or "source", for the sentences. */
  thing: string
  /** What a row the code does not know means, in words. */
  neverUsed: string
  /** What an inactive row the code still uses means. */
  stillUsed: string
}

const STATUSES: Lookup<StayStatus> = {
  known: STAY_STATUSES, idColumn: 'Home_Time_Status_Id', nameColumn: 'Home_Time_Status', thing: 'status',
  neverUsed: 'so no stay will ever have it', stillUsed: 'but stays still move into it',
}

const SOURCES: Lookup<StaySource> = {
  known: STAY_SOURCES, idColumn: 'Home_Time_Source_Id', nameColumn: 'Home_Time_Source', thing: 'source',
  neverUsed: 'so no arrival or departure will ever be recorded with it', stillUsed: 'but arrivals and departures are still recorded with it',
}

// Every way a table and its list disagree, as sentences. Empty means they agree.
function check<T extends string>(rows: unknown, l: Lookup<T>): string[] {
  if (!Array.isArray(rows)) return [`the ${l.thing} rows must be an array`]
  const known = l.known as readonly string[]
  const problems: string[] = []
  const seen = new Set<string>()

  rows.forEach((row: unknown, i: number) => {
    if (!isRec(row)) {
      problems.push(`row ${i} is not an object`)
      return
    }
    const name = row[l.nameColumn]
    const at = `row ${i} (Id ${String(row[l.idColumn])})`
    if (typeof name !== 'string' || name === '') {
      problems.push(`${at} has no ${l.nameColumn}`)
      return
    }
    if (name === PLACEHOLDER) return

    if (!known.includes(name)) {
      // Close is not a match: names are compared exactly. Say which near miss.
      const near = known.find((k) => k === name.trim().toUpperCase())
      problems.push(near
        ? `${at} "${name}" differs from "${near}" only in case or spaces -- ${l.thing}s are matched by exact name`
        : `${at} "${name}" is not a ${l.thing} the schedule knows, ${l.neverUsed}`)
      return
    }
    if (seen.has(name)) {
      problems.push(`${at} "${name}" appears more than once`)
      return
    }
    seen.add(name)
    if (row.IsActive === 0) problems.push(`${at} "${name}" is marked inactive, ${l.stillUsed}`)
  })

  for (const k of known) {
    if (!seen.has(k)) problems.push(`the schedule uses "${k}", but the table has no row for it`)
  }
  return problems
}

// The Id to store for each name. Only active rows count; the placeholder never does.
function ids<T extends string>(rows: readonly Record<string, unknown>[], l: Lookup<T>): Partial<Record<T, number>> {
  const known = l.known as readonly string[]
  const out: Partial<Record<T, number>> = {}
  for (const row of rows) {
    const name = row[l.nameColumn]
    const id = row[l.idColumn]
    if (row.IsActive !== 0 && typeof name === 'string' && known.includes(name) && typeof id === 'number' && out[name as T] === undefined) {
      out[name as T] = id
    }
  }
  return out
}

/** How DRVR.fk_Home_Time_Status and STAY_STATUSES disagree. Empty means they agree. */
export const checkStatusRows = (rows: unknown): string[] => check(rows, STATUSES)
/** The Id a stay's Home_Time_Status_Id stores, for each status. */
export const statusIds = (rows: readonly StayStatusRow[]): Partial<Record<StayStatus, number>> =>
  ids(rows as unknown as Record<string, unknown>[], STATUSES)

/** How DRVR.fk_Home_Time_Source and STAY_SOURCES disagree. Empty means they agree. */
export const checkSourceRows = (rows: unknown): string[] => check(rows, SOURCES)
/** The Id a stay's Arrived_Source_Id or Left_Source_Id stores, for each source. */
export const sourceIds = (rows: readonly StaySourceRow[]): Partial<Record<StaySource, number>> =>
  ids(rows as unknown as Record<string, unknown>[], SOURCES)
