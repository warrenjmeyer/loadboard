import { PLAN_STATUSES } from './contract.ts'
import type { PlanStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// The stakeholder's lookup table for a plan's status, and the tab's own list
// of the same thing, kept in step:
//
//   DRVR.fk_Load_Plan_Status   PLANNED, TAKEN_BACK   PLAN_STATUSES
//
// STORED: DRVR.Load_Plans.Load_Plan_Status_Id is a foreign key into it, so
// table and list must agree, and nothing else makes them -- the table is
// edited through the app, the list lives in contract.ts. The check here
// looks at both. (The schedule's lookups.ts does the same for its two
// tables; written again, not shared, so each folder moves on its own.)
//
// Matched by NAME, never by Id or Choice_Key: the app hands both out in
// creation order, so a database built in another order would disagree on
// either. planStatusIds turns a name into the Id the column stores.
//
// The rows keep the table's own column names, so an API can hand them over
// exactly as SELECT * returns them.
// ---------------------------------------------------------------------------

/** One row of DRVR.fk_Load_Plan_Status, as SELECT * returns it. */
export interface PlanStatusRow {
  Load_Plan_Status_Id: number
  Load_Plan_Status: string
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

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every way DRVR.fk_Load_Plan_Status and PLAN_STATUSES disagree, as sentences. Empty means they agree. */
export function checkPlanStatusRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return ['the status rows must be an array']
  const known = PLAN_STATUSES as readonly string[]
  const problems: string[] = []
  const seen = new Set<string>()

  rows.forEach((row: unknown, i: number) => {
    if (!isRec(row)) {
      problems.push(`row ${i} is not an object`)
      return
    }
    const name = row.Load_Plan_Status
    const at = `row ${i} (Id ${String(row.Load_Plan_Status_Id)})`
    if (typeof name !== 'string' || name === '') {
      problems.push(`${at} has no Load_Plan_Status`)
      return
    }
    if (name === PLACEHOLDER) return

    if (!known.includes(name)) {
      // Close is not a match: names are compared exactly. Say which near miss.
      const near = known.find((k) => k === name.trim().toUpperCase().replace(/\s+/g, '_'))
      problems.push(near
        ? `${at} "${name}" differs from "${near}" only in case, spaces or underscores -- statuses are matched by exact name`
        : `${at} "${name}" is not a status the load plans know, so no plan will ever have it`)
      return
    }
    if (seen.has(name)) {
      problems.push(`${at} "${name}" appears more than once`)
      return
    }
    seen.add(name)
    if (row.IsActive === 0) problems.push(`${at} "${name}" is marked inactive, but plans still move into it`)
  })

  for (const k of known) {
    if (!seen.has(k)) problems.push(`the load plans use "${k}", but the table has no row for it`)
  }
  return problems
}

/** The Id DRVR.Load_Plans.Load_Plan_Status_Id stores, for each status. Only
 * active rows count; the placeholder never does. */
export function planStatusIds(rows: readonly PlanStatusRow[]): Partial<Record<PlanStatus, number>> {
  const known = PLAN_STATUSES as readonly string[]
  const out: Partial<Record<PlanStatus, number>> = {}
  for (const row of rows) {
    const name = row.Load_Plan_Status
    if (row.IsActive !== 0 && known.includes(name) && out[name as PlanStatus] === undefined) {
      out[name as PlanStatus] = row.Load_Plan_Status_Id
    }
  }
  return out
}
