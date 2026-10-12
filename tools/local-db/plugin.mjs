// ---------------------------------------------------------------------------
// The laptop database, served to the preview. DEV ONLY: a Vite plugin whose
// middleware exists under `npm run dev` and nowhere else -- `vite build`
// never runs configureServer, so none of this ships.
//
//   GET  /local-db/load-plans/board?from&to      05_load_plan_reads.sql
//   GET  /local-db/load-plans/driver?driverCode
//   GET  /local-db/load-plans/open?from&to
//   GET  /local-db/load-plans/candidates?loadId
//   POST /local-db/load-plans/assign   {loadId, driverCode}   06_load_plan_writes.sql
//   POST /local-db/load-plans/unassign {loadId}
//   GET  /local-db/stays/queue                    03_scoped_reads.sql
//   GET  /local-db/stays/board?from&to
//   GET  /local-db/stays/driver?driverCode
//   GET  /local-db/stays/stay?id
//   POST /local-db/stays/request {driverCode, homeBy, backOut, note}   07_stay_writes.sql
//   POST /local-db/stays/act     {id, action}
//   GET  /local-db/drivers                        (for the preview's driver picker)
//   GET  /local-db/driver-master/list?includeInactive   09_driver_reads.sql
//   GET  /local-db/driver-master/driver?driverCode
//   POST /local-db/driver-master/save   {driverCode, version, changes}   10_driver_writes.sql
//   POST /local-db/driver-master/add    {driver}
//   POST /local-db/driver-master/active {driverCode, version, active}
//
// IT RUNS THE HOST'S OWN SQL. Each endpoint reads the script in
// src/features/sql/, keeps only the read it needs, and replaces the script's
// "Try it" DECLARE values with the request's -- so what is tested here is
// the text the host will run, WHO checks and all. The stays' moves go
// through the schedule's own rules first (applyAction, checkNewStay), as the
// host's API must, and so do the driver master's (applyChanges,
// checkNewDriver).
//
// WHO. There are no sessions on the laptop, so a request says who it is
// acting as, with the header X-Local-As: "dispatch" (the default), "admin",
// or "driver:TBOONE". A driver is matched to a user by DRVR.Drivers.User_Uuid,
// as on the host; local_test_users.sql gives the laptop's drivers one each.
//
// ONLY THIS MACHINE. The dev server listens on every address (host: true),
// so anything on the network could reach it; this answers loopback only.
// Values are checked before they go anywhere near a script.
//
// SQL runs through run-sql.ps1: Windows authentication, no password.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PREFIX = '/local-db/'

export function localDb() {
  let root = process.cwd()
  return {
    name: 'local-db',
    configResolved(config) { root = config.root },
    // Returning nothing installs this ahead of Vite's own middlewares -- and
    // ahead of the SPA fallback, which would otherwise answer with a page.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIX)) return next()
        handle(root, req, res).catch((err) => send(res, 500, { error: err instanceof Error ? err.message : String(err) }))
      })
    },
  }
}

// ---- Running a script ----------------------------------------------------

function runSql(root, sql) {
  const script = readFileSync(join(root, 'tools/local-db/run-sql.ps1'), 'utf8')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true })
    let out = ''
    let err = ''
    ps.stdout.on('data', (d) => { out += d })
    ps.stderr.on('data', (d) => { err += d })
    ps.on('error', reject)
    ps.on('close', () => {
      try { resolve(JSON.parse(out)) } catch { reject(new Error(`run-sql.ps1 said: ${(err || out).slice(0, 400)}`)) }
    })
    ps.stdin.end(sql, 'utf8')
  })
}

class Refused extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// SQL error numbers the scripts THROW, as HTTP statuses.
const STATUS_OF = { 50400: 400, 50403: 403, 50404: 404, 50409: 409 }

async function query(root, sql) {
  const result = await runSql(root, sql)
  if (!result.ok) throw new Refused(STATUS_OF[result.error.number] || 500, result.error.message)
  return result.sets.map((s) => s.rows)
}

// ---- Filling in a script -------------------------------------------------

const sqlFile = (root, name) => readFileSync(join(root, 'src/features/sql', name), 'utf8')

