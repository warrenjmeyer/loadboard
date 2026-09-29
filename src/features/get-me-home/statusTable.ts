import { STATUS_ORDER } from './planHome.ts'
import type { Status } from './planHome.ts'

// ---------------------------------------------------------------------------
// The stakeholder's lookup table for statuses, DRVR.fk_get_me_home_status,
// and the planner's own list of them, kept in step.
//
// The planner WORKS OUT a driver's status every time; the table is where the
// set of statuses is written down, so that anything which STORES one -- a
// saved plan, a home-time request -- can hold it as a foreign key. For that
// to mean anything the two lists must agree, and nothing else makes them:
// the table is edited through the app's interface, the rules in planHome.ts.
// checkStatusRows is the one place that looks at both.
//
// Rows are matched on fk_get_me_home_status, the name. Not the Id and not
// Choice_Key: the app hands out both in the order rows are created, so a
// second database built in a different order would disagree on either, and
// the name is the one value a person chose. The Id is what goes in a
// foreign-key column; statusIds turns a status into it.
//
// The rows keep the table's own column names, so an API can hand them over
// exactly as SQL returns them and nothing has to translate.
// ---------------------------------------------------------------------------

/** One row of DRVR.fk_get_me_home_status, as SELECT * returns it. */
export interface StatusRow {
  fk_get_me_home_status_Id: number
  fk_get_me_home_status: string
  Choice_Key: string | null
  IsActive: number | null
  j?: number
  TTP_ID?: number | null
  Created_At?: string | null
  Updated_At?: string | null
  Created_By?: string | null
}

// Every lookup table the app makes starts with this row -- Id 0, key "-" --
// and it is the column's default: "not set yet", not a status.
const PLACEHOLDER = 'Undefined'

function isStatus(name: string): name is Status {
  return (STATUS_ORDER as readonly string[]).includes(name)
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ---------------------------------------------------------------------------
// Every way the table and the planner disagree, as sentences. An empty array
// means they agree. Run it against a real SELECT once after the port, and
// again whenever somebody edits the table.
// ---------------------------------------------------------------------------
export function checkStatusRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return ['the status rows must be an array']

  const problems: string[] = []
  const seen = new Set<Status>()

  rows.forEach((row: unknown, i: number) => {
    if (!isRec(row)) {
      problems.push(`row ${i} is not an object`)
      return
    }
    const name = row.fk_get_me_home_status
    const at = `row ${i} (Id ${String(row.fk_get_me_home_status_Id)})`
    if (typeof name !== 'string' || name === '') {
      problems.push(`${at} has no fk_get_me_home_status`)
      return
    }
    if (name === PLACEHOLDER) return

    if (!isStatus(name)) {
      // Close is not a match: the planner compares exactly, so "Late" and
      // "LATE " are different statuses. Say which near miss it is.
      const near = STATUS_ORDER.find((s) => s === name.trim().toUpperCase())
      problems.push(near
        ? `${at} "${name}" differs from "${near}" only in case or spaces -- the planner matches names exactly`
        : `${at} "${name}" is not a status the planner assigns, so no driver will ever be given it`)
      return
    }
    if (seen.has(name)) {
      problems.push(`${at} "${name}" appears more than once`)
      return
    }
    seen.add(name)
    if (row.IsActive === 0) {
      problems.push(`${at} "${name}" is marked inactive, but the planner still assigns it`)
    }
  })

  for (const status of STATUS_ORDER) {
    if (!seen.has(status)) problems.push(`the planner assigns "${status}", but the table has no row for it`)
  }
  return problems
}

// The Id to store for each status -- what a foreign-key column holds. Only
// active rows count, and the placeholder never does.
export function statusIds(rows: readonly StatusRow[]): Partial<Record<Status, number>> {
  const ids: Partial<Record<Status, number>> = {}
  for (const row of rows) {
    const name = row.fk_get_me_home_status
    if (row.IsActive !== 0 && isStatus(name) && ids[name] === undefined) ids[name] = row.fk_get_me_home_status_Id
  }
  return ids
}
