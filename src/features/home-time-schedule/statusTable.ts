import { STAY_STATUSES } from './contract.ts'
import type { StayStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// The stakeholder's lookup table for a stay's status, DRVR.fk_Home_Time_Status,
// and the schedule's own list of them, kept in step.
//
// Unlike the planner's statuses, these ARE stored: a stay's status column is
// the foreign key this table exists for. So the table and STAY_STATUSES must
// agree, and nothing else makes them -- one is edited through the app, the
// other lives in contract.ts and rules.ts. checkStatusRows looks at both.
//
// Matched by NAME (Home_Time_Status), never by Id or Choice_Key: the app
// hands both out in creation order (Ids 1-6, keys a-f), so a database built
// in another order would disagree on either. statusIds turns a name into the
// Id a foreign-key column holds.
//
// The same idea as the planner's statusTable.ts, written out again rather
// than shared, so each folder still moves on its own. The rows keep the
// table's own column names, so an API can hand them over untouched.
// ---------------------------------------------------------------------------

/** One row of DRVR.fk_Home_Time_Status, as SELECT * returns it. */
export interface StayStatusRow {
  Home_Time_Status_Id: number
  Home_Time_Status: string
  Choice_Key: string | null
  IsActive: number | null
  j?: number
  TTP_ID?: number | null
  Created_At?: string | null
  Updated_At?: string | null
  Created_By?: string | null
}

// The row the app puts first in every lookup table -- Id 0, key "-" -- and
// the column default: "not set yet", not a status.
const PLACEHOLDER = 'Undefined'

function isStayStatus(name: string): name is StayStatus {
  return (STAY_STATUSES as readonly string[]).includes(name)
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Every way the table and the schedule disagree, as sentences. Empty means
// they agree. Run it against a real SELECT after the port, and whenever
// somebody edits the table.
export function checkStatusRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return ['the status rows must be an array']

  const problems: string[] = []
  const seen = new Set<StayStatus>()

  rows.forEach((row: unknown, i: number) => {
    if (!isRec(row)) {
      problems.push(`row ${i} is not an object`)
      return
    }
    const name = row.Home_Time_Status
    const at = `row ${i} (Id ${String(row.Home_Time_Status_Id)})`
    if (typeof name !== 'string' || name === '') {
      problems.push(`${at} has no Home_Time_Status`)
      return
    }
    if (name === PLACEHOLDER) return

    if (!isStayStatus(name)) {
      const near = STAY_STATUSES.find((s) => s === name.trim().toUpperCase())
      problems.push(near
        ? `${at} "${name}" differs from "${near}" only in case or spaces -- stays are matched by exact name`
        : `${at} "${name}" is not a status the schedule knows, so no stay will ever have it`)
      return
    }
    if (seen.has(name)) {
      problems.push(`${at} "${name}" appears more than once`)
      return
    }
    seen.add(name)
    if (row.IsActive === 0) {
      problems.push(`${at} "${name}" is marked inactive, but stays still move into it`)
    }
  })

  for (const status of STAY_STATUSES) {
    if (!seen.has(status)) problems.push(`the schedule uses "${status}", but the table has no row for it`)
  }
  return problems
}

// The Id to store for each status -- what a stay's foreign-key column holds.
// Only active rows count, and the placeholder never does.
export function statusIds(rows: readonly StayStatusRow[]): Partial<Record<StayStatus, number>> {
  const ids: Partial<Record<StayStatus, number>> = {}
  for (const row of rows) {
    const name = row.Home_Time_Status
    if (row.IsActive !== 0 && isStayStatus(name) && ids[name] === undefined) ids[name] = row.Home_Time_Status_Id
  }
  return ids
}