// Everything before the first read, and the one read asked for: from its
// "-- name:" heading to the next heading.
function section(text, name) {
  const heading = /^-- (\w+):/gm
  const marks = [...text.matchAll(heading)].filter((m) => /^load[A-Z]/.test(m[1]))
  const at = marks.findIndex((m) => m[1] === name)
  if (at < 0) throw new Error(`no read named ${name}`)
  const lineStart = (i) => text.lastIndexOf('\n', i) + 1
  // Back up over the dashed rule above each heading, so it goes with its read.
  const startOf = (m) => text.lastIndexOf('\n-----', m.index) + 1 || lineStart(m.index)
  const end = at + 1 < marks.length ? startOf(marks[at + 1]) : text.length
  return text.slice(0, startOf(marks[0])) + text.slice(startOf(marks[at]), end)
}

// Replace one "Try it" DECLARE's value. Exactly one must match: a script
// that has changed shape stops the request rather than running half-filled.
function setValue(text, name, literal) {
  const re = new RegExp(`^(DECLARE @${name}\\s+[\\w(),]+\\s*=\\s*)[^;]*;`, 'm')
  if (!re.test(text)) throw new Error(`the script has no "DECLARE @${name} ... = ...;" to fill in`)
  return text.replace(re, `$1${literal};`)
}

function fill(text, values) {
  return Object.entries(values).reduce((t, [k, v]) => setValue(t, k, v), text)
}

// Literals, each from a checked value.
const CODE = /^[A-Za-z0-9 ._-]{1,20}$/
const lit = {
  code(v, what) {
    if (typeof v !== 'string' || !CODE.test(v)) throw new Refused(400, `${what} is not a code: ${JSON.stringify(v)}`)
    return `'${v}'`
  },
  // A zoned ISO date-time goes in AS GIVEN: "home by 6 PM -05:00" is stored
  // with its -05:00, which is why the tables use datetimeoffset. Checked to
  // the character, so nothing else can ride along into the script.
  moment(v, what) {
    const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(v) : null
    if (!m || !Number.isFinite(Date.parse(v))) throw new Refused(400, `${what} is not a date-time with a zone: ${JSON.stringify(v)}`)
    return `'${m[1]}${m[2]}'`
  },
  momentOrNull(v, what) { return v === null || v === undefined ? 'NULL' : lit.moment(v, what) },
  text(v) { return v === null || v === undefined || v === '' ? 'NULL' : `N'${String(v).slice(0, 500).replace(/'/g, "''")}'` },
  int(v, what) {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new Refused(400, `${what} is not a number: ${JSON.stringify(v)}`)
    return String(n)
  },
  // A driver's version, as 09 hands it out: Updated_At to the millisecond, or 'none'.
  version(v) {
    if (typeof v !== 'string' || !/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}|none)$/.test(v)) throw new Refused(400, `version is not one 09_driver_reads.sql gave out: ${JSON.stringify(v)}`)
    return `'${v}'`
  },
  rate(v, what) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 99999.9999) throw new Refused(400, `${what} is not a rate: ${JSON.stringify(v)}`)
    return v.toFixed(4)
  },
  word(v, allowed, what) {
    if (v === null || v === undefined) return 'NULL'
    if (!allowed.includes(v)) throw new Refused(400, `${what} must be one of ${allowed.join(', ')}`)
    return `'${v}'`
  },
}

// ---- Who is asking -------------------------------------------------------

async function caller(root, req) {
  const as = String(req.headers['x-local-as'] || 'dispatch')
  if (as === 'dispatch') return { CallerUuid: 'NULL', CallerIsDispatch: '1', admin: false, driverCode: null }
  if (as === 'admin') return { CallerUuid: 'NULL', CallerIsDispatch: '1', admin: true, driverCode: null }
  const m = /^driver:(.+)$/.exec(as)
  if (!m) throw new Refused(400, 'X-Local-As must be "dispatch" or "driver:CODE".')
  const code = lit.code(m[1], 'the driver')
  const [rows] = await query(root, `SET NOCOUNT ON; SELECT CAST(User_Uuid AS varchar(36)) AS uuid FROM DRVR.Drivers WHERE Driver_Code = ${code};`)
  const uuid = rows[0]?.uuid
  if (!uuid) throw new Refused(403, `${m[1]} has no user on the laptop, so nothing can be read as them. Run src/features/sql/local_test_users.sql.`)
  return { CallerUuid: `'${uuid}'`, CallerIsDispatch: '0', admin: false, driverCode: m[1] }
}

