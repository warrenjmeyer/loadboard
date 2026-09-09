// ---------------------------------------------------------------------------
// The authorization matrix, against a real Millstream.
//
// Every cell below is a question of the form "can THIS person reach THAT?",
// and the wrong answer in either direction is a bug worth catching: a false
// deny is an annoyance, a false allow hands one driver another's pay.
//
//   $env:SQL_SERVER / SQL_DATABASE / SQL_USER / SQL_PASSWORD
//   $env:AUTH_PEPPER
//   node api/src/functions/authz.check.js
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { app } = require('@azure/functions')

// Capture the handlers as the modules register them. app.http is a no-op in
// test mode, so intercepting it is the only way to reach handlers that are
// otherwise defined inline -- and it means settlements.js needs no edit purely
// to be testable.
const handlers = {}

// Deliberately NOT at module scope. Replacing app.http is exactly what broke
// production when this file was loaded as a function, so it happens inside a
// call that only the direct-execution path makes.
function captureHandlers() {
  const realHttp = app.http.bind(app)
  app.http = (name, opts) => { handlers[name] = opts.handler }
  try {
    require('../src/functions/loads')
    require('../src/functions/settlements')
    require('../src/functions/fleet')
    require('../src/functions/customers')
    require('../src/functions/payrun')
    require('../src/functions/deductions')
    require('../src/functions/charges')
  } finally {
    app.http = realHttp
  }
}

const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')

const IP = '203.0.113.199'
const PASSWORD = 'a long enough passphrase for authz'
const SUFFIX = crypto.randomUUID()
const TEST_LOAD_ID = `ZZ-${SUFFIX.slice(0, 6).toUpperCase()}`

const people = {}   // role -> { userId, email, cookie }
let passed = 0
const ok = (label) => { passed++; console.log(`  ok  ${label}`) }

const ctx = { error: (...a) => console.log('    [ctx.error]', ...a), log: () => {} }

function req({ cookie = null, body = null, params = {}, method = 'GET' } = {}) {
  const headers = { 'x-forwarded-for': IP, 'user-agent': 'authz-check/1.0', ...(cookie ? { cookie } : {}) }
  return {
    method,
    params,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  }
}