// ---- The endpoints -------------------------------------------------------

async function handle(root, req, res) {
  const remote = req.socket.remoteAddress || ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return send(res, 403, { error: 'The laptop database answers this machine only.' })

  const url = new URL(req.url, 'http://localhost')
  const route = `${req.method} ${url.pathname.slice(PREFIX.length)}`
  const q = (k) => url.searchParams.get(k)
  try {
    const who = await caller(root, req)
    const as = { CallerUuid: who.CallerUuid, CallerIsDispatch: who.CallerIsDispatch }
    const window = () => ({ From: lit.moment(q('from'), 'from'), To: lit.moment(q('to'), 'to') })

    switch (route) {
      // -- The load plans: 05 and 06 --
      case 'GET load-plans/board':
      case 'GET load-plans/driver':
      case 'GET load-plans/open':
      case 'GET load-plans/candidates': {
        const read = { board: 'loadPlanBoard', driver: 'loadDriverPlan', open: 'loadOpenLoads', candidates: 'loadCandidates' }[route.slice(15)]
        const values = { ...as }
        if (read === 'loadPlanBoard' || read === 'loadOpenLoads') Object.assign(values, window())
        if (read === 'loadDriverPlan') values.DriverCode = lit.code(q('driverCode'), 'driverCode')
        if (read === 'loadCandidates') values.LoadNumber = lit.code(q('loadId'), 'loadId')
        const [loads = [], drivers = [], stays = []] = await query(root, fill(section(sqlFile(root, '05_load_plan_reads.sql'), read), values))
        return send(res, 200, { loads, drivers, stays })
      }
      case 'POST load-plans/assign':
      case 'POST load-plans/unassign': {
        const body = await readBody(req)
        const values = {
          ...as, Keep: '1',
          Do: route.endsWith('unassign') ? `'unassign'` : `'assign'`,
          LoadNumber: lit.code(body.loadId, 'loadId'),
          DriverCode: route.endsWith('unassign') ? `''` : lit.code(body.driverCode, 'driverCode'),
        }
        const sets = await query(root, fill(sqlFile(root, '06_load_plan_writes.sql'), values))
        return send(res, 200, { load: sets[sets.length - 1]?.[0] ?? null })
      }

      // -- The schedule: 03 and 07 --
      case 'GET stays/queue':
      case 'GET stays/board':
      case 'GET stays/driver':
      case 'GET stays/stay': {
        const read = { queue: 'loadQueue', board: 'loadBoard', driver: 'loadDriverStays', stay: 'loadStay' }[route.slice(10)]
        return send(res, 200, await readStays(root, read, as, q))
      }
      case 'POST stays/request': {
        const body = await readBody(req)
        const code = lit.code(body.driverCode, 'driverCode')
        // The rules first, over that driver's stays, as the host's API must.
        const { checkNewStay } = await rules(root)
        const { toStay } = await rows(root)
        const mine = await readStays(root, 'loadDriverStays', as, () => body.driverCode)
        const request = { driverCode: body.driverCode, homeBy: body.homeBy, backOut: body.backOut, note: body.note ?? null }
        const problems = checkNewStay(request, mine.stays.map(toStay), { now: new Date().toISOString() })
        if (problems.length > 0) throw new Refused(409, problems.join(' '))
        const values = {
          ...as, Keep: '1', Do: `'request'`, DriverCode: code,
          HomeBy: lit.moment(body.homeBy, 'homeBy'), BackOut: lit.moment(body.backOut, 'backOut'), Note: lit.text(body.note),
        }
        const sets = await query(root, fill(sqlFile(root, '07_stay_writes.sql'), values))
        return send(res, 200, { stay: sets[sets.length - 1]?.[0] ?? null })
      }
      case 'POST stays/act': {
        const body = await readBody(req)
        const id = lit.int(body.id, 'id')
        const { applyAction } = await rules(root)
        const { toStay } = await rows(root)
        const found = await readStays(root, 'loadStay', as, () => String(Number(id)))
        const row = found.stays[0]
        if (!row) throw new Refused(404, 'That stay no longer exists.')
        const before = toStay(row)
        const result = applyAction(before, body.action, { now: new Date().toISOString(), by: who.driverCode ? who.driverCode : 'Dispatch' })
        if ('error' in result) throw new Refused(409, result.error)
        const after = result.stay
        const SOURCES = ['GEOTAB', 'DISPATCH', 'OTHER']
        const values = {
          ...as, Keep: '1', Do: `'store'`, StayId: id,
          ExpectStatus: lit.word(before.status, [before.status], 'status'),
          Status: lit.word(after.status, ['REQUESTED', 'APPROVED', 'HOME', 'DONE', 'DECLINED', 'CANCELLED'], 'status'),
          DecidedAt: lit.momentOrNull(after.decidedAt, 'decidedAt'),
          DeclineReason: lit.text(after.declineReason),
          ArrivedAt: lit.momentOrNull(after.arrivedAt, 'arrivedAt'),
          ArrivedSource: lit.word(after.arrivedSource ?? null, SOURCES, 'arrivedSource'),
          LeftAt: lit.momentOrNull(after.leftAt, 'leftAt'),
          LeftSource: lit.word(after.leftSource ?? null, SOURCES, 'leftSource'),
        }
        const sets = await query(root, fill(sqlFile(root, '07_stay_writes.sql'), values))
        return send(res, 200, { stay: sets[sets.length - 1]?.[0] ?? null })
      }

      // -- Who there is to pick, for the preview's driver view --
      case 'GET drivers': {
        const [drivers] = await query(root, `SET NOCOUNT ON; SELECT Driver_Code AS driverCode, CONCAT(First_Name, N' ', Last_Name) AS name, Unit_No AS unitNo FROM DRVR.Drivers WHERE ISNULL(IsActive, 1) = 1 ORDER BY First_Name, Last_Name;`)
        return send(res, 200, { drivers })
      }
      // -- The driver master: 09 and 10 --
      case 'GET driver-master/list':
      case 'GET driver-master/driver':
      case 'POST driver-master/save':
      case 'POST driver-master/add':
      case 'POST driver-master/active':
        return send(res, 200, await driverMaster(root, route, { ...as, CallerIsAdmin: who.admin ? '1' : '0' }, who.admin, q, req))

      default:
        return send(res, 404, { error: `No such laptop-database request: ${route}` })
    }
  } catch (err) {
    if (err instanceof Refused) return send(res, err.status, { error: err.message })
    throw err
  }
}

async function readStays(root, read, as, q) {
  const values = { ...as }
  if (read === 'loadBoard') Object.assign(values, { From: lit.moment(q('from'), 'from'), To: lit.moment(q('to'), 'to') })
  if (read === 'loadDriverStays') values.DriverCode = lit.code(q('driverCode'), 'driverCode')
  if (read === 'loadStay') values.StayId = lit.int(q('id'), 'id')
  const [stays = [], drivers = []] = await query(root, fill(section(sqlFile(root, '03_scoped_reads.sql'), read), values))
  return { stays, drivers }
}

// ---- The driver master ----------------------------------------------------
//
// The reads are 09 as they stand. Each write is worked out first, as the
// host's API must: the driver is read whole (as the server, which may), the
// change runs through driver-master/rules.ts, and 10 stores the result --
// every detail field, and pay only for an admin. 10 checks again what must
// not be left to the API: who, the version, the code and pay.
const DETAIL_FIELDS = {
  FirstName: 'firstName', LastName: 'lastName', Address1: 'address1', Address2: 'address2', City: 'city', State: 'state',
  PostalCode: 'postalCode', Country: 'country', Job: 'job', JobType: 'jobType', Location: 'location', Department: 'department',
  UnitNo: 'unitNo', TruckDescription: 'truckDescription',
}
const NO_PAY = { DriverType: 'NULL', SsnLast4: 'NULL', PayRate: 'NULL', PayFrequency: 'NULL', PayBasis: 'NULL', PayGroup: 'NULL' }