async function makePerson(role, driverCode) {
  const email = `claude-authz-${role}-${SUFFIX}@example.invalid`
  const created = await store.createUser(email, await auth.hashPassword(PASSWORD), `authz ${role}`, IP)

  if (role !== 'none') {
    // Role and DriverCode move together: CK_Users_DriverCode requires a driver
    // to have a code and everyone else not to have one.
    const pool = await getPool()
    await pool.request()
      .input('u', sql.Int, created.UserId)
      .input('r', sql.VarChar(20), role)
      .input('d', sql.VarChar(20), driverCode || null)
      .query('UPDATE auth.Users SET [Role] = @r, DriverCode = @d, ModifiedUtc = SYSUTCDATETIME() WHERE UserId = @u;')
  }

  const { token } = await store.createSession(created.UserId, IP, 'authz-check/1.0')
  people[role] = { userId: created.UserId, email, cookie: `lb_session=${token}` }
  return people[role]
}

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  captureHandlers()
  await getPool()

  // A real driver code, because auth.Users.DriverCode has a foreign key to
  // dbo.Drivers and a made-up one would be rejected.
  const pool = await getPool()
  const drivers = await pool.request().query('SELECT TOP 2 driver_code FROM dbo.Drivers ORDER BY driver_code;')
  assert.ok(drivers.recordset.length >= 2, 'need two drivers to test cross-driver access')
  const MINE = drivers.recordset[0].driver_code
  const THEIRS = drivers.recordset[1].driver_code
  console.log(`driver codes: mine=${MINE} theirs=${THEIRS}\n`)

  await makePerson('none')
  await makePerson('driver', MINE)
  await makePerson('dispatcher')
  await makePerson('admin')
  ok('created a pending, a driver, a dispatcher and an admin')

  // --- GET /api/loads stays public ----------------------------------------
  let r = await handlers.loads(req(), ctx)
  assert.strictEqual(r.status, undefined, 'GET /api/loads must not have become gated')
  assert.ok(Array.isArray(r.jsonBody))
  ok('GET /api/loads is still public')

  // --- POST /api/loads ----------------------------------------------------
  const newLoad = {
    id: TEST_LOAD_ID, origin: 'Testville, IA', destination: 'Checkton, NE',
    miles: 120, rate: 500, equipment: 'Dry Van',
  }

  r = await handlers.loads(req({ method: 'POST', body: newLoad }), ctx)
  assert.strictEqual(r.status, 401, 'anonymous POST must be refused')
  ok('anonymous cannot add a load -> 401')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.none.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  assert.match(r.jsonBody.error, /waiting for approval/i, 'a pending account is told why')
  ok('a pending account cannot add a load -> 403, told it is pending')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.driver.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  assert.match(r.jsonBody.error, /permission/i)
  ok('a driver cannot add a load -> 403')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.id, TEST_LOAD_ID)
  assert.strictEqual(r.jsonBody.status, 'Available')
  ok('a dispatcher CAN add a load -> 201')

  // --- aggregate settlement views -----------------------------------------
  for (const [who, cookie, expected] of [
    ['anonymous', null, 401],
    ['a pending account', people.none.cookie, 403],
    ['a driver', people.driver.cookie, 403],
  ]) {
    r = await handlers.settlementBoard(req({ cookie }), ctx)
    assert.strictEqual(r.status, expected, `${who} on /api/settlements`)
    r = await handlers.driverList(req({ cookie }), ctx)
    assert.strictEqual(r.status, expected, `${who} on /api/drivers`)
  }
  ok('anonymous 401, pending 403, driver 403 on both aggregate views')

  r = await handlers.settlementBoard(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody))
  ok(`a dispatcher sees the settlements board (${r.jsonBody.length} rows)`)

  // Admin was untested until 2026-09-02. It is the role Warren actually holds,
  // which makes it the one role where being wrong is guaranteed to be noticed.
  r = await handlers.settlementBoard(req({ cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody) && r.jsonBody.length > 0)
  ok(`an ADMIN sees the settlements board (${r.jsonBody.length} rows)`)

  r = await handlers.driverList(req({ cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody) && r.jsonBody.length > 0)
  ok(`an ADMIN sees the driver list (${r.jsonBody.length} drivers)`)

  r = await handlers.settlementList(req({ cookie: people.admin.cookie, params: { driverCode: THEIRS } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  ok(`an ADMIN can open any driver's statements (${THEIRS})`)

  r = await handlers.loads(req({ method: 'POST', body: { ...newLoad, id: TEST_LOAD_ID + 'A' }, cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  ok('an ADMIN can add a load')

  // --- one driver's statement ---------------------------------------------
  const listReq = (cookie, code) => req({ cookie, params: { driverCode: code } })

  r = await handlers.settlementList(listReq(null, MINE), ctx)
  assert.strictEqual(r.status, 401)
  ok(`anonymous cannot read ${MINE}'s settlements -> 401`)

  r = await handlers.settlementList(listReq(people.driver.cookie, MINE), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody))
  ok(`a driver CAN read their own settlements (${r.jsonBody.length} rows)`)

  // The one that matters most.
  r = await handlers.settlementList(listReq(people.driver.cookie, THEIRS), ctx)
  assert.strictEqual(r.status, 403, 'a driver must not read another driver')
  ok(`a driver CANNOT read ${THEIRS}'s settlements -> 403`)

  // Case must not be a way around it.
  r = await handlers.settlementList(listReq(people.driver.cookie, THEIRS.toLowerCase()), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.settlementList(listReq(people.driver.cookie, MINE.toLowerCase()), ctx)
  assert.strictEqual(r.status, undefined)
  ok('the driver-code comparison is case-insensitive in both directions')

  r = await handlers.settlementList(listReq(people.dispatcher.cookie, THEIRS), ctx)
  assert.strictEqual(r.status, undefined)
  ok('a dispatcher can read any driver')

  r = await handlers.settlementList(listReq(people.none.cookie, MINE), ctx)
  assert.strictEqual(r.status, 403)
  ok('a pending account cannot read anyone -> 403')

  // --- the detail route, same rules ---------------------------------------
  const anyDate = (await pool.request().input('d', sql.VarChar(20), MINE)
    .query('SELECT TOP 1 CONVERT(char(10), check_date, 23) AS d FROM dbo.Settlements WHERE driver_code = @d ORDER BY check_date DESC;'))
    .recordset[0]

  if (anyDate) {
    const detailReq = (cookie, code) => req({ cookie, params: { driverCode: code, checkDate: anyDate.d } })

    r = await handlers.settlementDetail(detailReq(null, MINE), ctx)
    assert.strictEqual(r.status, 401)
    r = await handlers.settlementDetail(detailReq(people.driver.cookie, THEIRS), ctx)
    assert.strictEqual(r.status, 403)
    r = await handlers.settlementDetail(detailReq(people.driver.cookie, MINE), ctx)
    assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
    ok(`the detail route enforces the same rule (${MINE} on ${anyDate.d})`)
  } else {
    ok('no settlements for that driver; detail route check skipped')
  }

  // --- the lifecycle: PATCH /api/loads/{id} --------------------------------
  // The test load the dispatcher created above is Available. Walk it through
  // its life with the wrong people trying at each step.
  const patch = (cookie, body, id = TEST_LOAD_ID) =>
    handlers.load(req({ method: 'PATCH', cookie, body, params: { id } }), ctx)
  const getOne = (cookie, id = TEST_LOAD_ID) =>
    handlers.load(req({ cookie, params: { id } }), ctx)

  r = await patch(null, { driverCode: MINE })
  assert.strictEqual(r.status, 401)
  r = await patch(people.none.cookie, { driverCode: MINE })
  assert.strictEqual(r.status, 403)
  r = await patch(people.driver.cookie, { driverCode: MINE })
  assert.strictEqual(r.status, 403, 'a driver must not assign themselves')
  ok('assignment: anonymous 401, pending 403, driver 403')

  r = await patch(people.driver.cookie, { status: 'In Transit' })
  assert.strictEqual(r.status, 400, 'Available -> In Transit is not a move for anyone')
  ok('an impossible move is refused as a 400 in words')

  r = await patch(people.dispatcher.cookie, { driverCode: MINE.toLowerCase(), unitNo: 'ZZ-1' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'Covered')
  assert.strictEqual(r.jsonBody.driverCode, MINE)
  assert.strictEqual(r.jsonBody.unitNo, 'ZZ-1')
  assert.deepStrictEqual(r.jsonBody.actions.transitions, ['Available', 'In Transit', 'Delivered', 'Cancelled'])
  ok('a dispatcher assigns -> Covered, driver code upper-cased, unit stored')

  r = await getOne(null)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'Covered')
  assert.strictEqual(r.jsonBody.driverCode, null, 'anonymous must not see the driver')
  assert.strictEqual(r.jsonBody.unitNo, null)
  assert.deepStrictEqual(r.jsonBody.actions, { canEdit: false, canAssign: false, transitions: [] })
  ok('anonymous sees the covered load with the people stripped and no actions')

  r = await getOne(people.driver.cookie)
  assert.strictEqual(r.jsonBody.driverCode, MINE)
  assert.deepStrictEqual(r.jsonBody.actions, { canEdit: false, canAssign: false, transitions: ['In Transit'] })
  ok('the driver on the load is offered exactly "In Transit"')

  r = await patch(people.driver.cookie, { status: 'Delivered' })
  assert.strictEqual(r.status, 403, 'a driver may not skip pickup')
  ok('the driver may not go Covered -> Delivered directly -> 403')

  r = await patch(people.driver.cookie, { status: 'In Transit' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'In Transit')
  r = await patch(people.driver.cookie, { status: 'Delivered', deliveredDate: '2026-09-09' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'Delivered')
  assert.strictEqual(r.jsonBody.deliveredDate, '2026-09-09')
  assert.deepStrictEqual(r.jsonBody.actions.transitions, [])
  ok('the driver reports pickup, then delivery with a date')

  r = await getOne(null)
  assert.strictEqual(r.status, 404, 'a delivered load must be NOT FOUND to anonymous, never 403')
  ok('a delivered load is not found for anonymous')

  r = await handlers.loadEvents(req({ params: { id: TEST_LOAD_ID } }), ctx)
  assert.strictEqual(r.status, 401)
  r = await handlers.loadEvents(req({ cookie: people.driver.cookie, params: { id: TEST_LOAD_ID } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.deepStrictEqual(r.jsonBody.map((e) => e.type), ['Created', 'Assigned', 'Status', 'Status', 'Status'])
  assert.strictEqual(r.jsonBody[1].driverCode, MINE)
  assert.strictEqual(r.jsonBody[4].toStatus, 'Delivered')
  ok('the history records every step, in order, with who did it')

  r = await handlers.roster(req({ cookie: people.driver.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.roster(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.some((d) => d.driverCode === MINE))
  ok(`the roster is dispatch-only and lists ${r.jsonBody.length} drivers`)

  r = await patch(people.dispatcher.cookie, { driverCode: THEIRS })
  assert.strictEqual(r.status, 400, 'a delivered load must not be reassigned in place')
  r = await patch(people.admin.cookie, { status: 'In Transit' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.deliveredDate, null)
  assert.strictEqual(r.jsonBody.driverCode, MINE)
  ok('an admin can undo a delivery; the date clears and the driver stays')

  r = await patch(people.dispatcher.cookie, { commodity: 'authz check', weightLbs: 100, pickupStart: '2026-09-10T08:00' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.commodity, 'authz check')
  assert.strictEqual(r.jsonBody.pickupStart, '2026-09-10T08:00:00', 'the appointment must come back as stored, no timezone applied')
  ok('details edit round-trips, and a naive datetime stays naive')

  // --- the fleet -------------------------------------------------------------
  r = await handlers.trucks(req(), ctx)
  assert.strictEqual(r.status, 401)
  r = await handlers.trucks(req({ cookie: people.none.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.trucks(req({ cookie: people.driver.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody) && r.jsonBody.length > 0)
  assert.ok(r.jsonBody.every((t) => 'registrationDays' in t))
  ok(`a driver can read the fleet (${r.jsonBody.length} trucks); anonymous 401, pending 403`)

  const TEST_UNIT = `ZZ-${SUFFIX.slice(0, 4).toUpperCase()}`
  r = await handlers.trucks(req({ method: 'POST', cookie: people.driver.cookie, body: { unitNo: TEST_UNIT, description: 'authz truck' } }), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.trucks(req({ method: 'POST', cookie: people.dispatcher.cookie, body: { unitNo: TEST_UNIT, description: 'authz truck', plate: 'zz 1', plateState: 'ia' } }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.plate, 'ZZ 1')
  assert.strictEqual(r.jsonBody.status, 'Active')
  ok('a dispatcher adds a truck; a driver may not')

  r = await handlers.truck(req({ method: 'PATCH', cookie: people.dispatcher.cookie, params: { unitNo: TEST_UNIT }, body: { status: 'Shop' } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'Shop')
  ok('a truck can be sent to the shop')

  // The load from the lifecycle section is In Transit with MINE on it. A
  // unit that is not in dbo.Trucks is refused in words, not as a 500.
  r = await patch(people.dispatcher.cookie, { unitNo: 'ZZ-NOSUCH' })
  assert.strictEqual(r.status, 400, JSON.stringify(r.jsonBody))
  assert.match(r.jsonBody.error, /no truck with that unit number/)
  r = await patch(people.dispatcher.cookie, { unitNo: TEST_UNIT })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.unitNo, TEST_UNIT)
  ok('a load takes only a truck that exists')

  r = await handlers.trailers(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  const anyTrailer = r.jsonBody.find((t) => t.status === 'Active')
  if (anyTrailer) {
    r = await patch(people.dispatcher.cookie, { trailerNo: anyTrailer.trailerNo })
    assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
    assert.strictEqual(r.jsonBody.trailerNo, anyTrailer.trailerNo)
    ok(`a trailer rides along (${anyTrailer.trailerNo})`)
  }

  // Take the test truck back off the load so cleanup can delete it.
  r = await patch(people.dispatcher.cookie, { unitNo: null })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))

  // --- customers -------------------------------------------------------------
  r = await handlers.customers(req(), ctx)
  assert.strictEqual(r.status, 401)
  r = await handlers.customers(req({ cookie: people.driver.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody))
  ok(`a driver can read customers (${r.jsonBody.length}); anonymous 401`)

  const custName = `ZZ Authz Customer ${SUFFIX.slice(0, 6)}`
  r = await handlers.customers(req({ method: 'POST', cookie: people.driver.cookie, body: { name: custName } }), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.customers(req({ method: 'POST', cookie: people.dispatcher.cookie, body: { name: custName, mcNumber: '123456', status: 'Hold' } }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.mcNumber, 'MC-123456')
  const custId = r.jsonBody.customerId
  ok('a dispatcher adds a customer on hold; a driver may not')

  // Second test load: Available, no driver. Link it to the held customer,
  // then try to cover it.
  r = await patch(people.dispatcher.cookie, { customerId: custId }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.customerName, custName, 'the name must be copied from the record')
  assert.strictEqual(r.jsonBody.customerStatus, 'Hold')
  r = await patch(people.dispatcher.cookie, { driverCode: THEIRS }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, 400, JSON.stringify(r.jsonBody))
  assert.match(r.jsonBody.error, /is on hold/)
  ok('a load for a customer on hold cannot be covered, in words')

  r = await handlers.customer(req({ method: 'PATCH', cookie: people.dispatcher.cookie, params: { id: String(custId) }, body: { status: 'Active' } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  r = await patch(people.dispatcher.cookie, { driverCode: THEIRS }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.status, 'Covered')
  ok('lifting the hold lets the same load be covered')

  r = await handlers.customer(req({ cookie: people.driver.cookie, params: { id: String(custId) } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.loads.some((l) => l.id === TEST_LOAD_ID + 'A'))
  ok("the customer's page lists the load")

  r = await patch(people.dispatcher.cookie, { customerId: 999999999 }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, 400)
  ok('a customer id that does not exist is refused in words')

  // Unlink so cleanup can delete the customer.
  r = await patch(people.dispatcher.cookie, { customerId: null, driverCode: null }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))

  // --- the pay run -----------------------------------------------------------
  // The first test load is In Transit with MINE on it (undone delivery above).
  // Deliver it inside a period nobody has been paid for, preview, then run.
  const PERIOD = { periodStart: '2031-01-05', periodEnd: '2031-01-11', checkDate: '2031-01-17' }
  r = await patch(people.dispatcher.cookie, { status: 'Delivered', deliveredDate: '2031-01-08', emptyMiles: 25 })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.emptyMiles, 25)

  const payrunReq = (cookie, method = 'GET', body = null) => {
    const q = new URLSearchParams(PERIOD)
    const base = req({ cookie, method, body })
    base.query = { get: (k) => q.get(k) }
    return base
  }
  r = await handlers.payrun(payrunReq(null), ctx)
  assert.strictEqual(r.status, 401)
  r = await handlers.payrun(payrunReq(people.dispatcher.cookie), ctx)
  assert.strictEqual(r.status, 403, 'payroll is not dispatch')
  ok('the pay run is admin-only: anonymous 401, dispatcher 403')

  r = await handlers.payrun(payrunReq(people.admin.cookie), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  const mine = r.jsonBody.settlements.find((s) => s.driverCode === MINE)
  assert.ok(mine, 'the preview must list the driver with the unpaid load')
  const myRoute = mine.routes.find((x) => x.loadId === TEST_LOAD_ID)
  assert.ok(myRoute)
  assert.strictEqual(myRoute.totalMiles, newLoad.miles + 25)
  assert.strictEqual(myRoute.payAmount, Math.round((newLoad.miles + 25) * mine.payRate * 100) / 100)
  ok(`the preview pays ${MINE} ${myRoute.totalMiles} miles at ${mine.payRate} = ${myRoute.payAmount}`)

  r = await handlers.payrun(payrunReq(people.admin.cookie, 'POST', { ...PERIOD, driverCodes: [MINE] }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.created.length, 1)
  const doc = r.jsonBody.created[0].documentNo
  assert.match(doc, /^CK-310117-\d{4}$/)
  ok(`a settlement was generated: ${doc}`)

  r = await handlers.settlementDetail(req({ cookie: people.driver.cookie, params: { driverCode: MINE, checkDate: PERIOD.checkDate } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.routes.some((x) => x.loadId === TEST_LOAD_ID), 'the statement must show the load')
  ok('the driver can open the generated statement and the load is on it')

  r = await handlers.payrun(payrunReq(people.admin.cookie, 'POST', { ...PERIOD, driverCodes: [MINE] }), ctx)
  assert.ok(r.status === 400 || r.status === 409, `a second run must not pay twice, got ${r.status}`)
  ok('running it again pays nothing twice')

  r = await handlers.loadEvents(req({ cookie: people.driver.cookie, params: { id: TEST_LOAD_ID } }), ctx)
  assert.ok(r.jsonBody.some((e) => e.detail === `Paid on ${doc}`))
  ok('the load\'s history names the statement')

  // --- standing deductions --------------------------------------------------
  // Give MINE a truck payment and a small loan, then re-run payroll for a
  // second load and see both come out. The first pay run above already paid
  // the first test load; load A is Available with no driver, so deliver it.
  r = await handlers.deductions(req({ cookie: people.dispatcher.cookie, method: 'POST', body: { driverCode: MINE, code: 'ZZTEST', description: 'AUTHZ TRUCK', amount: 100 } }), ctx)
  assert.strictEqual(r.status, 403, 'deductions are admin-only')
  r = await handlers.deductions(req({ cookie: people.admin.cookie, method: 'POST', body: { driverCode: MINE, code: 'ZZTEST', description: 'AUTHZ TRUCK', amount: 100 } }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  const dedId = r.jsonBody.deductionId
  r = await handlers.deductions(req({ cookie: people.admin.cookie, method: 'POST', body: { driverCode: MINE, code: 'ZZLOAN', description: 'AUTHZ ADVANCE', amount: 50, balance: 30 } }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  const loanId = r.jsonBody.deductionId
  ok('an admin adds a weekly deduction and a loan; a dispatcher may not')

  const listReq2 = req({ cookie: people.admin.cookie })
  listReq2.query = { get: (k) => (k === 'driver' ? MINE : null) }
  r = await handlers.deductions(listReq2, ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.some((d) => d.deductionId === dedId) && r.jsonBody.some((d) => d.deductionId === loanId))
  ok('they list for the driver')

  r = await patch(people.dispatcher.cookie, { driverCode: MINE }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  r = await patch(people.dispatcher.cookie, { status: 'In Transit' }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  r = await patch(people.dispatcher.cookie, { status: 'Delivered', deliveredDate: '2031-01-15' }, TEST_LOAD_ID + 'A')
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))

  const PERIOD2 = { periodStart: '2031-01-12', periodEnd: '2031-01-18', checkDate: '2031-01-24' }
  const payrunReq2 = (cookie, method = 'GET', body = null) => {
    const q = new URLSearchParams(PERIOD2)
    const base = req({ cookie, method, body })
    base.query = { get: (k) => q.get(k) }
    return base
  }
  r = await handlers.payrun(payrunReq2(people.admin.cookie), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  const mine2 = r.jsonBody.settlements.find((s) => s.driverCode === MINE)
  assert.ok(mine2)
  assert.deepEqual(mine2.lines.map((l) => [l.code, l.amount]).sort(), [['ZZLOAN', -30], ['ZZTEST', -100]])
  assert.strictEqual(mine2.net, Math.round((mine2.routePay - 130) * 100) / 100)
  ok(`the preview nets ${mine2.routePay} less 130 = ${mine2.net}; the loan takes only what is owed`)

  r = await handlers.payrun(payrunReq2(people.admin.cookie, 'POST', { ...PERIOD2, driverCodes: [MINE] }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.created[0].net, mine2.net)
  const doc2 = r.jsonBody.created[0].documentNo

  r = await handlers.settlementDetail(req({ cookie: people.driver.cookie, params: { driverCode: MINE, checkDate: PERIOD2.checkDate } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.deductions.some((l) => l.code === 'ZZTEST' && l.amount === -100), JSON.stringify(r.jsonBody.deductions))
  assert.strictEqual(r.jsonBody.totals.settlementTotal, mine2.net)
  ok(`the statement ${doc2} shows the deduction lines and the net total`)

  r = await handlers.deductions(listReq2, ctx)
  const loanAfter = r.jsonBody.find((d) => d.deductionId === loanId)
  assert.strictEqual(loanAfter.balance, 0)
  assert.strictEqual(loanAfter.active, false)
  ok('the loan is paid off and switched itself off')

  // --- accessorials -----------------------------------------------------------
  // Load A is Delivered and already paid (the deductions run above). Charges
  // added now are stragglers: the next run pays them on their own.
  const chargesReq = (cookie, method = 'GET', body = null) => req({ cookie, method, body, params: { id: TEST_LOAD_ID + 'A' } })
  r = await handlers.loadCharges(chargesReq(null), ctx)
  assert.strictEqual(r.status, 401)
  r = await handlers.loadCharges(chargesReq(people.driver.cookie, 'POST', { code: 'DETENTION', amount: 90 }), ctx)
  assert.strictEqual(r.status, 403, 'a driver may not pay themselves detention')
  r = await handlers.loadCharges(chargesReq(people.driver.cookie, 'POST', { code: 'TOLLS', amount: 12.5, receiptNote: 'authz toll' }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.lineType, 'REIMBURSEMENT')
  assert.strictEqual(r.jsonBody.paidOn, null)
  const tollId = r.jsonBody.chargeId
  r = await handlers.loadCharges(chargesReq(people.dispatcher.cookie, 'POST', { code: 'DETENTION', description: 'Detention - 2 hrs', amount: 90, billCustomer: true, billAmount: 150 }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.description, 'DETENTION - 2 HRS')
  assert.strictEqual(r.jsonBody.billAmount, 150)
  ok('the driver turns in a toll receipt; dispatch adds detention billed at a different amount')

  r = await handlers.loadCharges(chargesReq(people.driver.cookie), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.length, 2)
  ok('both charges list on the load')

  const PERIOD3 = { periodStart: '2031-01-19', periodEnd: '2031-01-25', checkDate: '2031-01-31' }
  const payrunReq3 = (cookie, method = 'GET', body = null) => {
    const q = new URLSearchParams(PERIOD3)
    const base = req({ cookie, method, body })
    base.query = { get: (k) => q.get(k) }
    return base
  }
  r = await handlers.payrun(payrunReq3(people.admin.cookie), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  const mine3 = r.jsonBody.settlements.find((s) => s.driverCode === MINE)
  assert.ok(mine3, 'a driver with only stragglers must still be in the run')
  assert.strictEqual(mine3.loadCount, 0)
  assert.strictEqual(mine3.routePay, 0)
  assert.strictEqual(mine3.extrasTotal, 102.5)
  assert.ok(mine3.lines.some((l) => l.code === 'TOLLS' && l.amount === 12.5 && l.orderNo === TEST_LOAD_ID + 'A'))
  ok(`the preview pays the stragglers on their own: extras ${mine3.extrasTotal}, net ${mine3.net}`)

  r = await handlers.payrun(payrunReq3(people.admin.cookie, 'POST', { ...PERIOD3, driverCodes: [MINE] }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  const doc3 = r.jsonBody.created[0].documentNo

  r = await handlers.loadCharges(chargesReq(people.driver.cookie), ctx)
  assert.ok(r.jsonBody.every((c) => c.paidOn && c.paidOn.documentNo === doc3), JSON.stringify(r.jsonBody))
  ok(`both charges now say paid on ${doc3}`)

  r = await handlers.charge(req({ cookie: people.dispatcher.cookie, method: 'DELETE', params: { chargeId: String(tollId) } }), ctx)
  assert.strictEqual(r.status, 409, 'a paid charge must not be removable')
  ok('a paid charge cannot be removed')

  r = await handlers.settlementDetail(req({ cookie: people.driver.cookie, params: { driverCode: MINE, checkDate: PERIOD3.checkDate } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(r.jsonBody.reimbursements.some((l) => l.code === 'TOLLS' && l.orderNo === TEST_LOAD_ID + 'A'), JSON.stringify(r.jsonBody.reimbursements))
  assert.ok(r.jsonBody.revenue.some((l) => l.code === 'DETENTION'), JSON.stringify(r.jsonBody.revenue))
  ok('the statement shows the toll as a reimbursement on the load and the detention as revenue')

  // --- a revoked session loses everything immediately ---------------------
  await store.revokeSession(people.dispatcher.cookie.split('=')[1], 'Logout', IP)
  r = await handlers.settlementBoard(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, 401, 'revoking a session must take effect at once')
  ok('a revoked session loses access immediately, not at expiry')
}

async function cleanup() {
  const pool = await getPool()
  const ids = Object.values(people).map((p) => p.userId).filter(Boolean)

  // A generated settlement points at the test load (FK_Routes_load, NO ACTION),
  // so it goes first; its routes cascade.
  await pool.request().query("DELETE s FROM dbo.Settlements AS s WHERE EXISTS (SELECT 1 FROM dbo.SettlementRoutes AS r WHERE r.settlement_id = s.settlement_id AND r.load_id LIKE 'ZZ-%') OR EXISTS (SELECT 1 FROM dbo.SettlementLines AS l WHERE l.settlement_id = s.settlement_id AND l.order_no LIKE 'ZZ-%');")
  await pool.request().input('id', sql.VarChar(20), TEST_LOAD_ID)
    .query("DELETE FROM dbo.Loads WHERE id = @id OR id = @id + 'A'; DELETE FROM dbo.Trucks WHERE unit_no LIKE 'ZZ-%'; DELETE FROM dbo.DriverDeductions WHERE code LIKE 'ZZ%'; DELETE FROM dbo.Customers WHERE name LIKE 'ZZ Authz Customer %';")

  for (const id of ids) {
    await pool.request().input('u', sql.Int, id).input('ip', sql.VarChar(45), IP).query(`
      DELETE FROM auth.AuthEvents     WHERE UserId = @u;
      DELETE FROM auth.LoginAttempts  WHERE UserId = @u OR IpAddress = @ip;
      DELETE FROM auth.RateLimits     WHERE IpAddress = @ip;
      DELETE FROM auth.Sessions       WHERE UserId = @u;
      DELETE FROM auth.SecurityTokens WHERE UserId = @u;
      DELETE FROM auth.UserPasswords  WHERE UserId = @u;
      DELETE FROM auth.Users          WHERE UserId = @u;
    `)
  }

  const left = await pool.request()
    .query(`SELECT (SELECT COUNT(*) FROM auth.Users WHERE Email LIKE 'claude-authz-%') AS users,
                   (SELECT COUNT(*) FROM dbo.Loads WHERE id LIKE 'ZZ-%') AS loads;`)
  console.log(`\ncleanup  test users left: ${left.recordset[0].users}, test loads left: ${left.recordset[0].loads}`)
}

// ---------------------------------------------------------------------------
// Only run when executed directly, never when required.
//
// This guard exists because its absence took the production API down. These
// files used to live in api/src/functions/, which package.json globs as
// "src/functions/*.js" -- so Azure loaded them as if they were functions, ran
// main() against the live database, and called process.exit() inside the
// Functions host. authz.check.js additionally replaces app.http to capture
// handlers rather than register them, and it sorts before loads.js, so
// /api/loads and every settlement route were swallowed and never registered.
//
// Moving them out of that folder is the real fix. This is the belt to its
// braces: even if something requires this file, nothing happens.
// ---------------------------------------------------------------------------
if (require.main !== module) {
  module.exports = { main, cleanup }
} else {
  main()
    .then(async () => { await cleanup(); console.log(`\nALL PASS (${passed} checks)`); process.exit(0) })
    .catch(async (err) => {
      console.error(`\nFAILED: ${err.message}`)
      try { await cleanup() } catch (e) { console.error(`cleanup also failed: ${e.message}`) }
      process.exit(1)
    })
}