function driverValues(d, withPay) {
  const values = {}
  for (const [param, key] of Object.entries(DETAIL_FIELDS)) values[param] = lit.text(d[key])
  if (!withPay) return { ...values, ...NO_PAY }
  if (!/^\d{4}$/.test(String(d.pay.ssnLast4))) throw new Refused(400, 'The last four digits of their SSN: four digits, no more.')
  return {
    ...values,
    DriverType: lit.word(d.driverType, ['COMPANY', 'OWNER'], 'driverType'),
    SsnLast4: `'${d.pay.ssnLast4}'`,
    PayRate: lit.rate(d.pay.payRate, 'payRate'),
    PayFrequency: lit.word(d.pay.payFrequency, ['W', 'B', 'S', 'M'], 'payFrequency'),
    PayBasis: lit.word(d.pay.payBasis ?? null, ['MILEAGE', 'PERCENTAGE'], 'payBasis'),
    PayGroup: lit.text(d.pay.payGroup),
  }
}

async function driverMaster(root, route, as, admin, q, req) {
  const reads = sqlFile(root, '09_driver_reads.sql')
  const { toDriverRecord, toDriverList } = await rows(root)
  const readDriver = async (code, caller) => {
    const [found = []] = await query(root, fill(section(reads, 'loadDriver'), { ...caller, DriverCode: code }))
    return found[0] ? toDriverRecord(found[0]) : null
  }
  const store = async (values) => {
    const sets = await query(root, fill(sqlFile(root, '10_driver_writes.sql'), { ...as, Keep: '1', ...values }))
    const row = sets[sets.length - 1]?.[0]
    return { driver: row ? toDriverRecord(row) : null }
  }
  // The server's own view, to work a change out against -- never sent back.
  const server = { CallerUuid: 'NULL', CallerIsDispatch: '1', CallerIsAdmin: '1' }

  if (route === 'GET driver-master/list') {
    const [drivers = [], you = []] = await query(root, fill(section(reads, 'loadDriverList'), { ...as, IncludeInactive: q('includeInactive') === '1' ? '1' : '0' }))
    return toDriverList({ drivers, you: you[0] })
  }
  if (route === 'GET driver-master/driver') {
    return { driver: await readDriver(lit.code(q('driverCode'), 'driverCode'), as) }
  }

  const body = await readBody(req)
  const { applyChanges, applyActive, checkNewDriver, normalizeCode, normalizeDetails, sentence } = await driverRules(root)
  if (route === 'POST driver-master/add') {
    if (!admin) throw new Refused(403, 'Only an admin adds drivers.')
    const d = body.driver || {}
    const [all = []] = await query(root, fill(section(reads, 'loadDriverList'), { ...server, IncludeInactive: '1' }))
    const problems = checkNewDriver(d, all.map((r) => r.driverCode))
    if (Object.keys(problems).length > 0) throw new Refused(409, sentence(problems))
    const code = normalizeCode(d.driverCode)
    const stored = { ...normalizeDetails(d), driverType: d.driverType, pay: { ...d.pay, ssnLast4: String(d.pay.ssnLast4).trim(), payGroup: String(d.pay.payGroup).trim() } }
    return store({ Do: `'add'`, DriverCode: lit.code(code, 'driverCode'), Version: 'NULL', ...driverValues(stored, true) })
  }

  const code = lit.code(body.driverCode, 'driverCode')
  const before = await readDriver(code, server)
  if (!before) throw new Refused(404, `There is no driver ${body.driverCode}.`)
  if (route === 'POST driver-master/save') {
    const result = applyChanges(before, String(body.version), body.changes || {}, { canChangePay: admin })
    if ('error' in result) throw new Refused(409, result.error)
    return store({ Do: `'save'`, DriverCode: code, Version: lit.version(body.version), ...driverValues(result.record, admin) })
  }
  // active
  const result = applyActive(before, String(body.version), Boolean(body.active))
  if ('error' in result) throw new Refused(409, result.error)
  return store({ Do: `'active'`, DriverCode: code, Version: lit.version(body.version), Active: body.active ? '1' : '0', ...driverValues(before, false) })
}

// The schedule's rules and the row translator are TypeScript; Node runs them
// as they stand (type stripping), the same files the preview and tests use.
const rules = (root) => import(pathToFileURL(join(root, 'src/features/home-time-schedule/rules.ts')).href)
const rows = (root) => import(pathToFileURL(join(root, 'src/features/preview/laptop.ts')).href)
const driverRules = (root) => import(pathToFileURL(join(root, 'src/features/driver-master/rules.ts')).href)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (d) => { raw += d; if (raw.length > 100_000) req.destroy() })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new Refused(400, 'The body is not JSON.')) } })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
